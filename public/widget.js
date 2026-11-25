(function () {
    const script = document.currentScript;
    if (!script) return;
    const key = script.dataset.key;
    if (!key) {
        console.error("Smart search widget: data-key is missing");
        return;
    }
    const server = new URL(script.src).origin;
    const color = script.dataset.color || "#1f2937";
    const pageLang = (document.documentElement.lang || "").toLowerCase();
    const canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    const MAX_RECORDING_MS = 30000;
    const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

    const micIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>';
    const speakerIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>';

    const styles = `
        :host { all: initial; }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .open { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; width: 56px; height: 56px; border: none; border-radius: 50%; background: ${color}; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); }
        .box { position: fixed; right: 20px; bottom: 88px; z-index: 2147483000; width: 360px; max-width: calc(100vw - 40px); height: 480px; max-height: calc(100vh - 120px); display: flex; flex-direction: column; background: #fff; border-radius: 12px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); overflow: hidden; }
        .box[hidden] { display: none; }
        .head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: ${color}; color: #fff; font-size: 15px; font-weight: 600; }
        .close { border: none; background: none; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
        .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #f7f7f8; }
        .msg { max-width: 85%; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; color: #111; }
        .user { align-self: flex-end; background: ${color}; color: #fff; }
        .bot { align-self: flex-start; background: #fff; border: 1px solid #e5e5e5; }
        .error { align-self: flex-start; background: #fdecec; color: #8a1c1c; }
        .sources { margin-top: 6px; font-size: 12px; }
        .sources a { display: block; color: #2563eb; }
        .listen { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 3px 8px; border: 1px solid #d0d0d0; border-radius: 12px; background: #fff; color: #444; font-size: 12px; cursor: pointer; }
        .listen.active { border-color: ${color}; color: ${color}; }
        .form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e5e5; }
        .input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #d0d0d0; border-radius: 8px; font-size: 14px; }
        .mic { display: flex; align-items: center; justify-content: center; width: 38px; border: 1px solid #d0d0d0; border-radius: 8px; background: #fff; color: #444; cursor: pointer; }
        .mic.active { background: #dc2626; border-color: #dc2626; color: #fff; }
        .send { padding: 8px 14px; border: none; border-radius: 8px; background: ${color}; color: #fff; font-size: 14px; cursor: pointer; }
        .send:disabled, .mic:disabled { opacity: 0.6; cursor: default; }
    `;

    function start() {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `
            <style>${styles}</style>
            <button class="open" type="button" aria-label="Open chat">Chat</button>
            <div class="box" hidden>
                <div class="head"><span class="title">Ask us</span><button class="close" type="button" aria-label="Close">&times;</button></div>
                <div class="messages"></div>
                <form class="form">
                    <input class="input" type="text" maxlength="1000" autocomplete="off" placeholder="Type your question...">
                    ${canRecord ? `<button class="mic" type="button" aria-label="Ask by voice" title="Press to speak, press again to send">${micIcon}</button>` : ""}
                    <button class="send" type="submit">Send</button>
                </form>
            </div>
        `;

        const box = root.querySelector(".box");
        const title = root.querySelector(".title");
        const messages = root.querySelector(".messages");
        const form = root.querySelector(".form");
        const input = root.querySelector(".input");
        const send = root.querySelector(".send");
        const mic = root.querySelector(".mic");

        root.querySelector(".open").addEventListener("click", () => {
            box.hidden = !box.hidden;
            if (!box.hidden) input.focus();
        });
        root.querySelector(".close").addEventListener("click", () => {
            box.hidden = true;
            if (canSpeak) speechSynthesis.cancel();
        });

        let speakingButton = null;

        function stopSpeaking() {
            speechSynthesis.cancel();
            if (speakingButton) speakingButton.classList.remove("active");
            speakingButton = null;
        }

        function speak(text, lang, button) {
            if (speakingButton === button) {
                stopSpeaking();
                return;
            }
            stopSpeaking();
            const utterance = new SpeechSynthesisUtterance(text);
            if (lang) {
                utterance.lang = lang;
                const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
                if (voice) utterance.voice = voice;
            }
            utterance.onend = () => {
                if (speakingButton === button) stopSpeaking();
            };
            utterance.onerror = utterance.onend;
            speakingButton = button;
            button.classList.add("active");
            speechSynthesis.speak(utterance);
        }

        function addMessage(text, type, sources, lang) {
            const div = document.createElement("div");
            div.className = `msg ${type}`;
            div.textContent = text;
            const links = (sources || []).filter((url) => /^https?:\/\//.test(url));
            if (links.length) {
                const list = document.createElement("div");
                list.className = "sources";
                for (const url of links) {
                    const a = document.createElement("a");
                    a.href = url;
                    a.target = "_blank";
                    a.rel = "noopener";
                    a.textContent = url;
                    list.appendChild(a);
                }
                div.appendChild(list);
            }
            if (type === "bot" && canSpeak && lang !== undefined) {
                const listen = document.createElement("button");
                listen.type = "button";
                listen.className = "listen";
                listen.innerHTML = `${speakerIcon}<span>Listen</span>`;
                listen.addEventListener("click", () => speak(text, lang, listen));
                div.appendChild(document.createElement("br"));
                div.appendChild(listen);
            }
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        }

        addMessage("Hello! Ask me anything about this website.", "bot");

        fetch(`${server}/widget-config?key=${encodeURIComponent(key)}`)
            .then((response) => response.json())
            .then((data) => {
                if (data.name) title.textContent = script.dataset.title || data.name;
            })
            .catch(() => {});

        async function ask(question) {
            addMessage(question, "user");
            input.value = "";
            send.disabled = true;
            if (mic) mic.disabled = true;
            const waiting = addMessage("...", "bot");
            try {
                const response = await fetch(`${server}/ask`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key, question, lang: pageLang }),
                });
                const data = await response.json();
                waiting.remove();
                if (!response.ok) {
                    addMessage(data.error || "Something went wrong. Please try again.", "error");
                } else {
                    addMessage(data.answer, "bot", data.sources, data.lang || "");
                }
            } catch (err) {
                waiting.remove();
                addMessage("Connection problem. Please try again.", "error");
            } finally {
                send.disabled = false;
                if (mic) mic.disabled = false;
                input.focus();
            }
        }

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const question = input.value.trim();
            if (question) ask(question);
        });

        if (mic) {
            let recorder = null;
            let stopTimer = null;

            async function sendRecording(blob) {
                const type = (blob.type || "audio/webm").split(";")[0];
                mic.disabled = true;
                send.disabled = true;
                input.placeholder = "Recognizing...";
                try {
                    const response = await fetch(`${server}/transcribe?key=${encodeURIComponent(key)}`, {
                        method: "POST",
                        headers: { "Content-Type": type },
                        body: blob,
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        addMessage(data.error || "Voice input did not work. Please type your question.", "error");
                    } else if (data.text) {
                        await ask(data.text);
                    } else {
                        addMessage("Sorry, I did not hear anything. Please try again.", "error");
                    }
                } catch (err) {
                    addMessage("Connection problem. Please try again.", "error");
                } finally {
                    mic.disabled = false;
                    send.disabled = false;
                    input.placeholder = "Type your question...";
                }
            }

            mic.addEventListener("click", async () => {
                if (recorder) {
                    recorder.stop();
                    return;
                }
                if (canSpeak) stopSpeaking();
                let stream;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } catch (err) {
                    addMessage("Microphone access is blocked. Please allow it in the browser settings.", "error");
                    return;
                }
                const chunks = [];
                recorder = new MediaRecorder(stream);
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) chunks.push(event.data);
                };
                recorder.onstop = () => {
                    clearTimeout(stopTimer);
                    stream.getTracks().forEach((track) => track.stop());
                    mic.classList.remove("active");
                    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
                    recorder = null;
                    if (blob.size > 0) sendRecording(blob);
                    else input.placeholder = "Type your question...";
                };
                recorder.start();
                mic.classList.add("active");
                input.value = "";
                input.placeholder = "Listening... press the microphone again to send";
                stopTimer = setTimeout(() => {
                    if (recorder) recorder.stop();
                }, MAX_RECORDING_MS);
            });
        }
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener("DOMContentLoaded", start);
    }
})();
