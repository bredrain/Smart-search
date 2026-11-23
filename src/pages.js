import { htmlToText, chunkText } from "./text.js";
import { extractPage, pageTitle } from "./html.js";

export function pageToChunks(site, page) {
    const { text } = extractPage(page.html, site.contentSelector);
    const title = htmlToText(page.title || "") || pageTitle(page.html);
    return chunkText(text)
        .filter((piece) => piece.length >= 30)
        .map((piece) => ({
            text: piece,
            embedText: `${title}\n${piece}`,
            payload: { source: "page", pageId: String(page.id), title, url: page.url, ...(page.lang ? { lang: page.lang } : {}) },
        }));
}