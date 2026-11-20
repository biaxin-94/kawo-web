/*
 * ตู้เย็น (fridge + storage, with ✅ / 🗑 / 🧊 and the freeze suggestion) and เช็คของ (stock check).
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  const FRIDGE_LOCS = ['Fridge', 'Chill', 'Freezer', 'Pantry'];
  let part = 'fridge';                       // fridge | storage
  let dismissed = K.store.get(K.hkey('freezeDismissed'), {});   // v11.0: per household

  function byExpiry(a, b) {
    const la = a.left === null ? Infinity : a.left, lb = b.left === null ? Infinity : b.left;
    return la - lb || a.name.localeCompare(b.name, 'th');
  }

  function itemLine(it, showDate) {
    const q = K.qtyText(it.type, it.qty, it.unit);
    return el('div', { class: 'main' }, [
      it.name, q ? el('span', { class: 'qty', text: q }) : null,
      el('span', { class: 'sub', text: it.catTh + (it.type === 'flag' ? ' · มี' : '') }),
    ]);
  }

  /* ---------------- item actions ---------------- */
  /**
   * One item: ✅ ใช้ / 🗑 ทิ้ง use the stepper right here (starts at 1, max = what we have), so there's
   * no separate "how many?" step. มี/หมด items and qty 1 have no stepper. 🧊 move keeps its own question.
   */
  function openItem(it) {
    K.sheet(function (close) {
      const can = K.canEdit();
      const word = K.unitWord(it.type, it.unit);
      const st = can && it.type !== 'flag' && it.qty > 1 ? K.stepper(1, 1, it.qty, word) : null;
      const n = function () { return st ? st.get() : it.qty; };
      const nodes = [
        el('h3', { text: it.name + (K.qtyText(it.type, it.qty, it.unit) ? ' ' + K.qtyText(it.type, it.qty, it.unit) : '') }),
        el('div', { class: 'sub', text: K.locTh(it.loc) + (it.exp ? ' · หมด ' + K.thDate(it.exp) + ' (' + K.leftText(it.left, it.exp) + ')' : '') + (it.added ? ' · ซื้อ ' + K.thDate(it.added) : '') }),
      ];
      if (st) nodes.push(el('div', { class: 'amount' }, [el('span', { class: 'sub', text: 'จำนวน (มี ' + it.qty + ' ' + word + ')' }), st.node]));
      nodes.push(el('div', { class: 'btns' }, [
        el('button', { class: 'btn primary', type: 'button', disabled: !can, text: '✅ ใช้', on: { click: function () { const k = n(); close(); doAct(it, 'used', null, k); } } }),
        el('button', { class: 'btn danger', type: 'button', disabled: !can, text: '🗑 ทิ้ง', on: { click: function () { const k = n(); close(); doAct(it, 'toss', null, k); } } }),
      ]));
      const toChill = it.loc !== 'Chill' && K.zoneOn('Chill'), toFreezer = K.zoneOn('Freezer');   // v11.0: zones this household uses
      if (it.loc !== 'Storage' && it.loc !== 'Freezer' && (toChill || toFreezer)) {
        const mv = function (dest) { close(); askMove(it, dest); };
        nodes.push(el('div', { class: 'btns' }, [
          toChill ? el('button', { class: 'btn', type: 'button', disabled: !can, text: '❄️ ย้ายเข้า Chill', on: { click: function () { mv('Chill'); } } }) : null,
          toFreezer ? el('button', { class: 'btn', type: 'button', disabled: !can, text: '🧊 ย้ายเข้าช่องฟรีซ', on: { click: function () { mv('Freezer'); } } }) : null,
        ]));
      }
      if (!can) nodes.push(el('p', { class: 'hint', text: 'ดูอย่างเดียว: แก้ไขไม่ได้' }));
      return nodes;
    });
  }

  /** 🧊 move: how many to move (default all), unchanged from v8.0. */
  function askMove(it, dest) {
    if (it.type === 'flag' || it.qty <= 1) return doAct(it, 'mv', dest, it.qty);
    K.sheet(function (close) {
      const word = K.unitWord(it.type, it.unit);
      const st = K.stepper(it.qty, 1, it.qty, word);
      return [
        el('h3', { text: 'ย้าย ' + it.name + ' กี่' + word + '?' }),
        el('div', { class: 'sub', text: 'มี ' + it.qty + ' ' + word + ' → ' + K.locTh(dest) }),
        st.node,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ทั้งหมด (' + it.qty + ')', on: { click: function () { close(); doAct(it, 'mv', dest, it.qty); } } }),
          el('button', { class: 'btn primary', type: 'button', text: 'ตกลง', on: { click: function () { close(); doAct(it, 'mv', dest, st.get()); } } }),
        ]),
      ];
    });
  }

  async function doAct(it, act, dest, n) {
    const res = await K.write('itemAct', { id: it.id, act: act, dest: dest, n: n, expectQty: it.qty });
    if (res.ok && res.data.ranOut) offerList(res.data.ranOut);
  }

  /** After ✅ used the last one (never after 🗑): offer the shopping list. */
  function offerList(name) {
    K.confirmSheet('🛒 ' + name + ' หมดแล้ว', 'ใส่ในรายการซื้อไหม?', 'ใส่ในรายการ', function () { K.write('listAdd', { name: name }); });
  }

  /* ---------------- freeze suggestion ---------------- */
  function hintKey(h) { return h.id + ':' + h.qty + ':' + h.freeze; }
  function activeHints() { return (K.S.freezeHints || []).filter(function (h) { return !dismissed[hintKey(h)]; }); }

  function freezeCard(h) {
    const can = K.canEdit();
    return el('div', { class: 'banner info' }, [
      el('div', { text: '🧊 ' + h.name + ' ' + h.total + ' ที่ แต่' + h.locTh + ' เก็บได้ ' + h.days + ' วัน แบ่งแช่ฟรีซ ' + h.freeze + ' ที่ไหม?' }),
      el('div', { class: 'btns' }, [
        el('button', { class: 'btn small', type: 'button', text: 'ไม่ต้อง', on: { click: function () { dismissed[hintKey(h)] = 1; K.store.set(K.hkey('freezeDismissed'), dismissed); K.render(); } } }),
        el('button', { class: 'btn small primary', type: 'button', disabled: !can, text: 'แช่ฟรีซ ' + h.freeze + ' ที่',
          on: { click: function () { K.write('itemAct', { id: h.id, act: 'mv', dest: 'Freezer', n: h.freeze, expectQty: h.qty }); } } }),
      ]),
    ]);
  }

  /* ---------------- 🍳 ใช้ทำกับข้าว (use several items at once, v8.1) ---------------- */
  /*
   * Select mode on the ตู้เย็น tab: tick items from every location, set amounts (start at 1), confirm once.
   * Kept on the phone (localStorage) like the shopping ticks. "ยืนยัน" freezes the batch with ONE request
   * ID into pending; until the server answers, every retry (button, reopening the page, signal coming
   * back) reuses that ID, so the server applies it at most once.
   */
  let cookKey = K.hkey('cook.v1');           // v11.0: per household
  let cook = K.store.get(cookKey, null);   // null | {sel: {id: n}, menu, main: [id], opt: [id], pending: {reqId, payload, hh}}
  let cookSending = false;
  function saveCook() { if (cook) K.store.set(cookKey, cook); else K.store.del(cookKey); }
  K.onHousehold(function () {
    cookKey = K.hkey('cook.v1'); cook = K.store.get(cookKey, null);
    dismissed = K.store.get(K.hkey('freezeDismissed'), {});
  });
  function itemById(id) { return K.S.items.filter(function (i) { return i.id === id; })[0] || null; }

  function startCook(preset) {
    if (!K.canEdit()) return;
    cook = Object.assign({ sel: {}, menu: null, main: [], opt: [], pending: null }, preset || {});
    saveCook();
    K.go('fridge');
  }

  /** Best row of an ingredient for cooking: soonest-expiring outside the freezer first, then the freezer. */
  function bestRow(name) {
    const rows = K.S.items.filter(function (i) { return i.name === name; });
    rows.sort(function (a, b) { return (a.loc === 'Freezer') - (b.loc === 'Freezer') || byExpiry(a, b); });
    return rows[0] || null;
  }

  /** "ทำเมนูนี้": main ingredients we have, ticked at 1; optional ones we have, listed but not ticked. */
  K.cookRecipe = function (r) {
    const preset = { sel: {}, menu: r.menu, main: [], opt: [] };
    r.main.forEach(function (m) {
      const row = m.have ? bestRow(m.name) : null;
      if (row && preset.main.indexOf(row.id) < 0) { preset.main.push(row.id); preset.sel[row.id] = row.type === 'flag' ? row.qty : 1; }
    });
    r.opt.forEach(function (m) {
      const row = m.have ? bestRow(m.name) : null;
      if (row && preset.main.indexOf(row.id) < 0 && preset.opt.indexOf(row.id) < 0) preset.opt.push(row.id);
    });
    startCook(preset);
  };

  function useText(it, n) {
    return it.name + (it.type === 'flag' ? ' (หมด)' : ' ' + n + ' ' + K.unitWord(it.type, it.unit));
  }

  function cookRow(it, isOpt) {
    const on = cook.sel[it.id] !== undefined;
    const toggle = function () {
      if (cook.pending) return;
      if (on) delete cook.sel[it.id]; else cook.sel[it.id] = it.type === 'flag' ? it.qty : 1;
      saveCook(); K.render();
    };
    let right = null;
    if (on && it.type === 'flag') right = el('span', { class: 'end', text: 'หมด' });
    else if (on && it.qty > 1 && !cook.pending) {
      right = K.stepper(Math.min(cook.sel[it.id], it.qty), 1, it.qty, K.unitWord(it.type, it.unit), function (v) { cook.sel[it.id] = v; saveCook(); }).node;
    } else if (on) right = el('span', { class: 'end', text: cook.sel[it.id] + ' ' + K.unitWord(it.type, it.unit) });
    const where = K.locTh(it.loc) + (it.left !== null && it.loc !== 'Freezer' && it.loc !== 'Storage' ? ' · ' + K.leftText(it.left, it.exp) : '') + (isOpt ? ' · ของเสริม' : '');
    return el('div', { class: 'row' + (on ? ' picked' : '') }, [
      el('button', { class: 'check', type: 'button', disabled: !!cook.pending, 'aria-pressed': String(on), 'aria-label': 'ใช้ ' + it.name, text: on ? '✓' : '', on: { click: toggle } }),
      el('div', { class: 'main', on: { click: toggle } }, [
        it.name, K.qtyText(it.type, it.qty, it.unit) ? el('span', { class: 'qty', text: 'มี ' + K.qtyText(it.type, it.qty, it.unit) }) : null,
        el('span', { class: 'sub', text: where }),
      ]),
      right,
    ]);
  }

  function renderCook() {
    // Items that are gone since the ticks were made (used elsewhere) simply drop out.
    if (!cook.pending) Object.keys(cook.sel).forEach(function (id) { if (!itemById(id)) delete cook.sel[id]; });
    const n = Object.keys(cook.sel).length;
    const wrap = el('div', {}, [
      el('h1', { class: 'title', text: '🍳 ใช้ทำกับข้าว' + (cook.menu ? ': ' + cook.menu : '') }),
      el('p', { class: 'hint', text: cook.pending ? 'ยังไม่ได้บันทึก (สัญญาณอ่อน) กด "ส่งอีกครั้ง" ได้เลย ไม่บันทึกซ้ำ' : 'ติ๊กของที่ใช้ ปรับจำนวนได้ แล้วกดยืนยันทีเดียว' }),
    ]);
    const shown = {};
    if (cook.menu) {
      const mine = cook.main.concat(cook.opt).map(itemById).filter(Boolean);
      mine.forEach(function (i) { shown[i.id] = true; });
      if (mine.length) wrap.appendChild(K.group('ของในเมนูนี้', mine.map(function (i) { return cookRow(i, cook.opt.indexOf(i.id) >= 0); })));
    }
    FRIDGE_LOCS.concat(['Storage', 'other']).forEach(function (loc) {
      const list = K.S.items.filter(function (i) {
        if (shown[i.id]) return false;
        return loc === 'other' ? FRIDGE_LOCS.indexOf(i.loc) < 0 && i.loc !== 'Storage' : i.loc === loc;
      }).sort(byExpiry);
      if (list.length) wrap.appendChild(K.group(loc === 'other' ? '📍 ที่อื่นๆ' : K.locTh(loc), list.map(function (i) { return cookRow(i, false); })));
    });
    wrap.appendChild(el('div', { class: 'pad-bottom' }));
    wrap.appendChild(el('div', { class: 'storebar' }, cook.pending ? [
      el('button', { class: 'btn primary', type: 'button', disabled: cookSending, text: cookSending ? 'กำลังส่ง…' : 'ส่งอีกครั้ง', on: { click: sendCook } }),
    ] : [
      el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: function () { cook = null; saveCook(); K.render(); } } }),
      el('button', { class: 'btn primary', type: 'button', disabled: !n, text: 'ยืนยัน (' + n + ')', on: { click: cookConfirm } }),
    ]));
    return wrap;
  }

  /** Names this batch would use up: every row of that item fully used, and not on the list already (same rule as the server). */
  function willRunOut(uses) {
    const full = {};
    uses.forEach(function (u) { full[u.id] = u.n >= u.it.qty; });
    const names = [];
    uses.forEach(function (u) {
      const name = u.it.name;
      if (names.indexOf(name) >= 0) return;
      const allGone = K.S.items.filter(function (i) { return i.name === name; }).every(function (i) { return full[i.id]; });
      const listed = K.S.list.some(function (l) { return l.name === name; });
      if (allGone && !listed) names.push(name);
    });
    return names;
  }

  function cookConfirm() {
    const uses = Object.keys(cook.sel).map(function (id) {
      const it = itemById(id);
      return it ? { id: id, it: it, n: it.type === 'flag' ? it.qty : Math.min(cook.sel[id], it.qty) } : null;
    }).filter(Boolean);
    if (!uses.length) return;
    const out = willRunOut(uses);
    const tick = {};
    out.forEach(function (name) { tick[name] = true; });
    K.sheet(function (close) {
      return [
        el('h3', { text: '🍳 ใช้ไป ' + uses.length + ' อย่าง' }),
        el('p', { text: 'ใช้ไป: ' + uses.map(function (u) { return useText(u.it, u.n); }).join(', ') }),
        out.length ? el('div', { class: 'banner warn' }, [
          el('b', { text: '🛒 หมดแล้ว เพิ่มลงรายการซื้อไหม?' }),
          el('div', {}, out.map(function (name) {
            const box = el('input', { type: 'checkbox', checked: true, on: { change: function () { tick[name] = box.checked; } } });
            return el('label', { class: 'tickline' }, [box, el('span', { text: ' ' + name })]);
          })),
        ]) : null,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'กลับไปแก้', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', text: 'ยืนยัน บันทึก', on: { click: function () {
            close();
            cook.pending = { reqId: K.newReqId(), hh: K.hid, payload: {
              uses: uses.map(function (u) { return { id: u.id, n: u.n, name: u.it.name }; }),
              offered: out,
              addToList: out.filter(function (name) { return tick[name]; }),
            } };
            saveCook();
            sendCook();
          } } }),
        ]),
      ];
    });
  }

  async function sendCook() {
    if (!cook || !cook.pending || cookSending) return;
    // v11.0: the batch goes to the household it was made in, even if the page switched meanwhile
    const c = cook, key = cookKey, hh = c.pending.hh === undefined ? K.hid : c.pending.hh;
    cookSending = true; K.render();
    const res = await K.write('useItems', c.pending.payload, { reqId: c.pending.reqId, quiet: true, force: true, hh: hh });
    cookSending = false;
    const here = c === cook;
    if (res.ok) {
      K.store.del(key);
      if (here) { cook = null; K.render(); cookResult(res.data); }
    } else if (res.error === 'network' || res.error === 'auth' || res.error === 'server') {
      K.render();   // keep pending: the same request ID is used next time
    } else {
      c.pending = null; K.store.set(key, c); K.render();   // refused: nothing was applied, keep the ticks to fix
    }
  }

  function cookResult(d) {
    K.sheet(function (close) {
      return [
        el('h3', { text: d.used.length ? '✅ บันทึกแล้ว' : 'ไม่มีอะไรเปลี่ยน' }),
        d.used.length ? el('p', { text: 'ใช้ไป: ' + d.used.join(', ') }) : null,
        d.adjusted.length ? el('div', { class: 'banner warn', text: '⚠️ มีคนใช้ไปก่อนแล้ว ปรับจำนวน: ' + d.adjusted.join(', ') }) : null,
        d.skipped.length ? el('div', { class: 'banner warn', text: '⚠️ ข้าม: ' + d.skipped.join(', ') }) : null,
        d.listed.length ? el('p', { class: 'hint', text: '🛒 ใส่รายการซื้อแล้ว: ' + d.listed.join(', ') }) : null,
        el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'ตกลง', on: { click: function () {
          close();
          // Ran out, but the confirm screen couldn't know (someone used some meanwhile): ask now.
          const names = d.notOffered || [];
          if (names.length) {
            K.confirmSheet('🛒 ' + names.join(', ') + ' หมดแล้ว', 'ใส่ในรายการซื้อไหม?', 'ใส่ในรายการ', async function () {
              for (let i = 0; i < names.length; i++) await K.write('listAdd', { name: names[i] });
            });
          }
        } } })]),
      ];
    });
  }

  /** On other tabs: reminder that a batch is waiting to be sent. */
  function cookBanner() {
    if (!cook || !cook.pending || K.current === 'fridge') return null;
    return el('div', { class: 'banner warn' }, [
      el('span', { text: '🍳 ยังไม่ได้บันทึกของที่ใช้ทำกับข้าว ' }),
      el('button', { class: 'btn small', type: 'button', text: 'ดู', on: { click: function () { K.go('fridge'); } } }),
    ]);
  }
  window.addEventListener('online', function () { if (cook && cook.pending && K.S.me) sendCook(); });

  /* ---------------- ตู้เย็น tab ---------------- */
  function renderFridge() {
    if (cook && (K.canEdit() || cook.pending)) return renderCook();
    const S = K.S, days = S.meta.alertDays;
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'seg', role: 'group' }, [
      el('button', { type: 'button', 'aria-pressed': String(part === 'fridge'), text: '🧊 ตู้เย็น', on: { click: function () { part = 'fridge'; K.render(); } } }),
      el('button', { type: 'button', 'aria-pressed': String(part === 'storage'), text: '📦 ตู้เก็บของ', on: { click: function () { part = 'storage'; K.render(); } } }),
    ]));
    // Viewers don't get this button at all (the server refuses their writes anyway).
    if (K.canEdit() && S.items.length) {
      wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: '🍳 ใช้ทำกับข้าว', on: { click: function () { startCook(); } } })]));
    }

    if (part === 'storage') {
      const items = S.items.filter(function (i) { return i.loc === 'Storage'; }).sort(function (a, b) { return a.catTh.localeCompare(b.catTh, 'th') || a.name.localeCompare(b.name, 'th'); });
      wrap.appendChild(el('div', { class: 'summary' }, [el('span', { text: 'ทั้งหมด ' + items.length + ' รายการ' })]));
      if (!items.length) wrap.appendChild(el('div', { class: 'list empty', text: 'ตู้เก็บของว่าง' }));
      const cats = [];
      items.forEach(function (i) { if (cats.indexOf(i.catTh) < 0) cats.push(i.catTh); });
      cats.forEach(function (c) {
        const list = items.filter(function (i) { return i.catTh === c; });
        wrap.appendChild(K.group(c + ' (' + list.length + ')', list.map(function (i) {
          return el('button', { class: 'row', type: 'button', on: { click: function () { openItem(i); } } }, [itemLine(i, false)]);
        })));
      });
      return wrap;
    }

    activeHints().forEach(function (h) { wrap.appendChild(freezeCard(h)); });
    const items = S.items.filter(function (i) { return i.loc !== 'Storage'; });
    const late = items.filter(function (i) { return i.loc !== 'Freezer' && i.left !== null && i.left < 0; }).length;
    const soon = items.filter(function (i) { return i.loc !== 'Freezer' && i.left !== null && i.left >= 0 && i.left <= days; }).length;
    wrap.appendChild(el('div', { class: 'summary' }, [
      el('span', { text: 'ทั้งหมด ' + items.length + ' รายการ' }),
      late ? el('span', { class: 'bad', text: 'เลยกำหนด ' + late }) : null,
      soon ? el('span', { class: 'warn', text: 'ใช้ภายใน ' + days + ' วัน ' + soon }) : null,
    ]));
    FRIDGE_LOCS.concat(['other']).forEach(function (loc) {
      const list = items.filter(function (i) { return loc === 'other' ? FRIDGE_LOCS.indexOf(i.loc) < 0 : i.loc === loc; }).sort(byExpiry);
      if (!list.length && loc === 'other') return;
      wrap.appendChild(K.group((loc === 'other' ? '📍 ที่อื่นๆ' : K.locTh(loc)) + (list.length ? ' (' + list.length + ')' : ''), list.length
        ? list.map(function (i) {
          const u = i.loc === 'Freezer' ? '' : K.urgency(i.left, days);
          return el('button', { class: 'row' + (u ? ' ' + u : ''), type: 'button', on: { click: function () { openItem(i); } } }, [
            itemLine(i, true), el('div', { class: 'end', text: K.leftText(i.left, i.exp) }),
          ]);
        })
        : [el('div', { class: 'empty', text: 'ไม่มีของ' })]));
    });
    wrap.appendChild(el('p', { class: 'hint', text: 'แตะที่รายการเพื่อ ✅ ใช้ / 🗑 ทิ้ง / 🧊 ย้าย' }));
    return wrap;
  }

  K.tab({
    id: 'fridge', icon: '🧊', label: 'ตู้เย็น', render: renderFridge, banner: cookBanner,
    afterLoad: function () { if (cook && cook.pending) sendCook(); },   // reopened with an unsent batch: send it now
    badge: function () { return K.S.items.filter(function (i) { return i.loc !== 'Freezer' && i.loc !== 'Storage' && i.left !== null && i.left <= K.S.meta.alertDays; }).length; },
  });

  /* ---------------- เช็คของ tab ("ยังมีอยู่ไหม?") ---------------- */
  function renderStock() {
    const S = K.S, can = K.canEdit(), today = S.meta.today;
    const wrap = el('div', {}, [
      el('h1', { class: 'title', text: 'ยังมีอยู่ไหม?' }),
      el('p', { class: 'hint', text: 'ไล่ดูของจริงในตู้ แตะ ยังมี หรือ หมดแล้ว (หมดแล้ว = ไม่นับเป็นใช้/ทิ้ง)' }),
    ]);
    FRIDGE_LOCS.concat(['Storage']).forEach(function (loc) {
      const list = S.items.filter(function (i) { return i.loc === loc; }).sort(byExpiry);
      if (!list.length) return;
      const checkedN = list.filter(function (i) { return i.checked === today; }).length;
      wrap.appendChild(K.group(K.locTh(loc) + ' (' + checkedN + '/' + list.length + ')', list.map(function (i) {
        const done = i.checked === today;
        return el('div', { class: 'row' + (done ? ' done' : '') }, [
          itemLine(i, false),
          el('button', { class: 'pill ok', type: 'button', disabled: !can || done, text: done ? '✓ ยังมี' : 'ยังมี',
            on: { click: function () { K.write('stockCheck', { id: i.id, have: true }, { quiet: true }); } } }),
          el('button', { class: 'pill no', type: 'button', disabled: !can, text: 'หมดแล้ว',
            on: { click: function () { K.write('stockCheck', { id: i.id, have: false }); } } }),
        ]);
      })));
    });
    if (!S.items.length) wrap.appendChild(el('div', { class: 'list empty', text: 'ไม่มีของในบ้านเลย' }));
    return wrap;
  }

  K.tab({ id: 'stock', icon: '📋', label: 'เช็คของ', render: renderStock });
})();
