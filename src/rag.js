import { config, openai } from "./config.js";
import { embed, search } from "./vectors.js";

const TOP_K = 5;
const MIN_SCORE = 0.3;

async function toSearchQuery(question) {
    if (!config.siteLanguage) return question;
    const completion = await openai.chat.completions.create({
        model: config.chatModel,
        temperature: 0,
        messages: [
            { role: "system", content: `Translate the user's question into ${config.siteLanguage}. Return only the translation, nothing else.` },
            { role: "user", content: question },
        ],
    });
    return completion.choices[0].message.content.trim();
}

export async function findChunks(question) {
    const [vector] = await embed(await toSearchQuery(question));
    const results = await search(config.collection, vector, TOP_K);
    return results.filter((r) => r.score >= MIN_SCORE);
}

function instructions(materials) {
    return [
        `You are an assistant on the website of ${config.siteName}. Answer visitors' questions briefly and politely, in the language of the question.`,
        "Use ONLY the information from the Materials section. Do not make anything up.",
        `If the answer is not in the materials, say you don't know and suggest contacting ${config.contact}.`,
        "",
        "Materials:",
        materials,
    ].join("\n");
}

export async function answer(question) {
    const found = await findChunks(question);
    const materials = found.length
        ? found.map((r) => `${r.payload.title}\n${r.payload.text}`).join("\n\n---\n\n")
        : "(nothing found)";

    const completion = await openai.chat.completions.create({
        model: config.chatModel,
        temperature: 0.2,
        messages: [
            { role: "system", content: instructions(materials) },
            { role: "user", content: question },
        ],
    });

    const sources = [...new Set(found.map((r) => r.payload.url).filter(Boolean))];
    return { answer: completion.choices[0].message.content, sources, found: found.length };
}