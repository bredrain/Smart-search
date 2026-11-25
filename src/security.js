import crypto from "node:crypto";

const FAILURE_WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map();

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

setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of failures) {
        if (list.every((t) => now - t >= FAILURE_WINDOW)) failures.delete(ip);
    }
}, FAILURE_WINDOW).unref();