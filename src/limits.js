import { config } from "./config.js";
import { httpError } from "./errors.js";

const MINUTE = 60 * 1000;
const recent = new Map();
const daily = new Map();

export function checkLimits(siteId, ip) {
    const now = Date.now();
    const visitor = `${siteId}:${ip}`;
    const times = (recent.get(visitor) || []).filter((t) => now - t < MINUTE);
    if (times.length >= config.perMinuteLimit) {
        throw httpError(429, "Too many questions. Please wait a minute.");
    }

    const today = new Date().toISOString().slice(0, 10);
    const day = daily.get(siteId);
    const count = day && day.date === today ? day.count : 0;
    if (count >= config.dailyLimit) {
        throw httpError(429, "The chat is not available right now. Please try again tomorrow.");
    }

    times.push(now);
    recent.set(visitor, times);
    daily.set(siteId, { date: today, count: count + 1 });
}

setInterval(() => {
    const now = Date.now();
    for (const [visitor, times] of recent) {
        if (times.every((t) => now - t >= MINUTE)) recent.delete(visitor);
    }
}, MINUTE).unref();