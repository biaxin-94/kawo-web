/*
 * กะวอ web app core (v10.0): login, server calls, app state, tabs, shared UI pieces.
 * Each section (views-*.js) registers a tab with KAWO.tab({...}).
 * The page never decides permissions itself: the server checks every write. Viewers just see
 * disabled controls (KAWO.canEdit()) so they don't try.
 */
(function () {
  'use strict';

  const APP_VERSION = '10.0';   // must match VERSION in Code.js (the page warns if not)
  const CFG = window.KAWO_CONFIG || {};
  const ERRORS = {
    auth: 'ยืนยันตัวตนไม่สำเร็จ ลองปิดแล้วเปิดหน้านี้ใหม่จาก LINE',
    forbidden: 'บัญชีนี้ดูได้อย่างเดียว แก้ไขไม่ได้',
    unknown_action: 'หน้าเว็บกับระบบเป็นคนละเวอร์ชัน ลองรีเฟรช',
    bad_request: 'คำขอไม่ถูกต้อง ลองรีเฟรช',
    server: 'ระบบมีปัญหา ลองใหม่อีกครั้ง',
    network: 'ส่งไม่สำเร็จ สัญญาณอ่อนหรือไม่มีเน็ต ลองใหม่อีกครั้ง',
    config: 'หน้าเว็บยังไม่ได้ตั้งค่า (LIFF_ID / API_URL ใน config.js)',
    liff: 'เปิดผ่าน LINE ไม่สำเร็จ',
  };

  const K = window.KAWO = {
    APP_VERSION: APP_VERSION,
    S: { me: null, version: '', meta: null, items: [], list: [], chores: [], recipes: [], dict: [], members: [], freezeHints: [] },
    tabs: [],
    current: null,
    idToken: null,
    busy: false,
  };

  /* ---------------- DOM helpers (textContent only: names typed in chat can never inject HTML) ---------------- */
  K.el = function (tag, attrs, children) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
      else if (k === 'value') n.value = v;
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return n;
  };
  const el = K.el;
  K.$ = function (id) { return document.getElementById(id); };

  /* ---------------- formatting (same rules as the server) ---------------- */
  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  K.thDate = function (ymd) { if (!ymd) return ''; const p = String(ymd).split('-'); return Number(p[2]) + ' ' + TH_MONTHS[Number(p[1]) - 1]; };
  K.qtyText = function (type, qty, unit) {
    if (type === 'flag') return '';
    if (type === 'serving') return qty + ' ที่';
    if (unit) return qty + ' ' + unit;
    return qty > 1 ? '×' + qty : '';
  };
  K.unitWord = function (type, unit) { return type === 'serving' ? 'ที่' : (unit || 'ชิ้น'); };
  K.leftText = function (left, exp) {
    if (left === null || left === undefined) return '';
    if (left < 0) return 'เลย ' + (-left) + ' วัน';
    if (left === 0) return 'วันนี้';
    if (left === 1) return 'พรุ่งนี้';
    if (left <= 14) return 'อีก ' + left + ' วัน';
    return 'ถึง ' + K.thDate(exp);
  };
  K.urgency = function (left, days) {
    if (left === null || left === undefined) return '';
    if (left < 0) return 'late';
    return left <= days ? 'soon' : '';
  };
  K.locTh = function (id) { const l = (K.S.meta ? K.S.meta.locs : []).filter(function (x) { return x.id === id; })[0]; return l ? l.icon + ' ' + l.th : id; };
  K.catTh = function (id) { const c = (K.S.meta ? K.S.meta.cats : []).filter(function (x) { return x.id === id; })[0]; return c ? c.th : id; };
  K.dictEntry = function (name) { return K.S.dict.filter(function (d) { return d.name === name; })[0] || null; };

  K.canEdit = function () { return !!(K.S.me && K.S.me.role === 'editor'); };

  /* ---------------- local storage (never required: private mode / blocked storage still works) ---------------- */
  K.store = {
    get: function (key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set: function (key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
    del: function (key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  K.newReqId = function () {
    const a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return 'r' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };

  /* ---------------- server ---------------- */
  /** Raw call. Never throws: network trouble comes back as {ok:false, error:'network'}. */
  K.call = async function (api, args, reqId) {
    let res;
    try {
      // text/plain = "simple request": no CORS preflight, which Apps Script can't answer.
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: api, idToken: K.idToken, args: args || {}, reqId: reqId }),
      });
    } catch (e) {
      return { ok: false, error: 'network' };
    }
    if (!res.ok) return { ok: false, error: 'network' };
    try { return await res.json(); } catch (e) { return { ok: false, error: 'network' }; }
  };

  K.errorText = function (res) { return res.message || ERRORS[res.error] || ERRORS.server; };

  /** Applies a server answer: who I am, version, and any state parts it sent. */
  K.absorb = function (res) {
    if (res.me) K.S.me = res.me;
    if (res.version) K.S.version = res.version;
    if (res.state) Object.keys(res.state).forEach(function (k) { K.S[k] = res.state[k]; });
  };

  /**
   * A write from a button. One request ID per tap; shows the server's text or error.
   * Returns the response so callers can follow up (e.g. "ran out -> add to list?").
   */
  K.write = async function (api, args, opts) {
    opts = opts || {};
    if (!K.canEdit()) { K.toast(ERRORS.forbidden, true); return { ok: false, error: 'forbidden' }; }
    if (K.busy && !opts.force) return { ok: false, error: 'busy' };
    K.busy = true; K.renderBusy();
    const res = await K.call(api, args, opts.reqId || K.newReqId());
    K.busy = false; K.renderBusy();
    if (res.ok) {
      K.absorb(res);
      if (!opts.quiet && res.data && res.data.text) K.toast(res.data.text);
      K.render();
    } else {
      if (res.error === 'forbidden' && res.me) { K.absorb(res); K.render(); }
      K.toast(K.errorText(res), true);
    }
    return res;
  };

  K.reload = async function () {
    const res = await K.call('home', {});
    if (!res.ok) { K.fatal(K.errorText(res)); return false; }
    K.absorb(res);
    K.render();
    return true;
  };

  /* ---------------- UI pieces ---------------- */
  let toastTimer = null;
  K.toast = function (text, isError) {
    const old = K.$('toast'); if (old) old.remove();
    const t = el('div', { id: 'toast', class: 'toast' + (isError ? ' error' : ''), role: 'status', text: text });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, isError ? 5000 : 2600);
  };

  /**
   * Bottom sheet. build(close) returns the content nodes. Returns close().
   * onDismiss runs when the person closes it themselves (tap outside / Esc), not when code calls close().
   */
  K.sheet = function (build, onDismiss) {
    const back = el('div', { class: 'backdrop' });
    const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const close = function () { back.remove(); document.removeEventListener('keydown', onKey); };
    const dismiss = function () { close(); if (onDismiss) onDismiss(); };
    const onKey = function (e) { if (e.key === 'Escape') dismiss(); };
    back.addEventListener('click', function (e) { if (e.target === back) dismiss(); });
    document.addEventListener('keydown', onKey);
    build(close).forEach(function (n) { if (n) box.appendChild(n); });
    back.appendChild(box);
    document.body.appendChild(back);
    const f = box.querySelector('input:not([type=hidden]), select, textarea');
    if (f && !('ontouchstart' in window)) f.focus();
    return close;
  };

  /** Number stepper. Returns {node, get()}. */
  K.stepper = function (value, min, max, unit, onChange) {
    const input = el('input', { type: 'number', inputmode: 'numeric', min: min, max: max, value: value, 'aria-label': 'จำนวน' });
    const clamp = function (v) { v = Math.round(Number(v) || min); return Math.max(min, Math.min(max, v)); };
    const set = function (v) { input.value = clamp(v); if (onChange) onChange(Number(input.value)); };
    input.addEventListener('change', function () { set(input.value); });
    const node = el('span', { class: 'stepper' }, [
      el('button', { type: 'button', 'aria-label': 'ลด', text: '−', on: { click: function () { set(Number(input.value) - 1); } } }),
      input,
      unit ? el('span', { class: 'u', text: unit }) : null,
      el('button', { type: 'button', 'aria-label': 'เพิ่ม', text: '+', on: { click: function () { set(Number(input.value) + 1); } } }),
    ]);
    return { node: node, get: function () { return clamp(input.value); } };
  };

  /** Pick a Dictionary item (search by name or alias). onPick(entry); onCancel() if closed without picking. */
  K.pickItem = function (title, onPick, filter, onCancel) {
    K.sheet(function (close) {
      const input = el('input', { class: 'search', type: 'search', placeholder: 'ค้นหา เช่น ไก่ นม ไข่', 'aria-label': 'ค้นหาของ' });
      const box = el('div', { class: 'list' });
      const draw = function () {
        const q = input.value.trim().toLowerCase();
        const list = K.S.dict.filter(function (d) {
          if (filter && !filter(d)) return false;
          return !q || d.name.toLowerCase().indexOf(q) >= 0 || d.aliases.toLowerCase().indexOf(q) >= 0;
        }).slice(0, 60);
        box.replaceChildren.apply(box, list.length ? list.map(function (d) {
          return el('button', { class: 'row', type: 'button', on: { click: function () { close(); onPick(d); } } }, [
            el('div', { class: 'main' }, [d.name, el('span', { class: 'sub', text: K.catTh(d.cat) + (d.aliases ? ' · ' + d.aliases : '') })]),
          ]);
        }) : [el('div', { class: 'empty', text: 'ไม่เจอ ' + (q ? '"' + input.value.trim() + '"' : '') + ' (เพิ่มของใหม่ได้ที่ ตั้งค่า › ของ)' })]);
      };
      input.addEventListener('input', draw);
      draw();
      return [el('h3', { text: title }), input, box];
    }, onCancel);
  };

  K.confirmSheet = function (title, sub, okText, onOk, danger) {
    K.sheet(function (close) {
      return [
        el('h3', { text: title }), sub ? el('div', { class: 'sub', text: sub }) : null,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: close } }),
          el('button', { class: 'btn primary' + (danger ? ' danger' : ''), type: 'button', text: okText, on: { click: function () { close(); onOk(); } } }),
        ]),
      ];
    });
  };

  K.group = function (title, children, right) {
    return el('section', { class: 'group' }, [el('h2', {}, [el('span', { text: title }), right || null]), el('div', { class: 'list' }, children)]);
  };

  /* ---------------- tabs + rendering ---------------- */
  const TAB_ORDER = ['fridge', 'shop', 'stock', 'chores', 'cook', 'settings'];
  K.tab = function (t) {
    K.tabs.push(t);
    K.tabs.sort(function (a, b) { return TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id); });
  };

  K.go = function (id) {
    K.current = id;
    K.store.set('kawo.tab', id);
    K.render();
    window.scrollTo(0, 0);
  };

  K.renderBusy = function () { document.body.style.cursor = K.busy ? 'progress' : ''; };

  K.render = function () {
    if (!K.S.me) return;
    const who = K.$('who');
    who.replaceChildren(el('b', { text: K.S.me.name }), el('span', { class: 'role ' + K.S.me.role, text: K.S.me.roleTh }));
    who.hidden = false;

    const banners = K.$('banners');
    const b = [];
    if (K.S.version && K.S.version !== APP_VERSION) {
      b.push(el('div', { class: 'banner bad', text: 'หน้าเว็บ v' + APP_VERSION + ' ไม่ตรงกับระบบ v' + K.S.version + ' ลองปิดแล้วเปิดใหม่ (ถ้ายังไม่หาย บอกเด๊ะ)' }));
    }
    if (CFG.ENV === 'dev') b.push(el('div', { class: 'banner bad', text: '🧪 DEV: หน้าทดสอบ ใช้ข้อมูลชีตทดสอบ ไม่ใช่ของจริง' }));
    if (!K.canEdit()) b.push(el('div', { class: 'banner info', text: '👀 บัญชีนี้ดูได้อย่างเดียว ปุ่มแก้ไขจะกดไม่ได้' }));
    K.tabs.forEach(function (t) { if (t.banner) { const n = t.banner(); if (n) b.push(n); } });
    banners.replaceChildren.apply(banners, b);

    const nav = K.$('nav');
    if (!K.tabs.some(function (t) { return t.id === K.current; })) K.current = K.tabs[0].id;
    nav.replaceChildren.apply(nav, K.tabs.map(function (t) {
      const badge = t.badge ? t.badge() : 0;
      return el('button', { type: 'button', 'aria-current': t.id === K.current ? 'page' : null, on: { click: function () { K.go(t.id); } } }, [
        el('span', { class: 'ic', text: t.icon }),
        el('span', { text: t.label }),
        badge ? el('span', { class: 'dot', text: String(badge) }) : null,
      ]);
    }));
    nav.hidden = false;

    const tab = K.tabs.filter(function (t) { return t.id === K.current; })[0];
    K.$('view').replaceChildren(tab.render());
    K.$('foot').textContent = (CFG.ENV === 'dev' ? 'DEV · ' : '') + 'ข้อมูลวันที่ ' + K.thDate(K.S.meta.today) + ' · หน้าเว็บ v' + APP_VERSION + ' · ระบบ v' + K.S.version;
  };

  K.fatal = function (msg) {
    K.$('view').replaceChildren(el('p', { class: 'status error', text: msg }));
  };

  /* ---------------- start ---------------- */
  K.start = async function () {
    K.current = K.store.get('kawo.tab', null);
    // Local testing only (http://localhost): talk to the test server without LINE. The real server
    // rejects these fake tokens, so this does nothing on the published page.
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const as = new URLSearchParams(location.search).get('as');
    if (local && as) {
      CFG.API_URL = '/api';
      K.idToken = 'good-token-for-' + as + '-padding-xxxxxxxx';
    } else {
      if (!CFG.LIFF_ID || !CFG.API_URL || !window.liff) return K.fatal(ERRORS.config);
      try {
        await liff.init({ liffId: CFG.LIFF_ID });
      } catch (e) {
        return K.fatal(ERRORS.liff + ' (' + (e && e.message ? e.message : e) + ')');
      }
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      K.idToken = liff.getIDToken();
      if (!K.idToken) return K.fatal(ERRORS.auth + ' (ไม่มี ID token: เปิด scope openid ใน LIFF)');
    }
    const ok = await K.reload();
    if (ok) K.tabs.forEach(function (t) { if (t.afterLoad) t.afterLoad(); });
  };
})();
