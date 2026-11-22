/*
 * ซื้อของ: plan the list at home, pick items in the store, confirm into the fridge.
 *
 * Weak signal in a store: every tick is saved on the phone at once (localStorage 'kawo.shop.v1').
 * "ยืนยัน" freezes the batch with ONE request ID into `pending` before sending. If sending fails,
 * the batch stays pending and is sent again with the SAME ID: by the retry button, when the phone
 * comes back online, or when the page is opened again. The server applies a request ID only once,
 * so retries can never add items twice.
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  let KEY = K.hkey('shop.v1');         // v11.0: 'kawo.<household>.shop.v1'
  let shop = null;
  function loadShop() {
    KEY = K.hkey('shop.v1');
    shop = K.store.get(KEY, null) || {};
    shop.mode = shop.mode || 'plan';
    shop.picks = shop.picks || {};       // name -> qty picked in the store
    shop.extras = shop.extras || [];     // [{name, qty}] bought but not on the list
    shop.pending = shop.pending || null; // {reqId, payload, at, hh}
  }
  loadShop();
  K.onHousehold(loadShop);
  let sending = false;
  const save = function () { if (!K.store.set(KEY, shop)) K.toast('บันทึกในเครื่องไม่ได้ (โหมดส่วนตัว?) อย่าปิดหน้านี้ก่อนยืนยัน', true); };

  const can = function () { return K.canEdit(); };
  const defQty = function (name) { const d = K.dictEntry(name); return d && d.defQty > 0 ? d.defQty : 1; };
  const typeOf = function (name) { const d = K.dictEntry(name); return d ? { type: d.type, unit: d.unit } : { type: 'piece', unit: '' }; };
  const label = function (name, qty) { const t = typeOf(name); const q = K.qtyText(t.type, qty, t.unit); return name + (q ? ' ' + q : ''); };

  /* ---------------- plan mode: edit the list ---------------- */
  function addToList() {
    K.pickItem('เพิ่มในรายการซื้อ', function (d) {
      if (d.type === 'flag') return K.write('listAdd', { name: d.name });
      K.sheet(function (close) {
        const st = K.stepper(d.defQty > 0 ? d.defQty : 1, 1, 999, K.unitWord(d.type, d.unit));
        return [el('h3', { text: d.name }), el('div', { class: 'sub', text: 'ซื้อเท่าไหร่?' }), st.node,
          el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'ใส่รายการ', on: { click: function () { close(); K.write('listAdd', { name: d.name, qty: st.get() }); } } })])];
      });
    });
  }

  function editRow(r) {
    K.sheet(function (close) {
      const st = r.type === 'flag' ? null : K.stepper(r.qty, 1, 999, K.unitWord(r.type, r.unit));
      return [
        el('h3', { text: r.name }), el('div', { class: 'sub', text: r.catTh }),
        st ? st.node : null,
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn danger', type: 'button', disabled: !can(), text: 'เอาออก', on: { click: function () { close(); K.write('listRemove', { name: r.name }); } } }),
          st ? el('button', { class: 'btn primary', type: 'button', disabled: !can(), text: 'บันทึก', on: { click: function () { close(); K.write('listSetQty', { name: r.name, qty: st.get() }); } } }) : null,
        ]),
      ];
    });
  }

  function grouped(list, rowFn) {
    const out = [];
    const cats = [];
    list.forEach(function (r) { if (cats.indexOf(r.cat) < 0) cats.push(r.cat); });
    const order = (K.S.meta.cats || []).map(function (c) { return c.id; });
    cats.sort(function (a, b) { return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99); });
    cats.forEach(function (c) {
      const rows = list.filter(function (r) { return r.cat === c; });
      out.push(K.group(rows[0].icon + ' ' + rows[0].catTh + ' (' + rows.length + ')', rows.map(rowFn)));
    });
    return out;
  }

  function renderPlan(wrap) {
    const list = K.S.list;
    wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', disabled: !can(), text: '+ เพิ่มของ', on: { click: addToList } })]));
    if (!list.length) wrap.appendChild(el('p', { class: 'status', text: 'รายการซื้อว่างอยู่' }));
    grouped(list, function (r) {
      return el('button', { class: 'row', type: 'button', on: { click: function () { editRow(r); } } }, [
        el('div', { class: 'main' }, [r.name, K.qtyText(r.type, r.qty, r.unit) ? el('span', { class: 'qty', text: K.qtyText(r.type, r.qty, r.unit) }) : null]),
        el('span', { class: 'end', text: '✏️' }),
      ]);
    }).forEach(function (n) { wrap.appendChild(n); });
  }

  /* ---------------- store mode: pick ---------------- */
  function togglePick(r) {
    if (!can()) return;
    if (shop.picks[r.name] !== undefined) delete shop.picks[r.name];
    else shop.picks[r.name] = r.qty;
    save(); K.render();
  }

  function editPick(r) {
    if (r.type === 'flag') return togglePick(r);
    K.sheet(function (close) {
      const st = K.stepper(shop.picks[r.name] !== undefined ? shop.picks[r.name] : r.qty, 1, 999, K.unitWord(r.type, r.unit));
      return [el('h3', { text: 'หยิบ ' + r.name + ' เท่าไหร่?' }), el('div', { class: 'sub', text: 'ในรายการ ' + K.qtyText(r.type, r.qty, r.unit) }), st.node,
        el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'หยิบแล้ว', on: { click: function () { shop.picks[r.name] = st.get(); save(); close(); K.render(); } } })])];
    });
  }

  function addExtra() {
    K.pickItem('ซื้อเพิ่ม (นอกรายการ)', function (d) {
      const go = function (qty) {
        const ex = shop.extras.filter(function (x) { return x.name === d.name; })[0];
        if (ex) ex.qty += qty; else shop.extras.push({ name: d.name, qty: qty });
        save(); K.render();
      };
      if (d.type === 'flag') return go(1);
      K.sheet(function (close) {
        const st = K.stepper(d.defQty > 0 ? d.defQty : 1, 1, 999, K.unitWord(d.type, d.unit));
        return [el('h3', { text: d.name }), st.node, el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'เพิ่ม', on: { click: function () { close(); go(st.get()); } } })])];
      });
    });
  }

  function renderStore(wrap) {
    const list = K.S.list;
    const pickedN = Object.keys(shop.picks).length + shop.extras.length;
    wrap.appendChild(el('p', { class: 'hint', text: 'แตะเพื่อติ๊กว่าหยิบแล้ว · แตะ ✏️ แก้จำนวน · ติ๊กเก็บไว้ในเครื่อง สัญญาณหายก็ไม่หาย' }));
    if (!list.length) wrap.appendChild(el('p', { class: 'status', text: 'ไม่มีของในรายการ ซื้ออะไรมาก็กด + ซื้อเพิ่ม' }));
    grouped(list, function (r) {
      const picked = shop.picks[r.name] !== undefined;
      const q = picked ? shop.picks[r.name] : r.qty;
      return el('div', { class: 'row' + (picked ? ' picked' : '') }, [
        el('button', { class: 'check', type: 'button', disabled: !can(), 'aria-pressed': String(picked), 'aria-label': 'หยิบ ' + r.name, text: picked ? '✓' : '', on: { click: function () { togglePick(r); } } }),
        el('div', { class: 'main', on: { click: function () { togglePick(r); } } }, [r.name, K.qtyText(r.type, q, r.unit) ? el('span', { class: 'qty', text: K.qtyText(r.type, q, r.unit) }) : null]),
        r.type !== 'flag' ? el('button', { class: 'pill', type: 'button', disabled: !can(), text: '✏️', 'aria-label': 'แก้จำนวน ' + r.name, on: { click: function () { editPick(r); } } }) : null,
      ]);
    }).forEach(function (n) { wrap.appendChild(n); });

    wrap.appendChild(K.group('➕ ซื้อเพิ่ม (นอกรายการ)', shop.extras.length ? shop.extras.map(function (x, i) {
      return el('div', { class: 'row picked' }, [
        el('span', { class: 'check', text: '✓' }),
        el('div', { class: 'main', text: label(x.name, x.qty) }),
        el('button', { class: 'pill', type: 'button', text: 'เอาออก', on: { click: function () { shop.extras.splice(i, 1); save(); K.render(); } } }),
      ]);
    }) : [el('div', { class: 'empty', text: 'ยังไม่มี' })]));
    wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn', type: 'button', disabled: !can(), text: '+ ซื้อเพิ่ม', on: { click: addExtra } })]));
    wrap.appendChild(el('div', { class: 'pad-bottom' }));
    wrap.appendChild(el('div', { class: 'storebar' }, [
      el('button', { class: 'btn', type: 'button', disabled: !pickedN, text: 'ล้างติ๊ก', on: { click: function () { K.confirmSheet('ล้างติ๊กทั้งหมด?', 'ของที่ติ๊กไว้จะกลับเป็นยังไม่ได้หยิบ', 'ล้าง', function () { shop.picks = {}; shop.extras = []; save(); K.render(); }, true); } } }),
      el('button', { class: 'btn primary', type: 'button', disabled: !pickedN || !can() || !!shop.pending, text: 'ยืนยัน (' + pickedN + ')', on: { click: confirmScreen } }),
    ]));
  }

  /* ---------------- confirm + send ---------------- */
  function confirmScreen() {
    const picks = Object.keys(shop.picks).map(function (n) { return { name: n, qty: shop.picks[n] }; });
    const notPicked = K.S.list.filter(function (r) { return shop.picks[r.name] === undefined; });
    const all = picks.concat(shop.extras);
    K.sheet(function (close) {
      return [
        el('h3', { text: '🧊 เข้าตู้ ' + all.length + ' รายการ' }),
        el('div', { class: 'list' }, all.map(function (p) { return el('div', { class: 'row' }, [el('div', { class: 'main', text: label(p.name, p.qty) })]); })),
        notPicked.length ? el('div', { class: 'banner warn' }, [
          el('b', { text: '⚠️ ยังไม่ได้หยิบ ' + notPicked.length + ' อย่าง: ' }),
          notPicked.map(function (r) { return r.name; }).join(', '),
          el('div', { class: 'hint', text: 'ของที่ไม่ได้หยิบจะอยู่ในรายการต่อ' }),
        ]) : el('p', { class: 'hint', text: 'หยิบครบทุกอย่างในรายการ 👍' }),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'กลับไปหยิบต่อ', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', text: 'ยืนยัน บันทึก', on: { click: function () {
            close();
            shop.pending = { reqId: K.newReqId(), payload: { picks: picks, extras: shop.extras.slice() }, at: Date.now(), hh: K.hid };
            save();
            send();
          } } }),
        ]),
      ];
    });
  }

  async function send() {
    if (!shop.pending || sending) return;
    // v11.0: the trip goes to the household it was made in, even if the page switched household meanwhile
    const s = shop, key = KEY, hh = s.pending.hh === undefined ? K.hid : s.pending.hh;
    sending = true; K.render();
    const res = await K.call('shopConfirm', s.pending.payload, s.pending.reqId, hh);
    sending = false;
    const here = s === shop && hh === K.hid;
    if (res.ok) {
      const sentPicks = s.pending.payload.picks.map(function (p) { return p.name; });
      sentPicks.forEach(function (n) { delete s.picks[n]; });
      s.extras = [];
      s.pending = null;
      s.mode = 'plan';
      K.store.set(key, s);
      if (here) { K.absorb(res); K.render(); showResult(res.data); } else K.toast('บันทึกของที่ซื้อของอีกบ้านแล้ว');
    } else if (res.error === 'network' || res.error === 'auth' || res.error === 'server') {
      K.store.set(key, s); K.render();   // keep pending: same request ID next time
      K.toast(res.error === 'auth' ? 'ยังไม่ได้บันทึก: ปิดแล้วเปิดหน้านี้ใหม่จาก LINE ระบบจะส่งให้เอง' : 'ยังไม่ได้บันทึก (สัญญาณอ่อน) ติ๊กยังอยู่ครบ กด "ส่งอีกครั้ง" ได้เลย', true);
    } else {
      s.pending = null;   // the server refused it: nothing was applied, keep the ticks so they can fix it
      K.store.set(key, s); K.render();
      K.toast(K.errorText(res), true);
    }
  }

  function showResult(d) {
    K.sheet(function (close) {
      const hints = K.S.freezeHints || [];
      return [
        el('h3', { text: '✅ เก็บเข้าตู้แล้ว ' + d.added.length + ' รายการ' }),
        el('div', { class: 'list' }, d.added.map(function (a) {
          return el('div', { class: 'row' }, [el('div', { class: 'main' }, [a.name + (a.qtyText || ''), el('span', { class: 'sub', text: '→ ' + a.locTh + (a.exp ? ' · หมด ' + K.thDate(a.exp) : '') })])]);
        })),
        d.kept.length ? el('p', { class: 'hint', text: 'ยังอยู่ในรายการ: ' + d.kept.join(', ') }) : null,
        hints.length ? el('div', { class: 'banner info', text: '❄️ มีของที่ควรแบ่งแช่ฟรีซ ดูที่หน้า ตู้เย็น' }) : null,
        el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'ตกลง', on: { click: function () {
          close(); if (hints.length) K.go('fridge');
          if (d.undo) K.undoBar(d.undo, '✅ เก็บเข้าตู้ ' + d.added.length + ' รายการ');   // v14.0
        } } })]),
      ];
    });
  }

  function pendingBanner() {
    if (!shop.pending) return null;
    const n = shop.pending.payload.picks.length + shop.pending.payload.extras.length;
    return el('div', { class: 'banner warn' }, [
      sending ? '⏳ กำลังบันทึกของที่ซื้อ ' + n + ' รายการ…' : '⚠️ ของที่ซื้อ ' + n + ' รายการ ยังไม่ได้บันทึก',
      sending ? null : el('button', { class: 'btn small primary', type: 'button', text: 'ส่งอีกครั้ง', on: { click: send } }),
    ]);
  }

  /* ---------------- tab ---------------- */
  function render() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'seg', role: 'group' }, [
      el('button', { type: 'button', 'aria-pressed': String(shop.mode === 'plan'), text: '📝 จดรายการ', on: { click: function () { shop.mode = 'plan'; save(); K.render(); } } }),
      el('button', { type: 'button', 'aria-pressed': String(shop.mode === 'store'), text: '🛒 อยู่ที่ร้าน', on: { click: function () { shop.mode = 'store'; save(); K.render(); } } }),
    ]));
    if (shop.mode === 'store') renderStore(wrap); else renderPlan(wrap);
    return wrap;
  }

  K.tab({
    id: 'shop', icon: '🛒', label: 'ซื้อของ', render: render,
    banner: pendingBanner,
    badge: function () { return K.S.list.length; },
    afterLoad: function () { if (shop.pending) send(); },   // reopened the page with an unsent trip: send it now
  });
  window.addEventListener('online', function () { if (shop.pending && K.S.me) send(); });
})();
