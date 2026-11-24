import { replaceChunks, deleteWhere, deleteLegacyChunks } from "./vectors.js";
import { setSyncResult } from "./store.js";
import { indexPendingDocuments } from "./documents.js";
import { pageToChunks } from "./pages.js";
import { httpError } from "./errors.js";

const PARALLEL_PAGES = 4;
const syncing = new Set();

function headers(site, accept) {
    const result = { Accept: accept };
    if (site.wpUser) {
        const token = Buffer.from(`${site.wpUser}:${site.wpPass}`).toString("base64");
        result.Authorization = `Basic ${token}`;
    }
    return result;
}

async function listItems(site, postType, lang) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
        const language = lang ? `&lang=${encodeURIComponent(lang)}` : "";
        const url = `${site.wpUrl}/wp-json/wp/v2/${postType}?per_page=100&page=${page}&_fields=id,link,title,smart_search_exclude${language}`;
        const response = await fetch(url, { headers: headers(site, "application/json") });
        if (!response.ok) {
            throw new Error(`WordPress responded ${response.status} for ${url}`);
        }
        totalPages = Number(response.headers.get("X-WP-TotalPages")) || 1;
        items.push(...(await response.json()));
        page += 1;
    }
    return items;
}

export async function fetchHtml(site, url) {
    let response;
    try {
        response = await fetch(url, { headers: headers(site, "text/html") });
    } catch (err) {
        throw httpError(502, `Could not open ${url}: ${err.message}`);
    }
    if (!response.ok) {
        throw httpError(502, `Page responded ${response.status} for ${url}`);
    }
    return response.text();
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await fn(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function getPageChunks(site) {
    const languages = site.languages.length ? site.languages : [""];
    const pages = [];
    let excluded = 0;
    for (const lang of languages) {
        for (const postType of site.postTypes) {
            for (const item of await listItems(site, postType, lang)) {
                if (item.smart_search_exclude) {
                    excluded += 1;
                    continue;
                }
                pages.push({ id: item.id, url: item.link, title: item.title?.rendered, lang });
            }
        }
    }
    const failed = [];
    const results = await mapLimit(pages, PARALLEL_PAGES, async (page) => {
        try {
            return pageToChunks(site, { ...page, html: await fetchHtml(site, page.url) });
        } catch (err) {
            failed.push(page.url);
            console.error(err.message);
            return [];
        }
    });
    return { pages: pages.length, excluded, failed, chunks: results.flat() };
}

export async function syncSite(site) {
    if (syncing.has(site.id)) {
        throw httpError(409, "Sync is already in progress for this site");
    }
    syncing.add(site.id);
    try {
        const { pages, excluded, failed, chunks } = await getPageChunks(site);
        if (pages > 0 && failed.length === pages) {
            throw new Error(`Could not open any page, for example ${failed[0]}`);
        }
        const wordpress = await replaceChunks(site.collection, { source: "page" }, chunks);
        await deleteWhere(site.collection, { source: "wp" });
        await deleteLegacyChunks(site.collection);
        const documents = await indexPendingDocuments(site);
        setSyncResult(site.id, { ok: true, pages, excluded, failed: failed.length, wordpress, documents });
        console.log(`Sync finished for ${site.id}: ${pages} pages, ${excluded} excluded, ${failed.length} failed, ${wordpress} chunks, ${documents} documents indexed`);
        return { pages, excluded, failed: failed.length, wordpress, documents };
    } catch (err) {
        setSyncResult(site.id, { ok: false, error: err.message });
        throw err;
    } finally {
        syncing.delete(site.id);
    }
}