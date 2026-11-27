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

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];
const SAMPLE_RATE = 24000;
const SPEECH_TIMEOUT = 30000;
const READ_ALOUD = "You are a text-to-speech voice. Read the user's message aloud exactly as written, word for word, in its own language. Do not answer it, comment on it, translate it, or add anything.";

function toWav(pcm) {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

export function speech(text, voice) {
    const input = String(text || "").trim().slice(0, 2000);
    if (!input) {
        return Promise.reject(httpError(400, "Text is empty"));
    }
    if (typeof WebSocket === "undefined") {
        return Promise.reject(new Error("Speech needs Node.js 22 or newer"));
    }
    return new Promise((resolve, reject) => {
        const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.speechModel)}`;
        const socket = new WebSocket(url, ["realtime", `openai-insecure-api-key.${config.openaiKey}`]);
        const chunks = [];
        let finished = false;

        function finish(error) {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try {
                socket.close();
            } catch (err) {
            }
            if (error) {
                reject(error);
            } else if (chunks.length === 0) {
                reject(new Error("Speech returned no audio"));
            } else {
                resolve(toWav(Buffer.concat(chunks)));
            }
        }

        function send(event) {
            socket.send(JSON.stringify(event));
        }

        const timeout = setTimeout(() => finish(new Error("Speech timed out")), SPEECH_TIMEOUT);

        socket.addEventListener("open", () => {
            send({
                type: "session.update",
                session: {
                    type: "realtime",
                    output_modalities: ["audio"],
                    instructions: READ_ALOUD,
                    audio: {
                        output: {
                            format: { type: "audio/pcm", rate: SAMPLE_RATE },
                            voice: VOICES.includes(voice) ? voice : "coral",
                        },
                    },
                },
            });
            send({
                type: "conversation.item.create",
                item: { type: "message", role: "user", content: [{ type: "input_text", text: input }] },
            });
            send({ type: "response.create" });
        });

        socket.addEventListener("message", (event) => {
            let data;
            try {
                data = JSON.parse(String(event.data));
            } catch (err) {
                return;
            }
            if (data.type === "response.output_audio.delta") {
                chunks.push(Buffer.from(data.delta, "base64"));
            } else if (data.type === "response.done") {
                const status = data.response?.status;
                finish(status && status !== "completed" ? new Error(`Speech ${status}`) : undefined);
            } else if (data.type === "error") {
                finish(new Error(data.error?.message || "Speech failed"));
            }
        });

        socket.addEventListener("error", () => finish(new Error("Speech connection failed")));
        socket.addEventListener("close", () => finish(new Error("Speech connection closed")));
    });
}
