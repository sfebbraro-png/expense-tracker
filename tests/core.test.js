const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const Store = require('../sync.js');
const tx = (id, amount = 10, description = 'Groceries', date = '2026-07-02') => ({ id, date, category: 'Household', description, hh: amount, jyn: 0, stv: 0, inc: 0 });
const state = (...transactions) => ({ transactions, categories: ['Household', 'Personal'], descriptions: ['Groceries', 'Unused'] });
function storage() { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) }; }
function backend(initial) {
  let revision = 1, row = { data: C.toCloud(initial), updated_at: '1' };
  return {
    writes: 0,
    get row() { return C.clone(row); },
    change(next) { row = { data: C.toCloud(next, row.data), updated_at: String(++revision) }; },
    async read() { return C.clone(row); },
    async compareAndSwap(user, previous, data) { if (previous.updated_at !== row.updated_at) return false; this.writes++; row = { data: C.clone(data), updated_at: String(++revision) }; return true; }
  };
}
async function connected(initial = state(tx('a'))) {
  const memory = storage(), shared = backend(initial), store = new Store(memory, state());
  store.connect('user'); await store.sync(shared); return { memory, shared, store };
}
test('local calendar handles year boundaries without UTC conversion', () => {
  assert.equal(C.localDate(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(C.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(C.shiftMonth('2026-12', 1), '2027-01');
});
test('newest first, all-month search, exact filters, and oldest order', () => {
  const s = state(tx('a', 10, 'Groceries', '2026-07-02'), tx('b', 25, 'Eating Out', '2026-08-03'), tx('c', 5, 'Groceries', '2026-07-06'));
  assert.deepEqual(C.search(s, { month: '2026-07' }).map(t => t.id), ['c', 'a']);
  assert.deepEqual(C.search(s, { month: '2026-07', scope: 'all', query: 'eating 25' }).map(t => t.id), ['b']);
  assert.deepEqual(C.search(s, { month: '2026-07', person: 'stv' }), []);
  assert.deepEqual(C.search(s, { month: '2026-07', sort: 'oldest', description: 'Groceries' }).map(t => t.id), ['a', 'c']);
});
test('cloud round-trip retains unknown metadata and empty months', () => {
  const template = { custom: 'keep', currentMonth: '2026-07', months: { '2026-07': { budget: 80, txs: [] } } };
  const s = state({ ...tx('a'), note: 'keep note' });
  const encoded = C.toCloud(s, template);
  assert.equal(encoded.custom, 'keep'); assert.equal(encoded.months['2026-07'].budget, 80);
  assert.equal(C.fromCloud(encoded).transactions[0].note, 'keep note');
  assert.equal(C.toCloud(state(), encoded).months['2026-07'].txs.length, 0);
});
test('merge combines independent edits and preserves remote deletion', () => {
  const base = state(tx('a'), tx('b'), tx('c'));
  const local = state(tx('a', 20), tx('b'), tx('c'));
  const remote = state(tx('a'), tx('b', 30));
  const merged = C.merge(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.state.transactions.map(t => [t.id, t.hh]), [['a', 20], ['b', 30]]);
});
test('same-record edit/delete conflicts require an explicit selection', () => {
  const base = state(tx('a')), local = state(tx('a', 20)), remote = state();
  assert.equal(C.merge(base, local, remote).conflicts.length, 1);
  assert.equal(C.merge(base, local, remote, { 'transaction:a': 'remote' }).state.transactions.length, 0);
});
test('concurrent list edits pause instead of resurrecting deleted names', () => {
  const base = state(), local = { ...base, descriptions: ['Groceries'] }, remote = { ...base, descriptions: ['Groceries', 'Unused', 'Rent'] };
  assert.equal(C.merge(base, local, remote).conflicts[0].key, 'descriptions');
});
test('deleting an unused description survives reload without readding defaults', async () => {
  const { store, memory } = await connected();
  store.commit(s => s.descriptions = ['Groceries']);
  const reopened = new Store(memory, state());
  assert.deepEqual(reopened.state.descriptions, ['Groceries']); assert.equal(reopened.record.dirty, true);
});
test('offline changes survive reload and retry without losing remote edits', async () => {
  const { store, memory, shared } = await connected(state(tx('a'), tx('b')));
  store.commit(s => s.transactions[0].hh = 20);
  await store.sync({ read: async () => { throw new Error('Offline'); } });
  assert.equal(store.record.dirty, true);
  shared.change(state(tx('a'), tx('b', 40)));
  const reopened = new Store(memory, state()); reopened.connect('user'); await reopened.sync(shared);
  assert.deepEqual(reopened.state.transactions.map(t => t.hh), [20, 40]); assert.equal(reopened.record.dirty, false);
});
test('compare-and-swap retries when another device wins the race', async () => {
  const { store, shared } = await connected(state(tx('a'), tx('b')));
  store.commit(s => s.transactions[0].hh = 20);
  const cas = shared.compareAndSwap.bind(shared); let raced = false;
  shared.compareAndSwap = async (...args) => { if (!raced) { raced = true; shared.change(state(tx('a'), tx('b', 50))); } return cas(...args); };
  await store.sync(shared);
  assert.deepEqual(C.fromCloud(shared.row.data).transactions.map(t => t.hh), [20, 50]);
});
test('edits made during a pending upload get a second save', async () => {
  const { store, shared } = await connected();
  store.commit(s => s.transactions[0].hh = 20);
  const cas = shared.compareAndSwap.bind(shared); let changed = false;
  shared.compareAndSwap = async (...args) => { if (!changed) { changed = true; store.commit(s => s.transactions.push(tx('b', 99))); } return cas(...args); };
  await store.sync(shared);
  assert.equal(C.fromCloud(shared.row.data).transactions.length, 2); assert.equal(store.record.dirty, false); assert.equal(shared.writes, 2);
});
test('same-record conflicts never write until reviewed, then retain new remote additions', async () => {
  const { store, shared, memory } = await connected();
  store.commit(s => s.transactions[0].hh = 20); shared.change(state(tx('a', 30)));
  await store.sync(shared); assert.equal(shared.writes, 0); assert.equal(store.review.conflicts.length, 1);
  store.resolve({ 'transaction:a': 'local' });
  shared.change(state(tx('a', 30), tx('b')));
  await store.sync(shared);
  assert.equal(store.state.transactions.length, 2); assert.equal(store.state.transactions[0].hh, 20);
  assert.ok(memory.getItem('expense-tracker-before-sync-review'));
});
test('first upgrade sync requires review before replacing existing local data', async () => {
  const memory = storage(); memory.setItem('expense-tracker-data', JSON.stringify({ ...state(tx('local')), version: 2 }));
  const store = new Store(memory, state()); store.connect('user'); const shared = backend(state(tx('remote')));
  await store.sync(shared); assert.ok(store.review.initial); assert.equal(shared.writes, 0); assert.equal(store.state.transactions[0].id, 'local');
  store.resolve({ initial: 'merge' }); await store.sync(shared);
  assert.equal(store.state.transactions.length, 2);
});
test('first-sync shared choice keeps local recovery copy', async () => {
  const memory = storage(); memory.setItem('expense-tracker-data', JSON.stringify({ ...state(tx('local')), version: 2 }));
  const store = new Store(memory, state()); store.connect('user'); const shared = backend(state(tx('remote')));
  await store.sync(shared); store.resolve({ initial: 'remote' }); await store.sync(shared);
  assert.equal(store.state.transactions[0].id, 'remote'); assert.equal(shared.writes, 0);
  assert.equal(JSON.parse(memory.getItem('expense-tracker-before-sync-review')).state.transactions[0].id, 'local');
});
test('stale tabs cannot silently overwrite newer local changes', async () => {
  const { store, memory } = await connected(); const second = new Store(memory, state());
  store.commit(s => s.transactions[0].hh = 77);
  assert.throws(() => second.commit(s => s.transactions[0].hh = 88), /Another tab/);
  assert.equal(JSON.parse(memory.getItem('expense-tracker-data')).transactions[0].hh, 77);
});
test('storage failure rolls back a proposed edit', async () => {
  const { store, memory } = await connected(); memory.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => store.commit(s => s.transactions[0].hh = 88), /Quota/);
  assert.equal(store.state.transactions[0].hh, 10);
});
test('late responses after signout never replace local data', async () => {
  const { store } = await connected();
  let release; const reading = new Promise(resolve => release = resolve);
  const pending = store.sync({ read: () => reading }); store.connect(null);
  release({ data: C.toCloud(state(tx('unexpected'))), updated_at: '2' }); await pending;
  assert.equal(store.state.transactions[0].id, 'a');
});
test('pending account data cannot be uploaded to another account', async () => {
  const { store, shared } = await connected(); store.commit(s => s.transactions[0].hh = 88);
  assert.throws(() => store.connect('other-user'), /another account/);
  await store.sync(shared); assert.equal(shared.writes, 0);
});
test('invalid shared data and duplicate IDs cannot replace saved state', async () => {
  const { store } = await connected();
  await store.sync({ read: async () => ({ data: { months: { '2026-07': { txs: [tx('a'), tx('a')] } } } }) });
  assert.equal(store.state.transactions.length, 1);
  assert.throws(() => new Store({ getItem: () => '{broken' }, state()));
});
test('uncertain write response is safely reconciled on retry', async () => {
  const { store, shared } = await connected(); store.commit(s => s.transactions[0].hh = 88);
  const cas = shared.compareAndSwap.bind(shared);
  shared.compareAndSwap = async (...args) => { await cas(...args); throw new Error('Response lost'); };
  await store.sync(shared); assert.equal(store.record.dirty, true);
  await store.sync(shared); assert.equal(store.record.dirty, false); assert.equal(shared.writes, 1);
});
test('new entries lead on the same date regardless of random IDs', () => {
  const s = state(tx('z-old'), { ...tx('a-new'), createdAt: '2026-07-02T14:00:00Z' });
  assert.deepEqual(C.search(s, { month: '2026-07' }).map(t => t.id), ['a-new', 'z-old']);
  assert.deepEqual(C.search(s, { month: '2026-07', sort: 'oldest' }).map(t => t.id), ['z-old', 'a-new']);
});
test('an offline edit made after login is bound to that account', () => {
  const store = new Store(storage(), state(tx('a'))); store.connect('user');
  store.commit(s => s.transactions[0].hh = 20);
  assert.equal(store.record.owner, 'user');
  assert.throws(() => store.connect('someone-else'), /another account/);
});
test('legacy category-as-description lists are preserved during migration', () => {
  const memory = storage(); memory.setItem('expense-tracker-data', JSON.stringify({ categories: ['Legacy unused name'], transactions: [{ id: 'old', date: '2026-07-01', description: 'Groceries', type: 'expense', person: 'Steve', amount: 5 }] }));
  const store = new Store(memory, state());
  assert.ok(store.state.descriptions.includes('Legacy unused name'));
  assert.equal(store.state.transactions[0].stv, 5);
  assert.equal(store.state.transactions[0].category, 'Personal');
});
test('malformed amounts and impossible dates are rejected without coercion', () => {
  assert.throws(() => C.fromCloud({ cats: [], descs: [], months: { m: { txs: [{ ...tx('bad'), hh: 'not a number' }] } } }), /amount/);
  assert.throws(() => C.validate(state(tx('bad', 10, 'Groceries', '2026-02-30'))), /Invalid/);
});
