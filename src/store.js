import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config, toList } from "./config.js";
import { httpError } from "./errors.js";

const FILE = path.join(config.dataDir, "sites.json");
const EDITABLE = ["name", "wpUrl", "wpUser", "wpPass", "postTypes", "contact", "language", "allowedOrigins"];
const LISTS = ["postTypes", "allowedOrigins"];

let sites = load();
addFirstSiteFromEnv();

function load() {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
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
    site.createdAt = new Date().toISOString();
    sites.push(site);
    save();
    console.log(`Created site "main" from .env (collection ${site.collection})`);
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

export function createSite(input) {
    const site = clean(input);
    site.id = makeId(site.name);
    site.collection = `site_${site.id.replace(/-/g, "_")}`;
    site.publicKey = crypto.randomBytes(16).toString("hex");
    site.extraFile = "";
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

export function setSyncResult(id, result) {
    const site = getSite(id);
    if (!site) return;
    site.lastSync = { at: new Date().toISOString(), ...result };
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