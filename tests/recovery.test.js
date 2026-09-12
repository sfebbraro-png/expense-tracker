const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js'), R = require('../recovery.js'), Store = require('../sync.js');
const tx = (id, description = 'Groceries') => ({ id, date: '2026-09-01', category: 'Household', description, hh: 21.5, jyn: 0, stv: 0, inc: 0 });
const doc = (...transactions) => ({ transactions, categories: ['Household'], descriptions: ['Groceries'], trash: [] });
const memory = () => { const items = new Map(); return { getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) }; };
test('trash excludes deleted entries from totals and restores original identity', () => {
  const s = doc(tx('a')); R.remove(s, 'a'); assert.equal(s.transactions.length, 0); assert.equal(s.trash.length, 1);
  R.undelete(s, 'a'); assert.deepEqual(s.transactions[0], tx('a')); assert.equal(s.trash.length, 0);
});
test('trash survives disk reload and shared round-trip', () => {
  const storage = memory(), store = new Store(storage, doc(tx('a')));
  store.commit(s => R.remove(s, 'a'));
  const reopened = new Store(storage, doc()); assert.equal(reopened.state.trash.length, 1);
  assert.deepEqual(C.fromCloud(C.toCloud(reopened.state)), reopened.state);
});
test('independent deletion and edit merge without losing archived transaction', () => {
  const base = doc(tx('a'), tx('b')), local = C.clone(base), remote = C.clone(base);
  R.remove(local, 'a'); remote.transactions[1].hh = 50;
  const merged = C.merge(base, local, remote);
  assert.equal(merged.conflicts.length, 0); assert.equal(merged.state.trash[0].id, 'a'); assert.equal(merged.state.transactions[0].hh, 50);
});
test('edit versus delete remains a conflict and active choice clears stale trash', () => {
  const base = doc(tx('a')), local = C.clone(base), remote = C.clone(base); R.remove(local, 'a'); remote.transactions[0].hh = 50;
  assert.equal(C.merge(base, local, remote).conflicts.length, 1);
  const merged = C.merge(base, local, remote, { 'transaction:a': 'remote' }); assert.equal(merged.state.trash.length, 0); assert.equal(merged.state.transactions[0].hh, 50);
});
test('restoring an entry syncs its removal from trash', () => {
  const base = doc(tx('a')); R.remove(base, 'a'); const local = C.clone(base), remote = C.clone(base); R.undelete(local, 'a');
  const merged = C.merge(base, local, remote); assert.equal(merged.state.transactions.length, 1); assert.equal(merged.state.trash.length, 0);
});
test('CSV escapes quotes/newlines and neutralizes spreadsheet formulas', () => {
  const csv = R.csv([tx('a', '=SUM(1,2)'), tx('b', 'Store "quoted"\nline')]);
  assert.ok(csv.includes('"\'=SUM(1,2)"')); assert.ok(csv.includes('"Store ""quoted""\nline"')); assert.ok(csv.includes('21.50,0.00,0.00,0.00'));
});
test('backup format is account-free and round-trips active entries and trash', () => {
  const s = doc(tx('a'), tx('b')); R.remove(s, 'b'); const exported = R.backup(s);
  assert.equal(exported.format, 'expense-tracker-backup'); assert.equal(exported.data.trash[0].transaction.cat, 'Household');
  assert.deepEqual(R.parse(JSON.stringify(exported)).state, s); assert.equal(exported.data._sync, undefined);
});
test('merge restore respects existing versions and previously deleted IDs', () => {
  const current = doc(tx('a'), tx('b')); R.remove(current, 'b'); current.transactions[0].hh = 99;
  const restored = R.restore(current, doc(tx('a'), tx('b'), tx('c')), 'merge');
  assert.deepEqual(restored.transactions.map(t => t.id), ['a', 'c']); assert.equal(restored.transactions[0].hh, 99); assert.equal(restored.trash[0].id, 'b');
});
test('replace restore creates recoverable history before replacing data', () => {
  const storage = memory(), store = new Store(storage, doc(tx('original')));
  store.restoreBackup(doc(tx('replacement')), 'replace', store.raw);
  assert.equal(store.state.transactions[0].id, 'replacement');
  assert.equal(R.parse(JSON.stringify(store.backups()[0].backup)).state.transactions[0].id, 'original');
  assert.equal(store.record.dirty, true);
});
test('stale preview and failed recovery snapshot prevent restore', () => {
  const storage = memory(), store = new Store(storage, doc(tx('a'))), snapshot = store.raw;
  store.commit(s => s.transactions[0].hh = 99);
  assert.throws(() => store.restoreBackup(doc(tx('b')), 'replace', snapshot), /Data changed/);
  storage.setItem = () => { throw Error('Storage full'); };
  assert.throws(() => store.restoreBackup(doc(tx('b')), 'replace', store.raw), /Storage full/);
  assert.equal(store.state.transactions[0].id, 'a');
});
test('invalid and unsupported backups cannot mutate current data', () => {
  assert.throws(() => R.parse('{broken'));
  assert.throws(() => R.parse(JSON.stringify({ format: 'expense-tracker-backup', version: 99, data: {} })), /not supported/);
  const bad = R.backup(doc(tx('a'))); bad.data.trash = [{ id: 'a', transaction: bad.data.months['2026-09'].txs[0], deletedAt: '2026-09-02T00:00:00Z' }];
  assert.throws(() => R.parse(JSON.stringify(bad)), /duplicate/);
});
