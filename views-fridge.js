/*
 * ตู้เย็น (fridge + storage, with ✅ / 🗑 / 🧊 and the freeze suggestion) and เช็คของ (stock check).
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  const FRIDGE_LOCS = ['Fridge', 'Chill', 'Freezer', 'Pantry'];
  let part = 'fridge';                       // fridge | storage
  const dismissed = K.store.get('kawo.freezeDismissed', {});

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
  function openItem(it) {
    K.sheet(function (close) {
      const can = K.canEdit();
      const nodes = [
        el('h3', { text: it.name + (K.qtyText(it.type, it.qty, it.unit) ? ' ' + K.qtyText(it.type, it.qty, it.unit) : '') }),
        el('div', { class: 'sub', text: K.locTh(it.loc) + (it.exp ? ' · หมด ' + K.thDate(it.exp) + ' (' + K.leftText(it.left, it.exp) + ')' : '') + (it.added ? ' · ซื้อ ' + K.thDate(it.added) : '') }),
      ];
      const act = function (a, dest) { close(); askAmount(it, a, dest); };
      nodes.push(el('div', { class: 'btns' }, [
        el('button', { class: 'btn primary', type: 'button', disabled: !can, text: '✅ ใช้', on: { click: function () { act('used'); } } }),
        el('button', { class: 'btn danger', type: 'button', disabled: !can, text: '🗑 ทิ้ง', on: { click: function () { act('toss'); } } }),
      ]));
      if (it.loc !== 'Storage' && it.loc !== 'Freezer') {
        nodes.push(el('div', { class: 'btns' }, [
          it.loc !== 'Chill' ? el('button', { class: 'btn', type: 'button', disabled: !can, text: '❄️ ย้ายเข้า Chill', on: { click: function () { act('mv', 'Chill'); } } }) : null,
          el('button', { class: 'btn', type: 'button', disabled: !can, text: '🧊 ย้ายเข้าช่องฟรีซ', on: { click: function () { act('mv', 'Freezer'); } } }),
        ]));
      }
      if (!can) nodes.push(el('p', { class: 'hint', text: 'ดูอย่างเดียว: แก้ไขไม่ได้' }));
      return nodes;
    });
  }

  const VERB = { used: 'ใช้', toss: 'ทิ้ง', mv: 'ย้าย' };

  /** Quantity question depends on type: มี/หมด = none, ชิ้น/ที่ = how many (default all). */
  function askAmount(it, act, dest) {
    if (it.type === 'flag' || it.qty <= 1) return doAct(it, act, dest, it.qty);
    K.sheet(function (close) {
      const word = K.unitWord(it.type, it.unit);
      const st = K.stepper(it.qty, 1, it.qty, word);
      const title = it.type === 'serving' && act === 'used' ? 'ใช้ ' + it.name + ' ไปกี่ที่?' : VERB[act] + ' ' + it.name + ' กี่' + word + '?';
      return [
        el('h3', { text: title }),
        el('div', { class: 'sub', text: 'มี ' + it.qty + ' ' + word + (dest ? ' → ' + K.locTh(dest) : '') }),
        st.node,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ทั้งหมด (' + it.qty + ')', on: { click: function () { close(); doAct(it, act, dest, it.qty); } } }),
          el('button', { class: 'btn primary', type: 'button', text: 'ตกลง', on: { click: function () { close(); doAct(it, act, dest, st.get()); } } }),
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
        el('button', { class: 'btn small', type: 'button', text: 'ไม่ต้อง', on: { click: function () { dismissed[hintKey(h)] = 1; K.store.set('kawo.freezeDismissed', dismissed); K.render(); } } }),
        el('button', { class: 'btn small primary', type: 'button', disabled: !can, text: 'แช่ฟรีซ ' + h.freeze + ' ที่',
          on: { click: function () { K.write('itemAct', { id: h.id, act: 'mv', dest: 'Freezer', n: h.freeze, expectQty: h.qty }); } } }),
      ]),
    ]);
  }

  /* ---------------- ตู้เย็น tab ---------------- */
  function renderFridge() {
    const S = K.S, days = S.meta.alertDays;
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'seg', role: 'group' }, [
      el('button', { type: 'button', 'aria-pressed': String(part === 'fridge'), text: '🧊 ตู้เย็น', on: { click: function () { part = 'fridge'; K.render(); } } }),
      el('button', { type: 'button', 'aria-pressed': String(part === 'storage'), text: '📦 ตู้เก็บของ', on: { click: function () { part = 'storage'; K.render(); } } }),
    ]));

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
    id: 'fridge', icon: '🧊', label: 'ตู้เย็น', render: renderFridge,
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
