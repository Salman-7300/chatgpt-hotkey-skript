// ==UserScript==
// @name         chatgpt-hotkey
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Markierten Text mit Alt+Q an ChatGPT senden + erweitertes Menü mit Buttons, History und eigenem Prompt
// @match        *://*/*
// @match        https://chatgpt.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---------- TEIL 1: Hotkey auf jeder Webseite ----------
    document.addEventListener('keydown', function (e) {
        if (e.altKey && e.key.toLowerCase() === 'q') {
            let selectedText = window.getSelection().toString().trim();
            if (selectedText) {
                // History speichern
                let history = GM_getValue("chatgpt_history", []);
                history.unshift(selectedText);
                if (history.length > 5) history.pop(); // nur letzte 5 behalten
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

        let interval = setInterval(() => {
            let inputDiv = document.querySelector("div[contenteditable='true']");
            if (inputDiv) {
                clearInterval(interval);

                if (selectedText) {
                    insertTextEditable(inputDiv, selectedText);
                }

                createMenu(inputDiv, selectedText, history);
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
    function createMenu(inputDiv, selectedText, history) {
        let menu = document.createElement("div");
        menu.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #1e1e1e;
            padding: 12px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            z-index: 9999;
            font-family: Arial, sans-serif;
            color: white;
            font-size: 14px;
            cursor: move;
            max-width: 260px;
        `;

        let title = document.createElement("div");
        title.textContent = "⚡ ChatGPT Schnelloptionen";
        title.style.marginBottom = "8px";
        title.style.fontWeight = "bold";
        menu.appendChild(title);

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

            menu.appendChild(btn);
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
        menu.appendChild(input);

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
        menu.appendChild(customBtn);

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
            history.forEach((item, idx) => {
                let option = document.createElement("option");
                option.value = item;
                option.textContent = `#${idx + 1}: ${item.slice(0, 30)}...`;
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

            menu.appendChild(dropdown);
            menu.appendChild(restoreBtn);
        }

        document.body.appendChild(menu);

        // Hover Effekt für Menü
        menu.onmouseover = () => (menu.style.boxShadow = "0 6px 16px rgba(0,0,0,0.6)");
        menu.onmouseout = () => (menu.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)");

        // Drag & Drop
        let isDragging = false, offsetX, offsetY;
        menu.onmousedown = e => {
            isDragging = true;
            offsetX = e.clientX - menu.getBoundingClientRect().left;
            offsetY = e.clientY - menu.getBoundingClientRect().top;
        };
        document.onmousemove = e => {
            if (isDragging) {
                menu.style.left = e.clientX - offsetX + "px";
                menu.style.top = e.clientY - offsetY + "px";
                menu.style.right = "auto";
            }
        };
        document.onmouseup = () => (isDragging = false);
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
        btn.onmouseout = () =>
            (btn.style.background = "linear-gradient(135deg, #2f2f2f, #3f3f3f)");
        btn.onmousedown = () => (btn.style.transform = "scale(0.95)");
        btn.onmouseup = () => (btn.style.transform = "scale(1)");
    }
})();
