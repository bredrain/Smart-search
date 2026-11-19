import express from "express";
import { config } from "./config.js";
import { listSites, requireSite, requireSiteByKey, requireDocument, createSite, updateSite, deleteSite, rotatePublicKey, publicView } from "./store.js";
import { syncSite } from "./wordpress.js";
import { findChunks, answer } from "./rag.js";
import { countPoints, dropCollection } from "./vectors.js";
import { createDocument, deleteDocument, deleteSiteDocuments, readDocumentText } from "./documents.js";
import { checkLimits } from "./limits.js";
import { httpError } from "./errors.js";

const server = express();
server.set("trust proxy", 1);
server.use("/admin/api", express.json({ limit: "25mb" }));
server.use(express.json());
server.use(express.static("public"));

function handle(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            if (err.expose) {
                return res.status(err.status).json({ error: err.message });
            }
            console.error(err.message, err.data?.status?.error || "");
            res.status(500).json({ error: "Server error" });
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
    deleteSiteDocuments(site.id);
    deleteSite(site.id);
    res.json({ ok: true });
}));

admin.post("/sites/:id/rotate-key", handle(async (req, res) => {
    res.json(publicView(rotatePublicKey(req.params.id)));
}));

admin.post("/sites/:id/sync", handle(async (req, res) => {
    const site = requireSite(req.params.id);
    res.json({ ok: true, ...(await syncSite(site)) });
}));

admin.get("/sites/:id/search", handle(async (req, res) => {
    const site = requireSite(req.params.id);
        const found = await findChunks(site, String(req.query.q || ""), String(req.query.lang || ""));
    res.json(found.map((r) => ({ score: r.score, title: r.payload.title, lang: r.payload.lang || "", url: r.payload.url, text: r.payload.text })));
}));

admin.get("/sites/:id/documents", handle(async (req, res) => {
    res.json(requireSite(req.params.id).documents);
}));

admin.get("/sites/:id/documents/:docId", handle(async (req, res) => {
    const doc = requireDocument(req.params.id, req.params.docId);
    res.json({ ...doc, text: readDocumentText(req.params.id, doc.id) });
}));

admin.post("/sites/:id/documents", handle(async (req, res) => {
    const site = requireSite(req.params.id);
    res.status(201).json(await createDocument(site, req.body || {}));
}));

admin.delete("/sites/:id/documents/:docId", handle(async (req, res) => {
    await deleteDocument(requireSite(req.params.id), req.params.docId);
    res.json({ ok: true });
}));

server.use("/admin/api", admin);

function publicCors(req, res, next) {
    const origin = req.headers.origin;
    if (origin) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        res.set("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    next();
}

function checkOrigin(req, site) {
    const origin = req.headers.origin;
    if (!origin || site.allowedOrigins.length === 0) return;
    if (origin.endsWith(`//${req.get("host")}`)) return;
    if (!site.allowedOrigins.includes(origin)) {
        throw httpError(403, "This website is not allowed to use this chat");
    }
}

server.use("/widget-config", publicCors);
server.use("/ask", publicCors);

server.get("/widget-config", handle(async (req, res) => {
    const site = requireSiteByKey(String(req.query.key || ""));
    checkOrigin(req, site);
    res.json({ name: site.name });
}));

server.post("/ask", handle(async (req, res) => {
    const site = requireSiteByKey(String(req.body?.key || ""));
    checkOrigin(req, site);
    const question = String(req.body?.question || "").trim().slice(0, 1000);
    if (!question) {
        return res.status(400).json({ error: "Empty question" });
    }
    checkLimits(site.id, req.ip);
    res.json(await answer(site, question, String(req.body?.lang || "")));
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