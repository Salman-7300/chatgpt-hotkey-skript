// ==UserScript==
// @name         chatgpt-hotkey
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Markierten Text mit Alt+Q an ChatGPT senden + erweitertes Menü mit Buttons, History mit Zeitstempel und eigenen Prompts
// @match        *://*/*
// @match        https://chatgpt.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// ==/UserScript==

(function () {
    'use strict';

    const HISTORY_LIMIT = 5; // Anzahl gespeicherter History-Einträge

    // ---------- TEIL 1: Hotkey auf jeder Webseite ----------
    document.addEventListener('keydown', function (e) {
        if (e.altKey && e.key.toLowerCase() === 'q') {
            let selectedText = window.getSelection().toString().trim();
            if (selectedText) {
                // History speichern (Text + Zeitstempel)
                let history = GM_getValue("chatgpt_history", []);
                history.unshift({
                    text: selectedText,
                    time: new Date().toLocaleString()
                });
                if (history.length > HISTORY_LIMIT) history.pop();
                GM_setValue("chatgpt_history", history);

                // für Soforteinfügen merken
                GM_setValue("chatgpt_text", selectedText);

                window.open("https://chatgpt.com/", "_blank");
            } else {
                alert("Bitte erst Text markieren!");
            }
        }
    });

    // ---------- TEIL 2: Auf ChatGPT ----------
    if (window.location.hostname.includes("chatgpt.com")) {
        let selectedText = GM_getValue("chatgpt_text", "");
        let history = GM_getValue("chatgpt_history", []);
        let prompts = GM_getValue("chatgpt_prompts", []);

        let interval = setInterval(() => {
            let inputDiv = document.querySelector("div[contenteditable='true']");
            if (inputDiv) {
                clearInterval(interval);

                if (selectedText) {
                    insertTextEditable(inputDiv, selectedText);
                }

                createMenu(inputDiv, selectedText, history, prompts);
            }
        }, 1000);
    }

    // ---------- Hilfsfunktion: Text ins ContentEditable einfügen ----------
    function insertTextEditable(div, text) {
        div.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
    }

    // ---------- Hilfsfunktion: Menü erstellen ----------
    function createMenu(inputDiv, selectedText, history, prompts) {
        let menu = document.createElement("div");

        // gespeicherte Position laden
        let savedLeft = GM_getValue("menu_left", null);
        let savedTop = GM_getValue("menu_top", null);

        menu.style.cssText = `
            position: fixed;
            ${savedLeft !== null ? `left:${savedLeft}px;` : "right:20px;"}
            ${savedTop !== null ? `top:${savedTop}px;` : "top:20px;"}
            background: #1e1e1e;
            padding: 12px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            z-index: 9999;
            font-family: Arial, sans-serif;
            color: white;
            font-size: 14px;
            cursor: move;
            max-width: 280px;
        `;

        // Header
        let header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:bold;";
        header.textContent = "⚡ ChatGPT Schnelloptionen";

        let toggleBtn = document.createElement("button");
        toggleBtn.textContent = "−";
        toggleBtn.style.cssText = `
            background:none;
            border:none;
            color:white;
            font-size:16px;
            cursor:pointer;
            margin-left:8px;
        `;
        header.appendChild(toggleBtn);
        menu.appendChild(header);

        let content = document.createElement("div");

        // ---- Buttons ----
        let buttons = [
            { text: "Erklär mir", addon: " Erklär mir das bitte ausführlich." },
            { text: "Pro & Contra", addon: " Gib mir bitte eine Pro- und Contra-Liste dazu." },
            { text: "Zusammenfassung", addon: " Fasse mir das bitte in einfachen Worten zusammen." },
            { text: "Beispiel", addon: " Kannst du mir ein praktisches Beispiel dazu geben?" },
            { text: "Übersetzen (Deutsch)", addon: " Übersetze mir das bitte ins Deutsche." },
            { text: "📧 Schreibe als E-Mail", addon: " Formuliere das bitte als professionelle E-Mail." },
            { text: "🙏 Höflich umformulieren", addon: " Schreibe das bitte höflich und respektvoll um." },
            { text: "👶 Erklär für 10-Jährige", addon: " Erklär mir das bitte so, dass es ein 10-jähriges Kind versteht." }
        ];

        buttons.forEach(btnData => {
            let btn = document.createElement("button");
            btn.textContent = btnData.text;
            styleButton(btn);
            btn.onclick = () => {
                insertTextEditable(inputDiv, selectedText + btnData.addon);
                inputDiv.focus();
            };
            content.appendChild(btn);
        });

        // ---- Eingabefeld für eigenen Prompt ----
        let input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Eigenen Prompt eingeben...";
        input.style.cssText = `
            width: 100%;
            margin-top: 8px;
            padding: 6px;
            border-radius: 6px;
            border: 1px solid #555;
            background: #2a2a2a;
            color: white;
        `;
        content.appendChild(input);

        let customBtn = document.createElement("button");
        customBtn.textContent = "➕ Anwenden";
        styleButton(customBtn);
        customBtn.style.marginTop = "4px";
        customBtn.onclick = () => {
            if (input.value.trim()) {
                insertTextEditable(inputDiv, selectedText + " " + input.value.trim());
                inputDiv.focus();
            }
        };
        content.appendChild(customBtn);

        // ---- Eigene Prompts speichern & laden ----
        let savePromptBtn = document.createElement("button");
        savePromptBtn.textContent = "💾 Prompt speichern";
        styleButton(savePromptBtn);
        savePromptBtn.onclick = () => {
            if (input.value.trim()) {
                let prompts = GM_getValue("chatgpt_prompts", []);
                prompts.push(input.value.trim());
                GM_setValue("chatgpt_prompts", prompts);
                alert("Prompt gespeichert!");
            }
        };
        content.appendChild(savePromptBtn);

        if (prompts && prompts.length > 0) {
            let promptDropdown = document.createElement("select");
            promptDropdown.style.cssText = `
                width: 100%;
                margin-top: 8px;
                padding: 6px;
                border-radius: 6px;
                border: 1px solid #555;
                background: #2a2a2a;
                color: white;
            `;
            prompts.forEach((p, idx) => {
                let option = document.createElement("option");
                option.value = p;
                option.textContent = `Prompt ${idx + 1}: ${p.slice(0, 30)}...`;
                promptDropdown.appendChild(option);
            });

            let usePromptBtn = document.createElement("button");
            usePromptBtn.textContent = "📌 Prompt einfügen";
            styleButton(usePromptBtn);
            usePromptBtn.onclick = () => {
                let val = promptDropdown.value;
                if (val) {
                    insertTextEditable(inputDiv, selectedText + " " + val);
                    inputDiv.focus();
                }
            };
            content.appendChild(promptDropdown);
            content.appendChild(usePromptBtn);
        }

        // ---- Dropdown für History ----
        if (history && history.length > 0) {
            let dropdown = document.createElement("select");
            dropdown.style.cssText = `
                width: 100%;
                margin-top: 8px;
                padding: 6px;
                border-radius: 6px;
                border: 1px solid #555;
                background: #2a2a2a;
                color: white;
            `;
            history.forEach((entry, idx) => {
                let option = document.createElement("option");
                option.value = entry.text;
                option.textContent = `#${idx + 1} (${entry.time}): ${entry.text.slice(0, 30)}...`;
                dropdown.appendChild(option);
            });

            let restoreBtn = document.createElement("button");
            restoreBtn.textContent = "🔄 Einfügen";
            styleButton(restoreBtn);
            restoreBtn.onclick = () => {
                let val = dropdown.value;
                if (val) {
                    insertTextEditable(inputDiv, val);
                    inputDiv.focus();
                }
            };
            content.appendChild(dropdown);
            content.appendChild(restoreBtn);
        }

        menu.appendChild(content);
        document.body.appendChild(menu);

        // Toggle Funktion
        toggleBtn.onclick = () => {
            if (content.style.display === "none") {
                content.style.display = "block";
                toggleBtn.textContent = "−";
            } else {
                content.style.display = "none";
                toggleBtn.textContent = "+";
            }
        };

        // Drag & Drop + speichern
        let isDragging = false, offsetX, offsetY;
        header.onmousedown = e => {
            isDragging = true;
            offsetX = e.clientX - menu.getBoundingClientRect().left;
            offsetY = e.clientY - menu.getBoundingClientRect().top;
            e.preventDefault();
        };
        document.onmousemove = e => {
            if (isDragging) {
                menu.style.left = e.clientX - offsetX + "px";
                menu.style.top = e.clientY - offsetY + "px";
                menu.style.right = "auto";
            }
        };
        document.onmouseup = () => {
            if (isDragging) {
                GM_setValue("menu_left", menu.offsetLeft);
                GM_setValue("menu_top", menu.offsetTop);
            }
            isDragging = false;
        };
    }

    // ---------- Button Style ----------
    function styleButton(btn) {
        btn.style.cssText = `
            margin: 4px 2px;
            padding: 6px 10px;
            border-radius: 8px;
            border: 1px solid #555;
            background: linear-gradient(135deg, #2f2f2f, #3f3f3f);
            color: white;
            font-size: 13px;
            font-family: Arial, sans-serif;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
            display: block;
            width: 100%;
            text-align: left;
        `;
        btn.onmouseover = () => (btn.style.background = "#4a4a4a");
        btn.onmouseout = () => (btn.style.background = "linear-gradient(135deg, #2f2f2f, #3f3f3f)");
        btn.onmousedown = () => (btn.style.transform = "scale(0.95)");
        btn.onmouseup = () => (btn.style.transform = "scale(1)");
    }
})();
