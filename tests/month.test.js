const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');
const ExpenseStore = require('../sync.js');

function openApp(items) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        value: '', dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {}, focus() {}
      });
      return elements.get(selector);
    },
    querySelectorAll() { return []; }, addEventListener() {}
  };
  const context = vm.createContext({ document, navigator: {},
    window: { addEventListener() {}, scrollTo() {} },
    localStorage: { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) },
    alert(message) { throw new Error(message); }
  });
  for (const file of ['core.js', 'recovery.js', 'sync.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return document.querySelector;
}

test('selecting a current or future month survives closing and reopening without changing financial data', () => {
  const today = C.localDate().slice(0, 7);
  const later = C.shiftMonth(today, 1);
  const data = JSON.stringify({ version: 2, transactions: [], categories: ['Household'], descriptions: [] });
  const items = new Map([['expense-tracker-data', data], ['expense-tracker-month', today]]);
  const first = openApp(items);
  assert.equal(first('#monthInput').value, today);
  first('#monthInput').onchange({ target: { value: later } });
  assert.equal(items.get('expense-tracker-month'), later);
  assert.equal(JSON.parse(items.get('expense-tracker-data')).currentMonth, later);
  const reopened = openApp(items);
  assert.equal(reopened('#monthInput').value, later);
  reopened('#nextMonth').onclick();
  assert.equal(openApp(items)('#monthInput').value, C.shiftMonth(later, 1));
  assert.equal(JSON.parse(items.get('expense-tracker-data')).transactions.length, 0);
});

test('a full quit does not reopen on a stale past month such as July', () => {
  const today = C.localDate().slice(0, 7);
  const data = JSON.stringify({
    version: 2, currentMonth: '2026-07', transactions: [], categories: ['Household'], descriptions: []
  });
  const items = new Map([['expense-tracker-data', data], ['expense-tracker-month', '2026-07']]);
  assert.equal(openApp(items)('#monthInput').value, today);
  assert.equal(JSON.parse(items.get('expense-tracker-data')).currentMonth, today);
});

test('viewing month is restored from saved data when it is still current or future', () => {
  const today = C.localDate().slice(0, 7);
  const data = JSON.stringify({
    version: 2, currentMonth: today, transactions: [], categories: ['Household'], descriptions: []
  });
  const items = new Map([['expense-tracker-data', data]]);
  assert.equal(openApp(items)('#monthInput').value, today);
});

test('sync keeps the phone on its selected month and uploads that month with shared data', async () => {
  const today = C.localDate().slice(0, 7);
  const items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  const store = new ExpenseStore(storage, { transactions: [], categories: ['Household'], descriptions: [] });
  store.connect('user');
  store.record.base = C.empty();
  store.persistMonth(today);
  let written = null;
  await store.sync({
    async read() {
      return { data: { cats: ['Household'], descs: [], currentMonth: '2026-07', months: {} }, updated_at: '1' };
    },
    async compareAndSwap(_user, _row, data) { written = data; return true; }
  });
  assert.equal(store.currentMonth, today);
  assert.equal(written.currentMonth, today);
  assert.equal(JSON.parse(items.get('expense-tracker-data')).currentMonth, today);
});

test('toCloud records the active viewing month without dropping other template fields', () => {
  const encoded = C.toCloud({ transactions: [], categories: ['Household'], descriptions: [] }, {
    custom: 'keep', currentMonth: '2026-07', months: { '2026-07': { budget: 80, txs: [] } }
  }, '2026-09');
  assert.equal(encoded.custom, 'keep');
  assert.equal(encoded.currentMonth, '2026-09');
  assert.equal(encoded.months['2026-07'].budget, 80);
});
