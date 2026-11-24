<?php
/**
 * Plugin Name: Smart Search
 * Description: Sends pages to the Smart Search service when they are saved or deleted, so the chat always knows the current content.
 * Version: 1.1.0
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const SMART_SEARCH_OPTION = 'smart_search_options';
const SMART_SEARCH_LAST = 'smart_search_last';
const SMART_SEARCH_EXCLUDE = '_smart_search_exclude';

function smart_search_options()
{
    $defaults = [
        'service_url' => '',
        'site_id' => '',
        'hook_secret' => '',
        'post_types' => 'post, page',
    ];
    return array_merge($defaults, (array) get_option(SMART_SEARCH_OPTION, []));
}

function smart_search_post_types()
{
    $types = array_map('trim', explode(',', smart_search_options()['post_types']));
    return array_values(array_filter($types));
}

function smart_search_send($body)
{
    $options = smart_search_options();
    if ($options['service_url'] === '' || $options['site_id'] === '' || $options['hook_secret'] === '') {
        return new WP_Error('smart_search_not_configured', 'Fill in Service URL, Site ID and Hook secret');
    }
    $url = untrailingslashit($options['service_url']) . '/hooks/pages/' . rawurlencode($options['site_id']);
    return wp_remote_post($url, [
        'timeout' => 10,
        'headers' => [
            'Content-Type' => 'application/json',
            'x-hook-secret' => $options['hook_secret'],
        ],
        'body' => wp_json_encode($body),
    ]);
}

function smart_search_result($response)
{
    if (is_wp_error($response)) {
        return ['ok' => false, 'code' => 0, 'message' => $response->get_error_message()];
    }
    $code = (int) wp_remote_retrieve_response_code($response);
    $data = json_decode(wp_remote_retrieve_body($response), true);
    $message = is_array($data) && isset($data['error']) ? $data['error'] : 'HTTP ' . $code;
    return ['ok' => $code >= 200 && $code < 300, 'code' => $code, 'message' => $message];
}

function smart_search_post_language($post)
{
    $details = apply_filters('wpml_post_language_details', null, $post->ID);
    if (is_array($details) && !empty($details['language_code'])) {
        return $details['language_code'];
    }
    if (function_exists('pll_get_post_language')) {
        $code = pll_get_post_language($post->ID);
        if ($code) {
            return $code;
        }
    }
    return '';
}

function smart_search_is_excluded($post_id)
{
    return (bool) get_post_meta($post_id, SMART_SEARCH_EXCLUDE, true);
}

function smart_search_notify($action, $post)
{
    if (!in_array($post->post_type, smart_search_post_types(), true)) {
        return;
    }
    $body = ['action' => $action, 'id' => (string) $post->ID];
    $lang = smart_search_post_language($post);
    if ($lang !== '') {
        $body['lang'] = $lang;
    }
    if ($action === 'upsert') {
        $body['url'] = get_permalink($post);
        $body['title'] = get_the_title($post);
    }
    $result = smart_search_result(smart_search_send($body));
    if (!$result['ok']) {
        error_log('Smart Search: ' . $action . ' post ' . $post->ID . ' failed: ' . $result['message']);
    }
    update_option(SMART_SEARCH_LAST, [
        'time' => current_time('mysql'),
        'action' => $action,
        'post' => $post->ID,
        'title' => get_the_title($post),
        'ok' => $result['ok'],
        'message' => $result['message'],
    ], false);
}

add_action('wp_after_insert_post', function ($post_id, $post) {
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id) || $post->post_status === 'auto-draft') {
        return;
    }
    $visible = $post->post_status === 'publish' && !smart_search_is_excluded($post_id);
    smart_search_notify($visible ? 'upsert' : 'delete', $post);
}, 10, 2);

add_action('add_meta_boxes', function () {
    add_meta_box('smart-search', 'Smart Search', 'smart_search_meta_box', smart_search_post_types(), 'side');
});

function smart_search_meta_box($post)
{
    wp_nonce_field('smart_search_exclude', 'smart_search_nonce');
    echo '<label><input type="checkbox" name="smart_search_exclude" value="1"' . checked(smart_search_is_excluded($post->ID), true, false) . '> Exclude from chat</label>';
    echo '<p class="description">The chat will not use this page. The page stays on the website.</p>';
}

add_action('save_post', function ($post_id) {
    if (!isset($_POST['smart_search_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['smart_search_nonce'])), 'smart_search_exclude')) {
        return;
    }
    if (wp_is_post_autosave($post_id) || wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }
    if (empty($_POST['smart_search_exclude'])) {
        delete_post_meta($post_id, SMART_SEARCH_EXCLUDE);
    } else {
        update_post_meta($post_id, SMART_SEARCH_EXCLUDE, '1');
    }
});

add_action('rest_api_init', function () {
    foreach (smart_search_post_types() as $type) {
        register_rest_field($type, 'smart_search_exclude', [
            'get_callback' => function ($item) {
                return smart_search_is_excluded($item['id']);
            },
            'schema' => ['type' => 'boolean', 'context' => ['view'], 'readonly' => true],
        ]);
    }
});

add_action('trashed_post', function ($post_id) {
    $post = get_post($post_id);
    if ($post) {
        smart_search_notify('delete', $post);
    }
});

add_action('before_delete_post', function ($post_id, $post) {
    if ($post && !wp_is_post_revision($post_id) && $post->post_status !== 'trash') {
        smart_search_notify('delete', $post);
    }
}, 10, 2);

function smart_search_check_connection()
{
    $result = smart_search_result(smart_search_send([]));
    if ($result['code'] === 400 && $result['message'] === 'id is required') {
        return ['ok' => true, 'message' => 'Connected. Saved pages will be sent to the service.'];
    }
    if ($result['code'] === 401) {
        return ['ok' => false, 'message' => 'Wrong Hook secret.'];
    }
    if ($result['code'] === 404) {
        return ['ok' => false, 'message' => 'Site not found. Check Site ID and Service URL.'];
    }
    return ['ok' => false, 'message' => $result['message']];
}

add_action('admin_init', function () {
    register_setting('smart_search', SMART_SEARCH_OPTION, [
        'type' => 'array',
        'sanitize_callback' => function ($input) {
            $old = smart_search_options();
            $input = (array) $input;
            $clean = [
                'service_url' => esc_url_raw(trim($input['service_url'] ?? '')),
                'site_id' => sanitize_text_field($input['site_id'] ?? ''),
                'hook_secret' => sanitize_text_field($input['hook_secret'] ?? ''),
                'post_types' => sanitize_text_field($input['post_types'] ?? ''),
            ];
            if ($clean['hook_secret'] === '') {
                $clean['hook_secret'] = $old['hook_secret'];
            }
            if ($clean['post_types'] === '') {
                $clean['post_types'] = 'post, page';
            }
            return $clean;
        },
    ]);
});

add_action('admin_menu', function () {
    add_options_page('Smart Search', 'Smart Search', 'manage_options', 'smart-search', 'smart_search_settings_page');
});

function smart_search_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $options = smart_search_options();
    $status = smart_search_check_connection();
    $last = get_option(SMART_SEARCH_LAST);
    $name = SMART_SEARCH_OPTION;
    $field = function ($key, $label, $hint, $type = 'text') use ($options, $name) {
        $value = $type === 'password' ? '' : $options[$key];
        $placeholder = $type === 'password' && $options[$key] !== '' ? 'Leave empty to keep the current value' : '';
        echo '<tr><th scope="row"><label for="ss-' . esc_attr($key) . '">' . esc_html($label) . '</label></th><td>';
        echo '<input class="regular-text" id="ss-' . esc_attr($key) . '" type="' . esc_attr($type) . '" name="' . esc_attr($name . '[' . $key . ']') . '" value="' . esc_attr($value) . '" placeholder="' . esc_attr($placeholder) . '" autocomplete="off">';
        echo '<p class="description">' . esc_html($hint) . '</p></td></tr>';
    };
    ?>
    <div class="wrap">
        <h1>Smart Search</h1>
        <div class="notice notice-<?php echo $status['ok'] ? 'success' : 'warning'; ?> inline">
            <p><?php echo esc_html($status['message']); ?></p>
        </div>
        <?php if (is_array($last)) : ?>
            <p>
                Last sent: <?php echo esc_html($last['time'] . ', ' . $last['action'] . ' "' . $last['title'] . '" (ID ' . $last['post'] . ')'); ?>
                &mdash; <?php echo $last['ok'] ? 'OK' : esc_html('failed: ' . $last['message']); ?>
            </p>
        <?php endif; ?>
        <form method="post" action="options.php">
            <?php settings_fields('smart_search'); ?>
            <table class="form-table" role="presentation">
                <?php
                $field('service_url', 'Service URL', 'For example https://search.lizaland.de');
                $field('site_id', 'Site ID', 'From the Smart Search admin page, block "CMS connection"');
                $field('hook_secret', 'Hook secret', 'From the same block, the value after "x-hook-secret:"', 'password');
                $field('post_types', 'Post types', 'Which post types are sent, comma separated. Usually: post, page');
                ?>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}
