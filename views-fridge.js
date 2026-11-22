/*
 * ตู้เย็น (fridge + storage, with ✅ / 🗑 / ❄️ and the freeze suggestion) and เช็กของ (stock check, v14.0: saved once on confirm).
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  const FRIDGE_LOCS = ['Fridge', 'Chill', 'Freezer', 'Pantry', 'Kitchen'];   // v16.0: ของกิน zones, in this order (ตู้กับข้าว last)
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
   * no separate "how many?" step. มี/หมด items and qty 1 have no stepper. ❄️ move keeps its own question.
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
      if (!K.noExp(it.loc) && it.loc !== 'Freezer' && (toChill || toFreezer)) {
        const mv = function (dest) { close(); askMove(it, dest); };
        nodes.push(el('div', { class: 'btns' }, [
          toChill ? el('button', { class: 'btn', type: 'button', disabled: !can, text: '🌡️ ย้ายเข้า Chill', on: { click: function () { mv('Chill'); } } }) : null,
          toFreezer ? el('button', { class: 'btn', type: 'button', disabled: !can, text: '❄️ ย้ายเข้าช่องฟรีซ', on: { click: function () { mv('Freezer'); } } }) : null,
        ]));
      }
      if (!can) nodes.push(el('p', { class: 'hint', text: 'ดูอย่างเดียว: แก้ไขไม่ได้' }));
      return nodes;
    });
  }

  /** ❄️ move: how many to move (default all), unchanged from v8.0. */
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
      el('div', { text: '❄️ ' + h.name + ' ' + h.total + ' ที่ แต่' + h.locTh + ' เก็บได้ ' + h.days + ' วัน แบ่งแช่ฟรีซ ' + h.freeze + ' ที่ไหม?' }),
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
    const preset = { sel: {}, menu: r.menu, recipe: r.id || '', main: [], opt: [] };   // v12.0: recipe ID -> recipe_cooked
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
    else if (on && !cook.pending) {
      // v14.0: − at 1 unticks it (not used, it stays in the fridge); ticking again starts back at 1
      right = K.stepper(Math.min(cook.sel[it.id], it.qty), 1, it.qty, K.unitWord(it.type, it.unit), function (v) { cook.sel[it.id] = v; saveCook(); },
        { onUnder: function () { delete cook.sel[it.id]; saveCook(); K.render(); } }).node;
    } else if (on) right = el('span', { class: 'end', text: cook.sel[it.id] + ' ' + K.unitWord(it.type, it.unit) });
    const where = K.locTh(it.loc) + (it.left !== null && it.loc !== 'Freezer' && !K.noExp(it.loc) ? ' · ' + K.leftText(it.left, it.exp) : '') + (isOpt ? ' · ของเสริม' : '');
    return el('div', { class: 'row ' + K.fresh(it) + (on ? ' picked' : '') }, [
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
    FRIDGE_LOCS.concat(['Storage', 'other']).forEach(function (loc) {   // v16.0: includes ตู้กับข้าว
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
              recipe: cook.recipe || undefined, menu: cook.menu || undefined,
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
    const res = await K.write('useItems', c.pending.payload, { reqId: c.pending.reqId, quiet: true, force: true, hh: hh, noUndo: true });
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
          if (d.undo) K.undoBar(d.undo, '🍳 ใช้ไป ' + d.used.length + ' อย่าง');   // v14.0
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

  /* ---------------- ของกิน / ของใช้ tab (v16.0; was ตู้เย็น / ตู้เก็บของ) ---------------- */
  /*
   * ของกิน = every food zone as a section (ตู้เย็น, Chill, ฟรีซ, นอกตู้, ตู้กับข้าว: only zones that are on), ของใช้ = household
   * items by category. Each section header is pinned while scrolling through it and folds on tap (remembered per
   * household on the phone, key fold.v1). Items keep the same tap -> ✅ / 🗑 / ❄️ sheet.
   */
  let folds = K.store.get(K.hkey('fold.v1'), {});
  K.onHousehold(function () { folds = K.store.get(K.hkey('fold.v1'), {}); });
  function foodZones() { return FRIDGE_LOCS.filter(function (z) { return z === 'Fridge' || z === 'Kitchen' || K.zoneOn(z); }); }
  function isFood(i) { return i.loc !== 'Storage'; }

  /* ---- quick find (v16.0): search box (names + Dictionary aliases) and location chips ---- */
  let findQ = '';                                                   // kept while the app is open
  let chip = K.store.get(K.hkey('chip.v1'), 'all');                 // remembered on the phone
  K.onHousehold(function () { chip = K.store.get(K.hkey('chip.v1'), 'all'); findQ = ''; });
  const SOON_DAYS = 2;
  const CHIP_TH = { Fridge: 'ตู้เย็น', Chill: 'Chill', Freezer: 'ฟรีซ', Pantry: 'นอกตู้', Kitchen: 'ตู้กับข้าว' };
  function aliasesOf(name) { const d = K.dictEntry(name); return d ? d.aliases : ''; }
  function searchText(i) { return (i.name + ' ' + aliasesOf(i.name)).toLowerCase(); }
  function isSoon(i) { return !K.noExp(i.loc) && i.left !== null && i.left !== undefined && i.left <= SOON_DAYS; }

  /** The Dictionary entry a search word means (exact name/alias first, else the only one containing it), or null. */
  function dictFor(q) {
    const l = q.toLowerCase();
    const exact = K.S.dict.filter(function (d) { return d.name.toLowerCase() === l || d.aliases.toLowerCase().split(',').map(function (a) { return a.trim(); }).indexOf(l) >= 0; })[0];
    if (exact) return exact;
    const some = K.S.dict.filter(function (d) { return d.name.toLowerCase().indexOf(l) >= 0 || d.aliases.toLowerCase().indexOf(l) >= 0; });
    return some.length === 1 ? some[0] : null;
  }

  function addFromSearch(q) {
    const d = dictFor(q);
    if (d) { K.write('listAdd', { name: d.name }); return; }
    K.sheet(function (close) {
      return [el('h3', { text: '"' + q + '" อยู่หมวดไหน?' }), el('div', { class: 'sub', text: 'จำไว้ ครั้งหน้าไม่ต้องถาม' }),
        el('div', { class: 'list' }, (K.S.meta.cats || []).map(function (c) {
          return el('button', { class: 'row', type: 'button', on: { click: function () { close(); K.write('listAdd', { name: q, cat: c.id }); } } }, [
            el('div', { class: 'main', text: (c.icon || '') + ' ' + c.th }),
          ]);
        }))];
    });
  }

  /** Shows / hides cards and sections for the search word (no re-render, so the keyboard stays open). */
  function applyFind(wrap) {
    const q = findQ.trim().toLowerCase();
    let shown = 0;
    wrap.querySelectorAll('.zone').forEach(function (sec) {
      let n = 0;
      sec.querySelectorAll('.row[data-s]').forEach(function (r) { const ok = !q || r.getAttribute('data-s').indexOf(q) >= 0; r.hidden = !ok; if (ok) n++; });
      const empty = sec.querySelector('.list > .empty');
      if (empty) empty.hidden = !!q;
      sec.hidden = !!q && !n;
      sec.classList.toggle('found', !!q && n > 0);   // a folded section opens while it has matches
      shown += n;
    });
    const miss = wrap.querySelector('.findmiss');
    if (!miss) return;
    miss.hidden = !q || shown > 0;
    if (miss.hidden) return;
    const other = K.S.items.filter(function (i) { return (part === 'storage' ? isFood(i) : !isFood(i)) && searchText(i).indexOf(q) >= 0; });
    const word = findQ.trim();
    miss.replaceChildren.apply(miss, (other.length ? [
      el('span', { text: 'ไม่มี "' + word + '" ใน' + (part === 'storage' ? 'ของใช้' : 'ของกิน') + ' ' }),
      el('button', { class: 'btn small primary', type: 'button', text: 'เจอใน' + (part === 'storage' ? 'ของกิน' : 'ของใช้') + ' (' + other.length + ')',
        on: { click: function () { part = part === 'storage' ? 'fridge' : 'storage'; chip = 'all'; K.render(); } } }),
    ] : [
      el('span', { text: 'ไม่มี "' + word + '" ในบ้าน ' }),
      K.canEdit() ? el('button', { class: 'btn small primary', type: 'button', text: '+ เพิ่มลงรายการซื้อ', on: { click: function () { addFromSearch(word); } } }) : null,
    ]).filter(Boolean));
  }

  function findBox(wrap) {
    const input = el('input', { id: 'find', class: 'search find', type: 'search', placeholder: '🔎 หาของ เช่น ไข่ หรือ egg', 'aria-label': 'หาของ', value: findQ,
      autocomplete: 'off', on: { input: function () { findQ = input.value; applyFind(wrap); } } });
    return input;
  }

  function chipRow(zones) {
    if (chip !== 'all' && chip !== 'soon' && zones.indexOf(chip) < 0) chip = 'all';
    const one = function (id, text) {
      return el('button', { type: 'button', class: 'fchip', 'aria-pressed': String(chip === id), text: text, on: { click: function () {
        chip = id; K.store.set(K.hkey('chip.v1'), chip); K.render();
      } } });
    };
    return el('div', { class: 'fchips', role: 'group', 'aria-label': 'ที่เก็บ' }, [one('all', 'ทั้งหมด')]
      .concat(zones.map(function (z) { return one(z, CHIP_TH[z] || K.locTh(z)); })).concat([one('soon', '⏰ ใกล้หมดอายุ')]));
  }

  function itemCard(i) {
    return el('button', { class: 'row ' + K.fresh(i), type: 'button', 'data-name': i.name, 'data-s': searchText(i), on: { click: function () { openItem(i); } } }, [
      itemLine(i, true), K.noExp(i.loc) ? null : el('div', { class: 'end', text: K.leftText(i.left, i.exp) }),
    ]);
  }

  /** A section: pinned header "🧊 ตู้เย็น (12)" that folds, a light zone tint behind the cards. */
  function zoneSection(key, title, n, tint, cards) {
    const shut = !!folds[key];
    const sec = el('section', { class: 'zone' + (tint ? ' tint-' + tint : '') + (shut ? ' shut' : ''), 'data-key': key }, [
      el('button', { class: 'zonehead', type: 'button', 'aria-expanded': String(!shut), on: { click: function () {
        if (folds[key]) delete folds[key]; else folds[key] = 1;
        K.store.set(K.hkey('fold.v1'), folds);
        sec.classList.toggle('shut', !!folds[key]);
        this.setAttribute('aria-expanded', String(!folds[key]));
      } } }, [el('span', { class: 'zt', text: title }), el('span', { class: 'zn', text: '(' + n + ')' }), el('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' })]),
      el('div', { class: 'list' }, cards.length ? cards : [el('div', { class: 'empty', text: 'ไม่มีของ' })]),
    ]);
    return sec;
  }

  /** v17.0: an action that opens another flow: a card (icon, name, one gray line, ›), never a chip. */
  function actionCard(icon, name, line, go) {
    return el('button', { class: 'actcard', type: 'button', on: { click: go } }, [
      el('span', { class: 'ai', 'aria-hidden': 'true', text: icon }),
      el('span', { class: 'at' }, [el('b', { text: name }), el('span', { text: line })]),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
    ]);
  }

  function renderFridge() {
    if (cook && (K.canEdit() || cook.pending)) return renderCook();
    const S = K.S, days = S.meta.alertDays;
    const wrap = el('div');
    // v17.0: 1. actions (cards that open other flows), 2. last check, 3. the find group (filters), 4. the list.
    // Viewers get no เช็กของ / 🍳 (the server refuses their writes anyway); ของใช้ only has เช็กของ.
    const acts = [];
    if (K.canEdit()) acts.push(actionCard('✅', 'เช็กของ', 'เช็กว่าของในตู้ตรงไหม', function () { K.go('stock'); }));
    if (part !== 'storage' && K.canEdit() && S.items.length) acts.push(actionCard('🍳', 'ใช้ทำกับข้าว', 'บันทึกของที่ใช้', function () { startCook(); }));
    if (part !== 'storage') acts.push(actionCard('💡', 'ทำอะไรกินดี', 'เมนูจากของที่มี', function () { K.go('cook'); }));
    if (acts.length) wrap.appendChild(el('div', { class: 'actcards n' + acts.length }, acts));
    const lc = lastCheckLine();
    if (lc) wrap.appendChild(lc);
    const zones = foodZones();
    wrap.appendChild(el('div', { class: 'findgroup', role: 'search' }, [
      el('div', { class: 'seg', role: 'group' }, [
        el('button', { type: 'button', 'aria-pressed': String(part === 'fridge'), text: '🥢 ของกิน', on: { click: function () { part = 'fridge'; K.render(); } } }),
        el('button', { type: 'button', 'aria-pressed': String(part === 'storage'), text: '🧴 ของใช้', on: { click: function () { part = 'storage'; K.render(); } } }),
      ]),
      findBox(wrap),
      part !== 'storage' ? chipRow(zones) : null,
      el('div', { class: 'banner info findmiss', hidden: true }),
    ]));

    if (part === 'storage') {
      const items = S.items.filter(function (i) { return !isFood(i); }).sort(function (a, b) { return a.catTh.localeCompare(b.catTh, 'th') || a.name.localeCompare(b.name, 'th'); });
      wrap.appendChild(el('div', { class: 'summary' }, [el('span', { text: 'ทั้งหมด ' + items.length + ' รายการ' })]));
      if (!items.length) wrap.appendChild(el('div', { class: 'list empty', text: 'ยังไม่มีของใช้' }));
      const cats = [];
      items.forEach(function (i) { if (cats.indexOf(i.catTh) < 0) cats.push(i.catTh); });
      cats.forEach(function (c) {
        const list = items.filter(function (i) { return i.catTh === c; });
        wrap.appendChild(zoneSection('cat:' + c, c, list.length, '', list.map(itemCard)));
      });
      applyFind(wrap);
      return wrap;
    }

    activeHints().forEach(function (h) { wrap.appendChild(freezeCard(h)); });
    const items = S.items.filter(isFood);
    const late = items.filter(function (i) { return i.loc !== 'Freezer' && i.left !== null && i.left < 0; }).length;
    const soon = items.filter(function (i) { return i.loc !== 'Freezer' && i.left !== null && i.left >= 0 && i.left <= days; }).length;
    wrap.appendChild(el('div', { class: 'summary' }, [
      el('span', { text: 'ทั้งหมด ' + items.length + ' รายการ' }),
      late ? el('span', { class: 'bad', text: 'เลยกำหนด ' + late }) : null,
      soon ? el('span', { class: 'warn', text: 'ใช้ภายใน ' + days + ' วัน ' + soon }) : null,
    ]));
    zones.concat(['other']).forEach(function (loc) {
      if (chip !== 'all' && chip !== 'soon' && chip !== loc) return;   // a zone chip shows that zone only
      const list = items.filter(function (i) { return (loc === 'other' ? zones.indexOf(i.loc) < 0 : i.loc === loc) && (chip !== 'soon' || isSoon(i)); })
        .sort(K.noExp(loc) ? function (a, b) { return a.catTh.localeCompare(b.catTh, 'th') || a.name.localeCompare(b.name, 'th'); } : byExpiry);
      if (!list.length && (loc === 'other' || chip === 'soon')) return;
      wrap.appendChild(zoneSection(loc, loc === 'other' ? '📍 ที่อื่นๆ' : K.locTh(loc), list.length, loc === 'other' ? '' : loc.toLowerCase(), list.map(itemCard)));
    });
    if (chip === 'soon' && !items.some(isSoon)) wrap.appendChild(el('div', { class: 'list empty', text: 'ไม่มีของใกล้หมดอายุ 👍' }));
    wrap.appendChild(el('p', { class: 'hint', text: 'แตะที่รายการเพื่อ ✅ ใช้ / 🗑 ทิ้ง / ❄️ ย้าย · แตะหัวข้อเพื่อพับเก็บ' }));
    applyFind(wrap);
    return wrap;
  }

  K.tab({
    id: 'fridge', icon: '🥢', label: 'ของกิน', render: renderFridge, banner: cookBanner,
    afterLoad: function () { if (cook && cook.pending) sendCook(); },   // reopened with an unsent batch: send it now
    badge: function () { return K.S.items.filter(function (i) { return i.loc !== 'Freezer' && !K.noExp(i.loc) && i.left !== null && i.left <= K.S.meta.alertDays; }).length; },
    urgent: function () { return K.S.items.some(function (i) { return !K.noExp(i.loc) && i.left !== null && i.left <= 0; }); },   // expired or expires today
  });

  /* ---------------- last stock check line (ตู้เย็น landing, v14.0) ---------------- */
  function daysAgo(ymd) {
    return Math.round((Date.parse(K.S.meta.today + 'T00:00:00Z') - Date.parse(ymd + 'T00:00:00Z')) / 864e5);
  }
  function lastCheckLine() {
    const m = K.S.meta;
    if (!m || !('lastCheck' in m)) return null;   // an older server: no line
    const lc = m.lastCheck, due = m.checkOverdueDays || 7;
    let text, hot = false;
    if (!lc) { text = 'ยังไม่เคยเช็กของ'; hot = true; }
    else {
      const d = daysAgo(lc.ymd);
      if (d >= due) { text = 'ไม่ได้เช็กของมา ' + d + ' วันแล้ว'; hot = true; }
      else text = 'เช็กของล่าสุด: ' + (d <= 0 ? 'วันนี้' : d === 1 ? 'เมื่อวาน' : d + ' วันก่อน') + (lc.by ? ' (' + lc.by + ')' : '');
    }
    return el('div', { class: 'lastcheck' + (hot ? ' due' : '') }, [
      el('span', { text: '📋 ' + text }),
      K.canEdit() ? el('button', { class: 'btn small' + (hot ? ' primary' : ''), type: 'button', text: 'เช็กเลย', on: { click: function () { K.go('stock'); } } }) : null,
    ]);
  }

  /* ---------------- เช็กของ (v14.0) ---------------- */
  /*
   * "แตะเฉพาะของที่ไม่ตรง": the page assumes everything is right. Changes stay on the phone (per household, like the
   * shopping ticks) until ยืนยัน, then go to the server in ONE request (stockCheckSave) with one request ID that is
   * kept until the server answers, so weak signal never loses or doubles anything.
   *   chk = {base: {id: qty when first touched}, now: {id: qty}, exp: {id: 'toss'|'keep'}, why: {id: use|toss|unsure},
   *          found: [{key, name, qty, zone, cat?, unit}], done: {zone: 1}, pending: {reqId, hh, payload} | null}
   * Zone progress (done) is phone-only. The server checks every "was" quantity and skips items someone changed.
   */
  const CHECK_ZONES = ['Chill', 'Fridge', 'Freezer', 'Pantry', 'Kitchen'];   // the order people open things; ของใช้ last (v16.0)
  let checkKey = K.hkey('check.v1');
  let chk = K.store.get(checkKey, null);
  let chkSending = false;
  function saveChk() { if (chk) K.store.set(checkKey, chk); else K.store.del(checkKey); }
  K.onHousehold(function () { checkKey = K.hkey('check.v1'); chk = K.store.get(checkKey, null); });
  function newDraft() { return { base: {}, now: {}, exp: {}, split: {}, why: {}, found: [], done: {}, pending: null }; }

  function checkZones() {
    const z = CHECK_ZONES.filter(function (x) { return x === 'Kitchen' || K.zoneOn(x); }).concat(['Storage']);
    if (K.S.items.some(function (i) { return z.indexOf(i.loc) < 0; })) z.push('other');
    return z;
  }
  function inZone(i, zone, zones) { return zone === 'other' ? zones.indexOf(i.loc) < 0 : i.loc === zone; }
  function isExpired(i) { return !K.noExp(i.loc) && i.left !== null && i.left !== undefined && i.left < 0; }
  function cur(it) { return chk.now[it.id] !== undefined ? chk.now[it.id] : it.qty; }
  function baseOf(it) { return chk.base[it.id] !== undefined ? chk.base[it.id] : it.qty; }
  function changeCount() { return chk ? Object.keys(chk.now).length + Object.keys(chk.exp).length + chk.found.length : 0; }

  /** Drop draft entries for items that are gone (used elsewhere since). */
  function tidyDraft() {
    if (!chk || chk.pending) return;
    ['now', 'exp', 'why', 'base'].forEach(function (k) { Object.keys(chk[k]).forEach(function (id) { if (!itemById(id)) delete chk[k][id]; }); });
  }

  function setQty(it, v) {
    if (chk.base[it.id] === undefined) chk.base[it.id] = it.qty;
    if (v === chk.base[it.id]) { delete chk.now[it.id]; delete chk.base[it.id]; delete chk.why[it.id]; }
    else chk.now[it.id] = v;
    saveChk(); K.render();
  }
  function setExp(it, act, n) {
    chk.split = chk.split || {};
    if (act === 'split') chk.split[it.id] = n; else delete chk.split[it.id];
    if (chk.exp[it.id] === act && act !== 'split') { delete chk.exp[it.id]; delete chk.base[it.id]; }
    else { chk.exp[it.id] = act; chk.base[it.id] = chk.base[it.id] === undefined ? it.qty : chk.base[it.id]; delete chk.now[it.id]; delete chk.why[it.id]; }
    saveChk(); K.render();
  }

  function rowSub(it) {
    return it.catTh + (it.left !== null && !K.noExp(it.loc) && it.loc !== 'Freezer' ? ' · ' + K.leftText(it.left, it.exp) : '');
  }

  /** One item in a zone: stepper (0 = gone) + หมด, or มี | หมด for มี/หมด items. */
  function checkRow(it) {
    const v = cur(it), changed = chk.now[it.id] !== undefined;
    const word = K.unitWord(it.type, it.unit);
    const main = el('div', { class: 'main' }, [
      it.name,
      el('span', { class: 'sub', text: rowSub(it) }),
      changed ? el('span', { class: 'was', text: 'เดิม ' + (it.type === 'flag' ? 'มี' : baseOf(it) + ' ' + word) }) : null,
    ]);
    let ctl;
    if (it.type === 'flag') {
      ctl = el('span', { class: 'toggle2', role: 'group', 'aria-label': it.name }, [
        el('button', { class: 'yes', type: 'button', 'aria-pressed': String(v > 0), text: 'มี', on: { click: function () { setQty(it, 1); } } }),
        el('button', { class: 'no', type: 'button', 'aria-pressed': String(v === 0), text: 'หมด', on: { click: function () { setQty(it, 0); } } }),
      ]);
    } else {
      ctl = el('span', { class: 'ctl' }, [
        K.stepper(v, 0, 999, word, function (n) { setQty(it, n); }, { label: 'จำนวน ' + it.name }).node,
        ' ',
        el('button', { class: 'gonebtn', type: 'button', 'aria-pressed': String(v === 0), text: 'หมด',
          on: { click: function () { setQty(it, v === 0 ? baseOf(it) : 0); } } }),
      ]);
    }
    return el('div', { class: 'row ck ' + K.fresh(it) + (v === 0 ? ' gone' : changed ? ' changed' : '') }, [main, ctl]);
  }

  /** v15.0: ชิ้น / ที่ with more than 1 can be split: ทิ้งทั้งหมด · ยังดีอยู่ · แบ่ง (ทิ้ง X จาก N, the rest is still good). */
  function expiredRow(it) {
    const a = chk.exp[it.id], canSplit = it.type !== 'flag' && it.qty > 1;
    const word = K.unitWord(it.type, it.unit), n = (chk.split || {})[it.id];
    const state = a === 'split' ? 'ทิ้ง ' + n + ' · ยังดีอยู่ ' + (it.qty - n) + ' ' + word : '';
    const btn = function (cls, act, text, click) {
      return el('button', { class: cls, type: 'button', 'aria-pressed': String(a === act), text: text, on: { click: click || function () { setExp(it, act); } } });
    };
    return el('div', { class: 'row ck late' + (a === 'toss' ? ' gone' : a ? ' changed' : '') }, [
      el('div', { class: 'main' }, [it.name + (K.qtyText(it.type, it.qty, it.unit) ? ' ' + K.qtyText(it.type, it.qty, it.unit) : ''),
        el('span', { class: 'sub', text: K.locTh(it.loc) + ' · ' + K.leftText(it.left, it.exp) }),
        state ? el('span', { class: 'was', text: state }) : null]),
      el('span', { class: 'toggle2', role: 'group', 'aria-label': it.name }, [
        btn('no', 'toss', canSplit ? 'ทิ้งทั้งหมด' : 'ทิ้ง'),
        btn('yes', 'keep', 'ยังดีอยู่'),
        canSplit ? btn('yes', 'split', 'แบ่ง', function () { askSplit(it); }) : null,
      ]),
    ]);
  }
  function askSplit(it) {
    const word = K.unitWord(it.type, it.unit);
    K.sheet(function (close) {
      const st = K.stepper((chk.split || {})[it.id] || 1, 1, it.qty, word, null, { label: 'จำนวนที่ทิ้ง' });
      return [
        el('h3', { text: 'แบ่ง ' + it.name }),
        el('div', { class: 'sub', text: 'ที่เหลือยังดีอยู่ ใช้ได้อีก ' + (K.S.meta.keepGoodDays || 2) + ' วัน' }),
        el('div', { class: 'amount' }, [el('span', { text: 'ทิ้ง' }), st.node, el('span', { text: 'จาก ' + it.qty })]),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', text: 'ตกลง', on: { click: function () {
            const n = st.get(); close(); setExp(it, n >= it.qty ? 'toss' : 'split', n);
          } } }),
        ]),
      ];
    });
  }

  function foundRow(f) {
    return el('div', { class: 'row ck changed' }, [
      el('div', { class: 'main' }, [f.name, el('span', { class: 'newtag', text: 'ใหม่' }), el('span', { class: 'sub', text: f.qtyText || '' })]),
      el('button', { class: 'btn small', type: 'button', 'aria-label': 'เอา ' + f.name + ' ออก', text: '✕',
        on: { click: function () { chk.found = chk.found.filter(function (x) { return x.key !== f.key; }); saveChk(); K.render(); } } }),
    ]);
  }

  /* ---- + เจอของที่ไม่ได้จด: pick from the Dictionary, or a new name + its category ---- */
  function addFound(zone) {
    K.sheet(function (close) {
      const input = el('input', { class: 'search', type: 'search', placeholder: 'ชื่อของ เช่น ไข่ แอปเปิ้ล', 'aria-label': 'ชื่อของ' });
      const box = el('div', { class: 'list' });
      const draw = function () {
        const q = input.value.trim(), ql = q.toLowerCase();
        const list = K.S.dict.filter(function (d) { return !ql || d.name.toLowerCase().indexOf(ql) >= 0 || d.aliases.toLowerCase().indexOf(ql) >= 0; }).slice(0, 40);
        const rows = list.map(function (d) {
          return el('button', { class: 'row', type: 'button', on: { click: function () { close(); foundQty(zone, d, null); } } }, [
            el('div', { class: 'main' }, [d.name, el('span', { class: 'sub', text: K.catTh(d.cat) })]),
          ]);
        });
        const exact = K.S.dict.some(function (d) { return d.name.toLowerCase() === ql; });
        if (q && !exact) rows.unshift(el('button', { class: 'row', type: 'button', on: { click: function () { close(); foundCategory(zone, q.slice(0, 40)); } } }, [
          el('div', { class: 'main' }, ['+ "' + q.slice(0, 40) + '" เป็นของใหม่', el('span', { class: 'sub', text: 'เลือกประเภทต่อ (ครั้งหน้าจะจำได้)' })]),
        ]));
        box.replaceChildren.apply(box, rows.length ? rows : [el('div', { class: 'empty', text: 'พิมพ์ชื่อของที่เจอ' })]);
      };
      input.addEventListener('input', draw);
      draw();
      return [el('h3', { text: 'เจออะไรใน' + K.locTh(zone) + '?' }), input, box];
    });
  }
  function foundCategory(zone, name) {
    K.sheet(function (close) {
      return [el('h3', { text: '"' + name + '" คืออะไร?' }), el('div', { class: 'list' }, (K.S.meta.cats || []).map(function (c) {
        return el('button', { class: 'row', type: 'button', on: { click: function () { close(); foundQty(zone, null, { name: name, cat: c.id }); } } }, [
          el('div', { class: 'main', text: (c.icon || '') + ' ' + c.th }),
        ]);
      }))];
    });
  }
  function foundQty(zone, d, fresh) {
    const name = d ? d.name : fresh.name, type = d ? d.type : 'piece', unit = d ? d.unit : '';
    const word = K.unitWord(type, unit);
    const add = function (n) {
      chk = chk || newDraft();
      chk.found.push({ key: K.newReqId().slice(0, 10), name: name, qty: n, zone: zone, cat: fresh ? fresh.cat : undefined,
        qtyText: type === 'flag' ? K.locTh(zone) : n + ' ' + word + ' · ' + K.locTh(zone) });
      saveChk(); K.render();
    };
    if (type === 'flag') return add(1);
    K.sheet(function (close) {
      const st = K.stepper(d && d.defQty > 0 ? d.defQty : 1, 1, 999, word);
      return [
        el('h3', { text: name + ' กี่' + word + '?' }), el('div', { class: 'sub', text: K.locTh(zone) }),
        el('div', { class: 'amount' }, [el('span', { class: 'sub', text: 'จำนวน' }), st.node]),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', text: 'เพิ่ม', on: { click: function () { const n = st.get(); close(); add(n); } } }),
        ]),
      ];
    });
  }

  /* ---- the page ---- */
  function renderStock() {
    const S = K.S;
    if (!K.canEdit()) return el('div', {}, [el('p', { class: 'status', text: 'เช็กของได้เฉพาะคนที่แก้ไขได้' })]);
    chk = chk || newDraft();
    tidyDraft();
    const zones = checkZones();
    const doneN = zones.filter(function (z) { return chk.done[z]; }).length;
    const n = changeCount();
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'checkhead' }, [
      el('p', { class: 'big', text: 'แตะเฉพาะของที่ไม่ตรง' }),
      el('div', { class: 'prog', text: 'เช็กแล้ว ' + doneN + '/' + zones.length + ' โซน' + (n ? ' · แก้ไว้ ' + n + ' รายการ' : '') }),
    ]));
    if (chk.pending) wrap.appendChild(el('div', { class: 'banner warn', text: chkSending ? '⏳ กำลังบันทึก…' : '⚠️ ยังไม่ได้บันทึก (สัญญาณอ่อน) กด "ส่งอีกครั้ง" ได้เลย ไม่บันทึกซ้ำ' }));

    const expired = S.items.filter(isExpired).sort(byExpiry);
    if (expired.length) wrap.appendChild(K.group('⏰ เลยวันหมดอายุแล้ว (' + expired.length + ')', expired.map(expiredRow)));

    zones.forEach(function (zone) {
      const title = zone === 'other' ? '📍 ที่อื่นๆ' : K.locTh(zone);
      const list = S.items.filter(function (i) { return inZone(i, zone, zones) && !chk.exp[i.id]; }).sort(byExpiry);
      const found = chk.found.filter(function (f) { return f.zone === zone; });
      if (chk.done[zone]) {
        wrap.appendChild(el('div', { class: 'zonedone' }, [
          el('span', { text: '✓ ' + title + ' ครบแล้ว' + (list.length ? ' (' + list.length + ')' : '') }),
          el('button', { class: 'btn small', type: 'button', text: 'เปิดดู', on: { click: function () { delete chk.done[zone]; saveChk(); K.render(); } } }),
        ]));
        return;
      }
      const rows = list.map(checkRow).concat(found.map(foundRow));
      if (!rows.length) rows.push(el('div', { class: 'empty', text: 'ไม่มีของ' }));
      rows.push(el('div', { class: 'zonebtns' }, [
        zone !== 'other' ? el('button', { class: 'btn', type: 'button', disabled: !!chk.pending, text: '+ เจอของที่ไม่ได้จด', on: { click: function () { addFound(zone); } } }) : null,
        el('button', { class: 'btn primary', type: 'button', text: 'ครบแล้ว ✓', on: { click: function () { chk.done[zone] = 1; saveChk(); K.render(); } } }),
      ]));
      wrap.appendChild(K.group(title + (list.length ? ' (' + list.length + ')' : ''), rows));
    });

    wrap.appendChild(el('div', { class: 'pad-bottom' }));
    wrap.appendChild(el('div', { class: 'storebar' }, chk.pending ? [
      el('button', { class: 'btn primary', type: 'button', disabled: chkSending, text: chkSending ? 'กำลังส่ง…' : 'ส่งอีกครั้ง', on: { click: sendCheck } }),
    ] : [
      n ? el('button', { class: 'btn', type: 'button', text: 'ล้างที่แก้', on: { click: function () {
        K.confirmSheet('ล้างที่แก้ไว้ทั้งหมด?', n + ' รายการ', 'ล้าง', function () { chk = null; saveChk(); K.render(); }, true);
      } } }) : null,
      el('button', { class: 'btn primary', type: 'button', text: n ? 'ยืนยัน (' + n + ')' : 'ยืนยัน ทุกอย่างตรง', on: { click: checkSummary } }),
    ]));
    return wrap;
  }

  /* ---- ยืนยัน: only the changes; lower amounts get ใช้ / ทิ้ง / ไม่แน่ใจ ---- */
  const WHY = [['use', 'ใช้'], ['toss', 'ทิ้ง'], ['unsure', 'ไม่แน่ใจ']];
  function checkSummary() {
    const zones = checkZones();
    const notDone = zones.filter(function (z) { return !chk.done[z]; }).map(function (z) { return z === 'other' ? 'ที่อื่นๆ' : K.locTh(z); });
    const expT = [], expK = [], expS = [];
    Object.keys(chk.exp).forEach(function (id) {
      const it = itemById(id);
      if (!it) return;
      if (chk.exp[id] === 'split') { const n = chk.split[id]; expS.push(it.name + ': ทิ้ง ' + n + ', ยังดีอยู่ ' + (it.qty - n)); }
      else (chk.exp[id] === 'toss' ? expT : expK).push(it.name);
    });
    const changes = Object.keys(chk.now).map(itemById).filter(Boolean);
    K.sheet(function (close) {
      const nodes = [el('h3', { text: changeCount() ? '📋 สรุปที่แก้' : '📋 ทุกอย่างตรงตามรายการ' })];
      if (notDone.length) nodes.push(el('div', { class: 'banner warn', text: 'ยังไม่ได้เช็ก: ' + notDone.join(', ') }));
      const lines = [];
      if (expT.length) lines.push(el('div', { class: 'sumline', text: '🗑 ทิ้ง (เลยวันหมดอายุ): ' + expT.join(', ') }));
      expS.forEach(function (t) { lines.push(el('div', { class: 'sumline', text: '✂️ ' + t })); });
      if (expK.length) lines.push(el('div', { class: 'sumline', text: '👍 ยังดีอยู่ (ใช้ได้อีก ' + (K.S.meta.keepGoodDays || 2) + ' วัน): ' + expK.join(', ') }));
      changes.forEach(function (it) {
        const was = baseOf(it), now = chk.now[it.id], word = K.unitWord(it.type, it.unit);
        const txt = it.type === 'flag' ? it.name + ' มี → ' + (now ? 'มี' : 'หมด') : it.name + ' ' + was + ' → ' + now + ' ' + word;
        const line = el('div', { class: 'sumline' }, [el('div', { text: (now < was ? '➖ ' : '➕ ') + txt })]);
        if (now < was) {
          if (!chk.why[it.id]) chk.why[it.id] = 'unsure';
          const btns = WHY.map(function (w) {
            const b = el('button', { type: 'button', 'aria-pressed': String(chk.why[it.id] === w[0]), text: w[1], on: { click: function () {
              chk.why[it.id] = w[0]; saveChk();
              btns.forEach(function (x, i) { x.setAttribute('aria-pressed', String(WHY[i][0] === w[0])); });
            } } });
            return b;
          });
          line.appendChild(el('div', { class: 'why', role: 'group', 'aria-label': 'หายไปเพราะ' }, btns));
        }
        lines.push(line);
      });
      chk.found.forEach(function (f) { lines.push(el('div', { class: 'sumline', text: '🆕 ' + f.name + ' ' + (f.qtyText || '') })); });
      saveChk();
      nodes.push(lines.length ? el('div', {}, lines) : el('p', { class: 'hint', text: 'ไม่มีอะไรต้องแก้ จะบันทึกว่าเช็กแล้ววันนี้ ✓' }));
      nodes.push(el('div', { class: 'btns' }, [
        el('button', { class: 'btn', type: 'button', text: 'กลับไปแก้', on: { click: close } }),
        el('button', { class: 'btn primary', type: 'button', text: 'บันทึก', on: { click: function () { close(); freezeCheck(); sendCheck(); } } }),
      ]));
      return nodes;
    });
  }

  /** Freezes the draft into one request (one request ID until the server answers). */
  function freezeCheck() {
    const payload = {
      expired: Object.keys(chk.exp).filter(itemById).map(function (id) { return { id: id, was: chk.base[id], act: chk.exp[id], toss: chk.exp[id] === 'split' ? chk.split[id] : undefined }; }),
      changes: Object.keys(chk.now).filter(itemById).map(function (id) { return { id: id, was: chk.base[id], now: chk.now[id], why: chk.why[id] || 'unsure' }; }),
      found: chk.found.map(function (f) { return { name: f.name, qty: f.qty, zone: f.zone, cat: f.cat }; }),
      seen: K.S.items.map(function (i) { return i.id; }),
    };
    chk.pending = { reqId: K.newReqId(), hh: K.hid, payload: payload };
    saveChk();
  }

  async function sendCheck() {
    if (!chk || !chk.pending || chkSending) return;
    const c = chk, key = checkKey, hh = c.pending.hh === undefined ? K.hid : c.pending.hh;
    chkSending = true; K.render();
    const res = await K.write('stockCheckSave', c.pending.payload, { reqId: c.pending.reqId, quiet: true, force: true, hh: hh, noUndo: true });
    chkSending = false;
    const here = c === chk;
    if (res.ok) {
      K.store.del(key);
      if (here) { chk = null; K.go('fridge', true); afterCheck(res.data); }
    } else if (res.error === 'network' || res.error === 'auth' || res.error === 'server') {
      K.render();   // keep pending: the same request ID next time
    } else {
      c.pending = null; K.store.set(key, c); K.render();   // refused: nothing applied, the draft stays to fix
    }
  }

  /** After the save: ran-out items (never tossed ones) → shopping list, then the เลิกทำ bar for the whole check. */
  function afterCheck(d) {
    const bar = function () {
      if (d.skipped && d.skipped.length) K.toast('⚠️ ข้าม (มีคนแก้ไปก่อน): ' + d.skipped.join(', '), true);
      if (d.undo) K.undoBar(d.undo, d.n ? '📋 บันทึก ' + d.n + ' รายการ' : '📋 เช็กแล้ว ทุกอย่างตรง');
      else K.toast(d.text || 'บันทึกแล้ว');
    };
    if (!d.offer || !d.offer.length) return bar();
    const tick = {};
    d.offer.forEach(function (n) { tick[n] = true; });
    K.sheet(function (close) {
      return [
        el('h3', { text: '🛒 หมดแล้ว เพิ่มลงรายการซื้อไหม?' }),
        el('div', {}, d.offer.map(function (name) {
          const box = el('input', { type: 'checkbox', checked: true, on: { change: function () { tick[name] = box.checked; } } });
          return el('label', { class: 'tickline' }, [box, el('span', { text: ' ' + name })]);
        })),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ไม่ต้อง', on: { click: function () { close(); bar(); } } }),
          el('button', { class: 'btn primary', type: 'button', text: 'เพิ่มลงรายการ', on: { click: async function () {
            close();
            const names = d.offer.filter(function (n) { return tick[n]; });
            if (names.length) await K.write('checkToList', { names: names, joinBatch: d.undo }, { quiet: true, noUndo: true });
            bar();
          } } }),
        ]),
      ];
    }, bar);
  }

  function checkBanner() {
    if (!chk || !chk.pending || K.current === 'stock') return null;
    return el('div', { class: 'banner warn' }, [
      el('span', { text: '📋 ยังไม่ได้บันทึกการเช็กของ ' }),
      el('button', { class: 'btn small', type: 'button', text: 'ดู', on: { click: function () { K.go('stock'); } } }),
    ]);
  }
  window.addEventListener('online', function () { if (chk && chk.pending && K.S.me) sendCheck(); });

  K.tab({
    id: 'stock', icon: '📋', label: 'เช็กของ', render: renderStock, nav: false, parent: 'fridge', banner: checkBanner,
    afterLoad: function () { if (chk && chk.pending) sendCheck(); },
    unsaved: function () { return !!chk && !chk.pending && changeCount() > 0; },
    discard: function () { chk = null; saveChk(); },
  });
})();
