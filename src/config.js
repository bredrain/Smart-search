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

export function toList(value) {
    const items = Array.isArray(value) ? value : String(value || "").split(",");
    return items.map((s) => String(s).trim()).filter(Boolean);
}

export const config = {
    port: Number(process.env.SERVICE_PORT || process.env.PORT || 3030),
    adminKey: process.env.ADMIN_KEY || "",
    dataDir: process.env.DATA_DIR || "data",
    perMinuteLimit: Number(process.env.PER_MINUTE_LIMIT || 10),
    dailyLimit: Number(process.env.DAILY_LIMIT || 300),
    reloadHours: Number(process.env.RELOAD_HOURS || 0),
    embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    vectorSize: Number(process.env.VECTOR_SIZE || 1536),
    chatModel: process.env.CHAT_MODEL || "gpt-4.1-mini",
    transcribeModel: process.env.TRANSCRIBE_MODEL || "gpt-transcribe",
    speechModel: process.env.SPEECH_MODEL || "gpt-4o-mini-tts",
    speechVoice: process.env.SPEECH_VOICE || "coral",
    firstSite: {
        name: process.env.SITE_NAME || "",
        wpUrl: process.env.WP_URL || "",
        wpUser: process.env.WP_USER || "",
        wpPass: process.env.WP_PASS || "",
        postTypes: toList(process.env.WP_POST_TYPES),
        contact: process.env.CONTACT || "",
        language: process.env.SITE_LANGUAGE || "",
        collection: process.env.COLLECTION || "",
        allowedOrigins: toList(process.env.ALLOWED_ORIGINS),
    },
};

export const openai = new OpenAI({ apiKey: required("OPENAI_API_KEY") });

export const qdrant = new QdrantClient({
    url: required("QDRANT_URL"),
    apiKey: process.env.QDRANT_API_KEY || undefined,
});