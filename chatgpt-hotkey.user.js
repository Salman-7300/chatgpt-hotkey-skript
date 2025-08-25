// ==UserScript==
// @name         chatgpt-hotkey
// @namespace    http://tampermonkey.net/
// @version      3.9.1
// @description  Alt+Q: neuer Chat (optional immer „Neuer Chat“ klicken) • Alt+W: in letzten Chat einfügen (mit Fallback-Nachfrage). Pro-Menü, Auto-Submit, Export/Import, Site-Toggle, Zielwahl, HUD/Toast. Robust: Hotkey-Handling, AltGr-Support, Input-Finder.
// @match        *://*/*
// @match        https://chatgpt.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --------------------------- Storage Keys & Defaults ---------------------------
  const K = {
    history: 'chatgpt_history_v3',
    text: 'chatgpt_text_v1',
    settings: 'chatgpt_settings_v6',    // v6: +forceNewClick
    quick: 'chatgpt_quick_actions_v2',
    prompts: 'chatgpt_prompts_v2',
    intent: 'chatgpt_intent_v1',        // { mode: 'new' | 'append' }
    menuPos: { left: 'menu_left', top: 'menu_top' }
  };

  const DEFAULT_SETTINGS = Object.freeze({
    historyLimit: 10,
    theme: 'auto',            // 'auto' | 'dark' | 'light'
    size: 'md',               // 'sm' | 'md' | 'lg'
    autoSubmit: false,
    hotkeyNew: 'Alt+Q',
    hotkeyAppend: 'Alt+W',
    onlyWithSelection: false,
    openInSameTab: false,
    target: 'auto',           // 'auto' | 'chatgpt' | 'openai' | 'custom'
    customTarget: '',
    blockedHosts: [],
    lastChatUrl: '',
    forceNewClick: true       // Alt+Q erzwingt „Neuer Chat“-Button
  });

  const DEFAULT_QUICK = Object.freeze([
    { label: 'Erklär mir', addon: 'Erklär {SELECTION} bitte ausführlich.' },
    { label: 'Pro & Contra', addon: 'Erstelle Pro- und Contra-Liste zu: {SELECTION}' },
    { label: 'Zusammenfassung', addon: 'Fasse {SELECTION} in einfachen Worten zusammen.' },
    { label: 'Beispiel', addon: 'Gib mir ein praktisches Beispiel zu: {SELECTION}' },
    { label: 'Übersetzen (Deutsch)', addon: 'Übersetze {SELECTION} ins Deutsche.' },
    { label: '📧 E-Mail', addon: 'Formuliere {SELECTION} als professionelle E-Mail.' },
    { label: '🙏 Höflich', addon: 'Schreibe {SELECTION} höflich und respektvoll um.' },
    { label: '👶 Einfach erklären', addon: 'Erklär {SELECTION} so, dass es ein 10-jähriges Kind versteht.' }
  ]);

  const DEFAULT_PROMPTS = Object.freeze([
    { category: 'Allgemein', items: [
      'Formuliere eine freundliche, professionelle Antwort auf {SELECTION}.',
      'Fasse {SELECTION} in 5 Bulletpoints zusammen.',
      'Nenne die wichtigsten Risiken und Gegenmaßnahmen zu {SELECTION}.'
    ] }
  ]);

  // --------------------------- Helpers: Storage ---------------------------
  const get = (k, f) => {
    const v = GM_getValue(k);
    return (v === undefined || v === null) ? f : v;
  };
  const set = (k, v) => GM_setValue(k, v);

  const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...get(K.settings, {}) });
  const saveSettings = (s) => set(K.settings, s);

  const loadQuick = () => get(K.quick, null) || DEFAULT_QUICK.slice();
  const saveQuick = (a) => set(K.quick, a);

  const loadPrompts = () => get(K.prompts, null) || JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
  const savePrompts = (a) => set(K.prompts, a);

  const loadHistory = () => get(K.history, []);
  const saveHistory = (a) => set(K.history, a);

  // --------------------------- Misc helpers ---------------------------
  const host = () => location.hostname.replace(/^www\./, '');
  const isChatHost = (h = location.hostname) =>
    /(^|\.)chatgpt\.com$/i.test(h) || /(^|\.)chat\.openai\.com$/i.test(h);

  function resolveTarget(s){
    if (s.target === 'chatgpt') return 'https://chatgpt.com/';
    if (s.target === 'openai')  return 'https://chat.openai.com/';
    if (s.target === 'custom' && s.customTarget) return s.customTarget;
    const isOpenAI = /(^|\.)chat\.openai\.com$/i.test(location.hostname);
    const isChatGPT = /(^|\.)chatgpt\.com$/i.test(location.hostname);
    return isOpenAI ? 'https://chat.openai.com/' : (isChatGPT ? 'https://chatgpt.com/' : 'https://chat.openai.com/');
  }

  function toast(msg){
    try{
      const theme = palette(loadSettings().theme);
      const t = document.createElement('div');
      Object.assign(t.style, {
        position:'fixed', right:'16px', bottom:'16px', zIndex: 1000000,
        background: theme.card, color: theme.fg, border:`1px solid ${theme.border}`,
        padding:'8px 10px', borderRadius:'10px', boxShadow: theme.shadow,
        fontFamily:'Inter,system-ui,Arial,sans-serif', fontSize:'13px'
      });
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(()=>t.remove(),1600);
    }catch(_){}
  }

  // --------------------------- Text & Templates ---------------------------
  function cleanSelection(sel) {
    if (!sel) return '';
    sel = sel.replace(/\u00A0/g, ' ')
             .replace(/[ \t]+\n/g, '\n')
             .replace(/\n{3,}/g, '\n\n')
             .trim();
    const lines = sel.split('\n');
    const looksCode = /[{}();=<>]|function|class|const|let|var/.test(sel) && lines.length >= 4;
    if (looksCode && !/^```/.test(sel)) sel = '```\n' + sel + '\n```';
    return sel;
  }
  function renderTpl(template, ctx) {
    const now = new Date();
    const map = {
      '{SELECTION}': ctx.sel || '',
      '{URL}': location.href,
      '{TITLE}': document.title,
      '{TIME}': now.toLocaleString(),
      '{LANG}': navigator.language || 'de'
    };
    let out = String(template || '');
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
    return out;
  }
  function combineSelectionWith(addon, sel) {
    if (/\{SELECTION\}/.test(addon || '')) return renderTpl(addon, { sel });
    return (sel || '') + (addon ? (' ' + addon) : '');
  }

  // --------------------------- Hotkey Matching ---------------------------
  function matchHotkey(e, hotkeyStr) {
    if (!hotkeyStr || typeof hotkeyStr !== 'string') return false;
    const altGraph = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');

    const parts = hotkeyStr.toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
    const rawKey = parts.pop();
    const need = { alt:parts.includes('alt'), ctrl:parts.includes('ctrl'), shift:parts.includes('shift'), meta:parts.includes('meta') };

    const has = { alt:!!e.altKey||!!altGraph, ctrl:!!e.ctrlKey||!!altGraph, shift:!!e.shiftKey, meta:!!e.metaKey };
    if (need.alt && !has.alt) return false;
    if (need.ctrl && !has.ctrl) return false;
    if (need.shift && !has.shift) return false;
    if (need.meta && !has.meta) return false;

    function expectedCode(key) {
      if (/^[a-z]$/.test(key)) return 'Key' + key.toUpperCase();
      if (/^[0-9]$/.test(key)) return 'Digit' + key;
      const map = { enter:'Enter', space:'Space', tab:'Tab', escape:'Escape', esc:'Escape', backspace:'Backspace', delete:'Delete',
                    arrowup:'ArrowUp', arrowdown:'ArrowDown', arrowleft:'ArrowLeft', arrowright:'ArrowRight' };
      if (map[key]) return map[key];
      if (/^f([1-9]|1[0-2])$/.test(key)) return key.toUpperCase();
      return null;
    }
    const wantCode = expectedCode(rawKey);
    const keyOkByCode = wantCode && (e.code === wantCode);
    const ek = (e.key || '').toLowerCase();
    const keyOkByValue = (ek === rawKey) || (rawKey === 'q' && ek === '@'); // Alt/Option+Q → "@"
    return keyOkByCode || keyOkByValue;
  }

  // --------------------------- Auswahl sicher lesen ---------------------------
  function getSelectedTextSafe() {
    try {
      const s = window.getSelection && window.getSelection().toString();
      if (s && s.trim()) return cleanSelection(s);
    } catch (_) {}
    const el = document.activeElement;
    const isTextInput = el && (
      el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && /^(text|search|url|tel|email|password)$/i.test(el.type || 'text'))
    );
    if (isTextInput && el.selectionStart != null && el.selectionEnd != null && el.selectionStart !== el.selectionEnd) {
      try {
        const s2 = String(el.value).slice(el.selectionStart, el.selectionEnd);
        if (s2 && s2.trim()) return cleanSelection(s2);
      } catch (_) {}
    }
    return '';
  }

  // --------------------------- Teil 1: Hotkeys überall ---------------------------
  document.addEventListener('keydown', function (e) {
    const s = loadSettings();

    // Seite blockiert?
    if (Array.isArray(s.blockedHosts) && s.blockedHosts.includes(host())) return;

    const isNew    = matchHotkey(e, s.hotkeyNew);
    const isAppend = matchHotkey(e, s.hotkeyAppend);
    if (!isNew && !isAppend) return;

    // Shortcuts anderer Seiten blocken
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const selectedText = getSelectedTextSafe();

    // nur mit Markierung?
    if (!selectedText && s.onlyWithSelection) { toast('Keine Auswahl – Öffnen abgebrochen.'); return; }

    // Nur bei echter Auswahl in History
    if (selectedText) {
      const history = loadHistory();
      const now = Date.now();
      history.unshift({ text: selectedText, time: new Date(now).toLocaleString(), timeMs: now, pinned: false });
      if (history.length > s.historyLimit) history.splice(s.historyLimit);
      saveHistory(history);
    }

    // ---- Fallback-Frage für Alt+W, wenn kein letzter Chat vorhanden ----
    let mode = isNew ? 'new' : 'append';
    let targetUrl = '';

    if (mode === 'append' && !s.lastChatUrl) {
      const choice = (prompt(
        'Kein letzter Chat gefunden.\n' +
        'n = neuen Chat öffnen\n' +
        's = Startseite öffnen\n' +
        'a = abbrechen',
        'n'
      ) || '').trim().toLowerCase();

      if (!choice || choice.startsWith('a')) { toast('Abgebrochen.'); return; }
      if (choice.startsWith('n')) {
        mode = 'new';
        targetUrl = resolveTarget(s);
        toast('Neuer Chat…');
      } else {
        targetUrl = resolveTarget(s);
        toast('Chat öffnen…');
      }
    } else {
      targetUrl = (mode === 'append' && s.lastChatUrl) ? s.lastChatUrl : resolveTarget(s);
      toast(mode === 'new' ? 'Neuer Chat…' : (s.lastChatUrl ? 'In letzten Chat…' : 'Chat öffnen…'));
    }

    // Absicht + Text speichern und öffnen
    set(K.text, selectedText || '');
    set(K.intent, { mode });

    s.openInSameTab ? location.assign(targetUrl) : window.open(targetUrl, '_blank');
  }, true);

  // --------------------------- Teil 2: Auf Chat-Seite ---------------------------
  if (isChatHost()) {
    trackChatUrl();

    const selectedText = cleanSelection(get(K.text, ''));
    const intent = get(K.intent, { mode: 'append' });
    const history = loadHistory();
    const settings = loadSettings();
    const quick = loadQuick();
    const prompts = loadPrompts();

    (async () => {
      // Nur klicken, wenn Schalter an ist
      if (intent && intent.mode === 'new' && settings.forceNewClick) {
        await tryNewChat(5000);
      }
      const inputDiv = await waitForInputDiv().catch(() => null);

      if (inputDiv && selectedText) {
        insertTextEditable(inputDiv, selectedText);
        if (settings.autoSubmit) trySubmit();
      }
      mountMenu(inputDiv, { settings, quick, prompts, history, selectedText });
    })();
  }

  // --------------------------- Track last chat url ---------------------------
  function trackChatUrl() {
    let lastHref = location.href;
    function update(url) {
      if (/\/c\/[A-Za-z0-9-]+/i.test(url)) {
        const s = loadSettings();
        if (s.lastChatUrl !== url) { s.lastChatUrl = url; saveSettings(s); }
      }
    }
    update(lastHref);
    const mo = new MutationObserver(() => {
      if (location.href !== lastHref) { lastHref = location.href; update(lastHref); }
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (location.href !== lastHref) { lastHref = location.href; update(lastHref); }
    }, 1000);
  }

  // --------------------------- "New Chat" Button finden & klicken ---------------------------
  function tryNewChat(timeoutMs = 4000) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      function attempt() {
        const candidates = [
          'button[aria-label*="New chat"]',
          'button[aria-label*="Neue"]',
          'button[data-testid*="new-chat"]',
          'a[aria-label*="New chat"]',
          'a[data-testid*="new-chat"]',
          'button', 'a'
        ];
        for (const sel of candidates) {
          const nodes = document.querySelectorAll(sel);
          for (const n of nodes) {
            const txt = (n.innerText || n.textContent || '').trim().toLowerCase();
            if (/new chat|neue unterhaltung|neuer chat/.test(txt) || /new-chat/.test(n.getAttribute('data-testid')||'')) {
              n.click(); return resolve(true);
            }
          }
        }
        if (Date.now() > deadline) return resolve(false);
        requestAnimationFrame(attempt);
      }
      attempt();
    });
  }

  // --------------------------- Input Finder ---------------------------
  function waitForInputDiv(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const tryFind = () => {
        const candidates = Array.from(document.querySelectorAll('div[contenteditable="true"]'))
          .filter(el => el.offsetParent !== null);
        if (candidates.length) return candidates[0];
        return null;
      };

      const first = tryFind();
      if (first) { resolve(first); return; }

      const obs = new MutationObserver(() => {
        const el = tryFind();
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true });

      setTimeout(() => {
        obs.disconnect();
        const fallback = tryFind();
        fallback ? resolve(fallback) : reject(new Error('Input not found'));
      }, timeoutMs);
    });
  }

  // --------------------------- Insert & Submit ---------------------------
  function insertTextEditable(div, text) {
    if (!div) return;
    div.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }
  function trySubmit() {
    const active = document.activeElement;
    active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    const btn = document.querySelector(
      'button[aria-label*="end"], button[aria-label*="Senden"], button[data-testid*="send"], form button[type="submit"]'
    );
    if (btn) btn.click();
  }

  // --------------------------- UI: Styles & Theming ---------------------------
  function palette(theme) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const mode = theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme;
    if (mode === 'light') {
      return { bg:'#ffffff', fg:'#0f172a', subtle:'#e2e8f0', border:'#cbd5e1', accent:'#0ea5e9', card:'#f8fafc', hover:'#f1f5f9', shadow:'0 10px 24px rgba(0,0,0,0.12)' };
    }
    return { bg:'#121212', fg:'#e5e7eb', subtle:'#262626', border:'#3f3f46', accent:'#22d3ee', card:'#1b1b1b', hover:'#2a2a2a', shadow:'0 10px 24px rgba(0,0,0,0.5)' };
  }
  function sizeVars(size) {
    switch (size) {
      case 'sm': return { pad:'10px', radius:'10px', font:'13px', maxW:'280px' };
      case 'lg': return { pad:'16px', radius:'14px', font:'15px', maxW:'360px' };
      default:   return { pad:'12px', radius:'12px', font:'14px', maxW:'320px' };
    }
  }

  // --------------------------- UI: Menu Mount ---------------------------
  function mountMenu(inputDiv, ctx) {
    const { settings } = ctx;
    const theme = palette(settings.theme);
    const sz = sizeVars(settings.size);

    // Container
    const menu = document.createElement('div');
    const savedLeft = get(K.menuPos.left, null);
    const savedTop = get(K.menuPos.top, null);

    Object.assign(menu.style, {
      position: 'fixed',
      left: savedLeft !== null ? `${savedLeft}px` : '',
      top: savedTop !== null ? `${savedTop}px` : '',
      right: savedLeft === null ? '20px' : '',
      ...(savedTop === null ? { top: '20px' } : {}),
      background: theme.card,
      color: theme.fg,
      padding: sz.pad,
      borderRadius: sz.radius,
      border: `1px solid ${theme.border}`,
      boxShadow: theme.shadow,
      zIndex: 999999,
      fontFamily: 'Inter, system-ui, Arial, sans-serif',
      fontSize: sz.font,
      width: 'fit-content',
      maxWidth: sz.maxW,
      minWidth: '260px',
      userSelect: 'none'
    });

    // Header (drag)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '8px';
    header.style.fontWeight = '600';
    header.style.cursor = 'move';
    header.innerHTML = `<span>⚡ ChatGPT Menü</span>`;
    const btnRow = document.createElement('div');

    const btnMin = iconBtn('−', theme);
    const btnClose = iconBtn('×', theme);
    btnRow.appendChild(btnMin);
    btnRow.appendChild(btnClose);
    header.appendChild(btnRow);
    menu.appendChild(header);

    // Tabs
    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.gap = '6px';
    tabBar.style.marginBottom = '8px';

    const tabs = [
      { key: 'actions', label: 'Aktionen' },
      { key: 'prompts', label: 'Prompts' },
      { key: 'history', label: 'History' },
      { key: 'settings', label: 'Einstellungen' }
    ];

    const content = document.createElement('div');
    const contentAreas = {}; // <<< WICHTIG: nur EINMAL deklarieren!
    menu.appendChild(tabBar);
    menu.appendChild(content);

    tabs.forEach((t, i) => {
      const tb = document.createElement('button');
      styleTab(tb, theme);
      tb.textContent = t.label;
      if (i === 0) { tb.dataset.active = '1'; tb.style.background = theme.subtle; }
      tb.addEventListener('click', () => {
        [...tabBar.children].forEach(b => { b.dataset.active = '0'; b.style.background = 'transparent'; b.style.boxShadow='none'; });
        tb.dataset.active = '1'; tb.style.background = theme.subtle;
        Object.values(contentAreas).forEach(el => el.style.display = 'none');
        contentAreas[t.key].style.display = 'block';
      });
      tabBar.appendChild(tb);
    });

    // --- Tab: Aktionen (Quick Actions) ---
    const actionsEl = document.createElement('div');
    const quickWrap = document.createElement('div');
    quickWrap.style.display = 'grid';
    quickWrap.style.gridTemplateColumns = '1fr';
    quickWrap.style.gap = '6px';

    function doInsertAndMaybeSend(textToInsert) {
      if (!inputDiv) return;
      insertTextEditable(inputDiv, textToInsert);
      inputDiv.focus();
      if (ctx.settings.autoSubmit) { trySubmit(); toast('Gesendet ✔'); }
      else { toast('Eingefügt ✔'); }
    }
    function showPreview(text) { previewBox.style.display = 'block'; previewArea.value = text; previewArea.scrollTop = 0; }

    function renderQuick() {
      quickWrap.innerHTML = '';
      const quick = loadQuick();
      if (!quick.length) {
        quickWrap.appendChild(emptyNote('Keine Quick-Aktionen. Füge unten welche hinzu.', theme));
      } else {
        quick.forEach((qa, idx) => {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '1fr auto auto auto';
          row.style.gap = '6px';
          const b = solidBtn(qa.label, theme);
          b.style.textAlign = 'left';
          b.title = 'Klick: Einfügen • Shift+Klick: Vorschau';
          b.addEventListener('click', (ev) => {
            const sel = cleanSelection(ctx.selectedText || '');
            const final = combineSelectionWith(qa.addon, sel);
            if (ev.shiftKey) { showPreview(renderTpl(final, { sel })); return; }
            doInsertAndMaybeSend(renderTpl(final, { sel }));
          });

          const up = miniBtn('↑', theme);
          const down = miniBtn('↓', theme);
          const del = miniBtn('🗑', theme);

          up.onclick = () => { const arr = loadQuick(); if (idx > 0) { [arr[idx-1],arr[idx]]=[arr[idx],arr[idx-1]]; saveQuick(arr); renderQuick(); } };
          down.onclick = () => { const arr = loadQuick(); if (idx < arr.length-1) { [arr[idx+1],arr[idx]]=[arr[idx],arr[idx+1]]; saveQuick(arr); renderQuick(); } };
          del.onclick = () => { const arr = loadQuick(); arr.splice(idx,1); saveQuick(arr); renderQuick(); };

          row.appendChild(b); row.appendChild(up); row.appendChild(down); row.appendChild(del);
          quickWrap.appendChild(row);
        });
      }
    }
    renderQuick();

    const qaLabel = textInput('Name der Aktion …', theme);
    const qaAddon = textInput('Text/Anweisung (Platzhalter ok: {SELECTION}, {URL}, {TITLE}, {TIME}, {LANG}) …', theme);
    const qaAddBtn = outlineBtn('➕ Quick-Aktion hinzufügen', theme);
    qaAddBtn.onclick = () => {
      const label = qaLabel.value.trim(); const addon = qaAddon.value.trim();
      if (!label || !addon) return;
      const arr = loadQuick(); arr.push({ label, addon }); saveQuick(arr);
      qaLabel.value=''; qaAddon.value=''; renderQuick();
    };

    actionsEl.appendChild(quickWrap);
    actionsEl.appendChild(divider(theme));
    actionsEl.appendChild(qaLabel);
    actionsEl.appendChild(qaAddon);
    actionsEl.appendChild(qaAddBtn);

    // --- Tab: Prompts ---
    const promptsEl = document.createElement('div');
    promptsEl.style.display = 'grid';
    promptsEl.style.gap = '8px';

    const search = textInput('Prompts durchsuchen …', theme);
    const categorySelect = selectInput(theme);
    const promptList = document.createElement('div');
    promptList.style.display = 'grid';
    promptList.style.gap = '6px';

    const addCatRow = document.createElement('div');
    addCatRow.style.display = 'grid';
    addCatRow.style.gridTemplateColumns = '1fr auto';
    addCatRow.style.gap = '6px';
    const newCat = textInput('Neue Kategorie …', theme);
    const addCatBtn = outlineBtn('Kategorie hinzufügen', theme);
    addCatBtn.onclick = () => {
      const name = newCat.value.trim(); if (!name) return;
      const arr = loadPrompts();
      if (arr.some(c => c.category.toLowerCase() === name.toLowerCase())) { alert('Kategorie existiert bereits.'); return; }
      arr.push({ category: name, items: [] }); savePrompts(arr); newCat.value=''; renderCategories(); renderPromptList();
    };
    addCatRow.appendChild(newCat); addCatRow.appendChild(addCatBtn);

    const addPromptRow = document.createElement('div');
    addPromptRow.style.display = 'grid';
    addPromptRow.style.gridTemplateColumns = '1fr auto';
    addPromptRow.style.gap = '6px';
    const newPrompt = textInput('Neuen Prompt eingeben (Platzhalter ok) …', theme);
    const addPromptBtn = outlineBtn('Prompt speichern', theme);
    addPromptBtn.onclick = () => {
      const txt = newPrompt.value.trim(); if (!txt) return;
      const arr = loadPrompts(); const cat = getSelectedCategory(arr);
      cat.items.push(txt); savePrompts(arr); newPrompt.value=''; renderPromptList();
    };
    addPromptRow.appendChild(newPrompt); addPromptRow.appendChild(addPromptBtn);

    promptsEl.appendChild(search);
    promptsEl.appendChild(categorySelect);
    promptsEl.appendChild(promptList);
    promptsEl.appendChild(divider(theme));
    promptsEl.appendChild(addCatRow);
    promptsEl.appendChild(addPromptRow);

    function getSelectedCategory(arr) {
      const sel = categorySelect.value;
      let cat = arr.find(c => c.category === sel);
      if (!cat) { if (!arr.length) { arr.push({ category: 'Allgemein', items: [] }); } cat = arr[0]; }
      return cat;
    }
    function renderCategories() {
      categorySelect.innerHTML = '';
      const arr = loadPrompts();
      if (!arr.length) savePrompts([{ category: 'Allgemein', items: [] }]);
      loadPrompts().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.category; opt.textContent = c.category;
        categorySelect.appendChild(opt);
      });
    }
    function renderPromptList() {
      promptList.innerHTML = '';
      const arr = loadPrompts();
      const cat = getSelectedCategory(arr);
      let items = cat.items.slice();
      const q = search.value.trim().toLowerCase();
      if (q) items = items.filter(t => t.toLowerCase().includes(q));

      if (!items.length) {
        promptList.appendChild(emptyNote('Keine Prompts gefunden.', theme));
      } else {
        items.forEach((txt) => {
          const realIdx = cat.items.indexOf(txt);
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '1fr auto auto';
          row.style.gap = '6px';

          const b = solidBtn(txt.length > 50 ? txt.slice(0, 50) + '…' : txt, theme);
          b.style.textAlign = 'left';
          b.title = 'Klick: Einfügen • Shift+Klick: Vorschau';
          b.onclick = (ev) => {
            const sel = cleanSelection(ctx.selectedText || '');
            const final = combineSelectionWith(txt, sel);
            if (ev.shiftKey) { showPreview(renderTpl(final, { sel })); return; }
            doInsertAndMaybeSend(renderTpl(final, { sel }));
          };

          const del = miniBtn('🗑', theme);
          del.onclick = () => {
            const arr2 = loadPrompts(); const cat2 = getSelectedCategory(arr2);
            cat2.items.splice(realIdx, 1); savePrompts(arr2); renderPromptList();
          };
          const copy = miniBtn('⎘', theme);
          copy.onclick = () => navigator.clipboard?.writeText(txt);

          row.appendChild(b); row.appendChild(copy); row.appendChild(del);
          promptList.appendChild(row);
        });
      }
    }
    search.addEventListener('input', renderPromptList);
    categorySelect.addEventListener('change', renderPromptList);
    renderCategories();
    renderPromptList();

    // --- Tab: History ---
    const historyEl = document.createElement('div');
    const histSearch = textInput('History durchsuchen …', theme);
    histSearch.style.marginBottom = '6px';
    historyEl.appendChild(histSearch);

    function sortedHistory(filterQ='') {
      const q = filterQ.trim().toLowerCase();
      const arr = loadHistory().map(h => ({
        ...h,
        pinned: !!h.pinned,
        timeMs: typeof h.timeMs === 'number' ? h.timeMs : (Date.parse(h.time || '') || 0)
      }));
      let out = arr;
      if (q) out = out.filter(h => (h.text || '').toLowerCase().includes(q) || String(h.time||'').toLowerCase().includes(q));
      out.sort((a, b) => (b.pinned - a.pinned) || (b.timeMs - a.timeMs));
      return out;
    }

    function renderHistoryList() {
      const listWrap = document.createElement('div');
      listWrap.style.display = 'grid';
      listWrap.style.gap = '6px';
      const hist = sortedHistory(histSearch.value);

      if (!hist.length) {
        listWrap.appendChild(emptyNote('Noch keine (passenden) History-Einträge.', theme));
      } else {
        hist.forEach((h) => {
          const wrap = document.createElement('details');
          wrap.style.background = theme.bg;
          wrap.style.border = `1px solid ${theme.border}`;
          wrap.style.borderRadius = '8px';
          wrap.style.padding = '6px';

          const sum = document.createElement('summary');
          sum.style.cursor = 'pointer';
          sum.textContent = `${h.time || ''} — ${h.text.slice(0, 60)}${h.text.length > 60 ? '…' : ''}`;
          wrap.appendChild(sum);

          const body = document.createElement('div');
          body.style.marginTop = '6px';
          body.style.display = 'grid';
          body.style.gap = '6px';

          const textArea = document.createElement('textarea');
          textArea.readOnly = true;
          textArea.value = h.text;
          Object.assign(textArea.style, {
            width:'100%', height:'80px',
            background: theme.card, color: theme.fg,
            border:`1px solid ${theme.border}`, borderRadius:'6px',
            padding:'6px', resize:'vertical', outline:'none'
          });

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '6px';
          row.style.flexWrap = 'wrap';

          const insertBtn = outlineBtn('🔄 Einfügen', theme);
          insertBtn.onclick = () => { if (inputDiv) doInsertAndMaybeSend(h.text); };

          const copyBtn = outlineBtn('⎘ Kopieren', theme);
          copyBtn.onclick = () => navigator.clipboard?.writeText(h.text);

          const pinBtn = outlineBtn(h.pinned ? '📌 Unpin' : '📌 Pin', theme);
          pinBtn.onclick = () => {
            const all = loadHistory();
            const ix = all.findIndex(x => (x.timeMs||0) === (h.timeMs||0) && x.text === h.text);
            if (ix >= 0) { all[ix].pinned = !all[ix].pinned; saveHistory(all); }
            historyEl.replaceChildren(histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
          };

          const delBtn = outlineBtn('🗑 Löschen', theme);
          delBtn.onclick = () => {
            const all = loadHistory();
            const ix = all.findIndex(x => (x.timeMs||0) === (h.timeMs||0) && x.text === h.text);
            if (ix >= 0) { all.splice(ix, 1); saveHistory(all); }
            historyEl.replaceChildren(histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
          };

          row.appendChild(insertBtn); row.appendChild(copyBtn); row.appendChild(pinBtn); row.appendChild(delBtn);

          body.appendChild(textArea); body.appendChild(row);
          wrap.appendChild(body);
          listWrap.appendChild(wrap);
        });
      }
      return listWrap;
    }

    const clearAllBtn = outlineBtn('🧹 History leeren', theme);
    clearAllBtn.onclick = () => {
      if (confirm('Wirklich die gesamte History löschen?')) {
        saveHistory([]);
        historyEl.replaceChildren(histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
      }
    };

    histSearch.addEventListener('input', () => {
      historyEl.replaceChildren(histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
    });
    historyEl.appendChild(divider(theme));
    historyEl.appendChild(renderHistoryList());
    historyEl.appendChild(divider(theme));
    historyEl.appendChild(clearAllBtn);

    // --- Tab: Einstellungen ---
    const settingsEl = buildSettingsTab(ctx, theme);

    // ---- Footer: Vorschau + Freier Prompt ----
    const previewTip = document.createElement('div');
    previewTip.style.opacity = '0.8';
    previewTip.textContent = 'Tipp: Shift+Klick auf Quick/Prompt zeigt nur die Vorschau.';
    previewTip.style.margin = '6px 0';

    const previewBox = document.createElement('div');
    previewBox.style.display = 'none';
    const previewArea = document.createElement('textarea');
    Object.assign(previewArea.style, {
      width:'100%', height:'100px', background: theme.card, color: theme.fg,
      border:`1px solid ${theme.border}`, borderRadius:'6px', padding:'6px', resize:'vertical'
    });

    const freeRow = document.createElement('div');
    freeRow.style.display = 'grid';
    freeRow.style.gridTemplateColumns = '1fr auto auto';
    freeRow.style.gap = '6px';
    const freeInput = textInput('Eigenen Prompt eingeben (Platzhalter ok) …', theme);
    const freePreviewBtn = outlineBtn('👁 Vorschau', theme);
    const freeBtn = solidBtn('➤ Anwenden', theme);
    freePreviewBtn.onclick = () => {
      const sel = cleanSelection(ctx.selectedText || '');
      const final = combineSelectionWith(freeInput.value, sel);
      const rendered = renderTpl(final, { sel });
      previewBox.style.display = 'block'; previewArea.value = rendered; previewArea.scrollTop = 0;
    };
    freeBtn.onclick = () => {
      const sel = cleanSelection(ctx.selectedText || '');
      const final = combineSelectionWith(freeInput.value.trim(), sel);
      if (!final || !inputDiv) return;
      doInsertAndMaybeSend(renderTpl(final, { sel }));
    };

    // ---- Register Tabs (FIX: NICHT erneut deklarieren)
    contentAreas.actions  = actionsEl;
    contentAreas.prompts  = promptsEl;
    contentAreas.history  = historyEl;
    contentAreas.settings = settingsEl;

    content.appendChild(actionsEl);
    content.appendChild(promptsEl);
    content.appendChild(historyEl);
    content.appendChild(settingsEl);

    // Sichtbarkeit
    promptsEl.style.display = 'none';
    historyEl.style.display = 'none';
    settingsEl.style.display = 'none';

    // Footer
    content.appendChild(divider(theme));
    content.appendChild(previewTip);
    content.appendChild(previewBox);
    previewBox.appendChild(previewArea);
    content.appendChild(divider(theme));
    freeRow.appendChild(freeInput);
    freeRow.appendChild(freePreviewBtn);
    freeRow.appendChild(freeBtn);
    content.appendChild(freeRow);

    // Mount
    document.body.appendChild(menu);

    // Standard: mittig, wenn keine Position gespeichert
    if (savedLeft === null || savedTop === null) {
      const rect = menu.getBoundingClientRect();
      const left = Math.max(10, (window.innerWidth - rect.width) / 2);
      const top = Math.max(10, (window.innerHeight - rect.height) / 2);
      menu.style.left = `${left}px`; menu.style.top = `${top}px`; menu.style.right = 'auto';
    }

    // Button actions
    btnMin.onclick = () => {
      const isHidden = content.style.display === 'none';
      content.style.display = isHidden ? 'block' : 'none';
      btnMin.textContent = isHidden ? '−' : '+';
    };
    btnClose.onclick = () => menu.remove();

    // Dragging
    let dragging = false, offX = 0, offY = 0;
    header.onmousedown = (e) => {
      dragging = true;
      const rect = menu.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      e.preventDefault();
    };
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      menu.style.left = `${e.clientX - offX}px`;
      menu.style.top = `${e.clientY - offY}px`;
      menu.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      set(K.menuPos.left, menu.offsetLeft);
      set(K.menuPos.top, menu.offsetTop);
    }, true);
  }

  // --------------------------- Settings Tab ---------------------------
  function buildSettingsTab(ctx, theme) {
    const settingsEl = document.createElement('div');
    settingsEl.style.display = 'grid';
    settingsEl.style.gap = '8px';

    const histLimitRow = labeledNumber('Max. History-Einträge', ctx.settings.historyLimit, 1, 200, theme);

    // Hotkeys (zwei Felder + Recorder)
    const hotNewRow = document.createElement('div');
    hotNewRow.style.display = 'grid';
    hotNewRow.style.gridTemplateColumns = '1fr auto';
    hotNewRow.style.gap = '6px';
    const hotNewInput = textInput('Hotkey "neuer Chat" (z. B. Alt+Q)', theme);
    hotNewInput.value = ctx.settings.hotkeyNew || DEFAULT_SETTINGS.hotkeyNew;
    const recNew = outlineBtn('🎙️ Aufnehmen', theme);

    const hotAppendRow = document.createElement('div');
    hotAppendRow.style.display = 'grid';
    hotAppendRow.style.gridTemplateColumns = '1fr auto';
    hotAppendRow.style.gap = '6px';
    const hotAppendInput = textInput('Hotkey "anhängen" (z. B. Alt+W)', theme);
    hotAppendInput.value = ctx.settings.hotkeyAppend || DEFAULT_SETTINGS.hotkeyAppend;
    const recAppend = outlineBtn('🎙️ Aufnehmen', theme);

    let recState = null;
    function startRecord(btn, input) {
      if (recState) return;
      recState = { btn, input };
      btn.textContent = '… Taste drücken'; btn.disabled = true;
      const handler = (e) => {
        e.preventDefault();
        const mods = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.shiftKey) mods.push('Shift');
        if (e.altKey) mods.push('Alt');
        if (e.metaKey) mods.push('Meta');
        const keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        input.value = [...mods, keyName].join('+');
        window.removeEventListener('keydown', handler, true);
        recState.btn.textContent = '🎙️ Aufnehmen';
        recState.btn.disabled = false;
        recState = null;
      };
      window.addEventListener('keydown', handler, true);
    }
    recNew.onclick = () => startRecord(recNew, hotNewInput);
    recAppend.onclick = () => startRecord(recAppend, hotAppendInput);

    // Auto-Submit
    const autoRow = document.createElement('label');
    autoRow.style.display = 'flex'; autoRow.style.gap = '8px'; autoRow.style.alignItems='center';
    const autoCb = document.createElement('input'); autoCb.type='checkbox'; autoCb.checked = !!ctx.settings.autoSubmit;
    autoRow.appendChild(autoCb); autoRow.appendChild(document.createTextNode('Automatisch senden (nach Einfügen)'));

    // Schalter „Alt+Q erzwingt New-Chat-Button“
    const forceNewRow = checkboxRow('Alt+Q: immer „Neuer Chat“ klicken', !!ctx.settings.forceNewClick, theme);

    // Nur mit Markierung / Im selben Tab
    const onlySelRow = checkboxRow('Nur mit Markierung öffnen', ctx.settings.onlyWithSelection, theme);
    const sameTabRow = checkboxRow('Im selben Tab öffnen', ctx.settings.openInSameTab, theme);

    // Theme & Size
    const sizeRow = labeledSelect('Menü-Größe', [
      { v: 'sm', t: 'Klein' }, { v: 'md', t: 'Mittel' }, { v: 'lg', t: 'Groß' }
    ], ctx.settings.size, theme);
    const themeRow = labeledSelect('Theme', [
      { v: 'auto', t: 'Automatisch' }, { v: 'light', t: 'Hell' }, { v: 'dark', t: 'Dunkel' }
    ], ctx.settings.theme, theme);

    // Zielauswahl
    const targetRow = labeledSelect('Ziel (Chat-Domain)', [
      { v: 'auto',    t: 'Auto (kontextabhängig)' },
      { v: 'chatgpt', t: 'chatgpt.com' },
      { v: 'openai',  t: 'chat.openai.com' },
      { v: 'custom',  t: 'Eigenes URL' }
    ], ctx.settings.target || 'auto', theme);
    const customUrlInput = textInput('Eigenes Ziel-URL (z. B. https://chatgpt.com/)', theme);
    customUrlInput.value = ctx.settings.customTarget || '';
    customUrlInput.disabled = (targetRow.select.value !== 'custom');
    targetRow.select.onchange = () => { customUrlInput.disabled = (targetRow.select.value !== 'custom'); };

    // Site an/aus
    const isBlocked = Array.isArray(ctx.settings.blockedHosts) && ctx.settings.blockedHosts.includes(host());
    const blockBtn = outlineBtn(isBlocked ? 'Diese Seite aktivieren' : 'Diese Seite deaktivieren', theme);
    blockBtn.onclick = () => {
      const s = loadSettings();
      s.blockedHosts = Array.isArray(s.blockedHosts) ? s.blockedHosts : [];
      const h = host();
      const ix = s.blockedHosts.indexOf(h);
      if (ix >= 0) s.blockedHosts.splice(ix,1); else s.blockedHosts.push(h);
      saveSettings(s);
      alert('Gespeichert für: ' + h + '. Seite lädt neu.');
      location.reload();
    };

    // Export / Import
    const expBtn = outlineBtn('↧ Daten exportieren', theme);
    const impBtn = outlineBtn('↥ Daten importieren', theme);
    expBtn.onclick = () => {
      const data = { settings: loadSettings(), quick: loadQuick(), prompts: loadPrompts(), history: loadHistory() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'chatgpt-hotkey-backup.json'; a.click(); URL.revokeObjectURL(a.href);
    };
    impBtn.onclick = () => {
      const inp = document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
      inp.onchange = () => {
        const f = inp.files?.[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try {
            const d = JSON.parse(String(r.result||'{}'));
            if (d.settings) saveSettings({ ...loadSettings(), ...d.settings });
            if (d.quick) saveQuick(d.quick);
            if (d.prompts) savePrompts(d.prompts);
            if (Array.isArray(d.history)) saveHistory(d.history);
            alert('Import erfolgreich. Menü wird neu geladen.'); location.reload();
          } catch(e){ alert('Import fehlgeschlagen: ' + e.message); }
        };
        r.readAsText(f);
      };
      inp.click();
    };

    const saveCfg = solidBtn('💾 Einstellungen speichern', theme);
    saveCfg.onclick = () => {
      const s = loadSettings();
      s.historyLimit = Number(histLimitRow.input.value) || DEFAULT_SETTINGS.historyLimit;
      s.size = sizeRow.select.value; s.theme = themeRow.select.value;
      s.autoSubmit = !!autoCb.checked;
      s.forceNewClick = !!forceNewRow.cb.checked;          // speichern
      s.hotkeyNew = (hotNewInput.value.trim() || DEFAULT_SETTINGS.hotkeyNew);
      s.hotkeyAppend = (hotAppendInput.value.trim() || DEFAULT_SETTINGS.hotkeyAppend);
      s.onlyWithSelection = !!onlySelRow.cb.checked;
      s.openInSameTab    = !!sameTabRow.cb.checked;
      s.target           = targetRow.select.value;
      s.customTarget     = customUrlInput.value.trim();
      saveSettings(s);

      const h = loadHistory();
      if (h.length > s.historyLimit) { h.splice(s.historyLimit); saveHistory(h); }
      alert('Einstellungen gespeichert. Menü wird neu gezeichnet.');
      location.reload();
    };

    const resetPos = outlineBtn('📍 Menü-Position zurücksetzen', theme);
    resetPos.onclick = () => { set(K.menuPos.left, null); set(K.menuPos.top, null); alert('Position zurückgesetzt. Seite neu laden empfohlen.'); };

    settingsEl.appendChild(histLimitRow.row);
    settingsEl.appendChild(hotNewRow);
    settingsEl.appendChild(hotAppendRow);
    settingsEl.appendChild(autoRow);
    settingsEl.appendChild(forceNewRow.row);
    settingsEl.appendChild(onlySelRow.row);
    settingsEl.appendChild(sameTabRow.row);
    settingsEl.appendChild(sizeRow.row);
    settingsEl.appendChild(themeRow.row);
    settingsEl.appendChild(targetRow.row);
    settingsEl.appendChild(customUrlInput);
    settingsEl.appendChild(blockBtn);
    settingsEl.appendChild(expBtn);
    settingsEl.appendChild(impBtn);
    settingsEl.appendChild(saveCfg);
    settingsEl.appendChild(resetPos);
    return settingsEl;
  }

  // --------------------------- UI Elements ---------------------------
  function iconBtn(txt, theme) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      background: 'transparent', color: theme.fg, border: `1px solid ${theme.border}`,
      width: '28px', height: '28px', borderRadius: '8px', cursor: 'pointer', lineHeight: '24px', outline: 'none'
    });
    b.textContent = txt; b.onmouseover = () => b.style.background = theme.hover; b.onmouseout = () => b.style.background = 'transparent';
    b.addEventListener('focus', () => b.style.boxShadow = `inset 0 0 0 2px ${theme.border}`); b.addEventListener('blur',  () => b.style.boxShadow = 'none');
    return b;
  }
  function styleTab(b, theme) {
    Object.assign(b.style, {
      flex: '1', padding: '6px 8px', borderRadius: '8px', border: `1px solid ${theme.border}`,
      background: 'transparent', color: theme.fg, cursor: 'pointer', outline: 'none', boxSizing: 'border-box'
    });
    b.onmouseover = () => { if (b.dataset.active !== '1') b.style.background = theme.hover; };
    b.onmouseout  = () => { if (b.dataset.active !== '1') b.style.background = 'transparent'; };
    b.addEventListener('focus', () => { b.style.boxShadow = `inset 0 0 0 2px ${b.dataset.active==='1' ? theme.subtle : theme.border}`; });
    b.addEventListener('blur',  () => { b.style.boxShadow = 'none'; });
  }
  function solidBtn(txt, theme) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      padding: '8px 10px', borderRadius: '8px', border: 'none', background: theme.accent,
      color: '#0b1020', fontWeight: 600, cursor: 'pointer', boxShadow: 'none', outline: 'none'
    });
    b.textContent = txt; b.onmouseover = () => b.style.filter = 'brightness(0.95)'; b.onmouseout = () => b.style.filter = 'none';
    b.onmousedown = () => b.style.transform = 'scale(0.98)'; b.onmouseup = () => b.style.transform = 'none';
    b.addEventListener('focus', () => b.style.boxShadow = `inset 0 0 0 2px ${theme.border}`); b.addEventListener('blur',  () => b.style.boxShadow = 'none');
    return b;
  }
  function outlineBtn(txt, theme) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      padding: '6px 8px', borderRadius: '8px', border: `1px solid ${theme.border}`,
      background: 'transparent', color: theme.fg, cursor: 'pointer', outline: 'none'
    });
    b.textContent = txt; b.onmouseover = () => b.style.background = theme.hover; b.onmouseout = () => b.style.background = 'transparent';
    b.addEventListener('focus', () => b.style.boxShadow = `inset 0 0 0 2px ${theme.border}`); b.addEventListener('blur',  () => b.style.boxShadow = 'none');
    return b;
  }
  function miniBtn(txt, theme) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      padding: '0 8px', borderRadius: '8px', border: `1px solid ${theme.border}`,
      background: 'transparent', color: theme.fg, cursor: 'pointer', height: '32px', outline: 'none'
    });
    b.textContent = txt; b.onmouseover = () => b.style.background = theme.hover; b.onmouseout = () => b.style.background = 'transparent';
    b.addEventListener('focus', () => b.style.boxShadow = `inset 0 0 0 2px ${theme.border}`); b.addEventListener('blur',  () => b.style.boxShadow = 'none');
    return b;
  }
  function textInput(placeholder, theme) {
    const i = document.createElement('input'); i.type = 'text';
    Object.assign(i.style, {
      width: '100%', padding: '8px', borderRadius: '8px', border: `1px solid ${theme.border}`,
      background: 'transparent', color: theme.fg, outline: 'none'
    });
    i.placeholder = placeholder || '';
    i.addEventListener('focus', () => i.style.boxShadow = `inset 0 0 0 2px ${theme.border}`);
    i.addEventListener('blur',  () => i.style.boxShadow = 'none');
    return i;
  }
  function selectInput(theme) {
    const s = document.createElement('select');
    Object.assign(s.style, {
      width: '100%', padding: '8px', borderRadius: '8px', border: `1px solid ${theme.border}`,
      background: 'transparent', color: theme.fg, cursor: 'pointer', outline: 'none'
    });
    s.addEventListener('focus', () => s.style.boxShadow = `inset 0 0 0 2px ${theme.border}`);
    s.addEventListener('blur',  () => s.style.boxShadow = 'none');
    return s;
  }
  function labeledNumber(label, value, min, max, theme) {
    const row = document.createElement('div'); row.style.display = 'grid'; row.style.gridTemplateColumns = '1fr auto'; row.style.gap = '6px';
    const span = document.createElement('span'); span.textContent = label;
    const input = document.createElement('input'); input.type = 'number'; input.value = value; if (min != null) input.min = min; if (max != null) input.max = max;
    Object.assign(input.style, {
      width: '120px', padding: '6px', borderRadius: '8px', border: `1px solid ${theme.border}`,
      background: 'transparent', color: theme.fg, outline: 'none'
    });
    input.addEventListener('focus', () => input.style.boxShadow = `inset 0 0 0 2px ${theme.border}`); input.addEventListener('blur',  () => input.style.boxShadow = 'none');
    row.appendChild(span); row.appendChild(input);
    return { row, input };
  }
  function labeledSelect(label, options, current, theme) {
    const row = document.createElement('div'); row.style.display = 'grid'; row.style.gridTemplateColumns = '1fr auto'; row.style.gap = '6px';
    const span = document.createElement('span'); span.textContent = label;
    const select = selectInput(theme);
    options.forEach(o => {
      const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.t;
      if (o.v === current) opt.selected = true;
      select.appendChild(opt);
    });
    row.appendChild(span); row.appendChild(select);
    return { row, select };
  }
  function divider(theme) {
    const d = document.createElement('div'); d.style.height = '1px'; d.style.background = theme.border; d.style.margin = '6px 0'; return d;
  }
  function emptyNote(text, theme) {
    const n = document.createElement('div'); n.textContent = text; n.style.opacity = '0.8'; n.style.padding = '6px';
    n.style.background = theme.bg; n.style.border = `1px dashed ${theme.border}`; n.style.borderRadius = '8px'; return n;
  }
  function checkboxRow(label, checked, theme) {
    const wrap = document.createElement('label');
    wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '8px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!checked;
    wrap.appendChild(cb); wrap.appendChild(document.createTextNode(label));
    return { row: wrap, cb };
  }

})();
