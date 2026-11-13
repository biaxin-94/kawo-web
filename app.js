/*
 * กะวอ web page (v7.0, read-only prototype).
 * Flow: LIFF login -> ID token -> POST to Apps Script -> server verifies token + role -> data.
 * To add a section later: add an entry to TABS with a render(state) function that returns a DOM node.
 * The page never decides permissions on its own; it only shows what the server allows.
 */
(function () {
  'use strict';

  const CFG = window.KAWO_CONFIG || {};
  const LOCATIONS = [
    { loc: 'Fridge', title: '🥬 ตู้เย็น' },
    { loc: 'Chill', title: '❄️ ช่อง Chill' },
    { loc: 'Freezer', title: '🧊 ช่องฟรีซ' },
    { loc: 'Pantry', title: '🧺 ของนอกตู้ (Pantry)' },
  ];
  const ERRORS = {
    auth: 'ยืนยันตัวตนไม่สำเร็จ ลองปิดแล้วเปิดหน้านี้ใหม่จาก LINE',
    forbidden: 'บัญชีนี้ไม่มีสิทธิ์ดูหน้านี้',
    unknown_action: 'หน้าเว็บกับเซิร์ฟเวอร์เป็นคนละเวอร์ชัน ลองรีเฟรช',
    server: 'เซิร์ฟเวอร์มีปัญหา ลองใหม่อีกครั้ง',
    network: 'ต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง',
    config: 'หน้าเว็บยังไม่ได้ตั้งค่า (LIFF_ID)',
    liff: 'เปิดผ่าน LINE ไม่สำเร็จ',
  };

  const state = { me: null, data: null, version: '', tab: 'fridge' };

  const TABS = [
    { id: 'fridge', label: '🧊 ตู้เย็น', render: renderFridge },
    { id: 'storage', label: '📦 ตู้เก็บของ', render: renderStorage },
  ];

  /* ---------- tiny DOM helper (textContent only, so item names can never inject HTML) ---------- */
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  const $ = function (id) { return document.getElementById(id); };

  function showStatus(msg, isError) {
    $('view').replaceChildren(el('p', { class: 'status' + (isError ? ' error' : ''), text: msg }));
  }

  /* ---------- server ---------- */
  async function call(api, idToken, args) {
    let res;
    try {
      // text/plain = "simple request": no CORS preflight, which Apps Script can't answer.
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: api, idToken: idToken, args: args || {} }),
      });
    } catch (e) {
      return { ok: false, error: 'network' };
    }
    try { return await res.json(); } catch (e) { return { ok: false, error: 'server' }; }
  }

  /* ---------- formatting ---------- */
  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thDate(ymd) {
    const p = String(ymd).split('-');
    return Number(p[2]) + ' ' + TH_MONTHS[Number(p[1]) - 1];
  }
  function whenText(it) {
    if (it.left === null) return '';
    if (it.left < 0) return 'เลย ' + (-it.left) + ' วัน';
    if (it.left === 0) return 'วันนี้';
    if (it.left === 1) return 'พรุ่งนี้';
    if (it.left <= 14) return 'อีก ' + it.left + ' วัน';
    return 'ถึง ' + thDate(it.exp);
  }
  function urgency(it, days) {
    if (it.left === null) return '';
    if (it.left < 0) return 'late';
    return it.left <= days ? 'soon' : '';
  }
  function byExpiry(a, b) {
    const la = a.left === null ? Infinity : a.left;
    const lb = b.left === null ? Infinity : b.left;
    return la - lb || a.name.localeCompare(b.name, 'th');
  }

  function itemRow(it, days, showDate) {
    const u = showDate ? urgency(it, days) : '';
    return el('li', { class: 'item' + (u ? ' ' + u : '') }, [
      el('div', { class: 'name' }, [
        it.name,
        it.qty > 1 ? el('span', { class: 'qty', text: '×' + it.qty }) : null,
        el('span', { class: 'sub', text: it.catTh }),
      ]),
      showDate ? el('div', { class: 'when', text: whenText(it) }) : null,
    ]);
  }

  /* ---------- tabs ---------- */
  function renderFridge(s) {
    const days = s.data.alertDays;
    const items = s.data.items.filter(function (i) { return i.loc !== 'Storage'; });
    const wrap = el('div');
    const late = items.filter(function (i) { return i.left !== null && i.left < 0; }).length;
    const soon = items.filter(function (i) { return i.left !== null && i.left >= 0 && i.left <= days; }).length;
    wrap.appendChild(el('div', { class: 'summary' }, [
      el('span', { text: 'ทั้งหมด ' + items.length + ' รายการ' }),
      late ? el('span', { class: 'bad', text: 'เลยกำหนด ' + late }) : null,
      soon ? el('span', { class: 'warn', text: 'ใช้ภายใน ' + days + ' วัน ' + soon }) : null,
    ]));

    const known = LOCATIONS.map(function (l) { return l.loc; });
    const groups = LOCATIONS.concat([{ loc: null, title: '📍 ที่อื่นๆ' }]);
    groups.forEach(function (g) {
      const list = items.filter(function (i) { return g.loc ? i.loc === g.loc : known.indexOf(i.loc) < 0; }).sort(byExpiry);
      if (!list.length && !g.loc) return;
      wrap.appendChild(el('section', { class: 'group' }, [
        el('h2', { text: g.title + (list.length ? ' (' + list.length + ')' : '') }),
        list.length
          ? el('ul', { class: 'list' }, list.map(function (i) { return itemRow(i, days, true); }))
          : el('div', { class: 'list empty', text: 'ไม่มีของ' }),
      ]));
    });
    return wrap;
  }

  function renderStorage(s) {
    const items = s.data.items.filter(function (i) { return i.loc === 'Storage'; })
      .sort(function (a, b) { return a.catTh.localeCompare(b.catTh, 'th') || a.name.localeCompare(b.name, 'th'); });
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'summary' }, [el('span', { text: 'ทั้งหมด ' + items.length + ' รายการ' })]));
    const cats = [];
    items.forEach(function (i) { if (cats.indexOf(i.catTh) < 0) cats.push(i.catTh); });
    if (!cats.length) wrap.appendChild(el('div', { class: 'list empty', text: 'ตู้เก็บของว่าง' }));
    cats.forEach(function (c) {
      const list = items.filter(function (i) { return i.catTh === c; });
      wrap.appendChild(el('section', { class: 'group' }, [
        el('h2', { text: c + ' (' + list.length + ')' }),
        el('ul', { class: 'list' }, list.map(function (i) { return itemRow(i, 0, false); })),
      ]));
    });
    return wrap;
  }

  function renderTabs() {
    const nav = $('tabs');
    nav.replaceChildren.apply(nav, TABS.map(function (t) {
      const b = el('button', { role: 'tab', 'aria-selected': String(t.id === state.tab), text: t.label });
      b.addEventListener('click', function () { state.tab = t.id; renderAll(); });
      return b;
    }));
    nav.hidden = false;
  }

  function renderWho() {
    const who = $('who');
    who.replaceChildren(
      el('b', { text: state.me.name }),
      el('span', { class: 'role ' + state.me.role, text: state.me.roleTh })
    );
    who.hidden = false;
  }

  function renderAll() {
    renderWho();
    renderTabs();
    const tab = TABS.filter(function (t) { return t.id === state.tab; })[0] || TABS[0];
    $('view').replaceChildren(tab.render(state));
    $('foot').textContent = 'ข้อมูลวันที่ ' + thDate(state.data.today) + ' · กะวอ v' + state.version + ' · ดูอย่างเดียว (ยังแก้ไขจากหน้านี้ไม่ได้)';
  }

  /* ---------- demo mode: ?demo shows sample data, no login, no server ---------- */
  function demoData() {
    const t = new Date();
    const d = function (n) { const x = new Date(t.getTime() + n * 864e5); return x.toISOString().slice(0, 10); };
    const it = function (name, qty, cat, catTh, loc, left) { return { name: name, qty: qty, cat: cat, catTh: catTh, loc: loc, exp: left === null ? null : d(left), left: left }; };
    return {
      me: { name: 'ตัวอย่าง', role: 'viewer', roleTh: 'ดูอย่างเดียว', owner: false },
      version: 'demo',
      data: { today: d(0), alertDays: 2, items: [
        it('นม', 1, 'Dairy', 'นม/ไข่/เต้าหู้', 'Fridge', 1),
        it('ไข่', 14, 'Dairy', 'นม/ไข่/เต้าหู้', 'Fridge', 14),
        it('กุ้ง', 4, 'Seafood', 'อาหารทะเล', 'Fridge', -2),
        it('ผักชี', 4, 'Veg', 'ผัก', 'Fridge', 0),
        it('ไก่', 4, 'Meat', 'เนื้อสัตว์', 'Chill', 2),
        it('เนื้อ', 2, 'Meat', 'เนื้อสัตว์', 'Freezer', 113),
        it('กระเทียม', 8, 'Veg', 'ผัก', 'Pantry', 53),
        it('มาม่า', 14, 'Dry', 'ของแห้ง', 'Storage', null),
        it('สบู่เหลว', 2, 'Household', 'ของใช้ในบ้าน', 'Storage', null),
      ] },
    };
  }

  /* ---------- start ---------- */
  async function start() {
    if (/[?&]demo\b/.test(location.search)) {
      const demo = demoData();
      state.me = demo.me; state.data = demo.data; state.version = demo.version;
      return renderAll();
    }
    if (!CFG.LIFF_ID || !window.liff) return showStatus(ERRORS.config, true);
    try {
      await liff.init({ liffId: CFG.LIFF_ID });
    } catch (e) {
      return showStatus(ERRORS.liff + ' (' + (e && e.message ? e.message : e) + ')', true);
    }
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    const idToken = liff.getIDToken();
    if (!idToken) return showStatus(ERRORS.auth + ' (ไม่มี ID token: เปิด scope openid ใน LIFF)', true);

    const res = await call('home', idToken);
    if (!res.ok) return showStatus(ERRORS[res.error] || ERRORS.server, true);
    state.me = res.me; state.data = res.data; state.version = res.version;
    renderAll();
  }

  start();
})();
