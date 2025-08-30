// ==UserScript==
// @name         chatgpt-hotkey
// @namespace    http://tampermonkey.net/
// @version      3.22
// @description  Alt+Q: neuer Chat • Alt+W: an letzten Chat anhängen • Alt+M: Menü togglen • Menü (Aktionen/Prompts/History/Einstellungen), Hotkeys mit Aufnahme, Auto-Submit, Domain-Regeln, Export/Import, Themes. Menü mit Resizer (B/H), größere Defaults & „Größe zurücksetzen“.
// @match        *://*/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Salman-7300/chatgpt-hotkey-skript/main/chatgpt-hotkey.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Storage ----------
  const K = {
    history: 'chatgpt_history_v3',
    text: 'chatgpt_text_v1',
    settings: 'chatgpt_settings_v9',
    quick: 'chatgpt_quick_actions_v2',
    prompts: 'chatgpt_prompts_v2',
    intent: 'chatgpt_intent_v1',
    menuPos: { left: 'menu_left', top: 'menu_top' },
    menuW: 'menu_w_px',
    menuH: 'menu_h_px'
  };

  const DEFAULT_SETTINGS = Object.freeze({
    historyLimit: 10,
    theme: 'auto',
    size: 'md',
    density: 'normal',
    autoSubmit: false,
    hotkeyNew: 'Alt+Q',
    hotkeyAppend: 'Alt+W',
    hotkeyToggle: 'Alt+M',
    onlyWithSelection: false,
    openInSameTab: false,
    target: 'auto',
    customTarget: '',
    blockedHosts: [],
    lastChatUrl: '',
    forceNewClick: true,
    rulesByHost: {}
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

  // ---------- Helpers (storage) ----------
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

  // ---------- Misc ----------
  const host = () => location.hostname.replace(/^www\./, '');
  const isChatHost = (h = location.hostname) =>
    /(^|\.)chatgpt\.com$/i.test(h) || /(^|\.)chat\.openai\.com$/i.test(h);

  function resolveTarget(baseSettings){
    const s = baseSettings;
    if (s.target === 'chatgpt') return 'https://chatgpt.com/';
    if (s.target === 'openai')  return 'https://chat.openai.com/';
    if (s.target === 'custom' && s.customTarget) return s.customTarget;
    const isOpenAI = /(^|\.)chat\.openai\.com$/i.test(location.hostname);
    const isChatGPT = /(^|\.)chatgpt\.com$/i.test(location.hostname);
    return isOpenAI ? 'https://chat.openai.com/' : (isChatGPT ? 'https://chatgpt.com/' : 'https://chat.openai.com/');
  }

  function applyDomainRules(s) {
    try {
      const rules = (s.rulesByHost || {})[host()];
      if (!rules) return s;
      const merged = { ...s };
      if (typeof rules.autoSubmit === 'boolean')   merged.autoSubmit   = rules.autoSubmit;
      if (typeof rules.openInSameTab === 'boolean')merged.openInSameTab= rules.openInSameTab;
      if (typeof rules.forceNewClick === 'boolean')merged.forceNewClick= rules.forceNewClick;
      merged._defaultMode = rules.defaultMode || 'auto';
      return merged;
    } catch { return s; }
  }

  function toast(msg){
    try{
      const th = palette(loadSettings().theme);
      const t = document.createElement('div');
      Object.assign(t.style, {
        position:'fixed', right:'16px', bottom:'16px', zIndex: 1000000,
        background: th.card, color: th.fg, border:`1px solid ${th.border}`,
        padding:'8px 10px', borderRadius:'10px', boxShadow: th.shadow,
        fontFamily:'Inter,system-ui,Arial,sans-serif', fontSize:'13px'
      });
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(()=>t.remove(),1600);
    }catch(_){}
  }

  // ---------- Text utils ----------
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
      '{LANG}': navigator.language || 'de',
      '{HOST}': host(),
      '{DOMAIN}': host().split('.').slice(-2).join('.')
    };
    let out = String(template || '');
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
    return out;
  }
  function combineSelectionWith(addon, sel) {
    if (/\{SELECTION\}/.test(addon || '')) return renderTpl(addon, { sel });
    return (sel || '') + (addon ? (' ' + addon) : '');
  }

  // ---------- Prompt-Variablen ----------
  const VAR_RE = /\{var:([^}|]+?)(?:\|([^}]*))?\}/g;
  function extractVars(str) {
    const vars = [];
    const seen = new Set();
    let m;
    while ((m = VAR_RE.exec(str))) {
      const name = m[1].trim();
      const def = (m[2] || '').trim();
      if (!seen.has(name)) { seen.add(name); vars.push({ name, def }); }
    }
    return vars;
  }
  function replaceVars(str, values) {
    return str.replace(VAR_RE, (_, name, def) => (values[name] ?? def ?? ''));
  }
  async function fillPromptVariables(template) {
    const vars = extractVars(template);
    if (!vars.length) return template;

    const th = palette(loadSettings().theme);
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', zIndex: 1000001,
        display:'flex', alignItems:'center', justifyContent:'center'
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        background: th.card, color: th.fg, border:`1px solid ${th.border}`, borderRadius:'12px',
        boxShadow: th.shadow, padding:'12px', width:'min(90vw, 380px)', fontFamily:'Inter,system-ui,Arial,sans-serif'
      });
      const h = document.createElement('div');
      h.textContent = 'Variablen ausfüllen';
      h.style.fontWeight = '700'; h.style.marginBottom = '8px';
      const form = document.createElement('div'); form.style.display='grid'; form.style.gap='8px';
      const inputs = {};
      vars.forEach(v => {
        const row = document.createElement('div'); row.style.display='grid'; row.style.gap='6px';
        const label = document.createElement('label'); label.textContent = v.name;
        const input = document.createElement('input');
        Object.assign(input.style, {
          padding:'8px', borderRadius:'8px', border:`1px solid ${th.border}`,
          background:'transparent', color:th.fg
        });
        input.placeholder = v.def || '';
        input.value = v.def || '';
        inputs[v.name] = input;
        row.appendChild(label); row.appendChild(input); form.appendChild(row);
      });
      const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='8px'; btns.style.justifyContent='flex-end';
      const cancel = outlineBtn('Abbrechen', th);
      const ok = solidBtn('Einsetzen', th);
      cancel.onclick = () => { document.body.removeChild(overlay); resolve(null); };
      ok.onclick = () => {
        const values = {};
        Object.keys(inputs).forEach(k => values[k] = inputs[k].value);
        document.body.removeChild(overlay);
        resolve(replaceVars(template, values));
      };
      btns.appendChild(cancel); btns.appendChild(ok);

      box.appendChild(h); box.appendChild(form); box.appendChild(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  // ---------- Hotkey Matching ----------
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

  // ---------- Auswahl sicher lesen ----------
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

  // ---------- Global Hotkeys ----------
  document.addEventListener('keydown', async function (e) {
    // Menü-Toggle (gilt immer auf Chat-Host)
    const sRaw = loadSettings();
    if (matchHotkey(e, sRaw.hotkeyToggle) && isChatHost()) {
      e.preventDefault(); e.stopPropagation();
      const menu = document.querySelector('#cgpt-menu-shell');
      if (menu) {
        menu.style.display = (menu.style.display === 'none' ? 'flex' : 'none');
      } else {
        await mountIfChatHost();
      }
      return;
    }

    // Deaktiviert auf dieser Seite?
    if (Array.isArray(sRaw.blockedHosts) && sRaw.blockedHosts.includes(host())) return;

    const s = applyDomainRules(sRaw);
    const isNew    = matchHotkey(e, s.hotkeyNew);
    const isAppend = matchHotkey(e, s.hotkeyAppend);
    if (!isNew && !isAppend) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const selectedText = getSelectedTextSafe();
    if (!selectedText && s.onlyWithSelection) { toast('Keine Auswahl – Öffnen abgebrochen.'); return; }

    if (selectedText) {
      const history = loadHistory();
      const now = Date.now();
      history.unshift({ text: selectedText, time: new Date(now).toLocaleString(), timeMs: now, pinned: false });
      if (history.length > s.historyLimit) history.splice(s.historyLimit);
      saveHistory(history);
    }

    let mode = isNew ? 'new' : 'append';
    if (s._defaultMode === 'new') mode = 'new';
    if (s._defaultMode === 'append') mode = 'append';

    let targetUrl = '';
    if (mode === 'append' && !s.lastChatUrl) {
      const choice = (prompt('Kein letzter Chat gefunden.\n' +
                             'n = neuen Chat öffnen\n' +
                             's = Startseite öffnen\n' +
                             'a = abbrechen', 'n') || '').trim().toLowerCase();
      if (!choice || choice.startsWith('a')) { toast('Abgebrochen.'); return; }
      if (choice.startsWith('n')) {
        mode = 'new';
        targetUrl = resolveTarget(s);
      } else {
        targetUrl = resolveTarget(s);
      }
    } else {
      targetUrl = (mode === 'append' && s.lastChatUrl) ? s.lastChatUrl : resolveTarget(s);
    }

    set(K.text, selectedText || '');
    set(K.intent, { mode });
    s.openInSameTab ? location.assign(targetUrl) : window.open(targetUrl, '_blank');
  }, true);

  // ---------- Auf Chat-Seite ----------
  if (isChatHost()) { mountIfChatHost(); }

  async function mountIfChatHost() {
    trackChatUrl();
    const selectedText = cleanSelection(get(K.text, ''));
    const intent = get(K.intent, { mode: 'append' });
    const history = loadHistory();
    const settings = loadSettings();
    const quick = loadQuick();
    const prompts = loadPrompts();

    if (intent && intent.mode === 'new' && settings.forceNewClick) {
      await tryNewChat(5000);
    }
    const inputDiv = await waitForInputDiv().catch(() => null);
    const sEff = applyDomainRules(settings);
    if (inputDiv && selectedText) {
      insertTextEditable(inputDiv, selectedText);
      if (sEff.autoSubmit) trySubmit();
    }
    mountMenu(inputDiv, { settings: sEff, quick, prompts, history, selectedText });
  }

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

  // ---------- Input Finder ----------
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

  // ---------- Insert & Submit ----------
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

  // ---------- Styles ----------
  function palette(themeName) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const modeAuto = prefersDark ? 'dark' : 'light';
    const mode = themeName === 'auto' ? modeAuto : themeName;
    const THEMES = {
      light:   { bg:'#ffffff', fg:'#0f172a', subtle:'#e2e8f0', border:'#cbd5e1', accent:'#0ea5e9', card:'#f8fafc', hover:'#f1f5f9', shadow:'0 10px 24px rgba(0,0,0,0.12)' },
      dark:    { bg:'#121212', fg:'#e5e7eb', subtle:'#262626', border:'#3f3f46', accent:'#22d3ee', card:'#1b1b1b', hover:'#2a2a2a', shadow:'0 10px 24px rgba(0,0,0,0.5)' },
      nord:    { bg:'#0b1220', fg:'#e6edf3', subtle:'#1b2332', border:'#2b3242', accent:'#88c0d0', card:'#121a29', hover:'#1a2333', shadow:'0 14px 34px rgba(0,0,0,0.45)' },
      dracula: { bg:'#1e1f29', fg:'#f8f8f2', subtle:'#2b2c37', border:'#3a3b47', accent:'#bd93f9', card:'#232433', hover:'#2a2b3a', shadow:'0 14px 34px rgba(0,0,0,0.5)' },
      solarized: { bg:'#fdf6e3', fg:'#073642', subtle:'#eee8d5', border:'#e4ddc8', accent:'#268bd2', card:'#fffaf0', hover:'#f2ead7', shadow:'0 10px 24px rgba(0,0,0,0.12)' }
    };
    return THEMES[mode] || THEMES[modeAuto];
  }
  function sizeVars(size) {
    switch (size) {
      case 'xs': return { pad:'8px',  radius:'10px', font:'12px', maxW:'240px' };
      case 'sm': return { pad:'10px', radius:'10px', font:'13px', maxW:'280px' };
      case 'lg': return { pad:'16px', radius:'14px', font:'15px', maxW:'360px' };
      default:   return { pad:'12px', radius:'12px', font:'14px', maxW:'320px' };
    }
  }

  // ---------- Menü ----------
  async function mountMenu(inputDiv, ctx) {
    const { settings } = ctx;
    const th = palette(settings.theme);
    const sz = sizeVars(settings.size);

    (function injectMenuCSS() {
      const existing = document.getElementById('cgpt-menu-style');
      const css = `
      .cgpt-menu{position:fixed;top:16px;left:16px;background:${th.card};color:${th.fg};
        border:1px solid ${th.border};border-radius:14px;box-shadow:${th.shadow};z-index:999999;
        font-family:Inter,system-ui,Arial,sans-serif;font-size:${sz.font};display:flex;gap:0;overflow:hidden}
      .cgpt-menu.compact{font-size:calc(${sz.font} - 1px)}
      .cgpt-sidebar{display:flex;flex-direction:column;gap:6px;padding:8px;background:${th.bg};
        border-right:1px solid ${th.border};min-width:44px;align-items:center}
      .cgpt-tab{width:32px;height:32px;border:1px solid ${th.border};border-radius:9px;background:transparent;
        color:${th.fg};cursor:pointer;display:flex;align-items:center;justify-content:center}
      .cgpt-tab:hover{background:${th.hover}}
      .cgpt-tab.active{background:${th.subtle}}
      .cgpt-main{display:flex;flex-direction:column;min-width:260px;max-width:540px}
      .cgpt-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;
        border-bottom:1px solid ${th.border};cursor:move}
      .cgpt-title{font-weight:700}
      .cgpt-actions{display:flex;align-items:center;gap:6px}
      .cgpt-toggle{display:flex;align-items:center;gap:6px;border:1px solid ${th.border};border-radius:999px;
        padding:3px 7px;background:transparent}
      .cgpt-toggle input{accent-color:${th.accent}}
      .cgpt-content{padding:8px 10px;max-height:var(--cgptContentMax,52vh);overflow:auto}
      .cgpt-section{display:grid;gap:6px;margin-bottom:8px}
      .cgpt-h3{font-size:11px;letter-spacing:.02em;opacity:.8;text-transform:uppercase}
      .cgpt-grid{display:grid;gap:6px}
      @media (min-width: 820px){ .cgpt-grid.cols-2{grid-template-columns:1fr 1fr} }
      .cgpt-footer{padding:8px 10px;border-top:1px solid ${th.border};position:sticky;bottom:0;background:${th.card}}
      .cgpt-search{width:100%;padding:6px;border:1px solid ${th.border};border-radius:8px;background:transparent;color:${th.fg};outline:none}
      .cgpt-resizer{position:absolute;right:6px;bottom:6px;width:12px;height:12px;cursor:nwse-resize;opacity:.6}
      .cgpt-resizer::after{content:"";display:block;width:100%;height:100%;border-right:2px solid ${th.border};
        border-bottom:2px solid ${th.border};border-radius:2px;transform:rotate(45deg)}
      `;
      if (existing) { existing.textContent = css; return; }
      const style = document.createElement('style');
      style.id = 'cgpt-menu-style';
      style.textContent = css;
      document.head.appendChild(style);
    })();

    const shell = document.createElement('div');
    shell.id = 'cgpt-menu-shell';
    shell.className = 'cgpt-menu' + (settings.density === 'compact' ? ' compact' : '');
    const savedLeft = get(K.menuPos.left, null);
    const savedTop  = get(K.menuPos.top, null);
    const savedW    = get(K.menuW, null);
    Object.assign(shell.style, {
      left: savedLeft !== null ? `${savedLeft}px` : '',
      top:  savedTop  !== null ? `${savedTop}px`  : '',
      right: savedLeft === null ? '16px' : '',
      ...(savedTop === null ? { top: '16px' } : ''),
      // Größere Default-Breite + höheres Minimum
      width: savedW ? `${Math.max(320, Number(savedW)||420)}px` : '420px'
    });
    // WICHTIG: kein Stretch nach unten
    shell.style.bottom = 'auto';

    // größere Standard-Inhaltshöhe
    const defaultContentMax = Math.min(Math.round(window.innerHeight * 0.50), 520);
    const savedH = get(K.menuH, null);
    shell.style.setProperty('--cgptContentMax', ((savedH || defaultContentMax)) + 'px');

    const sidebar = document.createElement('div');
    sidebar.className = 'cgpt-sidebar';
    const tabs = [
      { key: 'actions', label: 'Aktionen', icon: '⚡' },
      { key: 'prompts', label: 'Prompts',  icon: '✍️' },
      { key: 'history', label: 'History',  icon: '🕒' },
      { key: 'settings',label: 'Einstellungen', icon: '⚙️' }
    ];

    const main = document.createElement('div');
    main.className = 'cgpt-main';

    const header = document.createElement('div');
    header.className = 'cgpt-header';
    const title = document.createElement('div');
    title.className = 'cgpt-title';
    title.textContent = 'ChatGPT Tools';

    const actionsBar = document.createElement('div');
    actionsBar.className = 'cgpt-actions';
    const tglAuto = quickToggle('Auto', !!settings.autoSubmit, (v) => { const s=loadSettings(); s.autoSubmit=v; saveSettings(s); });
    const tglNew  = quickToggle('New',  !!settings.forceNewClick, (v) => { const s=loadSettings(); s.forceNewClick=v; saveSettings(s); });
    const btnMin = iconBtn('−', th);
    const btnClose = iconBtn('×', th);
    actionsBar.appendChild(tglAuto);
    actionsBar.appendChild(tglNew);
    actionsBar.appendChild(btnMin);
    actionsBar.appendChild(btnClose);
    header.appendChild(title);
    header.appendChild(actionsBar);

    const content = document.createElement('div');
    content.className = 'cgpt-content';

    // ----- Aktionen -----
    const actionsEl = document.createElement('div');
    actionsEl.className = 'cgpt-section';
    const actionsH3 = document.createElement('div'); actionsH3.className = 'cgpt-h3'; actionsH3.textContent = 'Quick-Aktionen';
    const qaSearch = document.createElement('input'); qaSearch.className='cgpt-search'; qaSearch.placeholder='Quick-Aktionen filtern…';
    const quickWrap = document.createElement('div'); quickWrap.className='cgpt-grid cols-2';

    const footerEl = document.createElement('div'); footerEl.className='cgpt-footer';
    const previewTip = document.createElement('div'); previewTip.style.opacity='.8'; previewTip.textContent='Tipp: Shift+Klick zeigt Vorschau statt Senden.';
    const previewBox = document.createElement('div'); previewBox.style.display='none';
    const previewArea = document.createElement('textarea');
    Object.assign(previewArea.style, { width:'100%', height:'100px', border:`1px solid ${th.border}`, borderRadius:'6px', padding:'6px' });
    previewBox.appendChild(previewArea);
    const freeRow = document.createElement('div'); freeRow.style.display='grid'; freeRow.style.gridTemplateColumns='1fr auto auto'; freeRow.style.gap='6px';
    const freeInput = textInput('Eigenen Prompt (Platzhalter ok: {var:Name|Default}) …', th);
    const freePrev = outlineBtn('👁 Vorschau', th);
    const freeApply = solidBtn('➤ Anwenden', th);

    function doInsertAndMaybeSend(textToInsert) {
      if (!inputDiv) return;
      insertTextEditable(inputDiv, textToInsert);
      inputDiv.focus();
      if (ctx.settings.autoSubmit) trySubmit();
    }
    async function resolveTemplateAndMaybePreview(str, ev) {
      const filled = await fillPromptVariables(str);
      if (filled === null) return null;
      if (ev && ev.shiftKey) {
        previewArea.value = filled;
        previewBox.style.display='block';
        return null;
      }
      return filled;
    }

    function renderQuick() {
      quickWrap.innerHTML = '';
      const filter = (qaSearch.value||'').trim().toLowerCase();
      const arr = loadQuick();
      if (!arr.length) {
        quickWrap.appendChild(emptyNote('Keine Quick-Aktionen. Füge unten welche hinzu.', th));
      } else {
        arr.forEach((qa, idx) => {
          if (filter && !(qa.label.toLowerCase().includes(filter) || (qa.addon||'').toLowerCase().includes(filter))) return;
          const row = document.createElement('div'); row.className='cgpt-grid';

          const btn = solidBtn(qa.label, th);
          btn.style.textAlign='left';
          btn.addEventListener('click', async (ev) => {
            const sel = cleanSelection(ctx.selectedText || '');
            const base = renderTpl(combineSelectionWith(qa.addon, sel), { sel });
            const final = await resolveTemplateAndMaybePreview(base, ev);
            if (final) doInsertAndMaybeSend(final);
          });

          const rowBtns = document.createElement('div'); rowBtns.style.display='flex'; rowBtns.style.gap='6px';
          const up = miniBtn('↑', th);
          const down = miniBtn('↓', th);
          const del = miniBtn('🗑', th);
          up.onclick = () => { const a=loadQuick(); if(idx>0){ [a[idx-1],a[idx]]=[a[idx],a[idx-1]]; saveQuick(a); renderQuick(); } };
          down.onclick = () => { const a=loadQuick(); if(idx<a.length-1){ [a[idx+1],a[idx]]=[a[idx],a[idx+1]]; saveQuick(a); renderQuick(); } };
          del.onclick = () => { const a=loadQuick(); a.splice(idx,1); saveQuick(a); renderQuick(); };

          rowBtns.appendChild(up); rowBtns.appendChild(down); rowBtns.appendChild(del);
          row.appendChild(btn); row.appendChild(rowBtns);
          quickWrap.appendChild(row);
        });
      }
    }
    qaSearch.addEventListener('input', renderQuick);

    const qaLabel = textInput('Name der Aktion …', th);
    const qaAddon = textInput('Text/Anweisung (Platzhalter ok: {SELECTION}, {var:Name|Default}) …', th);
    const qaAddBtn = outlineBtn('➕ Hinzufügen', th);
    qaAddBtn.onclick = () => {
      const label = qaLabel.value.trim(); const addon = qaAddon.value.trim();
      if (!label || !addon) return;
      const arr = loadQuick(); arr.push({ label, addon }); saveQuick(arr);
      qaLabel.value=''; qaAddon.value=''; renderQuick();
    };
    const qaDetails = document.createElement('details');
    const qaSummary = document.createElement('summary'); qaSummary.textContent='➕ Neue Quick-Aktion';
    const qaForm = document.createElement('div'); qaForm.className='cgpt-grid'; qaForm.style.marginTop='6px';
    qaForm.appendChild(qaLabel); qaForm.appendChild(qaAddon); qaForm.appendChild(qaAddBtn);
    qaDetails.appendChild(qaSummary); qaDetails.appendChild(qaForm);

    actionsEl.appendChild(actionsH3);
    actionsEl.appendChild(qaSearch);
    actionsEl.appendChild(quickWrap);
    actionsEl.appendChild(divider(th));
    actionsEl.appendChild(qaDetails);

    freePrev.onclick = async () => {
      const sel = cleanSelection(ctx.selectedText || '');
      const base = renderTpl(combineSelectionWith(freeInput.value, sel), { sel });
      const filled = await fillPromptVariables(base);
      if (filled !== null) { previewArea.value = filled; previewBox.style.display='block'; }
    };
    freeApply.onclick = async () => {
      const sel = cleanSelection(ctx.selectedText || '');
      const base = renderTpl(combineSelectionWith(freeInput.value, sel), { sel });
      const final = await fillPromptVariables(base);
      if (final && inputDiv) doInsertAndMaybeSend(final);
    };

    footerEl.appendChild(previewTip);
    footerEl.appendChild(previewBox);
    footerEl.appendChild(divider(th));
    const freeRowWrap = document.createElement('div'); freeRowWrap.style.display='grid'; freeRowWrap.style.gap='6px';
    freeRow.appendChild(freeInput); freeRow.appendChild(freePrev); freeRow.appendChild(freeApply);
    freeRowWrap.appendChild(freeRow);
    footerEl.appendChild(freeRowWrap);

    // ----- Prompts -----
    const promptsEl = document.createElement('div'); promptsEl.className='cgpt-section';
    const pH3 = document.createElement('div'); pH3.className='cgpt-h3'; pH3.textContent='Prompts';
    const search = document.createElement('input'); search.className='cgpt-search'; search.placeholder='Prompts durchsuchen …';
    const categorySelect = selectInput(th);
    const promptList = document.createElement('div'); promptList.className='cgpt-grid cols-2';

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
        promptList.appendChild(emptyNote('Keine Prompts gefunden.', th));
      } else {
        items.forEach((txt) => {
          const realIdx = cat.items.indexOf(txt);
          const row = document.createElement('div'); row.className='cgpt-grid';
          const b = solidBtn(txt.length > 64 ? txt.slice(0,64)+'…' : txt, th);
          b.style.textAlign='left';
          b.onclick = async (ev) => {
            const sel = cleanSelection(ctx.selectedText || '');
            const base = renderTpl(combineSelectionWith(txt, sel), { sel });
            const final = await resolveTemplateAndMaybePreview(base, ev);
            if (final) doInsertAndMaybeSend(final);
          };
          const rowBtns = document.createElement('div'); rowBtns.style.display='flex'; rowBtns.style.gap='6px';
          const copy = miniBtn('⎘', th);
          const del = miniBtn('🗑', th);
          copy.onclick = () => navigator.clipboard?.writeText(txt);
          del.onclick = () => {
            const arr2 = loadPrompts(); const cat2 = getSelectedCategory(arr2);
            cat2.items.splice(realIdx, 1); savePrompts(arr2); renderPromptList();
          };
          row.appendChild(b); rowBtns.appendChild(copy); rowBtns.appendChild(del); row.appendChild(rowBtns);
          promptList.appendChild(row);
        });
      }
    }
    search.addEventListener('input', renderPromptList);
    categorySelect.addEventListener('change', renderPromptList);
    const addCatRow = document.createElement('div'); addCatRow.className='cgpt-grid';
    const newCat = textInput('Neue Kategorie …', th);
    const addCatBtn = outlineBtn('Kategorie hinzufügen', th);
    addCatBtn.onclick = () => {
      const name = newCat.value.trim(); if (!name) return;
      const arr = loadPrompts();
      if (arr.some(c => c.category.toLowerCase() === name.toLowerCase())) { alert('Kategorie existiert bereits.'); return; }
      arr.push({ category: name, items: [] }); savePrompts(arr); newCat.value=''; renderCategories(); renderPromptList();
    };
    addCatRow.appendChild(newCat); addCatRow.appendChild(addCatBtn);
    const addPromptRow = document.createElement('div'); addPromptRow.className='cgpt-grid';
    const newPrompt = textInput('Neuen Prompt eingeben (Platzhalter ok: {var:Name|Default}) …', th);
    const addPromptBtn = outlineBtn('Prompt speichern', th);
    addPromptBtn.onclick = () => {
      const txt = newPrompt.value.trim(); if (!txt) return;
      const arr = loadPrompts(); const cat = getSelectedCategory(arr);
      cat.items.push(txt); savePrompts(arr); newPrompt.value=''; renderPromptList();
    };
    addPromptRow.appendChild(newPrompt); addPromptRow.appendChild(addPromptBtn);

    promptsEl.appendChild(pH3); promptsEl.appendChild(search); promptsEl.appendChild(categorySelect);
    promptsEl.appendChild(promptList); promptsEl.appendChild(divider(th));
    promptsEl.appendChild(addCatRow); promptsEl.appendChild(addPromptRow);
    renderCategories(); renderPromptList();

    // ----- History -----
    const historyEl = document.createElement('div'); historyEl.className='cgpt-section';
    const hH3 = document.createElement('div'); hH3.className='cgpt-h3'; hH3.textContent='History';
    const histSearch = document.createElement('input'); histSearch.className='cgpt-search'; histSearch.placeholder='History durchsuchen …';

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
        listWrap.appendChild(emptyNote('Noch keine (passenden) History-Einträge.', th));
      } else {
        hist.forEach((h) => {
          const card = document.createElement('details');
          Object.assign(card.style, {
            background: th.bg, border:`1px solid ${th.border}`, borderRadius:'10px', padding:'6px'
          });
          const sum = document.createElement('summary'); sum.style.cursor='pointer';
          sum.textContent = `${h.time || ''} — ${h.text.slice(0, 60)}${h.text.length > 60 ? '…' : ''}`;
          const body = document.createElement('div'); body.className='cgpt-grid';
          const ta = document.createElement('textarea');
          Object.assign(ta.style, { width:'100%', height:'80px', background:th.card, color:th.fg,
            border:`1px solid ${th.border}`, borderRadius:'6px', padding:'6px', resize:'vertical', outline:'none' });
          ta.readOnly = true; ta.value = h.text;

          const row = document.createElement('div'); row.style.display='flex'; row.style.gap='6px'; row.style.flexWrap='wrap';
          const insertBtn = outlineBtn('🔄 Einfügen', th);
          insertBtn.onclick = () => { if (inputDiv) doInsertAndMaybeSend(h.text); };
          const copyBtn = outlineBtn('⎘ Kopieren', th);
          copyBtn.onclick = () => navigator.clipboard?.writeText(h.text);
          const pinBtn = outlineBtn(h.pinned ? '📌 Unpin' : '📌 Pin', th);
          pinBtn.onclick = () => {
            const all = loadHistory();
            const ix = all.findIndex(x => (x.timeMs||0) === (h.timeMs||0) && x.text === h.text);
            if (ix >= 0) { all[ix].pinned = !all[ix].pinned; saveHistory(all); }
            rerenderHistory();
          };
          const delBtn = outlineBtn('🗑 Löschen', th);
          delBtn.onclick = () => {
            const all = loadHistory(); const ix = all.findIndex(x => (x.timeMs||0) === (h.timeMs||0) && x.text === h.text);
            if (ix >= 0) { all.splice(ix, 1); saveHistory(all); }
            rerenderHistory();
          };

          row.appendChild(insertBtn); row.appendChild(copyBtn); row.appendChild(pinBtn); row.appendChild(delBtn);
          body.appendChild(ta); body.appendChild(row);
          card.appendChild(sum); card.appendChild(body);
          listWrap.appendChild(card);
        });
      }
      return listWrap;
    }
    const clearAllBtn = outlineBtn('🧹 History leeren', th);
    clearAllBtn.onclick = () => {
      if (confirm('Wirklich die gesamte History löschen?')) {
        saveHistory([]);
        rerenderHistory();
      }
    };
    function rerenderHistory() {
      historyEl.replaceChildren(hH3, histSearch, divider(th), renderHistoryList(), divider(th), clearAllBtn);
    }
    histSearch.addEventListener('input', rerenderHistory);
    historyEl.appendChild(hH3); historyEl.appendChild(histSearch);
    historyEl.appendChild(divider(th));
    historyEl.appendChild(renderHistoryList());
    historyEl.appendChild(divider(th));
    historyEl.appendChild(clearAllBtn);

    // ----- Einstellungen -----
    const settingsEl = buildSettingsTab({ settings }, th);

    function buildSettingsTab(ctx, th) {
      const s0 = loadSettings();
      const wrap = document.createElement('div'); wrap.className='cgpt-section';
      // inside buildSettingsTab(...)
const section = (title, nodes, open = true) => {
  const det = document.createElement('details');
  det.open = open;

  const sum = document.createElement('summary');
  sum.textContent = title;
  sum.style.cursor = 'pointer';
  sum.style.userSelect = 'none';

  const box = document.createElement('div');
  box.className = 'cgpt-grid';
  box.style.marginTop = '6px';
  nodes.forEach(n => box.appendChild(n));

  // Richtig: zuerst die Überschrift, dann der Inhalt
  det.appendChild(sum);
  det.appendChild(box);
  return det;
};

      const histLimitRow = labeledNumber('Max. History-Einträge', s0.historyLimit, 1, 200, th);

      const hotNewRow = rowHotkey('Hotkey „Neuer Chat“', s0.hotkeyNew || 'Alt+Q');
      const hotAppendRow = rowHotkey('Hotkey „An letzten Chat anhängen“', s0.hotkeyAppend || 'Alt+W');
      const hotToggleRow = rowHotkey('Hotkey „Menü ein/aus“', s0.hotkeyToggle || 'Alt+M');

      const autoRow     = checkboxRow('Automatisch senden (nach Einfügen)', !!s0.autoSubmit, th);
      const forceNewRow = checkboxRow('Alt+Q: immer „Neuer Chat“ klicken', !!s0.forceNewClick, th);
      const onlySelRow  = checkboxRow('Nur mit Markierung öffnen', !!s0.onlyWithSelection, th);
      const sameTabRow  = checkboxRow('Im selben Tab öffnen', !!s0.openInSameTab, th);

      const targetRow = labeledSelect('Ziel (Chat-Domain)', [
        { v: 'auto',    t: 'Auto (kontextabhängig)' },
        { v: 'chatgpt', t: 'chatgpt.com' },
        { v: 'openai',  t: 'chat.openai.com' },
        { v: 'custom',  t: 'Eigenes URL' }
      ], s0.target || 'auto', th);
      const customUrlInput = textInput('Eigenes Ziel-URL (z. B. https://chatgpt.com/)', th);
      customUrlInput.value = s0.customTarget || '';
      customUrlInput.disabled = (targetRow.select.value !== 'custom');
      targetRow.select.onchange = () => { customUrlInput.disabled = (targetRow.select.value !== 'custom'); };

      const sizeRow = labeledSelect('Menü-Größe', [
        { v: 'xs', t: 'Sehr klein' }, { v: 'sm', t: 'Klein' }, { v: 'md', t: 'Mittel' }, { v: 'lg', t: 'Groß' }
      ], s0.size, th);
      const themeRow = labeledSelect('Theme', [
        { v: 'auto', t: 'Automatisch' }, { v: 'light', t: 'Hell' }, { v: 'dark', t: 'Dunkel' },
        { v: 'nord', t: 'Nord' }, { v: 'dracula', t: 'Dracula' }, { v: 'solarized', t: 'Solarized' }
      ], s0.theme, th);
      const densityRow = labeledSelect('Dichte', [
        { v: 'normal', t: 'Normal' }, { v: 'compact', t: 'Kompakt' }
      ], s0.density || 'normal', th);

      const rules = s0.rulesByHost || {};
      const currentHost = host();
      const rule = rules[currentHost] || { defaultMode:'auto' };
      const ruleMode = labeledSelect('Default-Modus (für diese Seite)', [
        { v: 'auto',   t: 'Auto (Hotkey bestimmt)' },
        { v: 'new',    t: 'Immer: Neuer Chat' },
        { v: 'append', t: 'Immer: An letzten Chat anhängen' }
      ], rule.defaultMode || 'auto', th);
      const ruleAuto     = checkboxRow('Auto-Submit hier überschreiben', !!rule.autoSubmit, th);
      const ruleSameTab  = checkboxRow('Gleiches Tab hier überschreiben', !!rule.openInSameTab, th);
      const ruleForceNew = checkboxRow('„Neuer Chat“ klicken hier überschreiben', !!rule.forceNew, th);
      const saveRuleBtn  = solidBtn(`Regel speichern für ${currentHost}`, th);
      const delRuleBtn   = outlineBtn(`Regel löschen für ${currentHost}`, th);
      saveRuleBtn.onclick = () => {
        const s = loadSettings();
        s.rulesByHost = s.rulesByHost || {};
        s.rulesByHost[currentHost] = {
          defaultMode: ruleMode.select.value,
          autoSubmit:  !!ruleAuto.cb.checked,
          openInSameTab: !!ruleSameTab.cb.checked,
          forceNewClick: !!ruleForceNew.cb.checked
        };
        saveSettings(s);
        alert('Seiten-Regel gespeichert.');
      };
      delRuleBtn.onclick = () => {
        const s = loadSettings();
        if (s.rulesByHost && s.rulesByHost[currentHost]) {
          delete s.rulesByHost[currentHost];
          saveSettings(s);
          alert('Seiten-Regel entfernt.');
        }
      };

      const isBlocked = Array.isArray(s0.blockedHosts) && s0.blockedHosts.includes(host());
      const blockBtn = outlineBtn(isBlocked ? 'Diese Seite aktivieren' : 'Diese Seite deaktivieren', th);
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

      const expBtn = outlineBtn('↧ Daten exportieren', th);
      const impBtn = outlineBtn('↥ Daten importieren', th);
      expBtn.onclick = () => {
        const data = { settings: loadSettings(), quick: loadQuick(), prompts: loadPrompts(), history: loadHistory() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chatgpt-hotkey-backup.json'; a.click(); URL.revokeObjectURL(a.href);
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

      // NEU: Größe zurücksetzen
      const resetSize = outlineBtn('📐 Menü-Größe zurücksetzen', th);
      resetSize.onclick = () => {
        set(K.menuW, null);
        set(K.menuH, null);
        alert('Menü-Größe zurückgesetzt.');
        location.reload();
      };

      const saveCfg = solidBtn('💾 Einstellungen speichern', th);
      saveCfg.onclick = () => {
        const s = loadSettings();
        s.historyLimit   = Number(histLimitRow.input.value) || DEFAULT_SETTINGS.historyLimit;
        s.size           = sizeRow.select.value;
        s.theme          = themeRow.select.value;
        s.density        = densityRow.select.value;
        s.autoSubmit     = !!autoRow.cb.checked;
        s.forceNewClick  = !!forceNewRow.cb.checked;
        s.onlyWithSelection = !!onlySelRow.cb.checked;
        s.openInSameTab  = !!sameTabRow.cb.checked;
        s.target         = targetRow.select.value;
        s.customTarget   = customUrlInput.value.trim();
        s.hotkeyNew      = hotNewRow.get();
        s.hotkeyAppend   = hotAppendRow.get();
        s.hotkeyToggle   = hotToggleRow.get();
        saveSettings(s);

        const h = loadHistory();
        if (h.length > s.historyLimit) { h.splice(s.historyLimit); saveHistory(h); }
        alert('Einstellungen gespeichert. Menü wird neu gezeichnet.');
        location.reload();
      };
      const resetPos = outlineBtn('📍 Menü-Position zurücksetzen', th);
      resetPos.onclick = () => { set(K.menuPos.left, null); set(K.menuPos.top, null); alert('Position zurückgesetzt. Seite neu laden empfohlen.'); };

      const secHotkeys  = section('🎹 Hotkeys', [histLimitRow.row, hotNewRow.row, hotAppendRow.row, hotToggleRow.row], true);
      const secBehavior = section('⚙️ Verhalten & Ziel', [autoRow.row, forceNewRow.row, onlySelRow.row, sameTabRow.row, divider(th), targetRow.row, customUrlInput], false);
      const secLook     = section('🎨 Darstellung', [sizeRow.row, themeRow.row, densityRow.row], false);
      const secRules    = section('🌐 Seiten-Regeln', [ruleMode.row, ruleAuto.row, ruleSameTab.row, ruleForceNew.row, saveRuleBtn, delRuleBtn], false);
      const secAdmin    = section('🗂️ Backup & Verwaltung', [blockBtn, expBtn, impBtn, resetSize, saveCfg, resetPos], false);

      wrap.appendChild(secHotkeys);
      wrap.appendChild(secBehavior);
      wrap.appendChild(secLook);
      wrap.appendChild(secRules);
      wrap.appendChild(secAdmin);
      return wrap;

      function rowHotkey(label, initial) {
        const row = document.createElement('div');
        row.style.display='grid'; row.style.gridTemplateColumns='1fr auto'; row.style.gap='6px';
        const input = textInput(label + ' (z. B. Alt+Q)', th); input.value = initial;
        const rec = outlineBtn('🎙️ Aufnehmen', th);
        let recState = false;
        rec.onclick = () => {
          if (recState) return;
          recState = true; rec.textContent='… Taste drücken'; rec.disabled=true;
          const handler = (e) => {
            e.preventDefault();
            const mods=[]; if(e.ctrlKey)mods.push('Ctrl'); if(e.shiftKey)mods.push('Shift'); if(e.altKey)mods.push('Alt'); if(e.metaKey)mods.push('Meta');
            const keyName = e.key.length===1?e.key.toUpperCase():e.key;
            input.value = [...mods, keyName].join('+');
            window.removeEventListener('keydown', handler, true);
            rec.textContent='🎙️ Aufnehmen'; rec.disabled=false; recState=false;
          };
          window.addEventListener('keydown', handler, true);
        };
        row.appendChild(input); row.appendChild(rec);
        return { row, get: () => input.value.trim() || initial };
      }
    }

    const contentAreas = { actions: actionsEl, prompts: promptsEl, history: historyEl, settings: settingsEl };
    Object.entries(contentAreas).forEach(([k, el], i) => {
      content.appendChild(el);
      el.style.display = (k === 'actions' ? 'block' : 'none');
    });

    const sidebarButtons = [];
    tabs.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'cgpt-tab' + (i===0 ? ' active' : '');
      b.title = t.label;
      b.textContent = t.icon;
      b.addEventListener('click', () => {
        Object.keys(contentAreas).forEach(k => contentAreas[k].style.display = k === t.key ? 'block' : 'none');
        sidebarButtons.forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        footerEl.style.display = (t.key === 'actions') ? 'block' : 'none';
      });
      sidebar.appendChild(b); sidebarButtons.push(b);
    });

    const contentWrap = document.createElement('div'); contentWrap.style.position='relative';
    contentWrap.appendChild(header);
    contentWrap.appendChild(content);
    contentWrap.appendChild(footerEl);

    const shellWrapMount = () => {
      shell.appendChild(sidebar);
      shell.appendChild(contentWrap);
      document.body.appendChild(shell);
    };
    shellWrapMount();

    if (get(K.menuPos.left, null) === null || get(K.menuPos.top, null) === null) {
      const rect = shell.getBoundingClientRect();
      const left = Math.max(10, (window.innerWidth - rect.width) / 2);
      const top  = Math.max(10, (window.innerHeight - rect.height) / 2);
      shell.style.left = `${left}px`; shell.style.top = `${top}px`; shell.style.right = 'auto';
      shell.style.bottom = 'auto'; // wichtig: kein stretchen
    }

    btnMin.onclick = () => {
      const isHidden = content.style.display === 'none';
      content.style.display = isHidden ? 'block' : 'none';
      btnMin.textContent = isHidden ? '−' : '+';
    };
    btnClose.onclick = () => shell.remove();

    // Dragging
    let dragging = false, offX = 0, offY = 0;
    header.onmousedown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.classList.contains('cgpt-tab'))) return;
      dragging = true;
      const rect = shell.getBoundingClientRect();
      offX = e.clientX - rect.left; offY = e.clientY - rect.top;
      e.preventDefault();
    };
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      shell.style.left = `${e.clientX - offX}px`;
      shell.style.top  = `${e.clientY - offY}px`;
      shell.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      set(K.menuPos.left, shell.offsetLeft);
      set(K.menuPos.top, shell.offsetTop);
    }, true);

    // Resizer (Breite + Höhe)
    const res = document.createElement('div'); res.className='cgpt-resizer';
    res.title = 'Größe anpassen';
    res.onmousedown = (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = shell.getBoundingClientRect().width;
      const startMax = parseInt(getComputedStyle(shell).getPropertyValue('--cgptContentMax')) || 320;

      const move = (ev) => {
        // NEU: Mindestbreite 320px
        const w = Math.max(320, startW + (ev.clientX - startX));
        const contentMax = Math.max(160, startMax + (ev.clientY - startY));
        shell.style.width = `${w}px`;
        shell.style.setProperty('--cgptContentMax', `${contentMax}px`);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        set(K.menuW, parseInt(shell.style.width, 10));
        const finalMax = parseInt(getComputedStyle(shell).getPropertyValue('--cgptContentMax')) || startMax;
        set(K.menuH, finalMax);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    contentWrap.appendChild(res);

    renderQuick();
  }

  // ----- UI helpers -----
  function quickToggle(label, checked, onChange) {
    const th = palette(loadSettings().theme);
    const wrap = document.createElement('label');
    wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='6px';
    wrap.style.border=`1px solid ${th.border}`; wrap.style.borderRadius='999px';
    wrap.style.padding='3px 7px'; wrap.style.background='transparent';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=!!checked;
    cb.addEventListener('change',()=>onChange(!!cb.checked));
    const span=document.createElement('span'); span.textContent=label;
    wrap.appendChild(cb); wrap.appendChild(span); return wrap;
  }
  function iconBtn(txt, th){ const b=document.createElement('button'); Object.assign(b.style,{background:'transparent',color:th.fg,border:`1px solid ${th.border}`,width:'28px',height:'28px',borderRadius:'8px',cursor:'pointer',lineHeight:'24px',outline:'none'}); b.textContent=txt; b.onmouseover=()=>b.style.background=th.hover; b.onmouseout=()=>b.style.background='transparent'; return b; }
  function solidBtn(txt, th){ const b=document.createElement('button'); Object.assign(b.style,{padding:'8px 10px',borderRadius:'8px',border:'none',background:th.accent,color:'#0b1020',fontWeight:600,cursor:'pointer'}); b.textContent=txt; return b; }
  function outlineBtn(txt, th){ const b=document.createElement('button'); Object.assign(b.style,{padding:'6px 8px',borderRadius:'8px',border:`1px solid ${th.border}`,background:'transparent',color:th.fg,cursor:'pointer'}); b.textContent=txt; return b; }
  function miniBtn(txt, th){ const b=document.createElement('button'); Object.assign(b.style,{padding:'0 8px',borderRadius:'8px',border:`1px solid ${th.border}`,background:'transparent',color:th.fg,cursor:'pointer',height:'32px'}); b.textContent=txt; return b; }
  function textInput(ph, th){ const i=document.createElement('input'); i.type='text'; Object.assign(i.style,{width:'100%',padding:'6px',borderRadius:'8px',border:`1px solid ${th.border}`,background:'transparent',color:th.fg,outline:'none'}); i.placeholder=ph||''; return i; }
  function selectInput(th){ const s=document.createElement('select'); Object.assign(s.style,{width:'100%',padding:'6px',borderRadius:'8px',border:`1px solid ${th.border}`,background:'transparent',color:th.fg,cursor:'pointer'}); return s; }
  function labeledNumber(label,value,min,max,th){ const row=document.createElement('div'); row.style.display='grid'; row.style.gridTemplateColumns='1fr auto'; row.style.gap='6px'; const span=document.createElement('span'); span.textContent=label; const input=document.createElement('input'); input.type='number'; input.value=value; if(min!=null) input.min=min; if(max!=null) input.max=max; Object.assign(input.style,{width:'120px',padding:'6px',borderRadius:'8px',border:`1px solid ${th.border}`,background:'transparent',color:th.fg,outline:'none'}); row.appendChild(span); row.appendChild(input); return {row,input}; }
  function labeledSelect(label, options, current, th){ const row=document.createElement('div'); row.style.display='grid'; row.style.gridTemplateColumns='1fr auto'; row.style.gap='6px'; const span=document.createElement('span'); span.textContent=label; const select=selectInput(th); options.forEach(o=>{const opt=document.createElement('option'); opt.value=o.v; opt.textContent=o.t; if(o.v===current) opt.selected=true; select.appendChild(opt);}); row.appendChild(span); row.appendChild(select); return {row,select}; }
  function divider(th){ const d=document.createElement('div'); d.style.height='1px'; d.style.background=th.border; d.style.margin='6px 0'; return d; }
  function emptyNote(text, th){ const n=document.createElement('div'); n.textContent=text; n.style.opacity='0.8'; n.style.padding='6px'; n.style.background=th.bg; n.style.border=`1px dashed ${th.border}`; n.style.borderRadius='8px'; return n; }
  function checkboxRow(label, checked, th){ const wrap=document.createElement('label'); wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='8px'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!checked; wrap.appendChild(cb); wrap.appendChild(document.createTextNode(label)); return {row:wrap, cb}; }

})();
