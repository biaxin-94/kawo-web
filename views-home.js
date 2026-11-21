/*
 * งานบ้าน (due chores with ✅ ทำแล้ว / 💤 พรุ่งนี้) and ทำกิน (ทำอะไรกินดี + menu detail).
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;

  /* ---------------- งานบ้าน ---------------- */
  function choreWhen(c) {
    if (c.left < 0) return { cls: 'late', text: 'เลย ' + (-c.left) + ' วัน' };
    if (c.left === 0) return { cls: 'late', text: 'วันนี้' };
    if (c.left === 1) return { cls: 'soon', text: 'พรุ่งนี้' };
    return { cls: '', text: K.thDate(c.due) };
  }

  function choreRow(c) {
    const can = K.canEdit(), w = choreWhen(c), due = c.left <= 0;
    const doneToday = c.lastDone === K.S.meta.today;
    return el('div', { class: 'row' + (w.cls ? ' ' + w.cls : '') }, [
      el('div', { class: 'main' }, [c.task, el('span', { class: 'sub', text: '👤 ' + c.owner + ' · ทุก ' + c.every + ' วัน' + (c.lastDone ? ' · ล่าสุด ' + K.thDate(c.lastDone) + (c.lastBy ? ' (' + c.lastBy + ')' : '') : '') })]),
      el('div', { class: 'end', text: w.text }),
      el('button', { class: 'pill ok', type: 'button', disabled: !can || doneToday, text: doneToday ? '✓ แล้ว' : '✅ ทำแล้ว',
        on: { click: function () { K.write('choreDone', { row: c.row, task: c.task }); } } }),
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
  });

  /* ---------------- ทำกิน ---------------- */
  function ingLine(m) {
    let extra = '';
    if (m.have && m.frozen) extra = ' · 🧊 อยู่ช่องฟรีซ';
    else if (m.have && m.left !== null && m.left < 9999 && m.left <= 2) extra = ' · ⏰ ' + K.leftText(m.left);
    return el('div', { class: 'row' }, [el('div', { class: 'main', text: (m.have ? '✅ ' : '❌ ') + m.label + extra })]);
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
    if (r.frozenMain.length) note += (note ? ' · ' : '') + '🧊 ' + r.frozenMain.join(', ') + ' ละลายก่อน';
    return el('button', { class: 'row', type: 'button', on: { click: function () { openRecipe(r); } } }, [
      el('div', { class: 'main' }, [r.menu, note ? el('span', { class: 'sub', text: note }) : null]),
      el('span', { class: 'end', text: '›' }),
    ]);
  }

  function renderCook() {
    const all = K.S.recipes;
    const ready = all.filter(function (r) { return !r.missing; });
    const almost = all.filter(function (r) { return r.missing === 1; });
    const rest = all.filter(function (r) { return r.missing > 1; });
    const wrap = el('div', {}, [el('h1', { class: 'title', text: '🍳 ทำอะไรกินดี' })]);
    if (!all.length) wrap.appendChild(el('p', { class: 'status', text: 'ยังไม่มีเมนู เพิ่มได้ที่ ตั้งค่า › เมนู' }));
    if (ready.length) wrap.appendChild(K.group('✅ ทำได้เลย (' + ready.length + ')', ready.map(recipeRow)));
    if (almost.length) wrap.appendChild(K.group('🟡 ขาดอีกอย่างเดียว', almost.map(recipeRow)));
    if (rest.length) wrap.appendChild(K.group('เมนูอื่นๆ', rest.map(recipeRow)));
    return wrap;
  }

  K.tab({ id: 'cook', icon: '🍽', label: 'ทำอะไรกินดี', render: renderCook, nav: false, parent: 'fridge' });
})();
