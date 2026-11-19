import { htmlToText, chunkText } from "./text.js";
import { replaceChunks } from "./vectors.js";
import { setSyncResult } from "./store.js";
import { indexPendingDocuments } from "./documents.js";
import { httpError } from "./errors.js";

const syncing = new Set();

function headers(site) {
    const result = { Accept: "application/json" };
    if (site.wpUser) {
        const token = Buffer.from(`${site.wpUser}:${site.wpPass}`).toString("base64");
        result.Authorization = `Basic ${token}`;
    }
    return result;
}

async function fetchAll(site, postType) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
        const url = `${site.wpUrl}/wp-json/wp/v2/${postType}?per_page=100&page=${page}`;
        const response = await fetch(url, { headers: headers(site) });
        if (!response.ok) {
            throw new Error(`WordPress responded ${response.status} for ${url}`);
        }
        totalPages = Number(response.headers.get("X-WP-TotalPages")) || 1;
        items.push(...(await response.json()));
        page += 1;
    }
    return items;
}

function itemToChunks(item, postType) {
    const title = htmlToText(item.title?.rendered);
    const text = htmlToText(item.content?.rendered);
    return chunkText(text)
        .filter((piece) => piece.length >= 50)
        .map((piece) => ({
            text: piece,
            embedText: `${title}\n${piece}`,
            payload: { source: "wp", title, url: item.link, postId: item.id, postType },
        }));
}

export async function getWordPressChunks(site) {
    const chunks = [];
    for (const postType of site.postTypes) {
        for (const item of await fetchAll(site, postType)) {
            chunks.push(...itemToChunks(item, postType));
        }
    }
    return chunks;
}

export async function syncSite(site) {
    if (syncing.has(site.id)) {
        throw httpError(409, "Sync is already in progress for this site");
    }
    syncing.add(site.id);
    try {
        const wordpress = await replaceChunks(site.collection, { source: "wp" }, await getWordPressChunks(site));
        const documents = await indexPendingDocuments(site);
        setSyncResult(site.id, { ok: true, wordpress, documents });
        console.log(`Sync finished for ${site.id}: ${wordpress} WordPress chunks, ${documents} documents indexed`);
        return { wordpress, documents };
    } catch (err) {
        setSyncResult(site.id, { ok: false, error: err.message });
        throw err;
    } finally {
        syncing.delete(site.id);
    }
}