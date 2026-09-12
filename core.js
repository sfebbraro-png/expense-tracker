(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({ transactions: [], categories: [], descriptions: [] });
  function stable(value) {
    if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(stable(v))));
    if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))])));
    return JSON.stringify(value ?? null);
  }
  const equal = (a, b) => stable(a) === stable(b);
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function shiftMonth(month, offset) {
    const [year, m] = month.split('-').map(Number);
    return localDate(new Date(year, m - 1 + offset, 1)).slice(0, 7);
  }
  function normalize(t) {
    const result = { ...t, category: t.category ?? t.cat ?? 'Household', description: t.description ?? t.desc ?? '' };
    delete result.cat; delete result.desc;
    for (const key of ['hh', 'jyn', 'stv', 'inc']) {
      result[key] = Number(t[key] ?? 0);
      if (!Number.isFinite(result[key])) throw new Error('A saved amount is invalid. The original data was not replaced.');
    }
    if (!('hh' in t) && 'amount' in t) {
      const key = t.type === 'income' ? 'inc' : ({ Household: 'hh', Steve: 'stv', Jayne: 'jyn' })[t.person];
      if (key) result[key] = Number(t.amount);
      result.category = ['Steve', 'Jayne'].includes(t.person) ? 'Personal' : 'Household';
    }
    return result;
  }
  function validate(state) {
    const ids = new Set();
    for (const t of state.transactions) {
      if (!t.id || typeof t.id !== 'string' || ids.has(t.id) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') || localDate(new Date(`${t.date}T12:00:00`)) !== t.date || !t.category || !t.description) throw new Error('Invalid or duplicate transaction. The saved copy was not replaced.');
      ids.add(t.id);
      for (const key of ['hh', 'jyn', 'stv', 'inc']) if (!Number.isFinite(t[key])) throw new Error('Invalid transaction amount.');
    }
    for (const key of ['categories', 'descriptions']) if (!Array.isArray(state[key]) || state[key].some(v => typeof v !== 'string' || !v.trim())) throw new Error('Invalid saved list.');
    if (state.trash !== undefined) {
      if (!Array.isArray(state.trash)) throw new Error('Invalid trash data.');
      const archived = new Set();
      for (const item of state.trash) {
        if (!item || item.id !== item.transaction?.id || archived.has(item.id) || ids.has(item.id) || !Number.isFinite(Date.parse(item.deletedAt))) throw new Error('Invalid or duplicate trash entry.');
        validate({ transactions: [item.transaction], categories: [], descriptions: [] });
        archived.add(item.id);
      }
    }
    return state;
  }
  function fromCloud(data) {
    if (!data || !data.months || typeof data.months !== 'object') throw new Error('Shared data has an unrecognized format. Nothing was replaced.');
    const transactions = Object.values(data.months).flatMap(month => {
      if (!Array.isArray(month.txs)) throw new Error('Shared transactions have an unrecognized format.');
      return month.txs.map(normalize);
    });
    const state = { transactions, categories: data.cats ?? ['Household', 'Personal'], descriptions: data.descs ?? [...new Set(transactions.map(t => t.description))] };
    if (data.trash !== undefined) {
      if (!Array.isArray(data.trash)) throw new Error('Invalid shared trash.');
      state.trash = data.trash.map(item => ({ ...item, transaction: normalize(item.transaction) }));
    }
    return validate(state);
  }
  function toCloud(state, template = {}, currentMonth = template.currentMonth) {
    const result = clone(template);
    if (typeof currentMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(currentMonth)) result.currentMonth = currentMonth;
    result.cats = state.categories; result.descs = state.descriptions;
    if (state.trash !== undefined || template.trash !== undefined) result.trash = (state.trash || []).map(item => {
      const { category, description, ...rest } = item.transaction;
      return { ...item, transaction: { ...rest, cat: category, desc: description } };
    });
    delete result._sync;
    result.months = Object.fromEntries(Object.entries(template.months || {}).map(([key, month]) => [key, { ...month, txs: [] }]));
    for (const t of state.transactions) {
      const key = t.date.slice(0, 7);
      result.months[key] ||= { txs: [] };
      const { category, description, ...rest } = t;
      result.months[key].txs.push({ ...rest, cat: category, desc: description });
    }
    return result;
  }
  // A three-way merge preserves remote additions/deletions and flags edits to the same record.
  function merge(base, local, remote, choices = {}) {
    const result = empty(), conflicts = [];
    const maps = [base, local, remote].map(s => new Map(s.transactions.map(t => [t.id, t])));
    for (const id of new Set(maps.flatMap(m => [...m.keys()]))) {
      const [b, l, r] = maps.map(m => m.get(id));
      let value;
      if (equal(l, r) || equal(r, b)) value = l;
      else if (equal(l, b)) value = r;
      else {
        const key = `transaction:${id}`;
        if (!choices[key]) conflicts.push({ key, label: l?.description || r?.description || b?.description, local: l, remote: r });
        value = choices[key] === 'remote' ? r : l;
      }
      if (value) result.transactions.push(clone(value));
    }
    for (const key of ['categories', 'descriptions']) {
      const b = [...base[key]].sort(), l = [...local[key]].sort(), r = [...remote[key]].sort();
      if (equal(l, r) || equal(r, b)) result[key] = l;
      else if (equal(l, b)) result[key] = r;
      else {
        // Concurrent list edits may be a rename/delete pair. Ask instead of resurrecting a name.
        if (!choices[key]) conflicts.push({ key, label: key === 'categories' ? 'Categories list' : 'Descriptions list', local: l, remote: r });
        result[key] = choices[key] === 'remote' ? r : l;
      }
    }
    if ([base, local, remote].some(s => s.trash !== undefined)) {
      const bins = [base, local, remote].map(s => new Map((s.trash || []).map(item => [item.id, item])));
      const active = new Set(result.transactions.map(t => t.id));
      result.trash = [];
      for (const id of new Set(bins.flatMap(bin => [...bin.keys()]))) {
        if (active.has(id)) continue;
        const [b, l, r] = bins.map(bin => bin.get(id));
        let value;
        if (equal(l, r) || equal(r, b)) value = l;
        else if (equal(l, b)) value = r;
        else if (l && r && equal(l.transaction, r.transaction)) value = l.deletedAt > r.deletedAt ? l : r;
        else {
          const key = `trash:${id}`;
          if (!choices[key]) conflicts.push({ key, label: `Deleted: ${l?.transaction.description || r?.transaction.description || id}`, local: l?.transaction, remote: r?.transaction });
          value = choices[key] === 'remote' ? r : l;
        }
        if (value) result.trash.push(clone(value));
      }
    }
    return { state: result, conflicts };
  }
  function search(state, { month, query = '', scope = 'month', person = '', category = '', description = '', sort = 'newest' }) {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const positions = new Map(state.transactions.map((t, index) => [t.id, index]));
    const direction = sort === 'oldest' ? 1 : -1;
    return state.transactions.filter(t => {
      const names = ['hh', 'jyn', 'stv', 'inc'].filter(k => t[k] > 0).map(k => ({ hh: 'household', jyn: 'jayne', stv: 'steve', inc: 'income' })[k]);
      const text = `${t.date} ${t.category} ${t.description} ${names.join(' ')} ${t.hh} ${t.jyn} ${t.stv} ${t.inc}`.toLowerCase();
      return (scope === 'all' || t.date.startsWith(month)) && (!person || t[person] > 0) && (!category || t.category === category) && (!description || t.description === description) && terms.every(term => text.includes(term));
    }).sort((a, b) => direction * (a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || positions.get(a.id) - positions.get(b.id)));
  }
  const api = { clone, empty, equal, localDate, shiftMonth, normalize, validate, fromCloud, toCloud, merge, search };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ExpenseCore = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
