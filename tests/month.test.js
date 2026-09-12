const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('selecting September survives closing and reopening the app without changing financial data', () => {
  const data = JSON.stringify({ version: 2, transactions: [], categories: ['Household'], descriptions: [] });
  const items = new Map([['expense-tracker-data', data], ['expense-tracker-month', '2026-07']]);
  const first = openApp(items);
  assert.equal(first('#monthInput').value, '2026-07');
  first('#monthInput').onchange({ target: { value: '2026-09' } });
  const reopened = openApp(items);
  assert.equal(reopened('#monthInput').value, '2026-09');
  reopened('#nextMonth').onclick();
  assert.equal(openApp(items)('#monthInput').value, '2026-10');
  assert.equal(items.get('expense-tracker-data'), data);
});
