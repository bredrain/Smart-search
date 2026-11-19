import fs from "node:fs";
import { config } from "./config.js";
import { htmlToText, chunkText } from "./text.js";
import { replaceChunks } from "./vectors.js";

let isSyncing = false;

function headers() {
    const result = { Accept: "application/json" };
    if (config.wpUser) {
        const token = Buffer.from(`${config.wpUser}:${config.wpPass}`).toString("base64");
        result.Authorization = `Basic ${token}`;
    }
    return result;
}

async function fetchAll(postType) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
        const url = `${config.wpUrl}/wp-json/wp/v2/${postType}?per_page=100&page=${page}`;
        const response = await fetch(url, { headers: headers() });
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

export async function getWordPressChunks() {
    if (!config.wpUrl) {
        throw new Error("WP_URL is not set in .env");
    }
    const chunks = [];
    for (const postType of config.postTypes) {
        for (const item of await fetchAll(postType)) {
            chunks.push(...itemToChunks(item, postType));
        }
    }
    return chunks;
}

function getExtraChunks() {
    if (!fs.existsSync("extra.txt")) return [];
    const text = fs.readFileSync("extra.txt", "utf8");
    const title = "Guest information";
    return chunkText(text).map((piece) => ({
        text: piece,
        embedText: `${title}\n${piece}`,
        payload: { source: "doc", docId: "extra-txt", title, url: config.wpUrl },
    }));
}

export async function syncSite() {
    if (isSyncing) {
        throw new Error("Sync is already in progress");
    }
    isSyncing = true;
    try {
        const wordpress = await replaceChunks(config.collection, { source: "wp" }, await getWordPressChunks());
        const extra = await replaceChunks(config.collection, { source: "doc", docId: "extra-txt" }, getExtraChunks());
        console.log(`Sync finished: ${wordpress} WordPress chunks, ${extra} extra chunks`);
        return { wordpress, extra };
    } finally {
        isSyncing = false;
    }
}