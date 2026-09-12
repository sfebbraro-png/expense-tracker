# Expense Tracker web v24

## Fresh phone install pulls Mac data again

Reinstalling or updating the Home Screen app could leave demo seed transactions as “pending,” so sync asked for review instead of loading the Mac/shared copy. Demo seed or empty phone data now yields to the shared copy automatically. Sign in with the same Mac account if the status still says Sign In.

## Selected month after a full quit

A soft background on the phone kept September in memory, but a full swipe-quit reloaded an old July value from storage or the shared copy. Opening the app now ignores a saved or shared month that is earlier than the real calendar month, so in September you open on September even if July is still sitting in local storage or Supabase. The selected month is also stored with the main saved data as `currentMonth` and included when syncing. You can still browse older months during a session.

## Sync and data protection

The v20/v21 sync safeguards are retained: pending edits survive reloads, uploads condition on the shared revision, independent changes merge, conflicting edits require review, and stale tabs/account changes cannot overwrite pending data. The Mac app uploads month changes that previously stayed local-only. Run both updated clients. No database migration is needed.

## Backup and recovery

Open the Recovery tab.

- Download backup exports all active transactions, lists, and Trash across all months as `expense-tracker-backup` version 1 JSON. Export CSV includes active transactions only and escapes spreadsheet formula-like text.
- Restore a backup opens a counts/totals preview. Add missing entries keeps existing versions and previously deleted IDs. Replace requires confirmation. A recovery copy is saved first; changed data invalidates an old preview. Restored changes go through normal sync protection.
- Recovery copies saved before restores and conflict resolutions can be downloaded or previewed. The former single recovery copy is included automatically. Copies are not silently pruned; insufficient browser storage prevents a restore rather than losing its recovery snapshot. Download copies to retain them outside this browser.
- Transaction deletion moves the original record to shared Trash. Restore returns the original ID and its list choices. Trash is excluded from totals, syncs across updated clients, and is not automatically purged.
- Native Mac and web v24 share the backup and Trash formats. Legacy Mac/cloud JSON and prior web transaction snapshots are also recognized by the web importer. Backups do not include account credentials or local sync metadata.

The prior search filters and mobile overview remain. The app shell and assets are versioned v24.

## Validation

`node --test tests/*.test.js` runs the core, sync, month, and recovery regression tests. Tests cover offline/reload recovery, races, conflicts, old data migration, CSV escaping, backup validation, stale restore previews, recoverable deletion, shared Trash merging, and month persistence across reopen and sync, including ignoring a stale past month after a full quit.

Push this build, then fully quit and reopen the phone app so the v24 service worker replaces the older shell. On the Mac app, quit and reopen the updated build, then nudge the month once so the shared month uploads if the cloud was still on July.
