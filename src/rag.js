import { config, openai } from "./config.js";
import { embed, search } from "./vectors.js";

const TOP_K = 5;
const MIN_SCORE = 0.2;
const MAX_SOURCES = 3;

function chatOptions() {
    return { model: config.chatModel, reasoning_effort: config.reasoningEffort };
}

function timer() {
    const start = Date.now();
    let last = start;
    const parts = [];
    return {
        mark(name) {
            const now = Date.now();
            parts.push(`${name} ${((now - last) / 1000).toFixed(1)}s`);
            last = now;
        },
        done() {
            return `${parts.join(", ")}, total ${((Date.now() - start) / 1000).toFixed(1)}s`;
        },
    };
}

function pickLanguage(site, lang) {
    if (site.languages.length === 0) return "";
    const page = String(lang || "").toLowerCase();
    return site.languages.find((code) => code === page)
        || site.languages.find((code) => code === page.slice(0, 2))
        || site.languages[0];
}

async function questionLanguage(question) {
    const completion = await openai.chat.completions.create({
        ...chatOptions(),
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: 'Detect the language of the user\'s question. Reply in JSON: {"lang": "two-letter ISO 639-1 code"}' },
            { role: "user", content: question },
        ],
    });
    try {
        return String(JSON.parse(completion.choices[0].message.content).lang || "").toLowerCase();
    } catch (err) {
        return "";
    }
}

async function toSearchQuery(site, question, target) {
    const language = target ? `the language with the code "${target}"` : site.language;
    if (!language) return question;
    const completion = await openai.chat.completions.create({
        ...chatOptions(),
        messages: [
            { role: "system", content: `Translate the user's question into ${language}. If it is already in that language, return it unchanged. Return only the question, nothing else.` },
            { role: "user", content: question },
        ],
    });
    return completion.choices[0].message.content.trim();
}

export async function findChunks(site, question, lang, minScore = MIN_SCORE, asked, time) {
    const language = asked ?? (site.languages.length > 0 ? await questionLanguage(question) : "");
    const target = pickLanguage(site, language || lang);
    const query = await toSearchQuery(site, question, target);
    time?.mark("translate");
    const [vector] = await embed(query);
    time?.mark("embed");
    const filter = target
        ? { should: [{ key: "lang", match: { value: target } }, { is_empty: { key: "lang" } }] }
        : undefined;
    const results = await search(site.collection, vector, TOP_K, filter);
    time?.mark("search");
    return results.filter((r) => r.score >= minScore);
}

function instructions(site, materials, asked) {
    const replyLanguage = asked ? ` (language code "${asked}")` : "";
    return [
        `You are an assistant on the website of ${site.name}. Answer visitors' questions briefly and politely.`,
        `Always answer in the language of the visitor's question${replyLanguage}, even if the materials are in another language.`,
        "Use ONLY the information from the Materials section. Do not make anything up.",
        "Before answering, check that the materials are about exactly the thing the visitor asks about: the same place, object, person or event. If they describe a different thing that only looks similar, do not answer as if it were the same. Say that there is no information about what was asked, and you may mention what the materials do say, clearly as a different thing.",
        'Example: question "What is the name of the rooftop telescope?", materials describe a writer\'s own telescope at home. Good answer: "There is no information about a rooftop telescope. The site only mentions a writer\'s own 10-inch Dobsonian telescope."',
        `If the answer is not in the materials, say you don't know and suggest contacting ${site.contact || "the website team"}.`,
        "",
        'Reply in JSON: {"answer": "your answer", "used": [numbers of the materials you actually used for the answer]}. Use an empty list if you did not use any material.',
        "",
        "Materials:",
        materials,
    ].join("\n");
}

function readReply(content) {
    try {
        const data = JSON.parse(content);
        const used = Array.isArray(data.used) ? data.used.map(Number).filter(Number.isInteger) : [];
        return { text: String(data.answer || ""), used };
    } catch (err) {
        return { text: content, used: [] };
    }
}

export async function answer(site, question, lang) {
    const time = timer();
    const asked = await questionLanguage(question);
    time.mark("language");
    const found = await findChunks(site, question, lang, MIN_SCORE, asked, time);
    const materials = found.length
        ? found.map((r, i) => `[${i + 1}] ${r.payload.title}\n${r.payload.text}`).join("\n\n---\n\n")
        : "(nothing found)";

    const completion = await openai.chat.completions.create({
        ...chatOptions(),
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: instructions(site, materials, asked) },
            { role: "user", content: question },
        ],
    });
    time.mark("answer");
    console.log(`Answer on ${site.id}: ${time.done()}`);

    const reply = readReply(completion.choices[0].message.content);
    const usedChunks = reply.used.map((n) => found[n - 1]).filter(Boolean);
    const sources = [...new Set(usedChunks.map((r) => r.payload.url).filter(Boolean))].slice(0, MAX_SOURCES);
    return { answer: reply.text, sources, found: found.length, lang: asked };
}
