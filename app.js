const COLORS=['#2563eb','#16a34a','#dc2626','#d97706','#9333ea','#0891b2','#db2777','#65a30d','#ea580c','#7c3aed','#0d9488','#b45309','#475569','#1d4ed8','#15803d'];
const DEFAULT_DESCRIPTIONS=['Amazon Prime','Car Insurance','Cox Cable','Eating Out','Groceries','Mortgage','Netflix','Pharmacy','Subscriptions','Tithe','Transfer To Savings','Wedding','PIN'];
const seed=[['2026-07-02','Household','Transfer',3323.45,'inc'],['2026-07-02','Household','Subscriptions',20,'stv'],['2026-07-02','Household','Pharmacy',98,'hh'],['2026-07-02','Household','Amazon Prime',4.99,'stv'],['2026-07-02','Household',"Jayne's Salary",880.20,'inc'],['2026-07-02','Household','Car Insurance',237.08,'hh'],['2026-07-02','Household','Mortgage',1746.56,'hh'],['2026-07-03','Household','Eating Out',13.98,'hh'],['2026-07-03','Personal','PIN',104.37,'jyn'],['2026-07-03','Household','Eating Out',21.60,'hh'],['2026-07-03','Household','Subscriptions',8.99,'stv'],['2026-07-04','Household','Tithe',188,'hh'],['2026-07-05','Household',"Sophi's Wedding",27.52,'hh'],['2026-07-05','Household',"Sophi's Wedding",40.58,'hh'],['2026-07-05','Household',"Sophi's Wedding",54.10,'hh'],['2026-07-05','Household',"Sophi's Wedding",401.50,'hh'],['2026-07-06','Personal','Eating Out',6.76,'jyn'],['2026-07-06','Household','Transfer To Savings',100,'hh'],['2026-07-06','Household','Cox Cable',24.14,'hh'],['2026-07-06','Household','Groceries',3.57,'hh'],['2026-07-06','Household','Netflix',19.99,'hh']].map((x,i)=>({id:`seed-${i}`,date:x[0],category:x[1],description:x[2],hh:x[4]==='hh'?x[3]:0,jyn:x[4]==='jyn'?x[3]:0,stv:x[4]==='stv'?x[3]:0,inc:x[4]==='inc'?x[3]:0}));
'use strict';
const C = ExpenseCore;
const R = ExpenseRecovery;
let restorePreview = null;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rowExpenses = t => t.hh + t.stv + t.jyn;
const monthName = month => new Date(`${month}-02T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const fmtDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const monthPattern = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;
function readLocalMonth() {
  try {
    const saved = localStorage.getItem('expense-tracker-month');
    if (monthPattern.test(saved)) return saved;
  } catch { /* Transaction storage failures are handled below. */ }
  return null;
}
// Past months in storage/cloud (often July from an old shared copy) must not reopen after a full quit.
function resolveOpeningMonth(...candidates) {
  const today = C.localDate().slice(0, 7);
  for (const value of candidates) {
    if (typeof value === 'string' && monthPattern.test(value) && value >= today) return value;
  }
  return today;
}
let activeMonth = resolveOpeningMonth(readLocalMonth());
let store, cloud = null, cloudUser = null, cloudPoll = null, cloudChannel = null;
let editingCategory = null, editingDescription = null, editingSnapshot = null, showAll = false, descriptionFilter = '';
let syncMessage = 'Saved on this device', syncError = false;
let reviewSnapshot = null;
try {
  store = new ExpenseStore(localStorage, { transactions: seed, categories: ['Household', 'Personal'], descriptions: [...new Set([...DEFAULT_DESCRIPTIONS, ...seed.map(t => t.description)])] }, (message, error = false) => {
    syncMessage = message; syncError = error;
    renderSync();
  });
} catch (error) {
  $('#syncStatus').textContent = error.message;
  $('#syncStatus').classList.add('error');
  $$('button, input, select').forEach(el => el.disabled = true);
}
if (store) {
  activeMonth = resolveOpeningMonth(store.currentMonth, readLocalMonth());
  if (store.currentMonth !== activeMonth) {
    try { store.persistMonth(activeMonth); } catch { /* Viewing still works. */ }
  }
  try { localStorage.setItem('expense-tracker-month', activeMonth); } catch { /* Viewing still works. */ }
}
function state() { return store.state; }
function total(transactions) {
  return transactions.reduce((sum, t) => {
    for (const key of ['hh', 'stv', 'jyn', 'inc']) sum[key] += t[key];
    sum.expenses += rowExpenses(t); return sum;
  }, { hh: 0, stv: 0, jyn: 0, inc: 0, expenses: 0 });
}
function monthTransactions() { return C.search(state(), { month: activeMonth }); }
function commit(change) {
  try { store.commit(change); render(); void syncCloud(); return true; }
  catch (error) { alert(error.message); return false; }
}
function setMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '1900-01' || month > '2200-12') return;
  activeMonth = month; showAll = false;
  try { localStorage.setItem('expense-tracker-month', month); } catch { /* Viewing still works. */ }
  try { store.persistMonth(month); } catch { /* Viewing still works. */ }
  render();
  void syncCloud();
}
function render() {
  $('#monthButton').innerHTML = `${monthName(activeMonth)} <span>⌄</span>`;
  $('#monthInput').value = activeMonth;
  renderDashboard(); renderTransactions(); renderLists(); renderSync(); renderRecovery();
}
function renderDashboard() {
  const tx = monthTransactions(), sum = total(tx), balance = sum.inc - sum.expenses;
  $('#remainingTotal').textContent = money(balance);
  $('#remainingTotal').classList.toggle('negative-balance', balance < 0);
  $('#balanceLabel').textContent = balance < 0 ? 'Monthly balance' : 'Remaining';
  $('#totalIncome').textContent = money(sum.inc);
  $('#totalExpenses').textContent = money(sum.expenses);
  $('#spendingCaption').textContent = sum.inc > 0 ? `${Math.round(sum.expenses / sum.inc * 100)}% of income spent` : 'No income recorded';
  for (const [person, key] of [['household', 'hh'], ['steve', 'stv'], ['jayne', 'jyn']]) {
    $(`#${person}Total`).textContent = money(sum[key]);
    $(`#${person}Share`).textContent = sum.expenses > 0 ? `${(sum[key] / sum.expenses * 100).toFixed(1)}% of spending` : 'No spending yet';
  }
  $('#incomeRatios').innerHTML = [['Household', sum.hh], ['Steve', sum.stv], ['Jayne', sum.jyn], ['Total spending', sum.expenses]].map(([label, amount]) => `<div class="summary-row"><span>${label}</span><strong>${sum.inc > 0 ? `${(amount / sum.inc * 100).toFixed(1)}%` : '—'}</strong></div>`).join('') + (sum.inc <= 0 ? '<p class="helper">Add income to calculate these percentages.</p>' : '');
  const groups = new Map();
  for (const t of tx) if (rowExpenses(t)) groups.set(t.description, (groups.get(t.description) || 0) + rowExpenses(t));
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $('#categoryCount').textContent = `${sorted.length} description${sorted.length === 1 ? '' : 's'}`;
  $('#categoryList').innerHTML = (showAll ? sorted : sorted.slice(0, 5)).map(([name, amount]) => {
    const share = sum.expenses ? amount / sum.expenses * 100 : 0;
    return `<button class="spending-row" data-description-filter="${escapeHtml(name)}"><span class="spending-name">${escapeHtml(name)}</span><span class="spending-value">${money(amount)} <small>${share.toFixed(1)}%</small></span><span class="spending-track" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, share))}%"></span></span></button>`;
  }).join('') || '<p class="empty">No expenses this month. Use Add to record your first transaction.</p>';
  $('#viewAllCategories').classList.toggle('hidden', sorted.length <= 5);
  $('#viewAllCategories').textContent = showAll ? 'Show top five' : `View all ${sorted.length} descriptions`;
  $('#recentList').innerHTML = tx.slice(0, 5).map(t => `<button class="recent-row" data-edit="${escapeHtml(t.id)}"><span class="recent-copy"><strong>${escapeHtml(t.description)}</strong><span>${fmtDate(t.date)} · ${escapeHtml(t.category)}</span></span><span class="recent-amount">${amountHtml(t)}</span><span aria-hidden="true">›</span></button>`).join('') || '<p class="empty">No transactions this month.</p>';
}
function amountHtml(t) {
  const expense = rowExpenses(t);
  return `${expense ? `<span>${money(expense)} <small>spent</small></span>` : ''}${t.inc ? `<span class="positive">+${money(t.inc)} <small>income</small></span>` : ''}`;
}
function tokens(t) {
  return [['Household', 'hh'], ['Steve', 'stv'], ['Jayne', 'jyn']].filter(([, key]) => t[key] > 0).map(([label, key]) => `<span class="amount-token ${key}">${label} ${money(t[key])}</span>`).join('');
}
function searchOptions() {
  return { month: activeMonth, query: $('#transactionSearch').value, scope: $('#searchScope').value, person: $('#personFilter').value, category: $('#categoryFilter').value, description: descriptionFilter, sort: $('#transactionSort').value };
}
function renderTransactions() {
  const selected = $('#categoryFilter').value;
  const categories = [...new Set([...state().categories, ...state().transactions.map(t => t.category)])].sort();
  $('#categoryFilter').innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('#categoryFilter').value = categories.includes(selected) ? selected : '';
  const options = searchOptions(), tx = C.search(state(), options), sum = total(tx);
  $('#transactionTitle').textContent = options.scope === 'all' ? 'All transactions' : monthName(activeMonth);
  $('#descriptionFilterLabel').textContent = descriptionFilter ? `Description: ${descriptionFilter}` : '';
  $('#searchSummary').textContent = `${tx.length} transaction${tx.length === 1 ? '' : 's'} · ${money(sum.expenses)} expenses · ${money(sum.inc)} income`;
  $('#transactionsList').innerHTML = tx.map(t => `<article class="transaction-row"><div class="transaction-meta"><strong>${escapeHtml(t.description)}</strong><span>${fmtDate(t.date)} · ${escapeHtml(t.category)}</span><div class="split-summary">${tokens(t)}</div></div><div class="transaction-right"><strong>${amountHtml(t)}</strong><div class="transaction-actions"><button class="mini-button" data-edit="${escapeHtml(t.id)}" aria-label="Edit ${escapeHtml(t.description)} on ${t.date}">Edit</button><button class="mini-button delete" data-delete="${escapeHtml(t.id)}" aria-label="Move ${escapeHtml(t.description)} on ${t.date} to Trash">Trash</button></div></div></article>`).join('') || '<p class="empty">No matching transactions. Try another search, choose All months, or clear the filters.</p>';
}
function resetFilters() {
  $('#transactionSearch').value = ''; $('#searchScope').value = 'month'; $('#personFilter').value = ''; $('#categoryFilter').value = ''; $('#transactionSort').value = 'newest'; descriptionFilter = '';
}
function showView(name) {
  $$('.tab').forEach(button => { button.classList.toggle('active', button.dataset.view === name); button.setAttribute('aria-current', button.dataset.view === name ? 'page' : 'false'); });
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function listUsage(field, name) { return state().transactions.filter(t => t[field] === name).length; }
function renderLists() {
  for (const [key, field, target] of [['categories', 'category', '#manageCategories'], ['descriptions', 'description', '#manageDescriptions']]) {
    $(target).innerHTML = state()[key].slice().sort((a, b) => a.localeCompare(b)).map(name => {
      const count = listUsage(field, name);
      return `<div class="manage-row"><div class="list-copy"><strong>${escapeHtml(name)}</strong><small>${count} transaction${count === 1 ? '' : 's'}</small></div><button class="mini-button" data-list-edit="${field}" data-name="${escapeHtml(name)}">Rename</button><button class="mini-button delete" data-list-delete="${field}" data-name="${escapeHtml(name)}" ${count ? 'disabled title="Used by transactions; rename instead"' : ''}>Delete</button></div>`;
    }).join('') || '<p class="empty">No items yet. Select Add to create one.</p>';
  }
}
function options(selector, items, selected) {
  const choices = [...new Set([...items, ...(selected ? [selected] : [])])].sort((a, b) => a.localeCompare(b));
  $(selector).innerHTML = '<option value="">Choose…</option>' + choices.map(name => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}${!items.includes(name) ? ' (previously used)' : ''}</option>`).join('');
}
function openTransaction(id) {
  const t = id ? state().transactions.find(t => t.id === id) : null;
  if (id && !t) { alert('This transaction was removed on another device.'); return; }
  editingSnapshot = t ? C.clone(t) : null;
  $('#transactionForm').reset(); $('#transactionId').value = t?.id || '';
  $('#formTitle').textContent = t ? 'Edit Transaction' : 'Add Transaction';
  $('#dateInput').value = t?.date || C.localDate();
  $('#entryDateNote').textContent = !t && !C.localDate().startsWith(activeMonth) ? `Date starts at today. You are viewing ${monthName(activeMonth)}; change the date to add an older entry.` : '';
  options('#categoryInput', state().categories, t?.category || '');
  options('#descriptionSelect', state().descriptions, t?.description || '');
  for (const [id, key] of [['householdInput', 'hh'], ['steveInput', 'stv'], ['jayneInput', 'jyn'], ['incomeInput', 'inc']]) $(`#${id}`).value = t?.[key] || '';
  $('#transactionDialog').showModal();
}
function openList(field, name = '') {
  const category = field === 'category';
  if (category) editingCategory = name || null; else editingDescription = name || null;
  const prefix = category ? 'category' : 'description';
  $(`#${prefix}Form`).reset(); $(`#${prefix}NameInput`).value = name;
  $(`#${prefix}DialogTitle`).textContent = `${name ? 'Rename' : 'Add'} ${category ? 'Category' : 'Description'}`;
  $(`#${prefix}SaveButton`).textContent = name ? 'Save' : 'Add'; $(`#${prefix}Dialog`).showModal();
}
function saveList(event, field) {
  event.preventDefault();
  const key = field === 'category' ? 'categories' : 'descriptions', old = field === 'category' ? editingCategory : editingDescription;
  const name = $(`#${field}NameInput`).value.trim();
  if (!name) return;
  const names = new Set([...state()[key], ...state().transactions.map(t => t[field])]);
  if ([...names].some(n => n.toLowerCase() === name.toLowerCase() && n !== old)) { alert('That name already exists or is used by a transaction.'); return; }
  if (old && !state()[key].includes(old)) { alert('This list changed on another device. Close and reopen the form.'); return; }
  const count = old ? listUsage(field, old) : 0;
  if (old && old !== name && count && !confirm(`Rename “${old}” to “${name}” in ${count} existing transaction${count === 1 ? '' : 's'}?`)) return;
  if (commit(s => { s[key] = old ? s[key].map(n => n === old ? name : n) : [...s[key], name]; if (old) s.transactions = s.transactions.map(t => t[field] === old ? { ...t, [field]: name } : t); })) $(`#${field}Dialog`).close();
}
function renderSync() {
  if (!store) return;
  const status = $('#syncStatus');
  status.textContent = cloudUser ? syncMessage : (store.record.dirty ? 'Changes saved on this device · Sign in to sync' : 'Saved on this device');
  if (cloudUser && syncMessage === 'Synced' && store.record.lastSynced) status.textContent = `Synced at ${new Date(store.record.lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  status.classList.toggle('error', syncError);
  status.title = store.record.lastSynced ? `Last successful sync: ${new Date(store.record.lastSynced).toLocaleString()}` : 'Not synced yet';
  $('#accountButton').textContent = cloudUser ? 'Sign Out' : 'Sign In';
  $('#syncButton').classList.toggle('hidden', !cloudUser);
  $('#syncButton').disabled = store.busy;
  $('#reviewSyncButton').classList.toggle('hidden', !store.review);
}
const backend = {
  async read(user) {
    const { data, error } = await cloud.from('expense_data').select('data,updated_at').eq('user_id', user).maybeSingle();
    if (error) throw error;
    return data;
  },
  async compareAndSwap(user, row, data) {
    const timestamp = new Date(Math.max(Date.now(), (Date.parse(row.updated_at) || 0) + 1)).toISOString();
    let request = cloud.from('expense_data').update({ data, updated_at: timestamp }).eq('user_id', user);
    request = row.updated_at == null ? request.is('updated_at', null) : request.eq('updated_at', row.updated_at);
    const { data: updated, error } = await request.select('updated_at');
    if (error) throw error;
    return !!updated?.length;
  }
};
async function syncCloud() {
  if (!store || !cloud) return;
  await store.sync(backend);
  activeMonth = resolveOpeningMonth(store.currentMonth, activeMonth);
  render();
}
function conflictValue(value) {
  if (!value) return 'Deleted';
  if (Array.isArray(value)) return value.join(', ') || 'Empty list';
  return `${value.date} · ${value.category} · ${value.description} · Household ${money(value.hh)}, Steve ${money(value.stv)}, Jayne ${money(value.jyn)}, Income ${money(value.inc)}`;
}
function reviewSync() {
  const review = store.review;
  if (!review) return;
  reviewSnapshot = review;
  $('#syncReviewContent').innerHTML = review.initial
    ? `<p>This device has ${state().transactions.length} transactions and the shared copy has ${review.remote.transactions.length}. They have not been linked with a common sync history yet.</p><label class="review-choice"><input type="radio" name="initial" value="merge" required /> Merge both copies and review any differences</label><label class="review-choice"><input type="radio" name="initial" value="remote" required /> Use the shared copy (save a local recovery copy first)</label>`
    : review.conflicts.map((conflict, i) => `<fieldset><legend>${escapeHtml(conflict.label)}</legend><label class="review-choice"><input type="radio" name="choice-${i}" value="local" required /> This device: ${escapeHtml(conflictValue(conflict.local))}</label><label class="review-choice"><input type="radio" name="choice-${i}" value="remote" required /> Shared: ${escapeHtml(conflictValue(conflict.remote))}</label></fieldset>`).join('');
  $('#syncReviewDialog').showModal();
}
async function establishSession(session) {
  const user = session?.user || null;
  if (cloudUser?.id === user?.id) return;
  if (cloudPoll) clearInterval(cloudPoll);
  if (cloudChannel) { cloud.removeChannel(cloudChannel); cloudChannel = null; }
  cloudUser = user;
  try { store.connect(user?.id || null); }
  catch (error) { syncMessage = error.message; syncError = true; renderSync(); return; }
  renderSync();
  if (!user) return;
  cloudPoll = setInterval(() => void syncCloud(), 20000);
  cloudChannel = cloud.channel(`expense-sync-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'expense_data', filter: `user_id=eq.${user.id}` }, () => void syncCloud()).subscribe();
  await syncCloud();
}
async function initCloud() {
  if (!window.supabase || typeof SUPABASE_URL === 'undefined') return;
  cloud = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } });
  cloud.auth.onAuthStateChange((_event, session) => { setTimeout(() => void establishSession(session), 0); });
  try {
    const { data, error } = await cloud.auth.getSession();
    if (error) throw error;
    await establishSession(data.session);
  } catch (error) { syncMessage = error.message; syncError = true; renderSync(); }
}
function authMessage(message, success = false) { $('#authMessage').textContent = message; $('#authMessage').classList.toggle('success', success); }
function closeMonthPicker() { $('#monthPicker').classList.add('hidden'); $('#monthButton').setAttribute('aria-expanded', 'false'); }
if (store) {
  $('#previousMonth').onclick = () => setMonth(C.shiftMonth(activeMonth, -1));
  $('#nextMonth').onclick = () => setMonth(C.shiftMonth(activeMonth, 1));
  $('#monthButton').onclick = () => { const hidden = $('#monthPicker').classList.toggle('hidden'); $('#monthButton').setAttribute('aria-expanded', String(!hidden)); if (!hidden) $('#monthInput').focus(); };
  $('#monthInput').onchange = event => setMonth(event.target.value);
  $('#thisMonthButton').onclick = () => { setMonth(C.localDate().slice(0, 7)); closeMonthPicker(); };
  $('#closeMonthPicker').onclick = closeMonthPicker;
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMonthPicker(); });
  $$('.tab').forEach(button => button.onclick = () => showView(button.dataset.view));
  $$('[data-go]').forEach(button => button.onclick = () => { resetFilters(); renderTransactions(); showView(button.dataset.go); });
  $('#addButton').onclick = () => openTransaction();
  $('#viewAllCategories').onclick = () => { showAll = !showAll; renderDashboard(); };
  $('#transactionSearch').oninput = renderTransactions;
  for (const id of ['searchScope', 'personFilter', 'categoryFilter', 'transactionSort']) $(`#${id}`).onchange = renderTransactions;
  $('#clearFilters').onclick = () => { resetFilters(); renderTransactions(); };
  $$('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  $('#addCategoryButton').onclick = () => openList('category');
  $('#addDescriptionButton').onclick = () => openList('description');
  $('#categoryForm').onsubmit = event => saveList(event, 'category');
  $('#descriptionForm').onsubmit = event => saveList(event, 'description');
  $('#transactionForm').onsubmit = event => {
    event.preventDefault();
    const id = $('#transactionId').value, current = id ? state().transactions.find(t => t.id === id) : null;
    if (id && !C.equal(current, editingSnapshot)) { alert('This transaction changed on another device. Close and reopen it to review the latest version before saving.'); return; }
    const item = { ...current, ...(!id ? { createdAt: new Date().toISOString() } : {}), id: id || crypto.randomUUID(), date: $('#dateInput').value, category: $('#categoryInput').value, description: $('#descriptionSelect').value, hh: Number($('#householdInput').value), stv: Number($('#steveInput').value), jyn: Number($('#jayneInput').value), inc: Number($('#incomeInput').value) };
    if (!item.date || !item.category || !item.description || rowExpenses(item) + item.inc <= 0 || ['hh', 'stv', 'jyn', 'inc'].some(k => !Number.isFinite(item[k]) || item[k] < 0)) { alert('Choose a date, category and description, and enter at least one positive amount.'); return; }
    if (commit(s => { if (id) s.transactions = s.transactions.map(t => t.id === id ? item : t); else s.transactions.push(item); })) {
      $('#transactionDialog').close(); resetFilters(); setMonth(item.date.slice(0, 7));
    }
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    const d = button.dataset;
    if (d.person || d.descriptionFilter) { resetFilters(); if (d.person) $('#personFilter').value = d.person; else descriptionFilter = d.descriptionFilter; renderTransactions(); showView('transactions'); }
    if (d.edit) openTransaction(d.edit);
    if (d.delete) {
      const t = state().transactions.find(t => t.id === d.delete);
      if (t && commit(s => R.remove(s, d.delete))) { $('#recoveryStatus').textContent = `Moved “${t.description}” to Trash. You can restore it in Recovery.`; }
    }
    if (d.listEdit) openList(d.listEdit, d.name);
    if (d.listDelete) {
      const count = listUsage(d.listDelete, d.name);
      if (count) { alert(`This item is used by ${count} transactions. Rename it instead.`); return; }
      if (confirm(`Delete unused ${d.listDelete} “${d.name}”?`)) commit(s => { const key = d.listDelete === 'category' ? 'categories' : 'descriptions'; s[key] = s[key].filter(name => name !== d.name); });
    }
  });
  $('#syncButton').onclick = () => void syncCloud();
  $('#reviewSyncButton').onclick = reviewSync;
  $('#syncReviewForm').onsubmit = async event => {
    event.preventDefault();
    if (!store.review) { $('#syncReviewDialog').close(); return; }
    if (store.review !== reviewSnapshot) { $('#syncReviewDialog').close(); reviewSync(); return; }
    const data = new FormData(event.target), choices = {};
    if (store.review.initial) choices.initial = data.get('initial');
    else store.review.conflicts.forEach((conflict, i) => choices[conflict.key] = data.get(`choice-${i}`));
    try { store.resolve(choices); $('#syncReviewDialog').close(); render(); await syncCloud(); if (store.review) reviewSync(); }
    catch (error) { alert(error.message); }
  };
  $('#accountButton').onclick = async () => {
    if (!cloud) { alert('Sign-in is unavailable while offline. Changes remain on this device.'); return; }
    if (cloudUser) {
      if (store.record.dirty && !confirm('Pending changes will remain on this device for this account. Sign out?')) return;
      const { error } = await cloud.auth.signOut(); if (error) alert(error.message); return;
    }
    authMessage(''); $('#authForm').reset(); $('#authDialog').showModal();
  };
  $('#authForm').onsubmit = async event => {
    event.preventDefault(); authMessage('Signing in…', true);
    try { const { error } = await cloud.auth.signInWithPassword({ email: $('#authEmail').value.trim(), password: $('#authPassword').value }); if (error) throw error; $('#authDialog').close(); }
    catch (error) { authMessage(error.message); }
  };
  $('#createAccountButton').onclick = async () => {
    if (!$('#authForm').reportValidity()) return;
    authMessage('Creating account…', true);
    try { const { data, error } = await cloud.auth.signUp({ email: $('#authEmail').value.trim(), password: $('#authPassword').value }); if (error) throw error; authMessage(data.session ? 'Account created. Initialize shared data in the Mac app.' : 'Check your email to confirm the account, then sign in.', true); }
    catch (error) { authMessage(error.message); }
  };
  window.addEventListener('focus', () => void syncCloud());
  window.addEventListener('online', () => void syncCloud());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncCloud(); });
  window.addEventListener('storage', event => {
    if (event.key === store.key) { syncMessage = 'Another tab changed the data. Reload before editing or syncing.'; syncError = true; renderSync(); }
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // An older shell (for example v19) can keep serving until the new worker takes over.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {});
  }
  render(); showView('dashboard'); void initCloud();
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderRecovery() {
  $('#trashCount').textContent = `${(state().trash || []).length} ${(state().trash || []).length === 1 ? 'entry' : 'entries'}`;
  $('#trashList').innerHTML = (state().trash || []).slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)).map(item => `<div class="recovery-row"><div><strong>${escapeHtml(item.transaction.description)}</strong><small>${fmtDate(item.transaction.date)} · ${money(rowExpenses(item.transaction))} expenses · ${money(item.transaction.inc)} income</small><small>Deleted ${new Date(item.deletedAt).toLocaleString()}</small></div><button class="secondary-button" data-restore-trash="${escapeHtml(item.id)}">Restore</button></div>`).join('') || '<p class="empty">Trash is empty.</p>';
  try {
    $('#recoveryCopies').innerHTML = store.backups().map(copy => `<div class="recovery-row"><div><strong>${escapeHtml(copy.label)}</strong><small>${escapeHtml(new Date(copy.createdAt).toLocaleString())}</small></div><div class="recovery-actions"><button class="text-button" data-download-copy="${escapeHtml(copy.id)}">Download</button><button class="text-button" data-preview-copy="${escapeHtml(copy.id)}">Preview restore</button></div></div>`).join('') || '<p class="empty">No recovery copies yet.</p>';
  } catch (error) { $('#recoveryCopies').textContent = error.message; }
}
function previewRestore(imported, label) {
  const sums = total(imported.state.transactions);
  restorePreview = { ...imported, raw: store.raw };
  $('#restoreForm').reset();
  $('#restoreSummary').innerHTML = `<p><strong>${escapeHtml(label)}</strong></p><p>${imported.state.transactions.length} active transaction${imported.state.transactions.length === 1 ? '' : 's'} · ${(imported.state.trash || []).length} in Trash<br>${money(sums.expenses)} expenses · ${money(sums.inc)} income</p><p>Currently on this device: ${state().transactions.length} active transaction${state().transactions.length === 1 ? '' : 's'} and ${(state().trash || []).length} in Trash.</p>`;
  $('#restoreDialog').showModal();
}
if (store) {
  $('#downloadBackup').onclick = () => {
    try { downloadText(`expense-backup-${C.localDate()}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json'); }
    catch (error) { alert(error.message); }
  };
  $('#exportCsv').onclick = () => downloadText(`expense-transactions-${C.localDate()}.csv`, R.csv(C.search(state(), { scope: 'all', sort: 'oldest' })), 'text/csv;charset=utf-8');
  $('#chooseBackup').onclick = () => { $('#backupFile').value = ''; $('#backupFile').click(); };
  $('#backupFile').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.'); previewRestore(R.parse(await file.text()), file.name); }
    catch (error) { $('#recoveryStatus').textContent = `Backup not loaded: ${error.message}`; }
  };
  $('#restoreForm').onsubmit = async event => {
    event.preventDefault(); if (!restorePreview) return;
    const mode = new FormData(event.target).get('restoreMode');
    if (mode === 'replace' && !confirm('Replace all current transactions, lists, and Trash with this backup? A recovery copy will be kept, and the changes will sync to your account.')) return;
    try {
      store.restoreBackup(restorePreview.state, mode, restorePreview.raw);
      $('#restoreDialog').close(); restorePreview = null; render();
      $('#recoveryStatus').textContent = 'Restore saved on this device. Your previous data is available under Recovery copies.';
      await syncCloud();
    } catch (error) { alert(error.message); }
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    const d = button.dataset;
    if (d.restoreTrash) commit(s => R.undelete(s, d.restoreTrash));
    if (d.downloadCopy || d.previewCopy) {
      try {
        const copy = store.backups().find(c => c.id === (d.downloadCopy || d.previewCopy));
        if (!copy) throw new Error('This recovery copy is no longer available.');
        if (d.downloadCopy) downloadText(`expense-recovery-${copy.id}.json`, JSON.stringify(copy.backup, null, 2), 'application/json');
        else previewRestore(R.parse(JSON.stringify(copy.backup)), copy.label);
      } catch (error) { alert(error.message); }
    }
  });
}
