const ENTITIES = {
    nbsp: " ", amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">",
    laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", deg: "°", euro: "€",
};

function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

export function htmlToText(html) {
    return decodeEntities(
        String(html || "")
            .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
            .replace(/\[[^\]]*\]/g, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, "\n")
            .replace(/<(td|th)[^>]*>/gi, " | ")
            .replace(/<[^>]+>/g, " ")
    )
        .replace(/[\u0000-\u0008\u000B-\u001F]/g, "")
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function chunkText(text, maxChars = 1000) {
    const paragraphs = String(text || "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const parts = [];
    for (const paragraph of paragraphs) {
        if (paragraph.length <= maxChars) {
            parts.push(paragraph);
            continue;
        }
        let buffer = "";
        for (const sentence of paragraph.split(/(?<=[.!?…])\s+/)) {
            if (buffer && (buffer + " " + sentence).length > maxChars) {
                parts.push(buffer);
                buffer = sentence;
            } else {
                buffer = buffer ? buffer + " " + sentence : sentence;
            }
            while (buffer.length > maxChars) {
                parts.push(buffer.slice(0, maxChars));
                buffer = buffer.slice(maxChars);
            }
        }
        if (buffer) parts.push(buffer);
    }

    const chunks = [];
    let current = "";
    for (const part of parts) {
        if (current && (current + "\n" + part).length > maxChars) {
            chunks.push(current);
            current = part;
        } else {
            current = current ? current + "\n" + part : part;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}