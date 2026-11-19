import "dotenv/config";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

function required(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing environment variable ${name} in .env`);
        process.exit(1);
    }
    return value;
}

function list(value) {
    return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
    port: Number(process.env.SERVICE_PORT || process.env.PORT || 3030),
    wpUrl: (process.env.WP_URL || "").replace(/\/+$/, ""),
    wpUser: process.env.WP_USER || "",
    wpPass: process.env.WP_PASS || "",
    postTypes: list(process.env.WP_POST_TYPES).length ? list(process.env.WP_POST_TYPES) : ["posts", "pages"],
    collection: process.env.COLLECTION || "my_hotel",
    siteName: process.env.SITE_NAME || "this website",
    contact: process.env.CONTACT || "the website team",
    siteLanguage: process.env.SITE_LANGUAGE || "",
    loadKey: process.env.LOAD_KEY || "",
    allowedOrigins: list(process.env.ALLOWED_ORIGINS),
    reloadHours: Number(process.env.RELOAD_HOURS || 0),
    embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    vectorSize: Number(process.env.VECTOR_SIZE || 1536),
    chatModel: process.env.CHAT_MODEL || "gpt-4.1-mini",
};

export const openai = new OpenAI({ apiKey: required("OPENAI_API_KEY") });

export const qdrant = new QdrantClient({
    url: required("QDRANT_URL"),
    apiKey: process.env.QDRANT_API_KEY || undefined,
});