import { replaceChunks, deleteWhere } from "./vectors.js";
import { fetchHtml } from "./wordpress.js";
import { pageToChunks } from "./pages.js";
import { httpError } from "./errors.js";

const MAX_HTML = 5 * 1024 * 1024;

function pageKey(site, input) {
    const id = String(input.id ?? "").trim();
    if (!id) throw httpError(400, "id is required");
    if (site.languages.length === 0) return { id, lang: "" };
    const lang = String(input.lang || "").toLowerCase();
    if (!site.languages.includes(lang)) {
        throw httpError(400, `lang must be one of: ${site.languages.join(", ")}`);
    }
    return { id, lang };
}

function conditions(key) {
    return { source: "page", pageId: key.id, ...(key.lang ? { lang: key.lang } : {}) };
}

export function checkPageUpdate(site, input) {
    const key = pageKey(site, input);
    if (input.action === "delete") {
        return { action: "delete", key };
    }
    if (input.action !== "upsert") {
        throw httpError(400, 'action must be "upsert" or "delete"');
    }
    let url;
    try {
        url = new URL(String(input.url || ""));
    } catch (err) {
        throw httpError(400, "url is required");
    }
    if (url.origin !== new URL(site.wpUrl).origin) {
        throw httpError(400, "url must be on the website of this site");
    }
    const html = input.html === undefined || input.html === null ? null : String(input.html);
    if (html !== null && html.length > MAX_HTML) {
        throw httpError(400, "html is too large");
    }
    return { action: "upsert", key, url: url.href, title: String(input.title || ""), html };
}

function freshUrl(url) {
    const fresh = new URL(url);
    fresh.searchParams.set("_ss", String(Date.now()));
    return fresh.href;
}

export async function applyPageUpdate(site, update) {
    if (update.action === "delete") {
        await deleteWhere(site.collection, conditions(update.key));
        return 0;
    }
    const html = update.html ?? (await fetchHtml(site, freshUrl(update.url)));
    const chunks = pageToChunks(site, { id: update.key.id, url: update.url, title: update.title, lang: update.key.lang, html });
    return replaceChunks(site.collection, conditions(update.key), chunks);
}