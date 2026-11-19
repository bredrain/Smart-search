import { config, openai } from "./config.js";
import { embed, search } from "./vectors.js";

const TOP_K = 5;
const MIN_SCORE = 0.3;

function pickLanguage(site, lang) {
    if (site.languages.length === 0) return "";
    const page = String(lang || "").toLowerCase();
    return site.languages.find((code) => code === page)
        || site.languages.find((code) => code === page.slice(0, 2))
        || site.languages[0];
}

async function toSearchQuery(site, question, target) {
    const language = target ? `the language with the code "${target}"` : site.language;
    if (!language) return question;
    const completion = await openai.chat.completions.create({
        model: config.chatModel,
        temperature: 0,
        messages: [
            { role: "system", content: `Translate the user's question into ${language}. If it is already in that language, return it unchanged. Return only the question, nothing else.` },
            { role: "user", content: question },
        ],
    });
    return completion.choices[0].message.content.trim();
}

export async function findChunks(site, question, lang) {
    const target = pickLanguage(site, lang);
    const [vector] = await embed(await toSearchQuery(site, question, target));
    const filter = target
        ? { should: [{ key: "lang", match: { value: target } }, { is_empty: { key: "lang" } }] }
        : undefined;
    const results = await search(site.collection, vector, TOP_K, filter);
    return results.filter((r) => r.score >= MIN_SCORE);
}

function instructions(site, materials) {
    return [
        `You are an assistant on the website of ${site.name}. Answer visitors' questions briefly and politely, in the language of the question.`,
        "Use ONLY the information from the Materials section. Do not make anything up.",
        `If the answer is not in the materials, say you don't know and suggest contacting ${site.contact || "the website team"}.`,
        "",
        "Materials:",
        materials,
    ].join("\n");
}

export async function answer(site, question, lang) {
    const found = await findChunks(site, question, lang);
    const materials = found.length
        ? found.map((r) => `${r.payload.title}\n${r.payload.text}`).join("\n\n---\n\n")
        : "(nothing found)";

    const completion = await openai.chat.completions.create({
        model: config.chatModel,
        temperature: 0.2,
        messages: [
            { role: "system", content: instructions(site, materials) },
            { role: "user", content: question },
        ],
    });

    const sources = [...new Set(found.map((r) => r.payload.url).filter(Boolean))];
    return { answer: completion.choices[0].message.content, sources, found: found.length };
}