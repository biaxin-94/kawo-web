/*
 * กะวอ web app core (v13.0): login, server calls, app state, tabs, shared UI pieces.
 * Each section (views-*.js) registers a tab with KAWO.tab({...}).
 * The page never decides permissions itself: the server checks every write. Viewers just see
 * disabled controls (KAWO.canEdit()) so they don't try.
 * v11.0: several households. K.hid = the household this page is showing (from the app link ?h=, else the
 * last one used on this phone); every request carries it and the server checks the person belongs to it.
 * Phone storage is kept per household (K.hkey); views reload theirs when the household changes (K.onHousehold).
 */
(function () {
  'use strict';

  const APP_VERSION = '22.0';   // must match VERSION in Code.js (the page warns if not)
  const CFG = window.KAWO_CONFIG || {};
  const ERRORS = {
    auth: 'ยืนยันตัวตนไม่สำเร็จ ลองปิดแล้วเปิดหน้านี้ใหม่จาก LINE',
    forbidden: 'บัญชีนี้ดูได้อย่างเดียว แก้ไขไม่ได้',
    unknown_action: 'หน้าเว็บกับระบบเป็นคนละเวอร์ชัน ลองรีเฟรช',
    no_household: 'บัญชีนี้ยังไม่ได้อยู่ในบ้านนี้ เปิดแอปจากลิงก์ในกลุ่มไลน์ของบ้าน (พิมพ์ "แอป" ในกลุ่ม)',
    bad_request: 'คำขอไม่ถูกต้อง ลองรีเฟรช',
    server: 'ระบบมีปัญหา ลองใหม่อีกครั้ง',
    network: 'ส่งไม่สำเร็จ สัญญาณอ่อนหรือไม่มีเน็ต ลองใหม่อีกครั้ง',
    config: 'หน้าเว็บยังไม่ได้ตั้งค่า (LIFF_ID / API_URL ใน config.js)',
    liff: 'เปิดผ่าน LINE ไม่สำเร็จ',
  };

  const K = window.KAWO = {
    APP_VERSION: APP_VERSION,
    S: { me: null, version: '', meta: null, items: [], list: [], chores: [], recipes: [], dict: [], members: [], freezeHints: [], households: [] },
    hid: '',          // v11.0: current household ('' = a server without households)
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
    if (type === 'serving') return K.fmtQty(qty) + ' ที่';
    if (unit) return K.fmtQty(qty) + ' ' + unit;
    return qty > 1 ? '×' + K.fmtQty(qty) : qty < 1 ? K.fmtQty(qty) : '';
  };
  /** v22.0: 0.5 -> "½", 1.25 -> "1¼" (same as the server's fmtQty). */
  K.fmtQty = function (n) {
    n = Number(n) || 0;
    const whole = Math.floor(n + 1e-9), part = Math.round((n - whole) * 4), f = ['', '¼', '½', '¾'][part] || '';
    return f ? (whole ? String(whole) : '') + f : String(Math.round(n * 100) / 100);
  };
  /** v22.0 (Idea E): units that may be ½ / ¼ (same list as the server's WHOLE_UNITS). */
  const WHOLE_UNITS = ['ชิ้น', 'ฟอง', 'ซอง', 'กระป๋อง', 'ตัว', 'อัน', 'ที่'];
  K.splits = function (type, unit) { return type !== 'flag' && type !== 'serving' && !!unit && WHOLE_UNITS.indexOf(unit) < 0; };
  /** Rows of one item as text per unit: "1 แพ็ค + ½ กก." (never added across units). */
  K.stockText = function (rows) {
    const by = {}, order = [];
    rows.forEach(function (r) { const w = K.unitWord(r.type, r.unit); if (!(w in by)) { by[w] = 0; order.push(w); } by[w] += Number(r.qty) || 0; });
    return order.map(function (w) { return K.fmtQty(by[w]) + ' ' + w; }).join(' + ');
  };
  /**
   * v22.0: chips to pick one of an item's buying units ("แพ็ค | กก. | ชิ้น"). Returns {node, get()}; node is null
   * when the item has only one unit (nothing to pick).
   */
  K.unitPicker = function (units, current, onChange) {
    let cur = current || (units || [])[0] || '';
    if (!units || units.length < 2) return { node: null, get: function () { return cur; } };
    const btns = units.map(function (u) {
      return el('button', { type: 'button', class: 'fchip', 'aria-pressed': String(u === cur), text: u, on: { click: function () {
        cur = u; btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.textContent === cur)); }); if (onChange) onChange(u);
      } } });
    });
    return { node: el('div', { class: 'fchips unitpick', role: 'group', 'aria-label': 'หน่วย' }, btns), get: function () { return cur; } };
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
  /**
   * v15.0: freshness bar class for an item card: fresh (> FRESH_SOON_DAYS left), soon (0..2 days), late (expired),
   * nodate (ตู้กับข้าว / ของใช้, or no date).
   */
  const FRESH_SOON_DAYS = 2;
  /** v16.0: zones without dates (ตู้กับข้าว, ของใช้): neutral bar, never "expiring". */
  K.NO_EXPIRY_ZONES = ['Kitchen', 'Storage'];
  K.noExp = function (loc) { return K.NO_EXPIRY_ZONES.indexOf(loc) >= 0; };
  K.fresh = function (it) {
    if (!it || K.noExp(it.loc) || it.left === null || it.left === undefined) return 'nodate';
    if (it.left < 0) return 'late';
    return it.left <= FRESH_SOON_DAYS && it.loc !== 'Freezer' ? 'soon' : 'fresh';
  };
  K.locTh = function (id) { const l = (K.S.meta ? K.S.meta.locs : []).filter(function (x) { return x.id === id; })[0]; return l ? l.icon + ' ' + l.th : id; };
  K.catTh = function (id) { const c = (K.S.meta ? K.S.meta.cats : []).filter(function (x) { return x.id === id; })[0]; return c ? c.th : id; };
  K.dictEntry = function (name) { return K.S.dict.filter(function (d) { return d.name === name; })[0] || null; };

  K.canEdit = function () { return !!(K.S.me && (K.S.me.role === 'editor' || K.S.me.role === 'admin')); };
  K.isAdmin = function () { return !!(K.S.me && K.S.me.role === 'admin'); };
  /** Is a storage zone used in this household? (meta.locs[].on, v11.0; older servers: everything on) */
  K.zoneOn = function (id) { const l = (K.S.meta ? K.S.meta.locs : []).filter(function (x) { return x.id === id; })[0]; return !!l && l.on !== false; };

  /* ---------------- local storage (never required: private mode / blocked storage still works) ---------------- */
  K.store = {
    get: function (key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set: function (key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
    del: function (key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  /* ---------------- households (v11.0) ---------------- */
  const HH_KEYS = ['shop.v1', 'cook.v1', 'check.v1', 'freezeDismissed', 'fold.v1', 'chip.v1', 'setup.v1'];   // phone storage that belongs to one household
  const hhHooks = [];
  /** Storage key for this household's data ('kawo.<hid>.<base>'; no household = the pre-v11 key). */
  K.hkey = function (base, hid) { hid = hid === undefined ? K.hid : hid; return hid ? 'kawo.' + hid + '.' + base : 'kawo.' + base; };
  /** fn() runs whenever the household changes, so a view can load that household's phone storage. */
  K.onHousehold = function (fn) { hhHooks.push(fn); };
  K.setHousehold = function (hid) {
    hid = hid || '';
    if (hid === K.hid) return;
    K.hid = hid;
    if (hid) K.store.set('kawo.hh', hid);
    hhHooks.forEach(function (fn) { fn(); });
  };
  /** Pre-v11 phones kept the shopping ticks etc. without a household: they belong to the first household. */
  function moveOldStorage() {
    const first = (K.S.households || []).filter(function (h) { return h.first; })[0];
    if (!first) return;
    let moved = false;
    HH_KEYS.forEach(function (base) {
      const old = K.store.get('kawo.' + base, null);
      if (old === null) return;
      if (K.store.get(K.hkey(base, first.id), null) === null) { K.store.set(K.hkey(base, first.id), old); moved = true; }
      K.store.del('kawo.' + base);
    });
    if (moved && first.id === K.hid) hhHooks.forEach(function (fn) { fn(); });
  }

  K.newReqId = function () {
    const a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return 'r' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };

  /* ---------------- server ---------------- */
  /** Raw call. Never throws: network trouble comes back as {ok:false, error:'network'}. */
  K.call = async function (api, args, reqId, hh) {
    let res;
    hh = hh === undefined ? K.hid : hh;   // a waiting batch keeps the household it was made in
    try {
      // text/plain = "simple request": no CORS preflight, which Apps Script can't answer.
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: api, idToken: K.idToken, hh: hh || undefined, args: args || {}, reqId: reqId }),
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
    if (res.households) K.S.households = res.households;
    if (res.hh) K.setHousehold(res.hh);
    if (res.state) Object.keys(res.state).forEach(function (k) { K.S[k] = res.state[k]; });
    if (res.households) moveOldStorage();
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
    const hh = opts.hh === undefined ? K.hid : opts.hh;
    const res = await K.call(api, args, opts.reqId || K.newReqId(), hh);
    K.busy = false; K.renderBusy();
    if (res.ok && hh !== K.hid) return res;   // answered for a household we've switched away from: don't show its data
    if (res.ok) {
      K.absorb(res);
      // v14.0: a change the server can undo gets the เลิกทำ bar instead of the plain message
      if (res.data && res.data.undo && !opts.noUndo) K.undoBar(res.data.undo, opts.undoLabel || res.data.text);
      else if (!opts.quiet && res.data && res.data.text) K.toast(res.data.text);
      K.render();
    } else {
      if (res.error === 'forbidden' && res.me) { K.absorb(res); K.render(); }
      K.toast(K.errorText(res), true);
    }
    return res;
  };

  K.reload = async function () {
    const res = await K.call('home', {});
    if (!res.ok) {
      // v11.0: not in this household, but in others: let them pick
      if (res.error === 'no_household' && res.households && res.households.length) { K.S.households = res.households; K.pickHouseholdPage(); return false; }
      K.fatal(K.errorText(res)); return false;
    }
    K.absorb(res);
    K.render();
    return true;
  };

  /** Switch to another household this person belongs to: fresh data, that household's phone storage. */
  K.switchHousehold = async function (hid) {
    if (!hid || hid === K.hid) return;
    const keep = K.S.households;
    K.S = { me: null, version: '', meta: null, items: [], list: [], chores: [], recipes: [], dict: [], members: [], freezeHints: [], households: keep };
    K.setHousehold(hid);
    K.$('nav').hidden = true;
    K.$('view').replaceChildren(el('p', { class: 'status', text: 'กำลังโหลด…' }));
    const ok = await K.reload();
    window.scrollTo(0, 0);
    if (ok) K.tabs.forEach(function (t) { if (t.afterLoad) t.afterLoad(); });
  };

  function householdRows(close) {
    return (K.S.households || []).map(function (h) {
      return el('button', { class: 'row', type: 'button', 'aria-current': h.id === K.hid ? 'true' : null, on: { click: function () { if (close) close(); K.switchHousehold(h.id); } } }, [
        el('div', { class: 'main' }, ['🏠 ' + h.name, el('span', { class: 'sub', text: ({ admin: 'ผู้ดูแลบ้าน', editor: 'แก้ไขได้', viewer: 'ดูอย่างเดียว' })[h.role] || '' })]),
        el('span', { class: 'end', text: h.id === K.hid ? '✓' : '' }),
      ]);
    });
  }
  K.pickHousehold = function () {
    K.sheet(function (close) { return [el('h3', { text: 'เลือกบ้าน' }), el('div', { class: 'list' }, householdRows(close))]; });
  };
  K.pickHouseholdPage = function () {
    K.$('view').replaceChildren(el('div', {}, [el('p', { class: 'status', text: ERRORS.no_household }), K.group('บ้านของคุณ', householdRows(null))]));
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
   * v14.0: "แอปเปิ้ล หมดแล้ว · เลิกทำ" for about 10 seconds after a saved change. One at a time (a new save
   * replaces it). เลิกทำ asks the server to put that whole batch back; it says what it couldn't undo.
   */
  const UNDO_SHOW_MS = 10000;
  let undoTimer = null;
  K.undoBar = function (batch, label) {
    const old = K.$('undobar'); if (old) old.remove();
    clearTimeout(undoTimer);
    const t = K.$('toast'); if (t) t.remove();
    const text = String(label || 'บันทึกแล้ว').split('\n')[0].slice(0, 80);
    const bar = el('div', { id: 'undobar', class: 'undobar', role: 'status' }, [
      el('span', { class: 'txt', text: text }),
      el('button', { class: 'btn small', type: 'button', text: 'เลิกทำ', on: { click: async function () {
        bar.remove(); clearTimeout(undoTimer);
        const res = await K.write('undo', { batch: batch }, { quiet: true, force: true });
        if (res.ok) {
          const d = res.data || {};
          if (d.skipped && d.skipped.length) K.toast('↩️ เลิกทำแล้ว ยกเว้น ' + d.skipped.join(', ') + ' (มีคนแก้ไปแล้ว)', true);
          else K.toast('↩️ เลิกทำแล้ว');
        }
      } } }),
    ]);
    document.body.appendChild(bar);
    undoTimer = setTimeout(function () { bar.remove(); }, UNDO_SHOW_MS);
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

  /**
   * Number stepper. Returns {node, get()}. Tapping the number selects it, so it can be typed straight away.
   * opts.onUnder (v14.0): − at the minimum calls it instead of doing nothing (batch use: unticks the item).
   */
  K.stepper = function (value, min, max, unit, onChange, opts) {
    opts = opts || {};
    // v22.0 opts.split: ½ steps for units that split (a typed ¼ is kept: amounts round to ¼)
    const input = el('input', { type: 'number', inputmode: opts.split ? 'decimal' : 'numeric', min: min, max: max, step: opts.split ? 0.25 : 1, value: value, 'aria-label': opts.label || 'จำนวน' });
    const clamp = function (v) { v = opts.split ? Math.round(Number(v) * 4) / 4 : Math.round(Number(v)); if (!isFinite(v)) v = min; return Math.max(min, Math.min(max, v)); };
    const set = function (v) {
      if (Number(v) < min && opts.onUnder) { opts.onUnder(); return; }
      input.value = clamp(v); if (onChange) onChange(Number(input.value));
    };
    input.addEventListener('change', function () { set(input.value === '' ? min : input.value); });
    input.addEventListener('focus', function () { try { input.select(); } catch (e) { /* ignore */ } });
    const node = el('span', { class: 'stepper' }, [
      el('button', { type: 'button', 'aria-label': 'ลด', text: '−', on: { click: function () { set(Number(input.value) - (opts.split ? 0.5 : 1)); } } }),
      input,
      unit ? el('span', { class: 'u', text: unit }) : null,
      el('button', { type: 'button', 'aria-label': 'เพิ่ม', text: '+', on: { click: function () { set(Number(input.value) + (opts.split ? 0.5 : 1)); } } }),
    ]);
    const unitEl = node.querySelector ? node.querySelector('.u') : null;
    return { node: node, get: function () { return clamp(input.value); },
      setUnit: function (u, split) { if (unitEl) unitEl.textContent = u; opts.split = split; } };
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
  /*
   * v12.0 layout: exactly 4 tabs in the bottom bar (fridge = landing, shop, chores, history). Every other page is a
   * tab with nav: false: เช็กของ and ทำอะไรกินดี open from ตู้เย็น (parent: 'fridge', with a ← back bar), all
   * settings open from ⚙️ in the top corner. A future page goes inside one of the 4 tabs or under ⚙️.
   */
  const TAB_ORDER = ['fridge', 'shop', 'chores', 'history', 'stock', 'setup', 'cook', 'settings'];
  const LANDING = 'fridge';
  let lastMain = LANDING;   // where ← goes back to from ⚙️
  K.tab = function (t) {
    K.tabs.push(t);
    K.tabs.sort(function (a, b) { return TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id); });
  };

  K.go = function (id, force) {
    const from = K.tabs.filter(function (t) { return t.id === K.current; })[0];
    // v14.0: a page with unsaved changes (เช็กของ) asks first; "ออกเลย" lets it drop them
    if (!force && from && from.id !== id && from.unsaved && from.unsaved()) {
      K.confirmSheet('ยังไม่ได้บันทึก ออกเลยไหม?', 'ที่แก้ไว้จะหายไป', 'ออกเลย', function () { if (from.discard) from.discard(); K.go(id, true); }, true);
      return;
    }
    if (from && from.nav !== false) lastMain = from.id;
    K.current = id;
    K.store.set('kawo.tab', id);
    const t = K.tabs.filter(function (x) { return x.id === id; })[0];
    if (t && t.onEnter) t.onEnter();
    K.render();
    window.scrollTo(0, 0);
  };
  K.back = function () {
    const t = K.tabs.filter(function (x) { return x.id === K.current; })[0];
    K.go((t && t.parent) || lastMain || LANDING);
  };

  window.addEventListener('beforeunload', function (e) {
    const t = K.tabs.filter(function (x) { return x.id === K.current; })[0];
    if (t && t.unsaved && t.unsaved()) { e.preventDefault(); e.returnValue = ''; }   // the draft stays on the phone anyway
  });

  K.renderBusy = function () { document.body.style.cursor = K.busy ? 'progress' : ''; };

  K.render = function () {
    if (!K.S.me) return;
    const who = K.$('who');
    who.replaceChildren(el('b', { text: K.S.me.name }), el('span', { class: 'role ' + K.S.me.role, text: K.S.me.roleTh }));
    who.hidden = false;
    // v11.0: the household's name, and a switcher when the person is in more than one
    const house = K.S.meta && K.S.meta.houseName;
    const who2 = (K.S.meta && K.S.meta.persona && K.S.meta.persona.name) || 'กะวอ';   // v13.0: the household's persona
    const many = (K.S.households || []).length > 1;
    const brand = document.querySelector('.brand');
    brand.replaceChildren(many
      ? el('button', { class: 'house', type: 'button', 'aria-label': 'เปลี่ยนบ้าน', on: { click: K.pickHousehold } }, ['🏠 ' + (house || who2) + ' ▾'])
      : document.createTextNode('🏠 ' + (house || who2)));
    document.title = house ? who2 + ' · ' + house : who2;

    const banners = K.$('banners');
    const b = [];
    if (K.S.version && K.S.version !== APP_VERSION) {
      b.push(el('div', { class: 'banner bad', text: 'หน้าเว็บ v' + APP_VERSION + ' ไม่ตรงกับระบบ v' + K.S.version + ' ลองปิดแล้วเปิดใหม่ (ถ้ายังไม่หาย บอกเด๊ะ)' }));
    }
    // v13.0: no red DEV banner any more (our family's real household lives on dev); the footer still says DEV.
    if (!K.canEdit()) b.push(el('div', { class: 'banner info', text: '👀 บัญชีนี้ดูได้อย่างเดียว' + (house ? 'ใน' + house : '') + ' ปุ่มแก้ไขจะกดไม่ได้' }));
    K.tabs.forEach(function (t) { if (t.banner) { const n = t.banner(); if (n) b.push(n); } });
    banners.replaceChildren.apply(banners, b);

    const nav = K.$('nav');
    if (!K.tabs.some(function (t) { return t.id === K.current; })) K.current = LANDING;
    const tab = K.tabs.filter(function (t) { return t.id === K.current; })[0];
    const here = tab.nav === false ? (tab.parent || '') : tab.id;   // a page inside a tab lights up that tab
    nav.replaceChildren.apply(nav, K.tabs.filter(function (t) { return t.nav !== false; }).map(function (t) {
      const badge = t.badge ? t.badge() : 0;
      const urgent = badge && t.urgent ? t.urgent() : false;   // v15.0: soft amber only when it needs attention today
      return el('button', { type: 'button', 'aria-current': t.id === here ? 'page' : null, on: { click: function () { K.go(t.id); } } }, [
        el('span', { class: 'ic', text: t.icon }),
        el('span', { text: t.label }),
        badge ? el('span', { class: 'dot' + (urgent ? ' urgent' : ''), text: String(badge) }) : null,
      ]);
    }));
    nav.hidden = false;

    const gear = K.$('gear');
    gear.hidden = false;
    gear.setAttribute('aria-pressed', String(K.current === 'settings'));
    const page = tab.render();
    if (tab.nav === false) {
      // ← back bar for pages that aren't one of the 4 tabs
      const parent = K.tabs.filter(function (t) { return t.id === tab.parent; })[0];
      K.$('view').replaceChildren(el('div', { class: 'backbar' }, [
        el('button', { class: 'btn small', type: 'button', text: '← ' + (parent ? parent.label : 'กลับ'), on: { click: K.back } }),
        el('b', { text: tab.icon + ' ' + tab.label }),
      ]), page);
    } else {
      K.$('view').replaceChildren(page);
    }
    const topBar = document.querySelector('.top');   // v16.0: pinned zone headers sit just under it
    if (topBar) document.documentElement.style.setProperty('--top-h', topBar.offsetHeight + 'px');
    K.$('foot').textContent = (CFG.ENV === 'dev' ? 'DEV · ' : '') + 'ข้อมูลวันที่ ' + K.thDate(K.S.meta.today) + ' · หน้าเว็บ v' + APP_VERSION + ' · ระบบ v' + K.S.version;
  };

  K.fatal = function (msg) {
    K.$('view').replaceChildren(el('p', { class: 'status error', text: msg }));
  };

  /* ---------------- start ---------------- */
  K.start = async function () {
    K.current = LANDING;   // v12.0: always open on ตู้เย็น
    K.$('gear').addEventListener('click', function () { if (K.current === 'settings') K.back(); else K.go('settings'); });
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
    // v11.0: which household? The app link carries ?h=<id> (read after liff.init, which restores the query);
    // otherwise the household last used on this phone, otherwise the server picks the person's own.
    const h = new URLSearchParams(location.search).get('h');
    const fromLink = /^[a-z0-9]{4,40}$/.test(h || '');
    K.setHousehold(fromLink ? h : K.store.get('kawo.hh', ''));
    let ok = await K.reload();
    if (!ok && !fromLink && K.hid && !(K.S.households || []).length) { K.setHousehold(''); ok = await K.reload(); }   // a stale saved household
    if (ok) K.tabs.forEach(function (t) { if (t.afterLoad) t.afterLoad(); });
    // v19.0: the welcome card's เริ่มต้นตู้ button opens the app with &page=setup
    if (ok && new URLSearchParams(location.search).get('page') === 'setup' && K.canEdit()) K.go('setup');
  };
})();
