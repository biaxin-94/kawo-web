/*
 * ประวัติ (v12.0): the household's item history, newest first, grouped by day; one line per batch
 * ("ปีเก้ ทำกะเพราไก่: ไก่ 1 ที่, ไข่ 2 ฟอง"). Filters: item, member, action. 7 days per page + "ดูเพิ่ม".
 * Read-only for everyone. The tab also has room for a future สถิติ section (SECTIONS below, hidden for now).
 */
(function () {
  'use strict';
  const K = window.KAWO, el = K.el;
  const SECTIONS = [
    { id: 'history', label: '📜 ประวัติ' },
    { id: 'stats', label: '📊 สถิติ', hidden: true },   // the stats dashboard will live here
  ];
  const ACTION_TH = { add: 'เพิ่ม', shopping_confirm: 'ซื้อเข้าตู้', use: 'ใช้', toss: 'ทิ้ง', move: 'ย้าย',
    stock_check_remove: 'หมดแล้ว (เช็กของ)', undo: 'ยกเลิก', mixed: 'ทำรายการ' };
  let section = 'history';
  let H = null;            // {days, next, members, items, actions}
  let filters = { item: '', member: '', action: '' };
  let loading = false;

  function reset() { H = null; }
  K.onHousehold(function () { reset(); filters = { item: '', member: '', action: '' }; });

  async function load(more) {
    if (loading) return;
    loading = true; K.render();
    const res = await K.call('history', Object.assign({ before: more && H ? H.next : undefined }, filters));
    loading = false;
    if (!res.ok) { K.toast(K.errorText(res), true); K.render(); return; }
    const d = res.data;
    if (more && H) { H.days = H.days.concat(d.days); H.next = d.next; } else H = d;
    K.render();
  }

  const select = function (label, options, value, onChange) {
    const s = el('select', { 'aria-label': label }, options.map(function (o) { return el('option', { value: o.v, selected: o.v === value ? true : null, text: o.t }); }));
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  };

  function itemText(i) {
    let q = '';
    if (i.qty !== null && i.qty !== undefined && i.unit !== 'มี/หมด') q = i.unit === 'ชิ้น' ? (i.qty !== 1 ? ' ×' + i.qty : '') : ' ' + i.qty + ' ' + i.unit;
    return i.item + q + (i.to && i.from && i.to !== i.from ? ' → ' + K.locTh(i.to) : '');
  }

  function groupLine(g) {
    const items = g.items.map(itemText).join(', ');
    if (g.recipe) return g.who + ' ทำ' + g.recipe + ': ' + items;
    if (g.batch && g.action === 'shopping_confirm') return g.who + ' ซื้อของเข้าตู้: ' + items;
    if (g.batch && g.action === 'use' && g.items.length > 1) return g.who + ' ใช้ทำกับข้าว: ' + items;
    return g.who + ' ' + (ACTION_TH[g.action] || g.action) + ' ' + items;
  }

  function dayTitle(day) {
    const today = K.S.meta.today;
    const y = new Date(new Date(today + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
    return day === today ? 'วันนี้' : day === y ? 'เมื่อวาน' : K.thDate(day);
  }

  function renderHistory(wrap) {
    if (!H) {
      if (!loading) setTimeout(function () { load(false); }, 0);
      wrap.appendChild(el('p', { class: 'status', text: 'กำลังโหลด…' }));
      return;
    }
    wrap.appendChild(el('div', { class: 'filters' }, [
      select('ของ', [{ v: '', t: 'ของทุกอย่าง' }].concat(H.items.map(function (n) { return { v: n, t: n }; })), filters.item, function (v) { filters.item = v; load(false); }),
      select('ใคร', [{ v: '', t: 'ทุกคน' }].concat(H.members.map(function (m) { return { v: m.key, t: m.name }; })), filters.member, function (v) { filters.member = v; load(false); }),
      select('ทำอะไร', [{ v: '', t: 'ทุกอย่าง' }].concat(H.actions.map(function (a) { return { v: a, t: ACTION_TH[a] || a }; })), filters.action, function (v) { filters.action = v; load(false); }),
    ]));
    if (!H.days.length) wrap.appendChild(el('div', { class: 'empty', text: H.next ? 'ช่วง 7 วันนี้ไม่มีรายการ' : 'ยังไม่มีประวัติ' }));
    H.days.forEach(function (d) {
      wrap.appendChild(el('div', { class: 'day', text: dayTitle(d.day) }));
      wrap.appendChild(el('div', { class: 'list hist' }, d.groups.map(function (g) {
        const t = new Date(g.time), hm = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
        const buyers = g.action === 'toss' ? g.items.map(function (i) { return i.buyer; }).filter(function (b, i, a) { return a.indexOf(b) === i; }) : [];
        return el('div', { class: 'row' }, [
          el('span', { class: 'time', text: hm }),
          el('div', { class: 'main' }, [groupLine(g), buyers.length ? el('span', { class: 'sub', text: 'ซื้อโดย ' + buyers.join(', ') }) : null]),
        ]);
      })));
    });
    if (H.next) wrap.appendChild(el('div', { class: 'btns' }, [el('button', { class: 'btn', type: 'button', disabled: loading, text: loading ? 'กำลังโหลด…' : 'ดูเพิ่ม', on: { click: function () { load(true); } } })]));
  }

  function render() {
    const wrap = el('div');
    const shown = SECTIONS.filter(function (s) { return !s.hidden; });
    if (shown.length > 1) {
      wrap.appendChild(el('div', { class: 'seg', role: 'group' }, shown.map(function (s) {
        return el('button', { type: 'button', 'aria-pressed': String(s.id === section), text: s.label, on: { click: function () { section = s.id; K.render(); } } });
      })));
    }
    renderHistory(wrap);
    return wrap;
  }

  // Fresh data every time the tab is opened (something may have been used or bought since).
  K.tab({ id: 'history', icon: '📜', label: 'ประวัติ', render: render, onEnter: reset });
})();
