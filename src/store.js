import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config, toList } from "./config.js";
import { httpError } from "./errors.js";

const FILE = path.join(config.dataDir, "sites.json");
const EDITABLE = ["name", "wpUrl", "wpUser", "wpPass", "postTypes", "contact", "language", "languages", "allowedOrigins"];
const LISTS = ["postTypes", "languages", "allowedOrigins"];

let sites = load();
addFirstSiteFromEnv();
moveExtraFiles();

function load() {
    if (!fs.existsSync(FILE)) return [];
    const list = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const site of list) {
        site.documents = site.documents || [];
        site.languages = site.languages || [];
    }
    return list;
}

function save() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const temp = `${FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(sites, null, 2));
    fs.renameSync(temp, FILE);
}

function makeId(name) {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "site";
    let id = base;
    let n = 2;
    while (sites.some((s) => s.id === id)) {
        id = `${base}-${n}`;
        n += 1;
    }
    return id;
}

function clean(input, current = {}) {
    const site = { ...current };
    for (const field of EDITABLE) {
        if (input[field] === undefined) continue;
        if (field === "wpPass" && input[field] === "" && current.wpPass) continue;
        site[field] = LISTS.includes(field) ? toList(input[field]) : String(input[field]).trim();
    }
    site.wpUrl = (site.wpUrl || "").replace(/\/+$/, "");
    site.wpUser = site.wpUser || "";
    site.wpPass = site.wpPass || "";
    site.contact = site.contact || "";
    site.language = site.language || "";
    site.languages = (site.languages || []).map((code) => code.toLowerCase());
    site.allowedOrigins = site.allowedOrigins || [];
    if (!site.postTypes || site.postTypes.length === 0) site.postTypes = ["posts", "pages"];
    if (!site.name) throw httpError(400, "name is required");
    if (!/^https?:\/\//.test(site.wpUrl)) throw httpError(400, "wpUrl must start with http:// or https://");
    return site;
}

function addFirstSiteFromEnv() {
    const env = config.firstSite;
    if (sites.length > 0 || !env.wpUrl) return;
    const site = clean({ ...env, name: env.name || "Main site" });
    site.id = "main";
    site.collection = env.collection || "site_main";
    site.publicKey = crypto.randomBytes(16).toString("hex");
    site.extraFile = fs.existsSync("extra.txt") ? "extra.txt" : "";
    site.documents = [];
    site.createdAt = new Date().toISOString();
    sites.push(site);
    save();
    console.log(`Created site "main" from .env (collection ${site.collection})`);
}

function moveExtraFiles() {
    let changed = false;
    for (const site of sites) {
        if (site.extraFile === undefined) continue;
        if (site.extraFile && fs.existsSync(site.extraFile)) {
            const target = path.join(config.dataDir, "docs", site.id, "extra-txt.txt");
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(site.extraFile, target);
            site.documents.push({
                id: "extra-txt",
                title: "Guest information",
                type: "file",
                fileName: path.basename(site.extraFile),
                url: site.wpUrl,
                chars: fs.readFileSync(target, "utf8").length,
                chunks: 0,
                needsIndex: true,
                createdAt: new Date().toISOString(),
            });
            console.log(`Moved ${site.extraFile} into documents of site "${site.id}"`);
        }
        delete site.extraFile;
        changed = true;
    }
    if (changed) save();
}

export function listSites() {
    return sites;
}

export function getSite(id) {
    return sites.find((s) => s.id === id);
}

export function requireSite(id) {
    const site = getSite(id);
    if (!site) throw httpError(404, "Site not found");
    return site;
}

export function requireSiteByKey(key) {
    const site = key ? sites.find((s) => s.publicKey === key) : undefined;
    if (!site) throw httpError(404, "Unknown site key");
    return site;
}

export function createSite(input) {
    const site = clean(input);
    site.id = makeId(site.name);
    site.collection = `site_${site.id.replace(/-/g, "_")}`;
    site.publicKey = crypto.randomBytes(16).toString("hex");
    site.documents = [];
    site.createdAt = new Date().toISOString();
    sites.push(site);
    save();
    return site;
}

export function updateSite(id, input) {
    const index = sites.findIndex((s) => s.id === id);
    if (index === -1) throw httpError(404, "Site not found");
    sites[index] = clean(input, sites[index]);
    save();
    return sites[index];
}

export function rotatePublicKey(id) {
    const site = requireSite(id);
    site.publicKey = crypto.randomBytes(16).toString("hex");
    save();
    return site;
}

export function setSyncResult(id, result) {
    const site = getSite(id);
    if (!site) return;
    site.lastSync = { at: new Date().toISOString(), ...result };
    save();
}

export function requireDocument(siteId, docId) {
    const doc = requireSite(siteId).documents.find((d) => d.id === docId);
    if (!doc) throw httpError(404, "Document not found");
    return doc;
}

export function addDocument(siteId, doc) {
    requireSite(siteId).documents.push(doc);
    save();
}

export function updateDocument(siteId, docId, changes) {
    Object.assign(requireDocument(siteId, docId), changes);
    save();
}

export function removeDocument(siteId, docId) {
    const site = requireSite(siteId);
    site.documents = site.documents.filter((d) => d.id !== docId);
    save();
}

export function deleteSite(id) {
    const index = sites.findIndex((s) => s.id === id);
    if (index === -1) throw httpError(404, "Site not found");
    const [removed] = sites.splice(index, 1);
    save();
    return removed;
}

export function publicView(site) {
    const { wpPass, ...rest } = site;
    return { ...rest, hasPassword: Boolean(wpPass) };
}