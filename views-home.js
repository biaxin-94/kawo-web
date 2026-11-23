/*
 * งานบ้าน (due chores with ✅ ทำแล้ว / 💤 พรุ่งนี้) and ทำกิน (ทำอะไรกินดี + menu detail).
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;

  /* ---------------- งานบ้าน ---------------- */
  function choreWhen(c) {
    if (c.left < 0) return { cls: 'late', text: 'เลย ' + (-c.left) + ' วัน' };
    if (c.left === 0) return { cls: 'soon', text: 'วันนี้' };   // v15.0: red only when overdue
    if (c.left === 1) return { cls: 'soon', text: 'พรุ่งนี้' };
    return { cls: '', text: K.thDate(c.due) };
  }

  /**
   * v17.0: ✅ ทำแล้ว asks "ทำโดย": every household member (viewers too, e.g. แม่), the person tapping preselected.
   * Someone other than the assigned person did it -> the server keeps the turn with the assigned person.
   */
  function whoDid(c) {
    const people = (K.S.members || []).slice();
    if (!people.length) { K.write('choreDone', { row: c.row, task: c.task }); return; }
    let pick = (people.filter(function (m) { return m.me; })[0] || people[0]).key;
    K.sheet(function (close) {
      const rows = people.map(function (m) {
        const b = el('button', { class: 'row whopick', type: 'button', role: 'radio', 'aria-checked': String(m.key === pick), on: { click: function () {
          pick = m.key;
          rows.forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        } } }, [el('span', { class: 'radio', 'aria-hidden': 'true' }), el('div', { class: 'main' }, [(m.callName || m.name) + (m.me ? ' (ฉัน)' : ''),
          m.callName && m.callName !== m.name ? el('span', { class: 'sub', text: m.name }) : null])]);
        return b;
      });
      return [
        el('h3', { text: '✅ ' + c.task + ' · ทำโดย' }),
        el('div', { class: 'sub', text: 'ถึงคิว ' + c.owner + (c.ownerRule === 'Alternate' ? ' · ถ้าคนอื่นทำแทน รอบหน้ายังเป็นของ ' + c.owner : '') }),
        el('div', { class: 'list', role: 'radiogroup', 'aria-label': 'ทำโดย' }, rows),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', text: 'บันทึก', on: { click: function () {
            close();
            const me = people.filter(function (m) { return m.me; })[0];
            K.write('choreDone', me && me.key === pick ? { row: c.row, task: c.task } : { row: c.row, task: c.task, doer: pick });
          } } }),
        ]),
      ];
    });
  }

  function choreRow(c) {
    const can = K.canEdit(), w = choreWhen(c), due = c.left <= 0;
    const doneToday = c.lastDone === K.S.meta.today;
    return el('div', { class: 'row' + (w.cls ? ' ' + w.cls : '') }, [
      el('div', { class: 'main' }, [c.task, el('span', { class: 'sub', text: '👤 ' + c.owner + ' · ทุก ' + c.every + ' วัน' + (c.lastDone ? ' · ล่าสุด ' + K.thDate(c.lastDone) + (c.lastBy ? ' (' + c.lastBy + ')' : '') : '') })]),
      el('div', { class: 'end', text: w.text }),
      el('button', { class: 'pill ok', type: 'button', disabled: !can || doneToday, text: doneToday ? '✓ แล้ว' : '✅ ทำแล้ว',
        on: { click: function () { whoDid(c); } } }),
      due ? el('button', { class: 'pill', type: 'button', disabled: !can, text: '💤', 'aria-label': 'เลื่อน ' + c.task + ' ไปพรุ่งนี้',
        on: { click: function () { K.write('choreSnooze', { row: c.row, task: c.task }); } } }) : null,
    ]);
  }

  function renderChores() {
    const active = K.S.chores.filter(function (c) { return c.active; });
    const due = active.filter(function (c) { return c.left <= 0; });
    const later = active.filter(function (c) { return c.left > 0; });
    const wrap = el('div', {}, [el('h1', { class: 'title', text: '🧹 งานบ้าน' })]);
    wrap.appendChild(K.group('ถึงกำหนด (' + due.length + ')', due.length ? due.map(choreRow) : [el('div', { class: 'empty', text: 'ไม่มีงานค้าง เก่งมาก 🎉' })]));
    if (later.length) wrap.appendChild(K.group('รอบถัดไป', later.map(choreRow)));
    wrap.appendChild(el('p', { class: 'hint', text: 'เพิ่ม/แก้งานบ้าน: ตั้งค่า › งานบ้าน' }));
    return wrap;
  }

  K.tab({
    id: 'chores', icon: '🧹', label: 'งานบ้าน', render: renderChores,
    badge: function () { return K.S.chores.filter(function (c) { return c.active && c.left <= 0; }).length; },
    urgent: function () { return K.S.chores.some(function (c) { return c.active && c.left < 0; }); },   // v15.0: amber only when overdue
  });

  /* ---------------- ทำกิน ---------------- */
  function ingLine(m) {
    let extra = '';
    if (m.have && m.frozen) extra = ' · ❄️ อยู่ช่องฟรีซ';
    else if (m.have && m.left !== null && m.left < 9999 && m.left <= 2) extra = ' · ⏰ ' + K.leftText(m.left);
    return el('div', { class: 'row ' + (m.have ? 'fresh' : 'nodate') }, [el('div', { class: 'main', text: (m.have ? '✅ ' : '❌ ') + m.label + extra })]);
  }

  function openRecipe(r) {
    K.sheet(function (close) {
      const can = K.canEdit();
      const needMain = r.missing + r.seas.filter(function (s) { return s.warn; }).length;
      const needOpt = r.opt.filter(function (m) { return !m.have; }).length;
      const add = function (withOpt) { close(); K.write('recipeToList', { row: r.row, menu: r.menu, withOpt: withOpt }); };
      return [
        el('h3', { text: '🍳 ' + r.menu }),
        el('div', { class: 'sub', text: r.missing ? '❌ ขาด ' + r.missing + ' อย่าง' : '✅ ทำได้เลย!' }),
        el('div', { class: 'group' }, [el('h2', { text: 'วัตถุดิบหลัก' }), el('div', { class: 'list' }, r.main.map(ingLine))]),
        r.opt.length ? el('div', { class: 'group' }, [el('h2', { text: 'ใส่เพิ่มได้ (ไม่มีก็ทำได้)' }), el('div', { class: 'list' }, r.opt.map(ingLine))]) : null,
        r.seas.length ? el('p', { class: 'hint', text: '🧂 ' + r.seas.map(function (s) { return s.name + (s.warn ? ' ⚠️หมด' : ''); }).join(', ') }) : null,
        r.notes ? el('p', { class: 'hint', text: '📝 ' + r.notes }) : null,
        // Viewers don't see this button at all
        can && (r.main.some(function (m) { return m.have; }) || r.opt.some(function (m) { return m.have; }))
          ? el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: '🍳 ทำเมนูนี้', on: { click: function () { close(); K.cookRecipe(r); } } })])
          : null,
        el('div', { class: 'btns' }, [
          needMain ? el('button', { class: 'btn primary', type: 'button', disabled: !can, text: '🛒 ใส่ที่ขาดในรายการ', on: { click: function () { add(false); } } }) : null,
          needOpt ? el('button', { class: 'btn', type: 'button', disabled: !can, text: '🛒 รวมของเสริมด้วย', on: { click: function () { add(true); } } }) : null,
        ]),
      ];
    });
  }

  function recipeRow(r) {
    let note = r.missing ? 'ขาด ' + r.main.filter(function (m) { return !m.have; }).map(function (m) { return m.label; }).join(', ') : '';
    if (!r.missing && r.soonest && r.soonest.left <= 2) note = '⏰ ใช้' + r.soonest.name + ' (' + K.leftText(r.soonest.left) + ')';
    if (r.frozenMain.length) note += (note ? ' · ' : '') + '❄️ ' + r.frozenMain.join(', ') + ' ละลายก่อน';
    return el('button', { class: 'row', type: 'button', on: { click: function () { openRecipe(r); } } }, [
      el('div', { class: 'main' }, [r.menu, note ? el('span', { class: 'sub', text: note }) : null]),
      el('span', { class: 'end', text: '›' }),
    ]);
  }

  /*
   * v17.0: "🍳 ทำเมนูจากของนี้" on an item card opens this page filtered to recipes that use that item (as a main or
   * optional ingredient, alternatives included), in the usual order, with a removable chip. No recipe: ask the
   * persona in the group (LIFF sendMessages as the user; else copy the text).
   */
  let cookFor = null;   // {name, soon}
  K.openCookFor = function (it) {
    cookFor = { name: it.name, soon: it.left !== null && it.left !== undefined && it.left <= 2 && !K.noExp(it.loc) };
    K.cookForPending = true;   // onEnter keeps this filter; opening ทำอะไรกินดี any other way starts unfiltered
    K.go('cook');
  };
  // The server shows each slot as only the first alternative in stock, so also check the full list in r.edit.
  function usesItem(r, name) {
    const slots = r.main.concat(r.opt).some(function (m) { return m.name === name || String(m.label).split('/').map(function (x) { return x.trim(); }).indexOf(name) >= 0; });
    if (slots) return true;
    const e = r.edit || {};
    return (e.main || []).concat(e.opt || []).some(function (alts) { return alts.indexOf(name) >= 0; });
  }
  K.usesItem = usesItem;
  function personaName() { return (K.S.meta && K.S.meta.persona && K.S.meta.persona.name) || 'กะวอ'; }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* older webviews */ }
    try {
      const ta = el('textarea', { value: text, readonly: true, style: 'position:fixed;opacity:0' });
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  /** Posts the question into the household's group as the user (free reply from the persona), else copies it. */
  async function askPersona(text) {
    const L = window.liff;
    try {
      const ctx = L && L.getContext ? L.getContext() : null;
      if (L && L.isInClient && L.isInClient() && L.isApiAvailable && L.isApiAvailable('sendMessages') && ctx && (ctx.type === 'group' || ctx.type === 'room')) {
        await L.sendMessages([{ type: 'text', text: text }]);
        K.toast('ส่งในกลุ่มแล้ว');
        if (L.closeWindow) L.closeWindow();
        return;
      }
    } catch (e) { /* no permission / not opened from the group: copy instead */ }
    const ok = await copyText(text);
    if (ok) K.toast('คัดลอกแล้ว วางในแชทกลุ่มได้เลย');
    else K.sheet(function (close) { return [el('h3', { text: 'คัดลอกข้อความนี้ไปวางในแชทกลุ่ม' }), el('p', { text: text }), el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'ตกลง', on: { click: close } })])]; });
  }

  function renderCook() {
    let all = K.S.recipes;
    const wrap = el('div', {}, [el('h1', { class: 'title', text: '🍳 ทำอะไรกินดี' })]);
    if (cookFor) {
      const f = cookFor;
      all = all.filter(function (r) { return usesItem(r, f.name); });
      wrap.appendChild(el('div', { class: 'chips filterchips' }, [el('span', { class: 'chip on' }, ['🍳 ' + f.name,
        el('button', { class: 'x', type: 'button', 'aria-label': 'เอาตัวกรอง ' + f.name + ' ออก', text: '✕', on: { click: function () { cookFor = null; K.render(); } } })])]));
      if (!all.length) {
        const who = personaName();
        const q = who + ' มี' + f.name + (f.soon ? 'ใกล้หมด' : '') + ' ทำอะไรกินดี';
        wrap.appendChild(el('div', { class: 'list empty' }, [
          el('p', { text: 'ยังไม่มีเมนูที่ใช้ ' + f.name }),
          K.canEdit() ? el('button', { class: 'btn primary', type: 'button', text: 'ให้' + who + 'ช่วยคิดเมนู', on: { click: function () { askPersona(q); } } }) : null,
        ]));
        return wrap;
      }
    }
    const ready = all.filter(function (r) { return !r.missing; });
    const almost = all.filter(function (r) { return r.missing === 1; });
    const rest = all.filter(function (r) { return r.missing > 1; });
    if (!all.length) wrap.appendChild(el('p', { class: 'status', text: 'ยังไม่มีเมนู เพิ่มได้ที่ ตั้งค่า › เมนู' }));
    if (ready.length) wrap.appendChild(K.group('✅ ทำได้เลย (' + ready.length + ')', ready.map(recipeRow)));
    if (almost.length) wrap.appendChild(K.group('🟡 ขาดอีกอย่างเดียว', almost.map(recipeRow)));
    if (rest.length) wrap.appendChild(K.group('เมนูอื่นๆ', rest.map(recipeRow)));
    return wrap;
  }

  K.tab({ id: 'cook', icon: '🍽', label: 'ทำอะไรกินดี', render: renderCook, nav: false, parent: 'fridge',
    onEnter: function () { if (!K.cookForPending) cookFor = null; K.cookForPending = false; } });
})();
