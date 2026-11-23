// Run: node tests/uses-item.test.js  (no network). Loads views-home.js with a stub KAWO and checks the 🍳 filter.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const K = { el: function () { return {}; }, tab: function () {}, S: {}, go: function () {} };
const sandbox = { window: { KAWO: K }, document: {}, console: console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'views-home.js'), 'utf8'), sandbox);
assert.strictEqual(typeof K.usesItem, 'function', 'K.usesItem is exposed');
// Server sends only the first in-stock alternative as the slot name; the full list is in r.edit.
const mama = { main: [{ name: 'ผักกาดขาว', label: 'ผักกาดขาว', have: true }, { name: 'มาม่า', label: 'มาม่า', have: true }], opt: [],
  edit: { main: [['กวางตุ้ง', 'ผักกาดขาว', 'คะน้า'], ['มาม่า']], opt: [], seas: [] } };
assert.ok(K.usesItem(mama, 'กวางตุ้ง'), 'menu with alternative กวางตุ้ง should match');
assert.ok(K.usesItem(mama, 'ผักกาดขาว'), 'in-stock alternative still matches');
assert.ok(!K.usesItem(mama, 'หมู'), 'unrelated item does not match');
const optOnly = { main: [], opt: [{ name: 'ไข่', label: 'ไข่' }], edit: { main: [], opt: [['ไข่เป็ด', 'ไข่']] } };
assert.ok(K.usesItem(optOnly, 'ไข่เป็ด'), 'optional alternatives match too');
console.log('ok');
