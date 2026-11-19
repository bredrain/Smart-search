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
        .form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e5e5; }
        .input { flex: 1; padding: 8px 10px; border: 1px solid #d0d0d0; border-radius: 8px; font-size: 14px; }
        .send { padding: 8px 14px; border: none; border-radius: 8px; background: ${color}; color: #fff; font-size: 14px; cursor: pointer; }
        .send:disabled { opacity: 0.6; cursor: default; }
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

        root.querySelector(".open").addEventListener("click", () => {
            box.hidden = !box.hidden;
            if (!box.hidden) input.focus();
        });
        root.querySelector(".close").addEventListener("click", () => {
            box.hidden = true;
        });

        function addMessage(text, type, sources) {
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

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const question = input.value.trim();
            if (!question) return;
            addMessage(question, "user");
            input.value = "";
            send.disabled = true;
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
                    addMessage(data.answer, "bot", data.sources);
                }
            } catch (err) {
                waiting.remove();
                addMessage("Connection problem. Please try again.", "error");
            } finally {
                send.disabled = false;
                input.focus();
            }
        });
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener("DOMContentLoaded", start);
    }
})();