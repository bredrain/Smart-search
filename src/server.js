import express from "express";
import { config } from "./config.js";
import { listSites, requireSite, createSite, updateSite, deleteSite, publicView } from "./store.js";
import { syncSite } from "./wordpress.js";
import { findChunks, answer } from "./rag.js";
import { countPoints, dropCollection } from "./vectors.js";
import { httpError } from "./errors.js";

const server = express();
server.use(express.json());
server.use(express.static("public"));

function handle(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            console.error(err.message);
            res.status(err.status || 500).json({ error: err.message });
        }
    };
}

function adminAuth(req, res, next) {
    const key = req.get("x-admin-key") || req.query.key;
    if (!config.adminKey || key !== config.adminKey) {
        return res.status(401).json({ error: "Invalid admin key" });
    }
    next();
}

const admin = express.Router();
admin.use(adminAuth);

admin.get("/sites", handle(async (req, res) => {
    res.json(listSites().map(publicView));
}));

admin.post("/sites", handle(async (req, res) => {
    res.status(201).json(publicView(createSite(req.body || {})));
}));

admin.get("/sites/:id", handle(async (req, res) => {
    const site = requireSite(req.params.id);
    res.json({ ...publicView(site), chunks: await countPoints(site.collection) });
}));

admin.put("/sites/:id", handle(async (req, res) => {
    res.json(publicView(updateSite(req.params.id, req.body || {})));
}));

admin.delete("/sites/:id", handle(async (req, res) => {
    const site = requireSite(req.params.id);
    await dropCollection(site.collection);
    deleteSite(site.id);
    res.json({ ok: true });
}));

admin.post("/sites/:id/sync", handle(async (req, res) => {
    const site = requireSite(req.params.id);
    res.json({ ok: true, ...(await syncSite(site)) });
}));

admin.get("/sites/:id/search", handle(async (req, res) => {
    const site = requireSite(req.params.id);
    const found = await findChunks(site, String(req.query.q || ""));
    res.json(found.map((r) => ({ score: r.score, title: r.payload.title, text: r.payload.text })));
}));

server.use("/admin/api", admin);

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

server.post("/ask", handle(async (req, res) => {
    const question = String(req.body?.question || "").trim().slice(0, 1000);
    if (!question) {
        return res.status(400).json({ error: "Empty question" });
    }
    const site = req.body?.siteId ? requireSite(String(req.body.siteId)) : listSites()[0];
    if (!site) throw httpError(404, "No sites configured");
    res.json(await answer(site, question));
}));

async function syncAll() {
    for (const site of listSites()) {
        try {
            await syncSite(site);
        } catch (err) {
            console.error(`Scheduled sync failed for ${site.id}:`, err.message);
        }
    }
}

if (config.reloadHours > 0) {
    setInterval(syncAll, config.reloadHours * 60 * 60 * 1000);
    console.log(`Automatic sync every ${config.reloadHours} hours`);
}

server.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
});