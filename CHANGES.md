# Expense Tracker web v21

## Sync and data protection

The v20 sync safeguards are retained: pending edits survive reloads, uploads condition on the shared revision, independent changes merge, conflicting edits require review, and stale tabs/account changes cannot overwrite pending data. The Mac app now implements the matching safeguards, including insert-only first initialization. Run both updated clients to close the older Mac save gap. No database migration is needed.

## Backup and recovery

Open the new Recovery tab.

- Download backup exports all active transactions, lists, and Trash across all months as `expense-tracker-backup` version 1 JSON. Export CSV includes active transactions only and escapes spreadsheet formula-like text.
- Restore a backup opens a counts/totals preview. Add missing entries keeps existing versions and previously deleted IDs. Replace requires confirmation. A recovery copy is saved first; changed data invalidates an old preview. Restored changes go through normal sync protection.
- Recovery copies saved before restores and conflict resolutions can be downloaded or previewed. The former single recovery copy is included automatically. Copies are not silently pruned; insufficient browser storage prevents a restore rather than losing its recovery snapshot. Download copies to retain them outside this browser.
- Transaction deletion now moves the original record to shared Trash. Restore returns the original ID and its list choices. Trash is excluded from totals, syncs across updated clients, and is not automatically purged.
- Native Mac and web v21 share the backup and Trash formats. Legacy Mac/cloud JSON and prior web transaction snapshots are also recognized by the web importer. Backups do not include account credentials or local sync metadata.

The prior month/order fixes, search filters, and mobile overview remain. The app shell and assets are versioned v21.

## Validation

`node --test tests/*.test.js` runs the core, sync, and recovery regression tests. Tests cover offline/reload recovery, races, conflicts, old data migration, CSV escaping, backup validation, stale restore previews, recoverable deletion, and shared Trash merging.

The browser workflow was exercised with synthetic data on an isolated local origin, cloud disabled: move to Trash, restore, load a backup preview, restore missing entries, and verify the automatic recovery copy. A real synthetic Mac export was parsed successfully by the web importer. Native tests also import the web-generated fixture.

No live Supabase writes or changes to personal transaction data were made during implementation. Refresh/reopen both apps after updating. First sync may ask for review where saved local and shared copies differ without a common baseline.
