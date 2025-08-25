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
    settings: 'chatgpt_settings_v6',    // v6: +forceNewClick etc.
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

  // --------------------------- UI: Menü-Redesign ---------------------------
  function mountMenu(inputDiv, ctx) {
    const { settings } = ctx;
    const theme = palette(settings.theme);
    const sz = sizeVars(settings.size);

    // Persistente Breite (nur Breite, Höhe dynamisch mit max-height)
    const WIDTH_KEY = 'menu_w';

    // Design-CSS injizieren
    (function injectMenuCSS() {
      const existing = document.getElementById('cgpt-menu-style');
      const bg = theme.card, fg = theme.fg, subtle = theme.subtle, border = theme.border, hover = theme.hover, shadow = theme.shadow, accent = theme.accent;
      const css = `
      .cgpt-menu{position:fixed;inset:auto auto 20px 20px;background:${bg};color:${fg};border:1px solid ${border};border-radius:14px;box-shadow:${shadow};z-index:999999;font-family:Inter,system-ui,Arial,sans-serif;font-size:${sz.font};display:flex;gap:0;overflow:hidden}
      .cgpt-sidebar{display:flex;flex-direction:column;gap:6px;padding:10px;background:${theme.bg};border-right:1px solid ${border};min-width:48px;align-items:center}
      .cgpt-tab{width:36px;height:36px;border:1px solid ${border};border-radius:10px;background:transparent;color:${fg};cursor:pointer;display:flex;align-items:center;justify-content:center}
      .cgpt-tab:hover{background:${hover}}
      .cgpt-tab.active{background:${subtle}}
      .cgpt-main{display:flex;flex-direction:column;min-width:260px;max-width:520px}
      .cgpt-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid ${border};cursor:move}
      .cgpt-title{font-weight:700}
      .cgpt-actions{display:flex;align-items:center;gap:8px}
      .cgpt-toggle{display:flex;align-items:center;gap:6px;border:1px solid ${border};border-radius:999px;padding:4px 8px;background:transparent}
      .cgpt-toggle input{accent-color:${accent}}
      .cgpt-content{padding:10px 12px;max-height:70vh;overflow:auto}
      .cgpt-section{display:grid;gap:8px;margin-bottom:12px}
      .cgpt-h3{font-size:12px;letter-spacing:.02em;opacity:.8;text-transform:uppercase}
      .cgpt-grid{display:grid;gap:8px}
      @media (min-width: 820px){ .cgpt-grid.cols-2{grid-template-columns:1fr 1fr} }
      .cgpt-footer{padding:10px 12px;border-top:1px solid ${border};position:sticky;bottom:0;background:${bg};backdrop-filter:saturate(120%) blur(3px)}
      .cgpt-resizer{position:absolute;right:6px;bottom:6px;width:14px;height:14px;cursor:ew-resize;opacity:.6}
      .cgpt-resizer::after{content:"";display:block;width:100%;height:100%;border-right:2px solid ${border};border-bottom:2px solid ${border};border-radius:2px;transform:rotate(45deg)}
      .cgpt-search{width:100%;padding:8px;border:1px solid ${border};border-radius:8px;background:transparent;color:${fg};outline:none}
      .cgpt-search:focus{box-shadow:inset 0 0 0 2px ${border}}
      `;
      if (existing) { existing.textContent = css; return; }
      const style = document.createElement('style');
      style.id = 'cgpt-menu-style';
      style.textContent = css;
      document.head.appendChild(style);
    })();

    // Container
    const menu = document.createElement('div');
    menu.className = 'cgpt-menu';
    const savedLeft = get(K.menuPos.left, null);
    const savedTop  = get(K.menuPos.top, null);
    const savedW    = get(WIDTH_KEY, null);
    Object.assign(menu.style, {
      left: savedLeft !== null ? `${savedLeft}px` : '',
      top:  savedTop  !== null ? `${savedTop}px`  : '',
      right: savedLeft === null ? '20px' : '',
      ...(savedTop === null ? { top: '20px' } : {}),
      width: savedW ? `${Math.max(260, Number(savedW)||360)}px` : '360px'
    });

    // Sidebar (Tabs)
    const sidebar = document.createElement('div');
    sidebar.className = 'cgpt-sidebar';
    const tabs = [
      { key: 'actions', label: 'Aktionen', icon: '⚡' },
      { key: 'prompts', label: 'Prompts',  icon: '✍️' },
      { key: 'history', label: 'History',  icon: '🕒' },
      { key: 'settings',label: 'Einstellungen', icon: '⚙️' }
    ];
    const contentAreas = {}; // WICHTIG: nur einmal deklarieren!
    let activeKey = 'actions';
    const tabButtons = {};
    tabs.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'cgpt-tab' + (i===0 ? ' active' : '');
      b.title = t.label;
      b.textContent = t.icon;
      b.addEventListener('click', () => {
        activeKey = t.key;
        for (const k in tabButtons) tabButtons[k].classList.toggle('active', k === activeKey);
        for (const k in contentAreas) contentAreas[k].style.display = (k === activeKey ? 'block' : 'none');
      });
      tabButtons[t.key] = b;
      sidebar.appendChild(b);
    });

    // Main (Header + Content + Footer)
    const main = document.createElement('div');
    main.className = 'cgpt-main';

    // Header
    const header = document.createElement('div');
    header.className = 'cgpt-header';
    const title = document.createElement('div');
    title.className = 'cgpt-title';
    title.textContent = 'ChatGPT Tools';

    const actions = document.createElement('div');
    actions.className = 'cgpt-actions';

    function quickToggle(label, checked, onChange) {
      const wrap = document.createElement('label');
      wrap.className = 'cgpt-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!checked;
      cb.addEventListener('change', () => onChange(!!cb.checked));
      const span = document.createElement('span');
      span.textContent = label;
      wrap.appendChild(cb); wrap.appendChild(span);
      return wrap;
    }
    const tglAuto = quickToggle('Auto', !!settings.autoSubmit, (v) => {
      const s = loadSettings(); s.autoSubmit = v; saveSettings(s);
    });
    const tglNew  = quickToggle('New', !!settings.forceNewClick, (v) => {
      const s = loadSettings(); s.forceNewClick = v; saveSettings(s);
    });

    const btnMin = iconBtn('−', theme);
    const btnClose = iconBtn('×', theme);
    actions.appendChild(tglAuto);
    actions.appendChild(tglNew);
    actions.appendChild(btnMin);
    actions.appendChild(btnClose);
    header.appendChild(title);
    header.appendChild(actions);

    // Content
    const content = document.createElement('div');
    content.className = 'cgpt-content';

    // --- Aktionen ---
    const actionsEl = document.createElement('div');
    actionsEl.className = 'cgpt-section';
    const actionsH3 = document.createElement('div'); actionsH3.className = 'cgpt-h3'; actionsH3.textContent = 'Quick-Aktionen';
    const qaSearch = document.createElement('input'); qaSearch.className='cgpt-search'; qaSearch.placeholder='Quick-Aktionen filtern…';
    const quickWrap = document.createElement('div'); quickWrap.className = 'cgpt-grid cols-2';

    function doInsertAndMaybeSend(textToInsert) {
      if (!inputDiv) return;
      insertTextEditable(inputDiv, textToInsert);
      inputDiv.focus();
      if (ctx.settings.autoSubmit) { trySubmit(); toast('Gesendet ✔'); }
      else { toast('Eingefügt ✔'); }
    }
    function showPreview(text) {
      previewBox.style.display = 'block';
      previewArea.value = text;
      previewArea.scrollTop = 0;
    }
    function renderQuick() {
      quickWrap.innerHTML = '';
      const filter = (qaSearch.value || '').trim().toLowerCase();
      const quick = loadQuick();
      if (!quick.length) {
        quickWrap.appendChild(emptyNote('Keine Quick-Aktionen. Füge unten welche hinzu.', theme));
      } else {
        quick
          .map((q, i) => ({...q, i}))
          .filter(q => !filter || q.label.toLowerCase().includes(filter) || (q.addon||'').toLowerCase().includes(filter))
          .forEach((qa) => {
            const row = document.createElement('div');
            row.className = 'cgpt-grid';
            const b = solidBtn(qa.label, theme);
            b.style.textAlign = 'left';
            b.title = 'Klick: Einfügen • Shift+Klick: Vorschau';
            b.addEventListener('click', (ev) => {
              const sel = cleanSelection(ctx.selectedText || '');
              const final = combineSelectionWith(qa.addon, sel);
              if (ev.shiftKey) { showPreview(renderTpl(final, { sel })); return; }
              doInsertAndMaybeSend(renderTpl(final, { sel }));
            });

            const rowBtns = document.createElement('div');
            rowBtns.style.display='flex'; rowBtns.style.gap='6px';
            const up = miniBtn('↑', theme);
            const down = miniBtn('↓', theme);
            const del = miniBtn('🗑', theme);

            up.onclick = () => { const arr = loadQuick(); const i = qa.i; if (i>0){ [arr[i-1],arr[i]]=[arr[i],arr[i-1]]; saveQuick(arr); renderQuick(); } };
            down.onclick = () => { const arr = loadQuick(); const i = qa.i; if (i<arr.length-1){ [arr[i+1],arr[i]]=[arr[i],arr[i+1]]; saveQuick(arr); renderQuick(); } };
            del.onclick = () => { const arr = loadQuick(); arr.splice(qa.i,1); saveQuick(arr); renderQuick(); };

            rowBtns.appendChild(up); rowBtns.appendChild(down); rowBtns.appendChild(del);
            row.appendChild(b); row.appendChild(rowBtns);
            quickWrap.appendChild(row);
          });
      }
    }
    qaSearch.addEventListener('input', renderQuick);

    // Quick hinzufügen
    const qaAdd = document.createElement('div'); qaAdd.className = 'cgpt-section';
    const qaAddH3 = document.createElement('div'); qaAddH3.className = 'cgpt-h3'; qaAddH3.textContent = 'Neue Quick-Aktion';
    const qaLabel = textInput('Name der Aktion …', theme);
    const qaAddon = textInput('Text/Anweisung (Platzhalter ok: {SELECTION},{URL},{TITLE},{TIME},{LANG}) …', theme);
    const qaAddBtn = outlineBtn('➕ Hinzufügen', theme);
    qaAddBtn.onclick = () => {
      const label = qaLabel.value.trim(); const addon = qaAddon.value.trim();
      if (!label || !addon) return;
      const arr = loadQuick(); arr.push({ label, addon }); saveQuick(arr);
      qaLabel.value = ''; qaAddon.value = ''; renderQuick();
    };

    actionsEl.appendChild(actionsH3);
    actionsEl.appendChild(qaSearch);
    actionsEl.appendChild(quickWrap);
    actionsEl.appendChild(divider(theme));
    actionsEl.appendChild(qaAddH3);
    actionsEl.appendChild(qaLabel);
    actionsEl.appendChild(qaAddon);
    actionsEl.appendChild(qaAddBtn);

    // --- Prompts ---
    const promptsEl = document.createElement('div');
    promptsEl.className = 'cgpt-section';
    const pH3 = document.createElement('div'); pH3.className = 'cgpt-h3'; pH3.textContent = 'Prompts';
    const search = document.createElement('input'); search.className='cgpt-search'; search.placeholder='Prompts durchsuchen …';
    const categorySelect = selectInput(theme);
    const promptList = document.createElement('div'); promptList.className = 'cgpt-grid cols-2';

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
          const row = document.createElement('div'); row.className='cgpt-grid';
          const b = solidBtn(txt.length > 64 ? txt.slice(0,64)+'…' : txt, theme);
          b.style.textAlign='left';
          b.title = 'Klick: Einfügen • Shift+Klick: Vorschau';
          b.onclick = (ev) => {
            const sel = cleanSelection(ctx.selectedText || '');
            const final = combineSelectionWith(txt, sel);
            if (ev.shiftKey) { showPreview(renderTpl(final, { sel })); return; }
            doInsertAndMaybeSend(renderTpl(final, { sel }));
          };
          const rowBtns = document.createElement('div'); rowBtns.style.display='flex'; rowBtns.style.gap='6px';
          const copy = miniBtn('⎘', theme);
          const del = miniBtn('🗑', theme);
          copy.onclick = () => navigator.clipboard?.writeText(txt);
          del.onclick = () => {
            const arr2 = loadPrompts(); const cat2 = getSelectedCategory(arr2);
            cat2.items.splice(realIdx, 1); savePrompts(arr2); renderPromptList();
          };
          rowBtns.appendChild(copy); rowBtns.appendChild(del);
          row.appendChild(b); row.appendChild(rowBtns);
          promptList.appendChild(row);
        });
      }
    }
    search.addEventListener('input', renderPromptList);
    categorySelect.addEventListener('change', renderPromptList);

    const addCatRow = document.createElement('div'); addCatRow.className='cgpt-grid';
    const newCat = textInput('Neue Kategorie …', theme);
    const addCatBtn = outlineBtn('Kategorie hinzufügen', theme);
    addCatBtn.onclick = () => {
      const name = newCat.value.trim(); if (!name) return;
      const arr = loadPrompts();
      if (arr.some(c => c.category.toLowerCase() === name.toLowerCase())) { alert('Kategorie existiert bereits.'); return; }
      arr.push({ category: name, items: [] }); savePrompts(arr); newCat.value=''; renderCategories(); renderPromptList();
    };
    addCatRow.appendChild(newCat); addCatRow.appendChild(addCatBtn);

    const addPromptRow = document.createElement('div'); addPromptRow.className='cgpt-grid';
    const newPrompt = textInput('Neuen Prompt eingeben (Platzhalter ok) …', theme);
    const addPromptBtn = outlineBtn('Prompt speichern', theme);
    addPromptBtn.onclick = () => {
      const txt = newPrompt.value.trim(); if (!txt) return;
      const arr = loadPrompts(); const cat = getSelectedCategory(arr);
      cat.items.push(txt); savePrompts(arr); newPrompt.value=''; renderPromptList();
    };
    addPromptRow.appendChild(newPrompt); addPromptRow.appendChild(addPromptBtn);

    promptsEl.appendChild(pH3);
    promptsEl.appendChild(search);
    promptsEl.appendChild(categorySelect);
    promptsEl.appendChild(promptList);
    promptsEl.appendChild(divider(theme));
    promptsEl.appendChild(addCatRow);
    promptsEl.appendChild(addPromptRow);
    renderCategories(); renderPromptList();

    // --- History ---
    const historyEl = document.createElement('div');
    historyEl.className = 'cgpt-section';
    const hH3 = document.createElement('div'); hH3.className='cgpt-h3'; hH3.textContent='History';
    const histSearch = document.createElement('input'); histSearch.className='cgpt-search'; histSearch.placeholder='History durchsuchen …';
    historyEl.appendChild(hH3); historyEl.appendChild(histSearch);

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
      const listWrap = document.createElement('div'); listWrap.className='cgpt-grid';
      const hist = sortedHistory(histSearch.value);
      if (!hist.length) {
        listWrap.appendChild(emptyNote('Noch keine (passenden) History-Einträge.', theme));
      } else {
        hist.forEach((h) => {
          const card = document.createElement('details');
          Object.assign(card.style, {
            background: theme.bg, border:`1px solid ${theme.border}`, borderRadius:'10px', padding:'6px'
          });
          const sum = document.createElement('summary');
          sum.style.cursor='pointer';
          sum.textContent = `${h.time || ''} — ${h.text.slice(0, 60)}${h.text.length > 60 ? '…' : ''}`;
          const body = document.createElement('div'); body.className='cgpt-grid';
          const ta = document.createElement('textarea');
          Object.assign(ta.style, { width:'100%', height:'80px', background:theme.card, color:theme.fg, border:`1px solid ${theme.border}`, borderRadius:'6px', padding:'6px', resize:'vertical', outline:'none' });
          ta.readOnly = true; ta.value = h.text;

          const row = document.createElement('div'); row.style.display='flex'; row.style.gap='6px'; row.style.flexWrap='wrap';
          const insertBtn = outlineBtn('🔄 Einfügen', theme);
          insertBtn.onclick = () => { if (inputDiv) doInsertAndMaybeSend(h.text); };
          const copyBtn = outlineBtn('⎘ Kopieren', theme);
          copyBtn.onclick = () => navigator.clipboard?.writeText(h.text);
          const pinBtn = outlineBtn(h.pinned ? '📌 Unpin' : '📌 Pin', theme);
          pinBtn.onclick = () => {
            const all = loadHistory();
            const ix = all.findIndex(x => (x.timeMs||0) === (h.timeMs||0) && x.text === h.text);
            if (ix >= 0) { all[ix].pinned = !all[ix].pinned; saveHistory(all); }
            historyEl.replaceChildren(hH3, histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
          };
          const delBtn = outlineBtn('🗑 Löschen', theme);
          delBtn.onclick = () => {
            const all = loadHistory();
            const ix = all.findIndex(x => (x.timeMs||0) === (h.timeMs||0) && x.text === h.text);
            if (ix >= 0) { all.splice(ix, 1); saveHistory(all); }
            historyEl.replaceChildren(hH3, histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
          };

          row.appendChild(insertBtn); row.appendChild(copyBtn); row.appendChild(pinBtn); row.appendChild(delBtn);
          body.appendChild(ta); body.appendChild(row);
          card.appendChild(sum); card.appendChild(body);
          listWrap.appendChild(card);
        });
      }
      return listWrap;
    }
    const clearAllBtn = outlineBtn('🧹 History leeren', theme);
    clearAllBtn.onclick = () => {
      if (confirm('Wirklich die gesamte History löschen?')) {
        saveHistory([]);
        historyEl.replaceChildren(hH3, histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
      }
    };
    histSearch.addEventListener('input', () => {
      historyEl.replaceChildren(hH3, histSearch, divider(theme), renderHistoryList(), divider(theme), clearAllBtn);
    });
    historyEl.appendChild(divider(theme));
    historyEl.appendChild(renderHistoryList());
    historyEl.appendChild(divider(theme));
    historyEl.appendChild(clearAllBtn);

    // --- Einstellungen ---
    const settingsEl = buildSettingsTab(ctx, theme);

    // Register Tabs
    const contentAreasLocal = { actions: actionsEl, prompts: promptsEl, history: historyEl, settings: settingsEl };
    for (const k in contentAreasLocal) {
      contentAreas[k] = contentAreasLocal[k];
      content.appendChild(contentAreasLocal[k]);
      contentAreasLocal[k].style.display = (k === activeKey ? 'block' : 'none');
    }

    // Footer (sticky) mit Vorschau + freier Prompt
    const footer = document.createElement('div'); footer.className='cgpt-footer';
    const previewTip = document.createElement('div'); previewTip.style.opacity='.8'; previewTip.textContent='Tipp: Shift+Klick auf Quick/Prompt zeigt Vorschau.';
    const previewBox = document.createElement('div'); previewBox.style.display='none';
    const previewArea = document.createElement('textarea');
    Object.assign(previewArea.style, {
      width:'100%', height:'100px', background: theme.card, color: theme.fg,
      border:`1px solid ${theme.border}`, borderRadius:'6px', padding:'6px', resize:'vertical'
    });
    previewBox.appendChild(previewArea);

    const freeRow = document.createElement('div');
    freeRow.style.display='grid'; freeRow.style.gridTemplateColumns='1fr auto auto'; freeRow.style.gap='6px';
    const freeInput = textInput('Eigenen Prompt (Platzhalter ok) …', theme);
    const freePreviewBtn = outlineBtn('👁 Vorschau', theme);
    const freeBtn = solidBtn('➤ Anwenden', theme);
    freePreviewBtn.onclick = () => {
      const sel = cleanSelection(ctx.selectedText || '');
      const final = combineSelectionWith(freeInput.value, sel);
      const rendered = renderTpl(final, { sel });
      previewBox.style.display='block'; previewArea.value = rendered; previewArea.scrollTop = 0;
    };
    freeBtn.onclick = () => {
      const sel = cleanSelection(ctx.selectedText || '');
      const final = combineSelectionWith(freeInput.value.trim(), sel);
      if (!final || !inputDiv) return;
      doInsertAndMaybeSend(renderTpl(final, { sel }));
    };

    const resizer = document.createElement('div');
    resizer.className = 'cgpt-resizer';
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = menu.getBoundingClientRect().width;
      function onMove(ev){
        const dw = ev.clientX - startX;
        const w = Math.max(260, Math.min(560, Math.round(startW + dw)));
        menu.style.width = w + 'px';
      }
      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp, true);
        const w = Math.round(menu.getBoundingClientRect().width);
        set('menu_w', w);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, true);
    });

    const shell = document.createElement('div'); // enthält Header/Content/Footer + Resizer
    shell.style.position = 'relative';
    shell.appendChild(resizer);
    shell.appendChild(header);
    shell.appendChild(content);

    const dividerEl = divider(theme);
    footer.appendChild(previewTip);
    footer.appendChild(previewBox);
    footer.appendChild(dividerEl.cloneNode(true));
    footer.appendChild(freeRow);
    freeRow.appendChild(freeInput);
    freeRow.appendChild(freePreviewBtn);
    freeRow.appendChild(freeBtn);

    shell.appendChild(footer);
    menu.appendChild(sidebar);
    menu.appendChild(shell);
    document.body.appendChild(menu);

    // Default zentrieren, wenn keine Position gespeichert
    if (savedLeft === null || savedTop === null) {
      const rect = menu.getBoundingClientRect();
      const left = Math.max(10, (window.innerWidth - rect.width) / 2);
      const top  = Math.max(10, (window.innerHeight - rect.height) / 2);
      menu.style.left = `${left}px`; menu.style.top = `${top}px`; menu.style.right = 'auto';
    }

    // Header-Buttons
    btnMin.onclick = () => {
      const isHidden = content.style.display === 'none';
      content.style.display = isHidden ? 'block' : 'none';
      footer.style.display  = isHidden ? 'block' : 'none';
      btnMin.textContent = isHidden ? '−' : '+';
    };
    btnClose.onclick = () => menu.remove();

    // Dragging
    let dragging = false, offX = 0, offY = 0;
    header.onmousedown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.classList.contains('cgpt-tab'))) return;
      dragging = true;
      const rect = menu.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      e.preventDefault();
    };
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      menu.style.left = `${e.clientX - offX}px`;
      menu.style.top  = `${e.clientY - offY}px`;
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

    // Hotkeys
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

    // „Alt+Q immer Neuer Chat klicken“
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
      s.forceNewClick = !!forceNewRow.cb.checked;
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

