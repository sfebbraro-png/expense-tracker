(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.ExpenseCore;
  function backup(state, template = {}) {
    C.validate(state);
    return { format: 'expense-tracker-backup', version: 1, exportedAt: new Date().toISOString(), data: C.toCloud(state, template) };
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 10 MB.');
    const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    let data;
    if (raw?.format) {
      if (raw.format !== 'expense-tracker-backup' || raw.version !== 1) throw new Error('This backup format or version is not supported.');
      data = raw.data;
    } else if (raw?.months) data = raw;
    else {
      const legacy = raw?.state || raw;
      if (!Array.isArray(legacy?.transactions)) throw new Error('This file is not an expense backup.');
      const state = { transactions: legacy.transactions.map(C.normalize), categories: legacy.categories ?? [], descriptions: legacy.descriptions ?? [], ...(legacy.trash ? { trash: legacy.trash.map(item => ({ ...item, transaction: C.normalize(item.transaction) })) } : {}) };
      data = C.toCloud(C.validate(state));
    }
    return { state: C.fromCloud(data), template: data };
  }
  function csv(transactions) {
    const cell = value => {
      let text = String(value ?? '');
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [['ID', 'Date', 'Category', 'Description', 'Household', 'Jayne', 'Steve', 'Income'].join(',')];
    for (const t of transactions) rows.push([t.id, t.date, t.category, t.description].map(cell).concat([t.hh, t.jyn, t.stv, t.inc].map(n => Number(n).toFixed(2))).join(','));
    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }
  function restore(current, imported, mode) {
    if (!['merge', 'replace'].includes(mode)) throw new Error('Choose a restore mode.');
    C.validate(imported);
    if (mode === 'replace') return C.clone(imported);
    const result = C.clone(current), occupied = new Set([...current.transactions.map(t => t.id), ...(current.trash || []).map(item => item.id)]);
    for (const t of imported.transactions) if (!occupied.has(t.id)) { result.transactions.push(C.clone(t)); occupied.add(t.id); }
    result.trash ||= [];
    for (const item of imported.trash || []) if (!occupied.has(item.id)) { result.trash.push(C.clone(item)); occupied.add(item.id); }
    result.categories = [...new Set([...current.categories, ...imported.categories])];
    result.descriptions = [...new Set([...current.descriptions, ...imported.descriptions])];
    return C.validate(result);
  }
  function remove(state, id) {
    const t = state.transactions.find(t => t.id === id);
    if (!t) throw new Error('This transaction is no longer available.');
    state.trash ||= [];
    state.trash = state.trash.filter(item => item.id !== id);
    state.trash.push({ id, transaction: C.clone(t), deletedAt: new Date().toISOString() });
    state.transactions = state.transactions.filter(t => t.id !== id);
  }
  function undelete(state, id) {
    const entry = (state.trash || []).find(item => item.id === id);
    if (!entry) throw new Error('This trash entry changed. Refresh and try again.');
    if (state.transactions.some(t => t.id === id)) throw new Error('An active transaction already uses this ID. It was not overwritten.');
    state.transactions.push(C.clone(entry.transaction));
    state.trash = state.trash.filter(item => item.id !== id);
    if (!state.categories.includes(entry.transaction.category)) state.categories.push(entry.transaction.category);
    if (!state.descriptions.includes(entry.transaction.description)) state.descriptions.push(entry.transaction.description);
  }
  const api = { backup, parse, csv, restore, remove, undelete };
  if (typeof module !== 'undefined') module.exports = api; else root.ExpenseRecovery = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
