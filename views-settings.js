/*
 * ตั้งค่า: สมาชิก (roles), ของ (Dictionary), งานบ้าน (chores), เมนู (recipes).
 * v11.0: ⚙️ ตั้งค่าบ้าน (admins only): name, chore rotation, storage zones, default zone per category;
 * members get a call name (how กะวอ calls them), a note, and a role per household.
 * Viewers see everything with the controls disabled; the server refuses their writes anyway.
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  let sub = 'members';
  const multi = function () { return !!K.hid; };
  // v13.0: the household's persona name in the texts that mention her
  const her = function () { return (K.S.meta && K.S.meta.persona && K.S.meta.persona.name) || 'กะวอ'; };   // v11.0 household (else: a server without households)
  const ROLE_OPTS = [{ v: 'admin', t: 'ผู้ดูแลบ้าน' }, { v: 'editor', t: 'แก้ไขได้' }, { v: 'viewer', t: 'ดูอย่างเดียว' }];
  let dictQuery = '';

  const field = function (label, input) { return el('label', { class: 'field' }, [el('span', { text: label }), input]); };
  const select = function (options, value) {
    return el('select', {}, options.map(function (o) { return el('option', { value: o.v, selected: String(o.v) === String(value) ? true : null, text: o.t }); }));
  };
  const numInput = function (v, placeholder) { return el('input', { type: 'number', inputmode: 'numeric', min: '0', value: v === null || v === undefined ? '' : String(v), placeholder: placeholder || '' }); };

  /* ---------------- สมาชิก ---------------- */
  function memberForm(m) {
    K.sheet(function (close) {
      const name = el('input', { value: m.name, maxlength: '30' });
      const call = el('input', { value: m.callName || '', maxlength: '30', placeholder: 'เช่น อาเด๊ะ พี่หมี (ว่าง = ชื่อไลน์)' });
      const note = el('input', { value: m.note || '', maxlength: '80', placeholder: 'เช่น พูดสุภาพ ลงท้าย ค่ะ' });
      const role = select(ROLE_OPTS, m.role);
      const save = function () {
        close();
        K.write('memberSave', { key: m.key, name: name.value.trim(), callName: call.value.trim(), note: note.value.trim(), role: role.value });
      };
      return [
        el('h3', { text: m.name + (m.me ? ' (ฉัน)' : '') }),
        field('ชื่อในบ้านนี้', name),
        field(her() + 'เรียกว่า', call),
        field('วิธีพูดด้วย (ไม่ใส่ก็ได้)', note),
        field('สิทธิ์', role),
        el('p', { class: 'hint', text: 'ผู้ดูแลบ้าน = แก้ไขได้ + ตั้งค่าบ้าน + เปลี่ยนสิทธิ์ · ต้องมีผู้ดูแลอย่างน้อย 1 คน' }),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', text: 'บันทึก', on: { click: save } }),
        ]),
      ];
    });
  }

  function renderMembersMulti(wrap) {
    const admin = K.isAdmin();
    const roleTh = {}; ROLE_OPTS.forEach(function (o) { roleTh[o.v] = o.t; });
    wrap.appendChild(el('p', { class: 'hint', text: 'คนในกลุ่มไลน์ของบ้านนี้ที่เคยพิมพ์หรือเปิดแอปจะมาอยู่ที่นี่' + (admin ? ' · แตะเพื่อแก้ชื่อ ชื่อที่' + her() + 'เรียก และสิทธิ์' : '') }));
    wrap.appendChild(K.group('สมาชิก (' + K.S.members.length + ')', K.S.members.map(function (m) {
      const sub = [roleTh[m.role] || m.role, m.callName ? her() + 'เรียก "' + m.callName + '"' : null, m.note || null].filter(Boolean).join(' · ');
      const kids = [el('div', { class: 'main' }, [m.name + (m.me ? ' (ฉัน)' : ''), el('span', { class: 'sub', text: sub })]), admin ? el('span', { class: 'end', text: '✏️' }) : null];
      return admin ? el('button', { class: 'row', type: 'button', on: { click: function () { memberForm(m); } } }, kids) : el('div', { class: 'row' }, kids);
    })));
  }

  function renderMembers(wrap) {
    if (multi()) return renderMembersMulti(wrap);
    const can = K.canEdit();
    wrap.appendChild(el('p', { class: 'hint', text: 'คนที่เคยพิมพ์ในกลุ่มหรือเปิดแอปจะมาอยู่ที่นี่ · แก้ไขได้ = บอทตอบ + กดปุ่มแก้ไขได้ · ดูอย่างเดียว = ดูได้ทุกหน้า บอทไม่ตอบ' }));
    wrap.appendChild(K.group('สมาชิก (' + K.S.members.length + ')', K.S.members.map(function (m) {
      const sel = select([{ v: 'editor', t: 'แก้ไขได้' }, { v: 'viewer', t: 'ดูอย่างเดียว' }], m.role);
      sel.disabled = !can || m.owner;
      sel.setAttribute('aria-label', 'สิทธิ์ของ ' + m.name);
      sel.addEventListener('change', async function () {
        const res = await K.write('setRole', { key: m.key, role: sel.value });
        if (!res.ok) sel.value = m.role;
      });
      return el('div', { class: 'row' }, [
        el('div', { class: 'main' }, [m.name + (m.me ? ' (ฉัน)' : ''), m.owner ? el('span', { class: 'sub', text: '👑 เจ้าของ เปลี่ยนสิทธิ์ไม่ได้' }) : null]),
        sel,
      ]);
    })));
  }

  /* ---------------- ของ (Dictionary) ---------------- */
  function dictForm(d) {
    const meta = K.S.meta, isNew = !d;
    d = d || { name: '', aliases: '', cat: 'Other', loc: 'Fridge', type: 'piece', unit: '', defQty: null, fridge: null, chill: null, freezer: null };
    K.sheet(function (close) {
      const can = K.canEdit();
      const name = el('input', { value: d.name, maxlength: '40', placeholder: 'เช่น ไก่', readonly: isNew ? null : true });
      const aliases = el('input', { value: d.aliases, placeholder: 'คั่นด้วย , เช่น chicken, อกไก่' });
      const cat = select(meta.cats.map(function (c) { return { v: c.id, t: c.icon + ' ' + c.th }; }), d.cat);
      // v11.0: only zones this household uses (plus the item's current one); '' = the category's default
      const loc = select([{ v: '', t: 'ตามประเภท' }].concat(meta.locs.filter(function (l) { return l.on !== false || l.id === d.loc; })
        .map(function (l) { return { v: l.id, t: l.icon + ' ' + l.th }; })), d.loc);
      const type = select(meta.types.map(function (t) { return { v: t.id, t: t.th }; }), d.type);
      // v22.0 (Idea E): 1-4 buying units, the first one is the usual one ("แพ็ค, กก., ชิ้น")
      const unit = el('input', { value: (d.units && d.units.length ? d.units : (d.unit ? [d.unit] : [])).join(', '), maxlength: '60', placeholder: 'เช่น แพ็ค, กก., ชิ้น' });
      const defQty = numInput(d.defQty, '1');
      const fridge = numInput(d.fridge, 'ตามประเภท'), chill = numInput(d.chill, '-'), freezer = numInput(d.freezer, 'ไม่แช่');
      const pantry = numInput(d.pantry, 'เท่าตู้เย็น');
      const unitField = field('หน่วยที่ซื้อ (ตัวแรก = ปกติ)', unit), defField = field('จำนวนปกติ (ไม่ใส่ตัวเลข = เท่านี้)', defQty);
      const sync = function () { unitField.hidden = type.value === 'serving'; defField.hidden = type.value === 'flag'; };
      type.addEventListener('change', sync); sync();
      const save = function () {
        close();
        K.write('dictSave', { row: isNew ? null : d.row, name: name.value.trim(), aliases: aliases.value, cat: cat.value, loc: loc.value, type: type.value,
          units: unit.value, defQty: defQty.value, fridge: fridge.value, chill: chill.value, freezer: freezer.value, pantry: pantry.value });
      };
      return [
        el('h3', { text: isNew ? 'เพิ่มของใหม่' : d.name }),
        el('div', { class: 'sub', text: isNew ? 'ชื่อเปลี่ยนทีหลังไม่ได้' : 'แก้แล้วใช้กับของที่เพิ่มใหม่ ของในตู้ตอนนี้ไม่เปลี่ยน' }),
        d.review ? el('div', { class: 'banner warn', text: '🆕 ' + her() + 'เพิ่มอันนี้ให้จากเมนู โดยลอกค่าจากของที่คล้ายกัน ตรวจแล้วกดบันทึก ป้ายต้องตรวจจะหายไป' }) : null,
        isNew ? field('ชื่อ', name) : null,
        field('ชื่ออื่นที่พิมพ์ได้', aliases),
        el('div', { class: 'field row2' }, [field('ประเภท', cat), field('เก็บที่', loc)]),
        field('ชนิด: ชิ้น = นับ · ที่ = จำนวนที่ (เนื้อสัตว์) · มี/หมด = ไม่นับ', type),
        el('div', { class: 'field row2' }, [unitField, defField]),
        el('div', { class: 'field row2' }, [field('วันในตู้เย็น', fridge), K.zoneOn('Chill') ? field('วันใน Chill', chill) : null,
          K.zoneOn('Freezer') ? field('วันในช่องฟรีซ', freezer) : null, K.zoneOn('Pantry') ? field('วันนอกตู้', pantry) : null]),
        el('div', { class: 'btns' }, [
          el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', on: { click: close } }),
          el('button', { class: 'btn primary', type: 'button', disabled: !can, text: 'บันทึก', on: { click: save } }),
        ]),
      ];
    });
  }

  function renderDict(wrap) {
    const can = K.canEdit();
    const input = el('input', { class: 'search', type: 'search', placeholder: 'ค้นหา', value: dictQuery, 'aria-label': 'ค้นหาของ' });
    const box = el('div');
    const draw = function () {
      dictQuery = input.value;
      const q = dictQuery.trim().toLowerCase();
      // v10.0: items กะวอ added from a chat menu are flagged "ต้องตรวจ" and listed first; saving the form clears the flag
      const list = K.S.dict.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0 || d.aliases.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return (b.review ? 1 : 0) - (a.review ? 1 : 0); });
      const typeTh = {}; K.S.meta.types.forEach(function (t) { typeTh[t.id] = t.th; });
      const reviewN = K.S.dict.filter(function (d) { return d.review; }).length;
      box.replaceChildren(
        reviewN ? el('div', { class: 'banner warn', text: '🆕 ' + her() + 'เพิ่มของใหม่จากเมนู ' + reviewN + ' อย่าง แตะเพื่อตรวจวันหมดอายุ หน่วย และที่เก็บ แล้วกดบันทึก' }) : el('span'),
        K.group('ของ (' + list.length + ')', list.slice(0, 150).map(function (d) {
          const bits = [K.catTh(d.cat), d.loc ? K.locTh(d.loc) : 'ตามประเภท', typeTh[d.type] + (d.units && d.units.length ? ' (' + d.units.join(', ') + ')' : d.unit ? ' (' + d.unit + ')' : '') + (d.defQty ? ' ปกติ ' + d.defQty : '')];
          return el('button', { class: 'row' + (d.review ? ' soon' : ''), type: 'button', on: { click: function () { dictForm(d); } } }, [
            el('div', { class: 'main' }, [d.name, d.review ? el('span', { class: 'tag', text: ' 🆕 ต้องตรวจ' }) : null, el('span', { class: 'sub', text: bits.join(' · ') })]),
            el('span', { class: 'end', text: '✏️' }),
          ]);
        })));
    };
    input.addEventListener('input', draw);
    wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', disabled: !can, text: '+ เพิ่มของใหม่', on: { click: function () { dictForm(null); } } })]));
    wrap.appendChild(input);
    wrap.appendChild(box);
    draw();
  }

  /* ---------------- งานบ้าน ---------------- */
  function choreForm(c) {
    const isNew = !c;
    c = c || { task: '', every: 7, ownerRule: 'Alternate', active: true };
    K.sheet(function (close) {
      const can = K.canEdit();
      const task = el('input', { value: c.task, maxlength: '60', placeholder: 'เช่น ล้างแอร์' });
      const every = el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '365', value: String(c.every) });
      // v11.0: any member can be given a chore; "สลับกัน" goes round the rotation set in ตั้งค่าบ้าน
      const people = multi() ? K.S.members.map(function (m) { return m.name; }) : K.S.meta.household;
      const owner = select([{ v: 'Alternate', t: 'สลับกัน' + (multi() && K.S.meta.household.length ? ' (' + K.S.meta.household.join(' → ') + ')' : '') }]
        .concat(people.map(function (h) { return { v: h, t: h }; })), c.ownerRule);
      const send = function (active) {
        close();
        K.write('choreSave', { row: isNew ? null : c.row, orig: isNew ? null : c.task, task: task.value.trim(), every: Number(every.value), ownerRule: owner.value, active: active });
      };
      return [
        el('h3', { text: isNew ? 'เพิ่มงานบ้าน' : c.task }),
        !isNew && !c.active ? el('div', { class: 'sub', text: '📦 อยู่ในคลัง (ไม่เตือน ประวัติยังอยู่)' }) : null,
        field('ชื่องาน', task),
        el('div', { class: 'field row2' }, [field('ทำทุกกี่วัน', every), field('ใครทำ', owner)]),
        el('div', { class: 'btns' }, [
          !isNew && c.active ? el('button', { class: 'btn danger', type: 'button', disabled: !can, text: '📦 เก็บเข้าคลัง', on: { click: function () { send(false); } } }) : null,
          el('button', { class: 'btn primary', type: 'button', disabled: !can, text: !isNew && !c.active ? 'เอากลับมาใช้' : 'บันทึก', on: { click: function () { send(true); } } }),
        ]),
      ];
    });
  }

  function renderChoreSettings(wrap) {
    const can = K.canEdit();
    const row = function (c) {
      return el('button', { class: 'row' + (c.active ? '' : ' done'), type: 'button', on: { click: function () { choreForm(c); } } }, [
        el('div', { class: 'main' }, [c.task, el('span', { class: 'sub', text: 'ทุก ' + c.every + ' วัน · ' + (c.ownerRule === 'Alternate' ? 'สลับกัน (รอบนี้ ' + c.owner + ')' : c.ownerRule) })]),
        el('span', { class: 'end', text: '✏️' }),
      ]);
    };
    wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', disabled: !can, text: '+ เพิ่มงานบ้าน', on: { click: function () { choreForm(null); } } })]));
    const active = K.S.chores.filter(function (c) { return c.active; }), archived = K.S.chores.filter(function (c) { return !c.active; });
    wrap.appendChild(K.group('ใช้อยู่ (' + active.length + ')', active.length ? active.map(row) : [el('div', { class: 'empty', text: 'ยังไม่มี' })]));
    if (archived.length) wrap.appendChild(K.group('📦 คลัง (' + archived.length + ')', archived.map(row)));
  }

  /* ---------------- เมนู ---------------- */
  /**
   * Recipe editor. Ingredients come from the Dictionary picker, which is its own sheet: the form closes
   * while picking and reopens afterwards (also on cancel) with everything typed so far.
   */
  function recipeForm(r) {
    const isNew = !r;
    const data = r ? JSON.parse(JSON.stringify(r.edit)) : { main: [], opt: [], seas: [] };
    let close = null;
    const can = K.canEdit();
    const menu = el('input', { value: r ? r.menu : '', maxlength: '60', placeholder: 'เช่น ผัดกะเพราหมู' });
    const notes = el('input', { value: r ? r.notes : '', maxlength: '200', placeholder: 'ไม่ใส่ก็ได้' });
    const mainBox = el('div'), optBox = el('div'), seasBox = el('div');
    const pick = function (title, onPick) { if (close) close(); K.pickItem(title, function (d) { onPick(d); open(); }, null, open); };

    const groupEditor = function (box, groups, label) {
      const draw = function () {
        box.replaceChildren.apply(box, groups.map(function (alts, gi) {
          const parts = [];
          alts.forEach(function (n, ai) {
            if (ai) parts.push(el('span', { class: 'or', text: 'หรือ' }));
            parts.push(el('span', { class: 'chip' }, [n, el('button', { class: 'x', type: 'button', 'aria-label': 'เอา ' + n + ' ออก', text: '×',
              on: { click: function () { alts.splice(ai, 1); if (!alts.length) groups.splice(gi, 1); draw(); } } })]));
          });
          parts.push(el('button', { class: 'chip add', type: 'button', text: '+ หรือ', on: { click: function () {
            pick('ใช้แทน ' + alts[0] + ' ได้', function (d) { if (alts.indexOf(d.name) < 0) alts.push(d.name); });
          } } }));
          return el('div', { class: 'alt-group', style: 'margin-bottom:6px' }, parts);
        }).concat([el('button', { class: 'chip add', type: 'button', text: '+ ' + label, on: { click: function () {
          pick('เพิ่ม' + label, function (d) { groups.push([d.name]); });
        } } })]));
      };
      draw();
    };
    const seasEditor = function () {
      seasBox.replaceChildren(el('div', { class: 'chips' }, data.seas.map(function (n, i) {
        return el('span', { class: 'chip' }, [n, el('button', { class: 'x', type: 'button', text: '×', 'aria-label': 'เอา ' + n + ' ออก', on: { click: function () { data.seas.splice(i, 1); seasEditor(); } } })]);
      }).concat([el('button', { class: 'chip add', type: 'button', text: '+ เครื่องปรุง', on: { click: function () {
        pick('เพิ่มเครื่องปรุง', function (d) { if (data.seas.indexOf(d.name) < 0) data.seas.push(d.name); });
      } } })])));
    };
    const open = function () {
      close = K.sheet(function (c) {
        close = c;
        groupEditor(mainBox, data.main, 'วัตถุดิบหลัก');
        groupEditor(optBox, data.opt, 'ของเสริม');
        seasEditor();
        return [
          el('h3', { text: isNew ? 'เพิ่มเมนู' : 'แก้เมนู' }),
          el('div', { class: 'sub', text: 'วัตถุดิบเลือกจากรายการของ · "หรือ" = ใช้แทนกันได้' }),
          field('ชื่อเมนู', menu),
          el('div', { class: 'field' }, [el('span', { text: 'วัตถุดิบหลัก (ต้องมี)' }), mainBox]),
          el('div', { class: 'field' }, [el('span', { text: 'ของเสริม (ไม่มีก็ทำได้)' }), optBox]),
          el('div', { class: 'field' }, [el('span', { text: 'เครื่องปรุง' }), seasBox]),
          field('โน้ต', notes),
          el('div', { class: 'btns' }, [
            !isNew ? el('button', { class: 'btn danger', type: 'button', disabled: !can, text: 'ลบเมนู', on: { click: function () {
              c(); K.confirmSheet('ลบ "' + r.menu + '"?', 'ลบแล้วเอากลับไม่ได้', 'ลบ', function () { K.write('recipeRemove', { row: r.row, menu: r.menu }); }, true);
            } } }) : null,
            el('button', { class: 'btn primary', type: 'button', disabled: !can, text: 'บันทึก', on: { click: function () {
              c();
              K.write('recipeSave', { row: isNew ? null : r.row, orig: isNew ? null : r.menu, menu: menu.value.trim(), main: data.main, opt: data.opt, seas: data.seas, notes: notes.value.trim() });
            } } }),
          ]),
        ];
      });
    };
    open();
  }

  function renderRecipes(wrap) {
    const can = K.canEdit();
    wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', disabled: !can, text: '+ เพิ่มเมนู', on: { click: function () { recipeForm(null); } } })]));
    const list = K.S.recipes.slice().sort(function (a, b) { return a.menu.localeCompare(b.menu, 'th'); });
    wrap.appendChild(K.group('เมนู (' + list.length + ')', list.length ? list.map(function (r) {
      const names = r.edit.main.map(function (a) { return a.join('/'); }).join(', ');
      return el('button', { class: 'row', type: 'button', on: { click: function () { recipeForm(r); } } }, [
        el('div', { class: 'main' }, [r.menu, el('span', { class: 'sub', text: names })]), el('span', { class: 'end', text: '✏️' }),
      ]);
    }) : [el('div', { class: 'empty', text: 'ยังไม่มีเมนู' })]));
  }

  /* ---------------- ⚙️ ตั้งค่าบ้าน (v11.0, admins only) ---------------- */
  function renderHouse(wrap) {
    const meta = K.S.meta;
    // name
    const name = el('input', { value: meta.houseName || '', maxlength: '40', 'aria-label': 'ชื่อบ้าน' });
    wrap.appendChild(K.group('ชื่อบ้าน', [el('div', { class: 'row' }, [el('div', { class: 'main' }, [name]),
      el('button', { class: 'btn small primary', type: 'button', text: 'บันทึก', on: { click: function () { K.write('hhSave', { name: name.value.trim() }); } } })])]));

    // chore rotation: tick who takes turns, in member order
    const rot = meta.household || [];
    const boxes = K.S.members.map(function (m) {
      const cb = el('input', { type: 'checkbox', checked: rot.indexOf(m.name) >= 0 ? true : null, 'aria-label': m.name });
      return { name: m.name, cb: cb, node: el('label', { class: 'toggle' }, [el('span', { text: m.name }), cb]) };
    });
    const ordered = rot.filter(function (n) { return boxes.some(function (b) { return b.name === n; }); });
    wrap.appendChild(K.group('ใครผลัดกันทำงานบ้าน ("สลับกัน")', boxes.map(function (b) { return b.node; }).concat([
      el('p', { class: 'hint', text: ordered.length ? 'ตอนนี้: ' + ordered.join(' → ') : 'ยังไม่ได้ตั้ง งานบ้านแบบสลับกันจะเปิดใช้ไม่ได้จนกว่าจะตั้ง' }),
      el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'บันทึกคนผลัดกันทำ', on: { click: function () {
        const picked = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.name; });
        const keep = ordered.filter(function (n) { return picked.indexOf(n) >= 0; });   // keep the current order, new people at the end
        K.write('hhSave', { rotation: keep.concat(picked.filter(function (n) { return keep.indexOf(n) < 0; })) });
      } } })]),
      el('p', { class: 'hint', text: 'เปิด/ปิดงานแต่ละอย่างได้ที่ ตั้งค่า › งานบ้าน' }),
    ])));

    // zones
    const zones = {};
    const zoneRows = ['Chill', 'Freezer', 'Pantry'].map(function (id) {
      const l = meta.locs.filter(function (x) { return x.id === id; })[0];
      const cb = el('input', { type: 'checkbox', checked: l && l.on !== false ? true : null, 'aria-label': l ? l.th : id });
      zones[id] = cb;
      return el('label', { class: 'toggle' }, [el('span', { text: (l ? l.icon + ' ' + l.th : id) }), cb]);
    });
    wrap.appendChild(K.group('ช่องเก็บของที่บ้านนี้มี', zoneRows.concat([
      el('p', { class: 'hint', text: 'ตู้เย็น ตู้กับข้าว และของใช้มีเสมอ · ปิดช่องไหน ของใหม่จะไปตู้เย็นแทน (ของที่อยู่แล้วไม่ย้าย)' }),
      el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'บันทึกช่องเก็บของ', on: { click: function () {
        K.write('hhSave', { zones: { Chill: zones.Chill.checked, Freezer: zones.Freezer.checked, Pantry: zones.Pantry.checked } });
      } } })]),
    ])));

    // default zone per category (fresh food only: dry food lives in ตู้กับข้าว, household items in ของใช้)
    const sel = {};
    const catRows = meta.cats.filter(function (c) { return !c.storage; }).map(function (c) {
      const s = select([{ v: '', t: 'ตู้เย็น (ปกติ)' }].concat(meta.locs.filter(function (l) { return l.on !== false && l.id !== 'Fridge' && l.id !== 'Storage' && l.id !== 'Kitchen'; })
        .map(function (l) { return { v: l.id, t: l.icon + ' ' + l.th }; })), (meta.catZones || {})[c.id] || '');
      s.setAttribute('aria-label', c.th);
      sel[c.id] = s;
      return el('div', { class: 'row' }, [el('div', { class: 'main', text: (c.icon || '') + ' ' + c.th }), s]);
    });
    wrap.appendChild(K.group('ของแต่ละประเภทเก็บที่ไหน', catRows.concat([
      el('p', { class: 'hint', text: 'ใช้กับของที่ไม่ได้ตั้งที่เก็บเอง (ตั้งค่า › ของ › เก็บที่ "ตามประเภท") เช่น เนื้อสัตว์ → Chill' }),
      el('div', { class: 'btns' }, [el('button', { class: 'btn primary', type: 'button', text: 'บันทึกที่เก็บ', on: { click: function () {
        const out = {}; Object.keys(sel).forEach(function (c) { out[c] = sel[c].value; });
        K.write('hhSave', { catZones: out });
      } } })]),
    ])));
  }

  /* ---------------- tab ---------------- */
  const SUBS = [
    { id: 'house', label: '⚙️ ตั้งค่าบ้าน', render: renderHouse, show: function () { return multi() && K.isAdmin(); } },
    { id: 'members', label: '👥 สมาชิก', render: renderMembers },
    { id: 'dict', label: '🥬 ของ', render: renderDict },
    { id: 'chores', label: '🧹 งานบ้าน', render: renderChoreSettings },
    { id: 'recipes', label: '🍳 เมนู', render: renderRecipes },
  ];

  function render() {
    const wrap = el('div');
    const subs = SUBS.filter(function (s) { return !s.show || s.show(); });
    if (!subs.some(function (s) { return s.id === sub; })) sub = subs[0].id;
    wrap.appendChild(el('div', { class: 'seg', role: 'group' }, subs.map(function (s) {
      return el('button', { type: 'button', 'aria-pressed': String(s.id === sub), text: s.label, on: { click: function () { sub = s.id; K.render(); } } });
    })));
    subs.filter(function (s) { return s.id === sub; })[0].render(wrap);
    return wrap;
  }

  K.tab({ id: 'settings', icon: '⚙️', label: 'ตั้งค่า', render: render, nav: false });   // opened from ⚙️ (top corner)
})();
