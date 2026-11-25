import { toFile } from "openai";
import { config, openai } from "./config.js";
import { httpError } from "./errors.js";

const EXTENSIONS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
};

export async function transcribe(buffer, contentType) {
    const type = String(contentType || "").split(";")[0].trim().toLowerCase();
    const extension = EXTENSIONS[type];
    if (!extension) {
        throw httpError(400, "Unsupported audio format");
    }
    const file = await toFile(buffer, `question.${extension}`, { type });
    const result = await openai.audio.transcriptions.create({ file, model: config.transcribeModel });
    return String(result.text || "").trim();
}

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

export async function speech(text, voice) {
    const input = String(text || "").trim().slice(0, 2000);
    if (!input) {
        throw httpError(400, "Text is empty");
    }
    const result = await openai.audio.speech.create({
        model: config.speechModel,
        voice: VOICES.includes(voice) ? voice : "alloy",
        input,
        response_format: "mp3",
    });
    return Buffer.from(await result.arrayBuffer());
}