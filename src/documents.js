import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { config } from "./config.js";
import { chunkText } from "./text.js";
import { replaceChunks, deleteWhere } from "./vectors.js";
import { requireSite, addDocument, updateDocument, removeDocument, requireDocument } from "./store.js";
import { httpError } from "./errors.js";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CHARS = 500000;

function textFile(siteId, docId) {
    return path.join(config.dataDir, "docs", siteId, `${docId}.txt`);
}

function cleanText(text) {
    return String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B-\u001F]/g, "")
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function fileToText(fileName, buffer) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".pdf") {
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text } = await extractText(pdf, { mergePages: true });
        return text;
    }
    if (extension === ".docx") {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    }
    if (extension === ".txt" || extension === ".md") {
        return buffer.toString("utf8");
    }
    throw httpError(400, "Supported files: PDF, DOCX, TXT, MD");
}

export function readDocumentText(siteId, docId) {
    const file = textFile(siteId, docId);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export async function indexDocument(site, doc) {
    const text = readDocumentText(site.id, doc.id);
    const chunks = chunkText(text).map((piece) => ({
        text: piece,
        embedText: `${doc.title}\n${piece}`,
        payload: { source: "doc", docId: doc.id, title: doc.title, url: doc.url },
    }));
    const count = await replaceChunks(site.collection, { source: "doc", docId: doc.id }, chunks);
    updateDocument(site.id, doc.id, { chunks: count, needsIndex: false });
    return count;
}

export async function indexPendingDocuments(site) {
    let count = 0;
    for (const doc of requireSite(site.id).documents.filter((d) => d.needsIndex)) {
        await indexDocument(site, doc);
        count += 1;
    }
    return count;
}

export async function createDocument(site, input) {
    const fileName = String(input.fileName || "").trim();
    const title = String(input.title || fileName).trim();
    if (!title) throw httpError(400, "title is required");

    let text;
    if (input.fileBase64) {
        const buffer = Buffer.from(String(input.fileBase64), "base64");
        if (buffer.length > MAX_FILE_BYTES) throw httpError(400, "File is larger than 15 MB");
        try {
            text = await fileToText(fileName, buffer);
        } catch (err) {
            if (err.status) throw err;
            throw httpError(400, `Could not read the file: ${err.message}`);
        }
    } else {
        text = input.text;
    }

    text = cleanText(text);
    if (text.length < 20) throw httpError(400, "The document has no text. Scanned PDFs (pictures) are not supported.");
    if (text.length > MAX_CHARS) throw httpError(400, `The document is too long (max ${MAX_CHARS} characters)`);

    const doc = {
        id: crypto.randomBytes(4).toString("hex"),
        title,
        type: input.fileBase64 ? "file" : "text",
        fileName,
        url: String(input.url || site.wpUrl),
        chars: text.length,
        chunks: 0,
        needsIndex: true,
        createdAt: new Date().toISOString(),
    };

    const file = textFile(site.id, doc.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    addDocument(site.id, doc);
    try {
        await indexDocument(site, doc);
    } catch (err) {
        removeDocument(site.id, doc.id);
        fs.rmSync(file, { force: true });
        throw err;
    }
    return requireDocument(site.id, doc.id);
}

export async function deleteDocument(site, docId) {
    requireDocument(site.id, docId);
    await deleteWhere(site.collection, { source: "doc", docId });
    fs.rmSync(textFile(site.id, docId), { force: true });
    removeDocument(site.id, docId);
}

export function deleteSiteDocuments(siteId) {
    fs.rmSync(path.join(config.dataDir, "docs", siteId), { recursive: true, force: true });
}