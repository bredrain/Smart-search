import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import OpenAI from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';

const PORT = process.env.SERVICE_PORT || process.env.PORT || 3030;
const WP_URL = process.env.WP_URL;
const COLLECTION = process.env.COLLECTION || "my_hotel";

const openai = new OpenAI();
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const server = express();
server.use(express.json());
server.use(express.static("public"));

function wpHeaders() {
    if (process.env.WP_USER) {
        const auth = Buffer.from(process.env.WP_USER + ":" + process.env.WP_PASS).toString("base64");
        return { Authorization: "Basic " + auth };
    }
    return {};
}

async function getAll(type) {
    let allItems = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
        const url = WP_URL + "/wp-json/wp/v2/" + type + "?per_page=100&page=" + page;
        const response = await fetch(url, { headers: wpHeaders() });
        if (!response.ok) {
            throw new Error("WordPress responded " + response.status + " for " + url);
        }
        totalPages = Number(response.headers.get("X-WP-TotalPages")) || 1;
        const items = await response.json();
        allItems = allItems.concat(items);
        page = page + 1;
    }
    return allItems;
}

function htmlToText(html) {
    return html
        .replace(/\[[^\]]*\]/g, "")
        .replace(/<\/(p|h[1-6]|li|div)>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/[ \t]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/[\u0000-\u0008\u000B-\u001F]/g, "")
        .trim();
}

function splitText(text, maxLength) {
    const paragraphs = text.split("\n");
    const chunks = [];
    let current = "";
    for (const p of paragraphs) {
        if (current.length + p.length > maxLength && current !== "") {
            chunks.push(current.trim());
            current = "";
        }
        current = current + p + "\n";
    }
    if (current.trim() !== "") {
        chunks.push(current.trim());
    }
    return chunks;
}

async function getChunks() {
    const allChunks = [];

    const items = (await getAll("posts")).concat(await getAll("pages"));
    for (const item of items) {
        const title = htmlToText(item.title.rendered);
        const text = htmlToText(item.content.rendered);
        for (const piece of splitText(text, 1000)) {
            if (piece.length < 50) continue;
            allChunks.push({ title: title, link: item.link, text: piece });
        }
    }

    if (fs.existsSync("extra.txt")) {
        const extra = fs.readFileSync("extra.txt", "utf8");
        for (const piece of splitText(extra, 1000)) {
            allChunks.push({ title: "Guest information", link: WP_URL, text: piece });
        }
    }

    return allChunks;
}

async function toVectors(texts) {
    const result = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts
    });
    return result.data.map((d) => d.embedding);
}

async function searchChunks(question) {
    const [vector] = await toVectors([question]);
    const result = await qdrant.query(COLLECTION, {
        query: vector,
        limit: 5,
        with_payload: true
    });
    return result.points.filter((r) => r.score >= 0.3);
}
server.get("/chunks", async (req, res) => {
    try {
        const chunks = await getChunks();
        res.json({ count: chunks.length, chunks: chunks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.get("/load", async (req, res) => {
    if (!process.env.LOAD_KEY || req.query.key !== process.env.LOAD_KEY) {
        return res.status(403).json({ error: "Invalid key" });
    }
    try {
        const check = await qdrant.collectionExists(COLLECTION);
        if (check.exists) {
            await qdrant.deleteCollection(COLLECTION);
        }
        await qdrant.createCollection(COLLECTION, {
            vectors: { size: 1536, distance: "Cosine" }
        });

        const chunks = await getChunks();

        for (let i = 0; i < chunks.length; i = i + 50) {
            const batch = chunks.slice(i, i + 50);
            const vectors = await toVectors(batch.map((c) => c.title + "\n" + c.text));
            const points = batch.map((c, j) => ({ id: i + j, vector: vectors[j], payload: c }));
            await qdrant.upsert(COLLECTION, { wait: true, points: points });
            console.log("Loaded " + Math.min(i + 50, chunks.length) + " of " + chunks.length);
        }

        res.json({ ok: true, loaded: chunks.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

server.get("/search", async (req, res) => {
    try {
        const found = await searchChunks(req.query.q || "");
        res.json(found.map((r) => ({ score: r.score, title: r.payload.title, text: r.payload.text })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

server.post("/ask", async (req, res) => {
    const question = (req.body.question || "").trim();
    if (!question) {
        return res.status(400).json({ error: "Empty question" });
    }
    try {
        const found = await searchChunks(question);

        let materials = "(nothing found)";
        if (found.length > 0) {
            materials = found.map((r) => r.payload.title + "\n" + r.payload.text).join("\n\n---\n\n");
        }

               const siteName = process.env.SITE_NAME || "this website";
        const contact = process.env.CONTACT || "the website team";

        const instructions =
            "You are an assistant on the website of " + siteName + ". Answer visitors' questions briefly and politely, in the language of the question.\n" +
            "Use ONLY the information from the Materials section. Do not make anything up.\n" +
            "If the answer is not in the materials, say you don't know and suggest contacting " + contact + ".\n\n" +
            "Materials:\n" + materials;

        const completion = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            temperature: 0.2,
            messages: [
                { role: "system", content: instructions },
                { role: "user", content: question }
            ]
        });

        const links = [...new Set(found.map((r) => r.payload.link))];

        res.json({ answer: completion.choices[0].message.content, sources: links });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log("Server running at http://localhost:" + PORT);
});