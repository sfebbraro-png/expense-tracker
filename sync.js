(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.ExpenseCore;
  const R = typeof module !== 'undefined' ? require('./recovery.js') : root.ExpenseRecovery;
  class ExpenseStore {
    constructor(storage, initial, notify = () => {}) {
      this.storage = storage; this.notify = notify; this.key = 'expense-tracker-data';
      this.raw = storage.getItem(this.key);
      const raw = this.raw ? JSON.parse(this.raw) : null;
      if (raw && !Array.isArray(raw.transactions)) throw new Error('Saved data could not be read. Your original data has been left intact.');
      const state = raw ? C.validate({ transactions: raw.transactions.map(C.normalize), categories: raw.version >= 2 ? (raw.categories ?? ['Household', 'Personal']) : (raw.categoriesModel ?? ['Household', 'Personal']), descriptions: raw.descriptions ?? [...new Set([...(raw.version >= 2 ? [] : (raw.categories || [])), ...raw.transactions.map(t => t.description).filter(Boolean)])] }) : initial;
      this.record = { state, base: null, owner: null, dirty: !!raw, lastSynced: null, ...raw?.sync };
      if (raw?.trash !== undefined) { state.trash = raw.trash; C.validate(state); }
      // Transaction data is authoritative; sync metadata never supplies a second copy of it.
      this.record.state = state;
      this.user = null; this.busy = false; this.review = null; this.epoch = 0;
    }
    get state() { return this.record.state; }
    persist(next) {
      if (this.storage.getItem(this.key) !== this.raw) throw new Error('Another tab changed the data. Reload this tab before saving; your form is still open.');
      if (this.remoteTemplate) next = { ...next, template: this.remoteTemplate };
      const { state, ...sync } = next;
      const raw = JSON.stringify({ ...state, version: 2, sync });
      this.storage.setItem(this.key, raw);
      this.raw = raw; this.record = next;
    }
    commit(change) {
      if (this.user && this.record.owner && this.user !== this.record.owner) throw new Error('Sign back into the account that owns this device’s pending data.');
      const state = C.clone(this.state); change(state); C.validate(state);
      this.persist({ ...this.record, state, dirty: true, owner: this.record.owner || this.user });
      this.review = null; this.notify('Pending changes');
    }
    connect(user) {
      if (this.user !== user) { this.epoch++; this.review = null; }
      this.user = user;
      if (user && this.record.owner && this.record.owner !== user) throw new Error('This browser holds data for another account. Sign back into that account to sync it.');
    }
    backups() {
      const history = JSON.parse(this.storage.getItem('expense-tracker-recovery-history') || '[]');
      if (!Array.isArray(history)) throw new Error('Recovery history is unreadable. Export your current backup before proceeding.');
      if (!history.length) {
        const legacy = this.storage.getItem('expense-tracker-before-sync-review');
        if (legacy) {
          const previous = JSON.parse(legacy);
          history.push({ id: 'previous-review', label: 'Before previous sync review', createdAt: previous.savedAt, backup: R.backup(R.parse(legacy).state) });
        }
      }
      return history;
    }
    exportBackup() { return R.backup(this.state, this.remoteTemplate || this.record.template || {}); }
    backup(label = 'Before sync review') {
      const createdAt = new Date().toISOString();
      const history = this.backups();
      history.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label, createdAt, backup: this.exportBackup() });
      // Never discard a recovery snapshot silently. If storage fills, export copies first.
      this.storage.setItem('expense-tracker-recovery-history', JSON.stringify(history));
      this.storage.setItem('expense-tracker-before-sync-review', JSON.stringify({ ...this.record, savedAt: createdAt }));
    }
    restoreBackup(imported, mode, expectedRaw) {
      if (this.raw !== expectedRaw || this.storage.getItem(this.key) !== expectedRaw) throw new Error('Data changed while you reviewed this backup. Reopen the preview before restoring.');
      const restored = R.restore(this.state, imported, mode);
      this.backup('Before backup restore');
      this.commit(state => { state.transactions = restored.transactions; state.categories = restored.categories; state.descriptions = restored.descriptions; state.trash = restored.trash || []; });
    }
    resolve(choices) {
      if (!this.review) return;
      const { remote, initial } = this.review;
      this.backup();
      if (initial) {
        if (choices.initial === 'remote') this.persist({ ...this.record, state: remote, base: remote, dirty: false, owner: this.user });
        else if (choices.initial === 'merge') {
          // With no ancestor, retain additions on both sides. Same-ID differences still require review.
          const base = C.empty();
          base.categories = remote.categories.filter(n => this.state.categories.includes(n));
          base.descriptions = remote.descriptions.filter(n => this.state.descriptions.includes(n));
          this.persist({ ...this.record, base, owner: this.user, dirty: true });
        } else throw new Error('Choose how to connect these copies.');
      } else {
        const merged = C.merge(this.record.base, this.state, remote, choices);
        if (merged.conflicts.length) throw new Error('Choose a version for every conflict.');
        this.persist({ ...this.record, state: merged.state, base: remote, dirty: !C.equal(merged.state, remote), owner: this.user });
      }
      this.review = null;
    }
    async sync(backend) {
      if (!this.user || this.busy || this.review) return;
      if (this.record.owner && this.record.owner !== this.user) { this.notify('Account mismatch', true); return; }
      const user = this.user, epoch = this.epoch;
      const current = () => this.user === user && this.epoch === epoch;
      this.busy = true;
      try {
        for (let attempt = 0; attempt < 4 && current(); attempt++) {
          this.notify(this.record.dirty ? 'Saving pending changes…' : 'Checking shared data…');
          const row = await backend.read(user);
          if (!current()) return;
          if (!row) { this.notify('No shared data yet. Open the Mac app to initialize sync.', true); return; }
          const remote = C.fromCloud(row.data);
          this.remoteTemplate = row.data;
          if (!this.record.base && this.record.dirty && !C.equal(this.state, remote)) {
            this.review = { initial: true, remote, row, conflicts: [] };
            this.notify('Review first sync', true); return;
          }
          if (!this.record.dirty || !this.record.base) {
            this.persist({ ...this.record, state: remote, base: remote, dirty: false, owner: user, lastSynced: new Date().toISOString() });
            this.notify('Synced'); return;
          }
          const merged = C.merge(this.record.base, this.state, remote);
          if (merged.conflicts.length) {
            this.review = { remote, row, conflicts: merged.conflicts };
            this.notify('Conflicting changes need review', true); return;
          }
          if (C.equal(merged.state, remote)) {
            this.persist({ ...this.record, state: remote, base: remote, dirty: false, owner: user, lastSynced: new Date().toISOString() });
            this.notify('Synced'); return;
          }
          // Persist the merged copy before sending. A crash or network error leaves a durable retry.
          this.persist({ ...this.record, state: merged.state, base: remote, dirty: true, owner: user });
          const sent = C.clone(this.state);
          const success = await backend.compareAndSwap(user, row, C.toCloud(sent, row.data));
          if (!current()) return;
          if (!success) continue; // Another device saved first; read and merge again.
          const dirty = !C.equal(this.state, sent);
          this.persist({ ...this.record, base: sent, dirty, lastSynced: new Date().toISOString() });
          if (!dirty) { this.notify('Synced'); return; }
        }
        if (current()) this.notify('Shared data is busy. Changes saved on this device; retry shortly.', true);
      } catch (error) {
        if (current()) this.notify(`${this.record.dirty ? 'Changes pending. ' : ''}${error.message || 'Sync unavailable; retry shortly.'}`, true);
      } finally { this.busy = false; }
    }
  }
  if (typeof module !== 'undefined') module.exports = ExpenseStore;
  else root.ExpenseStore = ExpenseStore;
})(typeof globalThis === 'undefined' ? this : globalThis);
