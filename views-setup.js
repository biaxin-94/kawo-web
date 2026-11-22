/*
 * เริ่มต้นตู้ (v19.0): the first fill of an empty fridge, standing at the open fridge, zone by zone.
 * Opened from the welcome card in LINE (?page=setup) and from the ของกิน page while nothing is in stock.
 *   - zones in the stock check order (only the ones this household uses), the same zone tints
 *   - chips = Dictionary items whose zone is this zone (d.place from the server); tap = 1, stepper to change,
 *     tap again or − at 1 = removed
 *   - "พิมพ์เพิ่ม" per zone: "กวางตุ้ง 2 ปลาทู 3 ซอสหอย" -> setupParse (the server's splitter; new names get a category)
 *   - search at the top for anything that isn't a chip (goes into the zone that is open)
 *   - everything stays on the phone (K.hkey('setup.v1')) until บันทึก: ONE setupSave with one request ID, one เลิกทำ
 *   - after the save the page posts "✅ เริ่มต้นตู้เสร็จแล้ว (N อย่าง)" into the LINE group (liff.sendMessages) so she can
 *     reply for free; outside the group it asks the server for its one push instead (setupNotify)
 *   st = {sel: {key: {name, qty, zone, cat, type, unit, isNew}}, order: [keys], done: {zone: 1}, open: zone, pending}
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  const ZONES = ['Chill', 'Fridge', 'Freezer', 'Pantry', 'Kitchen', 'Storage'];   // same order as เช็กของ, ของใช้ last
  const TINT = { Fridge: 'fridge', Chill: 'chill', Freezer: 'freezer', Pantry: 'pantry', Kitchen: 'kitchen' };
  let key = K.hkey('setup.v1');
  let st = K.store.get(key, null);
  let sending = false, parsing = false, findQ = '';
  K.onHousehold(function () { key = K.hkey('setup.v1'); st = K.store.get(key, null); findQ = ''; });
  function save() { if (st) K.store.set(key, st); else K.store.del(key); }
  function draft() { return st || (st = { sel: {}, order: [], done: {}, open: '', pending: null }); }
  function count() { return st ? st.order.length : 0; }

  function zones() { return ZONES.filter(function (z) { return z === 'Fridge' || z === 'Kitchen' || z === 'Storage' || K.zoneOn(z); }); }
  function zoneTitle(z) { return z === 'Storage' ? '🧴 ของใช้' : K.locTh(z); }
  function current() {
    const zs = zones(), s = draft();
    if (s.open && zs.indexOf(s.open) >= 0) return s.open;
    return zs.filter(function (z) { return !s.done[z]; })[0] || '';
  }
  function placeOf(d) { return d.place || d.loc || (K.S.meta.catZones || {})[d.cat] || 'Fridge'; }
  function keyOf(zone, name) { return zone + '|' + name; }

  /* ---- the draft ---- */
  function add(zone, x) {
    const s = draft(), k = keyOf(zone, x.name);
    if (s.sel[k]) { if (x.qty > 1 && x.type !== 'flag') s.sel[k].qty = Math.min(999, x.qty); }
    else { s.sel[k] = { name: x.name, qty: x.type === 'flag' ? 1 : Math.max(1, x.qty || 1), zone: zone, cat: x.cat, type: x.type || 'piece', unit: x.unit || '', isNew: !!x.isNew }; s.order.push(k); }
    save();
  }
  function remove(k) { const s = draft(); delete s.sel[k]; s.order = s.order.filter(function (x) { return x !== k; }); save(); }
  function fromDict(d) { return { name: d.name, qty: 1, cat: d.cat, type: d.type, unit: d.unit }; }

  /* ---- one zone ---- */
  function chosenRow(k) {
    const x = st.sel[k], word = K.unitWord(x.type, x.unit);
    const right = x.type === 'flag'
      ? el('button', { class: 'btn small', type: 'button', 'aria-label': 'เอา ' + x.name + ' ออก', text: '✕', on: { click: function () { remove(k); K.render(); } } })
      : K.stepper(x.qty, 1, 999, word, function (v) { x.qty = v; save(); }, { label: 'จำนวน ' + x.name, onUnder: function () { remove(k); K.render(); } }).node;
    return el('div', { class: 'row ck changed' }, [
      el('div', { class: 'main' }, [x.name, x.isNew ? el('span', { class: 'newtag', text: 'ใหม่' }) : null,
        el('span', { class: 'sub', text: x.isNew ? K.catTh(x.cat) + ' · ไว้ตรวจทีหลังใน ตั้งค่า › ของ' : K.catTh(x.cat) })]),
      right,
    ]);
  }

  /** The zone's chips: its own items, and for Chill / ฟรีซ / นอกตู้ also what keeps there (days set for that zone). */
  function chipList(zone) {
    return K.S.dict.filter(function (d) {
      return placeOf(d) === zone || (zone === 'Freezer' && d.freezer > 0) || (zone === 'Chill' && d.chill > 0) || (zone === 'Pantry' && d.pantry > 0);
    }).sort(function (a, b) { return K.catTh(a.cat).localeCompare(K.catTh(b.cat), 'th') || a.name.localeCompare(b.name, 'th'); });
  }

  /** A picked chip turns into a small stepper in place: − at 1 or a tap on the name takes it out again. */
  function chip(zone, d) {
    const k = keyOf(zone, d.name), x = st.sel[k];
    if (!x) return el('button', { class: 'fchip', type: 'button', 'aria-pressed': 'false', text: d.name, on: { click: function () { add(zone, fromDict(d)); K.render(); } } });
    const out = function () { remove(k); K.render(); };
    if (x.type === 'flag') return el('button', { class: 'fchip', type: 'button', 'aria-pressed': 'true', text: '✓ ' + d.name, on: { click: out } });
    const word = K.unitWord(x.type, x.unit);
    const set = function (v) { if (v < 1) return out(); x.qty = Math.min(999, v); save(); K.render(); };
    return el('span', { class: 'chipstep', role: 'group', 'aria-label': d.name }, [
      el('button', { type: 'button', class: 'cs', 'aria-label': 'ลด ' + d.name, text: '−', on: { click: function () { set(x.qty - 1); } } }),
      el('button', { type: 'button', class: 'cn', 'aria-label': 'เอา ' + d.name + ' ออก', text: d.name + ' ' + x.qty + ' ' + word, on: { click: out } }),
      el('button', { type: 'button', class: 'cs', 'aria-label': 'เพิ่ม ' + d.name, text: '+', on: { click: function () { set(x.qty + 1); } } }),
    ]);
  }

  function chips(zone, list) {
    if (!list.length) return [el('div', { class: 'empty', text: 'ยังไม่มีของในรายการของโซนนี้ ใช้ช่อง พิมพ์เพิ่ม ได้เลย' })];
    const out = [], cats = [];
    list.forEach(function (d) { if (cats.indexOf(d.cat) < 0) cats.push(d.cat); });
    cats.forEach(function (c) {
      out.push(el('div', { class: 'chiphead', text: K.catTh(c) }));
      out.push(el('div', { class: 'chips setupchips' }, list.filter(function (d) { return d.cat === c; }).map(function (d) { return chip(zone, d); })));
    });
    return out;
  }

  /** พิมพ์เพิ่ม: the server splits the text (same rules as the chat) and says which names are new. */
  function typeBox(zone) {
    const input = el('input', { class: 'search', type: 'text', placeholder: 'พิมพ์เพิ่ม เช่น กวางตุ้ง 2 ปลาทู 3 ซอสหอย', 'aria-label': 'พิมพ์เพิ่มใน' + zoneTitle(zone),
      enterkeyhint: 'done', autocomplete: 'off' });
    const go = async function () {
      const text = input.value.trim();
      if (!text || parsing) return;
      parsing = true; btn.disabled = true; btn.textContent = 'กำลังอ่าน…';
      const res = await K.call('setupParse', { text: text, zone: zone });
      parsing = false;
      if (!res.ok) { btn.disabled = false; btn.textContent = 'เพิ่ม'; K.toast(K.errorText(res), true); return; }
      (res.data.items || []).forEach(function (x) { add(zone, { name: x.name, qty: x.qty, cat: x.cat, type: x.type, unit: x.unit, isNew: !x.known }); });
      const fresh = (res.data.items || []).filter(function (x) { return !x.known; }).length;
      K.toast('เพิ่ม ' + res.data.items.length + ' อย่าง' + (fresh ? ' (ของใหม่ ' + fresh + ')' : ''));
      K.render();
    };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const btn = el('button', { class: 'btn', type: 'button', text: 'เพิ่ม', on: { click: go } });
    return el('div', { class: 'typeadd' }, [input, btn]);
  }

  function zoneBlock(zone, isOpen) {
    const mine = st.order.filter(function (k) { return st.sel[k].zone === zone; });
    const title = zoneTitle(zone) + (mine.length ? ' (' + mine.length + ')' : '');
    if (!isOpen) {
      return el('div', { class: 'zonedone' + (st.done[zone] ? '' : ' next') }, [
        el('span', { text: (st.done[zone] ? '✓ ' : '') + title }),
        el('button', { class: 'btn small', type: 'button', text: st.done[zone] ? 'เปิดดู' : 'เปิด', on: { click: function () { st.open = zone; save(); K.render(); } } }),
      ]);
    }
    // typed / searched items that have no chip here are rows with a stepper at the top of the zone
    const list = chipList(zone), onChip = {};
    list.forEach(function (d) { onChip[keyOf(zone, d.name)] = true; });
    const body = mine.filter(function (k) { return !onChip[k]; }).map(chosenRow).concat(chips(zone, list), [typeBox(zone),
      el('div', { class: 'zonebtns' }, [el('button', { class: 'btn primary', type: 'button', text: 'ครบแล้ว ✓', on: { click: function () {
        st.done[zone] = 1;
        const next = zones().filter(function (z) { return !st.done[z]; })[0] || '';
        st.open = next; save(); K.render(); window.scrollTo(0, 0);
      } } })])]);
    return el('section', { class: 'zone' + (TINT[zone] ? ' tint-' + TINT[zone] : '') }, [
      el('div', { class: 'zonehead static' }, [el('span', { class: 'zt', text: title })]),
      el('div', { class: 'list' }, body),
    ]);
  }

  /* ---- search: anything in the Dictionary, into the zone that is open ---- */
  function findBox(zone) {
    const box = el('div', { class: 'list' });
    const input = el('input', { class: 'search', type: 'search', placeholder: '🔍 หาของที่ไม่มีในปุ่ม', 'aria-label': 'ค้นหาของ', value: findQ, autocomplete: 'off' });
    const draw = function () {
      const q = findQ.trim().toLowerCase();
      if (!q) { box.replaceChildren(); return; }
      const list = K.S.dict.filter(function (d) { return d.name.toLowerCase().indexOf(q) >= 0 || d.aliases.toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
      box.replaceChildren.apply(box, list.length ? list.map(function (d) {
        return el('button', { class: 'row', type: 'button', on: { click: function () {
          add(zone || placeOf(d), fromDict(d)); findQ = ''; K.toast('เพิ่ม ' + d.name + ' ใน' + zoneTitle(zone || placeOf(d))); K.render();
        } } }, [el('div', { class: 'main' }, [d.name, el('span', { class: 'sub', text: K.catTh(d.cat) + (d.aliases ? ' · ' + d.aliases : '') })]),
          el('span', { class: 'end', text: '+ ' + zoneTitle(zone || placeOf(d)) })]);
      }) : [el('div', { class: 'empty', text: 'ไม่เจอ "' + findQ.trim() + '" พิมพ์ในช่อง พิมพ์เพิ่ม ของโซนได้เลย' })]);
    };
    input.addEventListener('input', function () { findQ = input.value; draw(); });
    draw();
    return el('div', { class: 'setupfind' }, [input, box]);
  }

  function renderSetup() {
    if (!K.canEdit()) return el('div', {}, [el('p', { class: 'status', text: 'เริ่มต้นตู้ได้เฉพาะคนที่แก้ไขได้' })]);
    draft();
    const zs = zones(), open = current();
    const doneN = zs.filter(function (z) { return st.done[z]; }).length, n = count();
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'checkhead' }, [
      el('p', { class: 'big', text: 'เปิดตู้แล้วกดเลือกของที่มี' }),
      el('div', { class: 'prog', text: 'เสร็จแล้ว ' + doneN + '/' + zs.length + ' โซน' + (n ? ' · เลือกไว้ ' + n + ' อย่าง' : '') }),
    ]));
    if (st.pending) wrap.appendChild(el('div', { class: 'banner warn', text: sending ? '⏳ กำลังบันทึก…' : '⚠️ ยังไม่ได้บันทึก (สัญญาณอ่อน) กด "ส่งอีกครั้ง" ได้เลย ไม่บันทึกซ้ำ' }));
    if (!st.pending) wrap.appendChild(findBox(open));
    zs.forEach(function (z) { wrap.appendChild(zoneBlock(z, !st.pending && z === open)); });
    if (!open && !st.pending) wrap.appendChild(el('p', { class: 'hint', text: 'ครบทุกโซนแล้ว กด "ดูสรุป" แล้วบันทึกได้เลย' }));
    wrap.appendChild(el('div', { class: 'pad-bottom' }));
    wrap.appendChild(el('div', { class: 'storebar' }, st.pending ? [
      el('button', { class: 'btn primary', type: 'button', disabled: sending, text: sending ? 'กำลังส่ง…' : 'ส่งอีกครั้ง', on: { click: send } }),
    ] : [
      n ? el('button', { class: 'btn', type: 'button', text: 'ล้าง', on: { click: function () {
        K.confirmSheet('ล้างที่เลือกไว้ทั้งหมด?', n + ' อย่าง', 'ล้าง', function () { st = null; save(); K.render(); }, true);
      } } }) : null,
      el('button', { class: 'btn primary', type: 'button', disabled: !n, text: n ? 'ดูสรุป (' + n + ')' : 'ยังไม่ได้เลือก', on: { click: summary } }),
    ]));
    return wrap;
  }

  /* ---- one summary, one save ---- */
  function summary() {
    const zs = zones();
    const notDone = zs.filter(function (z) { return !st.done[z]; }).map(zoneTitle);
    const fresh = st.order.filter(function (k) { return st.sel[k].isNew; }).length;
    K.sheet(function (close) {
      const nodes = [el('h3', { text: '✨ สรุปของในบ้าน ' + count() + ' อย่าง' })];
      if (notDone.length) nodes.push(el('div', { class: 'banner warn', text: 'ยังไม่ได้ดู: ' + notDone.join(', ') + ' (บันทึกได้เลย เพิ่มทีหลังได้)' }));
      zs.forEach(function (z) {
        const mine = st.order.filter(function (k) { return st.sel[k].zone === z; }).map(function (k) { return st.sel[k]; });
        if (!mine.length) return;
        nodes.push(el('div', { class: 'sumline' }, [el('b', { text: zoneTitle(z) + ': ' }),
          mine.map(function (x) { return x.name + (x.type === 'flag' ? '' : ' ' + x.qty + (x.type === 'serving' ? ' ที่' : x.unit ? ' ' + x.unit : '')) + (x.isNew ? ' (ใหม่)' : ''); }).join(', ')]));
      });
      nodes.push(el('p', { class: 'hint', text: 'ของที่มีวันหมดอายุ ตั้งไว้ครึ่งหนึ่งของปกติก่อน เพราะไม่รู้ว่าซื้อมาเมื่อไร (ขึ้นป้าย "ไม่ทราบวันซื้อ" จนกว่าจะเช็กของ)' +
        (fresh ? ' · ของใหม่ ' + fresh + ' อย่าง ตรวจทีหลังได้ใน ตั้งค่า › ของ' : '') }));
      nodes.push(el('div', { class: 'btns' }, [
        el('button', { class: 'btn', type: 'button', text: 'กลับไปแก้', on: { click: close } }),
        el('button', { class: 'btn primary', type: 'button', text: 'บันทึก', on: { click: function () { close(); freeze(); send(); } } }),
      ]));
      return nodes;
    });
  }

  function freeze() {
    const items = st.order.map(function (k) { const x = st.sel[k]; return { name: x.name, qty: x.qty, zone: x.zone, cat: x.isNew ? x.cat : undefined }; });
    st.pending = { reqId: K.newReqId(), hh: K.hid, payload: { items: items } };
    save();
  }

  async function send() {
    if (!st || !st.pending || sending) return;
    const s = st, k = key, hh = s.pending.hh === undefined ? K.hid : s.pending.hh;
    sending = true; K.render();
    const res = await K.write('setupSave', s.pending.payload, { reqId: s.pending.reqId, quiet: true, force: true, hh: hh, noUndo: true });
    sending = false;
    if (res.ok) {
      K.store.del(k);
      if (s === st) { st = null; K.go('fridge', true); }
      const d = res.data || {};
      if (d.undo) K.undoBar(d.undo, '✨ เริ่มต้นตู้ ' + d.n + ' อย่าง'); else K.toast(d.text || 'บันทึกแล้ว');
      tellChat(d.chat, hh);
    } else if (res.error === 'network' || res.error === 'auth' || res.error === 'server') {
      K.render();   // keep pending: the same request ID next time
    } else {
      s.pending = null; K.store.set(k, s); K.render();   // refused: nothing saved, the draft stays to fix
    }
  }

  /** Her confirmation: post the line into the group as this person (she replies for free), else one push. */
  async function tellChat(text, hh) {
    if (!text) return;
    let posted = false;
    try {
      const ctx = window.liff && liff.isInClient && liff.isInClient() && liff.getContext ? liff.getContext() : null;
      if (ctx && (ctx.type === 'group' || ctx.type === 'room')) { await liff.sendMessages([{ type: 'text', text: text }]); posted = true; }
    } catch (e) { posted = false; }   // no chat_message.write scope, or not opened from the chat
    if (!posted) await K.call('setupNotify', {}, K.newReqId(), hh);
  }

  K.openSetup = function () { K.go('setup'); };
  window.addEventListener('online', function () { if (st && st.pending && K.S.me) send(); });

  K.tab({
    id: 'setup', icon: '✨', label: 'เริ่มต้นตู้', render: renderSetup, nav: false, parent: 'fridge',
    afterLoad: function () { if (st && st.pending) send(); },
    // no unsaved(): leaving keeps the picks on the phone (come back and carry on); only ล้าง drops them
  });
})();
