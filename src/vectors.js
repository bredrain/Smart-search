import crypto from "node:crypto";
import { config, openai, qdrant } from "./config.js";

const EMBED_BATCH = 64;
const UPSERT_BATCH = 100;

export async function embed(texts) {
    const input = Array.isArray(texts) ? texts : [texts];
    const vectors = [];
    for (let i = 0; i < input.length; i += EMBED_BATCH) {
        const result = await openai.embeddings.create({
            model: config.embeddingModel,
            input: input.slice(i, i + EMBED_BATCH),
        });
        vectors.push(...result.data.map((d) => d.embedding));
    }
    return vectors;
}

export async function ensureCollection(collection) {
    const { exists } = await qdrant.collectionExists(collection);
    if (exists) return;
    await qdrant.createCollection(collection, {
        vectors: { size: config.vectorSize, distance: "Cosine" },
    });
    for (const [field, schema] of [["source", "keyword"], ["docId", "keyword"], ["postId", "integer"]]) {
        await qdrant.createPayloadIndex(collection, { field_name: field, field_schema: schema, wait: true });
    }
}

export async function dropCollection(collection) {
    const { exists } = await qdrant.collectionExists(collection);
    if (exists) await qdrant.deleteCollection(collection);
}

export async function deleteWhere(collection, conditions) {
    const entries = Object.entries(conditions);
    if (entries.length === 0) {
        throw new Error("deleteWhere needs at least one condition");
    }
    const { exists } = await qdrant.collectionExists(collection);
    if (!exists) return;
    await qdrant.delete(collection, {
        wait: true,
        filter: { must: entries.map(([key, value]) => ({ key, match: { value } })) },
    });
}

export async function replaceChunks(collection, conditions, chunks) {
    await ensureCollection(collection);
    const vectors = chunks.length ? await embed(chunks.map((c) => c.embedText || c.text)) : [];
    const points = chunks.map((c, i) => ({
        id: crypto.randomUUID(),
        vector: vectors[i],
        payload: { ...c.payload, text: c.text },
    }));
    await deleteWhere(collection, conditions);
    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
        await qdrant.upsert(collection, { wait: true, points: points.slice(i, i + UPSERT_BATCH) });
    }
    return points.length;
}

export async function countPoints(collection) {
    const { exists } = await qdrant.collectionExists(collection);
    if (!exists) return 0;
    const { count } = await qdrant.count(collection, { exact: true });
    return count;
}

export async function search(collection, vector, limit) {
    const { exists } = await qdrant.collectionExists(collection);
    if (!exists) return [];
    const result = await qdrant.query(collection, { query: vector, limit, with_payload: true });
    return result.points;
}