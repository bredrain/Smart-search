import crypto from "node:crypto";

const FAILURE_WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map();
const ANSWER_LIFETIME = 60 * 60 * 1000;
const answers = new Map();

export function safeEqual(a, b) {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function tooManyFailures(ip) {
    const now = Date.now();
    const recent = (failures.get(ip) || []).filter((t) => now - t < FAILURE_WINDOW);
    failures.set(ip, recent);
    return recent.length >= MAX_FAILURES;
}

export function recordFailure(ip) {
    const list = failures.get(ip) || [];
    list.push(Date.now());
    failures.set(ip, list);
}

function answerHash(siteId, text) {
    return crypto.createHash("sha256").update(`${siteId}\n${String(text || "").trim()}`).digest("hex");
}

export function rememberAnswer(siteId, text) {
    answers.set(answerHash(siteId, text), Date.now() + ANSWER_LIFETIME);
}

export function isKnownAnswer(siteId, text) {
    const expires = answers.get(answerHash(siteId, text));
    return Boolean(expires && expires > Date.now());
}

export function securityHeaders(req, res, next) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (String(req.path || "").startsWith("/admin")) {
        res.set("X-Frame-Options", "DENY");
        res.set("Cache-Control", "no-store");
    }
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of failures) {
        if (list.every((t) => now - t >= FAILURE_WINDOW)) failures.delete(ip);
    }
    for (const [hash, expires] of answers) {
        if (expires <= now) answers.delete(hash);
    }
}, FAILURE_WINDOW).unref();