import { htmlToText } from "./text.js";

const ALWAYS_REMOVE = ["nav", "form", "button", "select", "svg", "iframe", "dialog"];
const BODY_REMOVE = ["header", "footer", "aside"];

function stripInvisible(html) {
    return String(html || "")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

function parseSelector(selector) {
    const match = selector.trim().match(/^([a-z][a-z0-9-]*)?(?:#([\w-]+))?(?:\.([\w-]+))?$/i);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;
    return { tag: match[1] ? match[1].toLowerCase() : "", id: match[2] || "", className: match[3] || "" };
}

function attribute(attributes, name) {
    const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    return match ? match[2] : "";
}

function matches(tag, attributes, rule) {
    if (rule.tag && tag !== rule.tag) return false;
    if (rule.id && attribute(attributes, "id") !== rule.id) return false;
    if (rule.className && !attribute(attributes, "class").split(/\s+/).includes(rule.className)) return false;
    return true;
}

function closingIndex(html, tag, from) {
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    pattern.lastIndex = from;
    let depth = 1;
    let match;
    while ((match = pattern.exec(html))) {
        if (match[0].endsWith("/>")) continue;
        depth += match[1] ? -1 : 1;
        if (depth === 0) return { start: match.index, end: pattern.lastIndex };
    }
    return { start: html.length, end: html.length };
}

function findElement(html, rule) {
    const pattern = /<([a-z][\w-]*)(\s[^>]*)?>/gi;
    let match;
    while ((match = pattern.exec(html))) {
        const tag = match[1].toLowerCase();
        if (!matches(tag, match[2] || "", rule)) continue;
        return html.slice(pattern.lastIndex, closingIndex(html, tag, pattern.lastIndex).start);
    }
    return null;
}

function removeElements(html, tags) {
    let result = html;
    for (const tag of tags) {
        const pattern = new RegExp(`<${tag}\\b[^>]*>`, "i");
        let match;
        while ((match = pattern.exec(result))) {
            const end = match[0].endsWith("/>")
                ? match.index + match[0].length
                : closingIndex(result, tag, match.index + match[0].length).end;
            result = `${result.slice(0, match.index)} ${result.slice(end)}`;
        }
    }
    return result;
}

function removeMatching(html, selectors) {
    let result = html;
    for (const selector of String(selectors || "").split(",")) {
        const rule = parseSelector(selector);
        if (!rule) continue;
        const pattern = /<([a-z][\w-]*)(\s[^>]*)?>/gi;
        let match;
        while ((match = pattern.exec(result))) {
            const tag = match[1].toLowerCase();
            if (!matches(tag, match[2] || "", rule)) continue;
            const end = match[0].endsWith("/>")
                ? match.index + match[0].length
                : closingIndex(result, tag, match.index + match[0].length).end;
            result = `${result.slice(0, match.index)} ${result.slice(end)}`;
            pattern.lastIndex = match.index;
        }
    }
    return result;
}

export function extractPage(html, selectors, removeSelectors) {
    const clean = removeMatching(stripInvisible(html), removeSelectors);
    for (const selector of String(selectors || "").split(",")) {
        const rule = parseSelector(selector);
        if (!rule) continue;
        const part = findElement(clean, rule);
        if (part !== null) {
            return { matched: selector.trim(), text: htmlToText(removeElements(part, ALWAYS_REMOVE)) };
        }
    }
    const body = findElement(clean, { tag: "body", id: "", className: "" }) ?? clean;
    return { matched: "body", text: htmlToText(removeElements(body, [...ALWAYS_REMOVE, ...BODY_REMOVE])) };
}

export function pageTitle(html) {
    const clean = stripInvisible(html);
    const heading = findElement(clean, { tag: "h1", id: "", className: "" });
    if (heading) return htmlToText(heading);
    const title = findElement(clean, { tag: "title", id: "", className: "" });
    return title ? htmlToText(title) : "";
}