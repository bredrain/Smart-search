(function () {
    const script = document.currentScript;
    const base = script.src.replace(/\/widget\.js.*$/, "");
    const title = script.getAttribute("data-title") || "Assistant";
    const welcome = script.getAttribute("data-welcome") || "Hi! How can I help you?";
    const color = script.getAttribute("data-color") || "#2563eb";

    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483000;";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
        <style>
            * { box-sizing: border-box; font-family: Arial, sans-serif; }
            .wrap { display: flex; flex-direction: column; align-items: flex-end; }
            .toggle { width: 56px; height: 56px; border-radius: 50%; border: 0; background: ${color}; color: #fff; font-size: 24px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
            .panel { display: none; flex-direction: column; width: 340px; max-width: calc(100vw - 40px); height: 480px; max-height: calc(100vh - 100px); background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.25); overflow: hidden; margin-bottom: 12px; }
            .panel.open { display: flex; }
            .head { background: ${color}; color: #fff; padding: 12px 14px; font-weight: bold; display: flex; justify-content: space-between; }
            .close { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; }
            .log { flex: 1; overflow-y: auto; padding: 12px; background: #f6f6f7; }
            .msg { max-width: 85%; margin: 0 0 10px; padding: 9px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
            .user { margin-left: auto; background: ${color}; color: #fff; }
            .bot { background: #fff; border: 1px solid #e3e3e3; color: #222; }
            .links { display: block; margin-top: 6px; font-size: 12px; }
            .links a { color: ${color}; }
            form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #eee; }
            input { flex: 1; padding: 9px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px; }
            .send { border: 0; border-radius: 8px; background: ${color}; color: #fff; padding: 0 14px; cursor: pointer; }
            .send:disabled { opacity: .5; }
        </style>
        <div class="wrap">
            <div class="panel">
                <div class="head"><span class="title"></span><button class="close">x</button></div>
                <div class="log"></div>
                <form><input placeholder="Your question..." maxlength="1000"><button class="send">Send</button></form>
            </div>
            <button class="toggle">?</button>
        </div>
    `;

    const panel = root.querySelector(".panel");
    const log = root.querySelector(".log");
    const form = root.querySelector("form");
    const input = root.querySelector("input");
    const send = root.querySelector(".send");
    root.querySelector(".title").textContent = title;

    function addMessage(text, who) {
        const msg = document.createElement("div");
        msg.className = "msg " + who;
        msg.textContent = text;
        log.appendChild(msg);
        log.scrollTop = log.scrollHeight;
        return msg;
    }

    addMessage(welcome, "bot");

    root.querySelector(".toggle").addEventListener("click", () => {
        panel.classList.toggle("open");
        if (panel.classList.contains("open")) input.focus();
    });
    root.querySelector(".close").addEventListener("click", () => panel.classList.remove("open"));

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const question = input.value.trim();
        if (!question) return;
        input.value = "";
        send.disabled = true;
        addMessage(question, "user");
        const answer = addMessage("...", "bot");

        try {
            const response = await fetch(base + "/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question })
            });
            const data = await response.json();
            answer.textContent = data.answer || ("Error: " + data.error);

            if (data.sources && data.sources.length > 0) {
                const links = document.createElement("span");
                links.className = "links";
                data.sources.forEach((url, i) => {
                    const a = document.createElement("a");
                    a.href = url;
                    a.target = "_blank";
                    a.rel = "noopener";
                    a.textContent = "Source " + (i + 1);
                    links.appendChild(a);
                    if (i < data.sources.length - 1) links.append(" | ");
                });
                answer.appendChild(links);
            }
        } catch (err) {
            answer.textContent = "Could not reach the server. Please try again later.";
        } finally {
            send.disabled = false;
            input.focus();
        }
    });
})();