import express from "express";
import { config } from "./config.js";
import { getWordPressChunks, syncSite } from "./wordpress.js";
import { findChunks, answer } from "./rag.js";

const server = express();
server.use(express.json());
server.use(express.static("public"));

function checkKey(req, res, next) {
    if (!config.loadKey || req.query.key !== config.loadKey) {
        return res.status(403).json({ error: "Invalid key" });
    }
    next();
}

server.use("/ask", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin))) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        res.set("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    next();
});

server.get("/chunks", checkKey, async (req, res) => {
    try {
        const chunks = await getWordPressChunks();
        res.json({ count: chunks.length, chunks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.get("/load", checkKey, async (req, res) => {
    try {
        res.json({ ok: true, ...(await syncSite()) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

server.get("/search", checkKey, async (req, res) => {
    try {
        const found = await findChunks(String(req.query.q || ""));
        res.json(found.map((r) => ({ score: r.score, title: r.payload.title, text: r.payload.text })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.post("/ask", async (req, res) => {
    const question = String(req.body?.question || "").trim().slice(0, 1000);
    if (!question) {
        return res.status(400).json({ error: "Empty question" });
    }
    try {
        res.json(await answer(question));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

if (config.reloadHours > 0) {
    setInterval(() => {
        syncSite().catch((err) => console.error("Scheduled sync failed:", err.message));
    }, config.reloadHours * 60 * 60 * 1000);
    console.log(`Automatic sync every ${config.reloadHours} hours`);
}

server.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
});