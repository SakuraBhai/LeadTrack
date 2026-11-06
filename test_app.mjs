/**
 * Automated End-to-End Verification Suite for LeadTrack Pro
 * Tests:
 * 1. OCR Phone Number Extraction & Multi-Screenshot Deduplication
 * 2. User Section & Agent Section Strict Isolation
 * 3. Status Transitions (Pending -> Positive -> Negative -> Pending)
 * 4. Agent-Wise Tracking & Statistics
 * 5. 30-Day History Point-in-Time Date Snapshot Reconstruction
 * 6. 30-Day Retention Policy (Prunes >30d history records while preserving >30d active numbers)
 */

import assert from 'node:assert/strict';

// Minimal Spec-Compliant IndexedDB Mock for Node.js verification of db.js
function installIndexedDBMock() {
  const databases = new Map();

  class MockCursor {
    constructor(store, records, index = 0) {
      this.store = store;
      this.records = records;
      this.index = index;
    }
    get value() {
      return this.records[this.index];
    }
    delete() {
      const rec = this.records[this.index];
      if (rec) {
        this.store.data.delete(rec[this.store.keyPath]);
      }
    }
    continue() {
      this.index++;
      queueMicrotask(() => {
        if (this.req && this.req.onsuccess) {
          const result = this.index < this.records.length ? this : null;
          this.req.onsuccess({ target: { result } });
        }
      });
    }
  }

  class MockObjectStore {
    constructor(name, options) {
      this.name = name;
      this.keyPath = options.keyPath;
      this.data = new Map();
      this.indexes = new Map();
    }
    createIndex(name, keyPath, options) {
      this.indexes.set(name, { name, keyPath, options });
    }
    put(record) {
      const cloned = structuredClone(record);
      this.data.set(cloned[this.keyPath], cloned);
      const req = {};
      queueMicrotask(() => req.onsuccess && req.onsuccess({ target: { result: cloned[this.keyPath] } }));
      return req;
    }
    get(key) {
      const req = {};
      queueMicrotask(() => {
        req.result = this.data.has(key) ? structuredClone(this.data.get(key)) : undefined;
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
    getAll() {
      const req = {};
      queueMicrotask(() => {
        req.result = Array.from(this.data.values()).map((v) => structuredClone(v));
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
    delete(key) {
      this.data.delete(key);
      const req = {};
      queueMicrotask(() => req.onsuccess && req.onsuccess({ target: {} }));
      return req;
    }
    clear() {
      this.data.clear();
      const req = {};
      queueMicrotask(() => req.onsuccess && req.onsuccess({ target: {} }));
      return req;
    }
    openCursor() {
      const req = {};
      const records = Array.from(this.data.values());
      queueMicrotask(() => {
        if (records.length === 0) {
          if (req.onsuccess) req.onsuccess({ target: { result: null } });
        } else {
          const cursor = new MockCursor(this, records, 0);
          cursor.req = req;
          if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
        }
      });
      return req;
    }
  }

  class MockDB {
    constructor(name) {
      this.name = name;
      this.stores = new Map();
      this.objectStoreNames = {
        contains: (s) => this.stores.has(s)
      };
    }
    createObjectStore(name, options) {
      const store = new MockObjectStore(name, options);
      this.stores.set(name, store);
      return store;
    }
    transaction(storeNames, mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const tx = {
        mode,
        objectStore: (name) => {
          if (!names.includes(name)) throw new Error(`Store ${name} not in transaction`);
          return this.stores.get(name);
        },
        oncomplete: null,
        onerror: null
      };
      // Trigger oncomplete after queued store operations finish
      setTimeout(() => {
        if (tx.oncomplete) tx.oncomplete();
      }, 15);
      return tx;
    }
  }

  globalThis.indexedDB = {
    open(name, version) {
      const req = {};
      setTimeout(() => {
        let isNew = false;
        if (!databases.has(name)) {
          databases.set(name, new MockDB(name));
          isNew = true;
        }
        const dbInstance = databases.get(name);
        req.result = dbInstance;
        if (isNew && req.onupgradeneeded) {
          req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) {
          req.onsuccess({ target: req });
        }
      }, 5);
      return req;
    }
  };
}

installIndexedDBMock();

const { db, toDateKey, normalizePhoneKey, formatPhoneDisplay } = await import('./db.js');
const { extractPhoneNumbersFromText } = await import('./ocr.js');

console.log('=== Starting LeadTrack Pro Comprehensive Verification ===\n');

// 1. Test OCR Phone Number Extraction & Deduplication
console.log('1. Testing OCR Phone Number Extraction & Noise Filtering...');
const sampleOCRText = `
  11:42 AM  98% Battery
  2026-11-06 Call Log Screenshot
  Lead 1: +91 98765 43210
  Lead 2: 9876543210 (duplicate in same screenshot!)
  Lead 3: +1 (415) 555-2671
  Lead 4: 098112-23344
  Noise: 0000000000
  Date: 2026/10/25
`;
const extracted = extractPhoneNumbersFromText(sampleOCRText);
assert.equal(extracted.length, 3, 'Should extract 3 unique valid mobile numbers and ignore duplicates/dates/all-zeros');
assert.equal(extracted[0].phoneKey, '9876543210');
assert.equal(extracted[1].phoneKey, '4155552671');
assert.equal(extracted[2].phoneKey, '9811223344');
console.log('   ✔ Passed OCR extraction, noise filtering, and batch deduplication.');

// 2. Test User vs Agent Strict Isolation & Duplicate Detection
console.log('2. Testing User & Agent Module Isolation and Duplicate Removal...');
await db.init();
await db.clearAllData();

const userImport1 = await db.importNumbers({
  module: 'user',
  rawNumbers: ['+91 98765 43210', '9876543210', '+91 98111 22233'],
  sourceType: 'ocr',
  sourceFiles: ['user_gallery_1.png']
});
assert.equal(userImport1.addedRecords.length, 2, 'Should add 2 unique User numbers');
assert.equal(userImport1.duplicateNumbers.length, 1, 'Should detect 1 duplicate in User import');

// Importing the same number into Agent section SHOULD succeed because User and Agent lists are strictly separate
const agents = await db.getAll('agents');
const agentImport1 = await db.importNumbers({
  module: 'agent',
  rawNumbers: ['+91 98765 43210', '+91 97111 55566'],
  sourceType: 'ocr',
  sourceFiles: ['agent_gallery_1.png'],
  agentId: agents[0].id
});
assert.equal(agentImport1.addedRecords.length, 2, 'Agent list is separate from User list');

// Re-importing existing number into User section should be blocked as duplicate
const userImportDup = await db.importNumbers({
  module: 'user',
  rawNumbers: ['98765-43210'],
  sourceType: 'manual'
});
assert.equal(userImportDup.addedRecords.length, 0, 'Existing User number must be skipped as duplicate');
assert.equal(userImportDup.duplicateNumbers.length, 1);
console.log('   ✔ Passed User & Agent strict isolation and duplicate prevention.');

// 3. Test Status Transitions (Pending -> Positive -> Negative -> Pending)
console.log('3. Testing Status Transitions & Instant Section Movement...');
const userNumId = userImport1.addedRecords[0].id;
const userNum2Id = userImport1.addedRecords[1].id;

// Initially both are pending
let snapToday = await db.getHistoricalSnapshotForDate(toDateKey(new Date()));
assert.equal(snapToday.userStats.pending, 2);
assert.equal(snapToday.userStats.positive, 0);

// Click Positive on first number
await db.updateNumbersStatus({
  module: 'user',
  numberIds: [userNumId],
  newStatus: 'positive'
});
snapToday = await db.getHistoricalSnapshotForDate(toDateKey(new Date()));
assert.equal(snapToday.userStats.positive, 1);
assert.equal(snapToday.userStats.pending, 1);

// Click Negative on second number
await db.updateNumbersStatus({
  module: 'user',
  numberIds: [userNum2Id],
  newStatus: 'negative'
});
snapToday = await db.getHistoricalSnapshotForDate(toDateKey(new Date()));
assert.equal(snapToday.userStats.positive, 1);
assert.equal(snapToday.userStats.negative, 1);
assert.equal(snapToday.userStats.pending, 0);

// Allow changing status anytime (Negative -> Pending)
await db.updateNumbersStatus({
  module: 'user',
  numberIds: [userNum2Id],
  newStatus: 'pending'
});
snapToday = await db.getHistoricalSnapshotForDate(toDateKey(new Date()));
assert.equal(snapToday.userStats.pending, 1);
assert.equal(snapToday.userStats.negative, 0);
console.log('   ✔ Passed Positive, Negative, Pending transitions and status re-change.');

// 4. Test Point-in-Time Historical Date Snapshot Reconstruction & 30-Day Retention Policy
console.log('4. Testing 30-Day History Point-in-Time Snapshots & 30-Day Retention Policy...');
await db.clearAllData();

const now = new Date();
const makePastDate = (daysAgo, hour = 12) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// A) Import a number 40 days ago (>30 days)
const d40 = makePastDate(40, 10);
const oldImport = await db.importNumbers({
  module: 'user',
  rawNumbers: ['+91 98000 00040'],
  sourceType: 'ocr',
  sourceFiles: ['old_40d.png'],
  defaultStatus: 'positive',
  customTimestamp: d40.toISOString()
});
assert.equal(oldImport.addedRecords.length, 1);

// B) Import a number 10 days ago as 'pending', change to 'positive' 5 days ago, change to 'negative' 2 days ago
const d10 = makePastDate(10, 10);
const d5 = makePastDate(5, 15);
const d2 = makePastDate(2, 18);

const trackedImport = await db.importNumbers({
  module: 'agent',
  rawNumbers: ['+91 99000 00010'],
  sourceType: 'ocr',
  sourceFiles: ['agent_day10.png'],
  agentId: agents[0].id,
  defaultStatus: 'pending',
  customTimestamp: d10.toISOString()
});
const trackedId = trackedImport.addedRecords[0].id;

await db.updateNumbersStatus({
  module: 'agent',
  numberIds: [trackedId],
  newStatus: 'positive',
  customTimestamp: d5.toISOString()
});

await db.updateNumbersStatus({
  module: 'agent',
  numberIds: [trackedId],
  newStatus: 'negative',
  customTimestamp: d2.toISOString()
});

// Verify historical snapshots on Day -10, Day -5, and Day -2!
const snapDay10 = await db.getHistoricalSnapshotForDate(toDateKey(d10));
const numOnDay10 = snapDay10.agentNumbers.find((n) => n.id === trackedId);
assert.equal(numOnDay10.status, 'pending', 'On Day -10, status must be pending');

const snapDay5 = await db.getHistoricalSnapshotForDate(toDateKey(d5));
const numOnDay5 = snapDay5.agentNumbers.find((n) => n.id === trackedId);
assert.equal(numOnDay5.status, 'positive', 'On Day -5, status must be positive');

const snapDay2 = await db.getHistoricalSnapshotForDate(toDateKey(d2));
const numOnDay2 = snapDay2.agentNumbers.find((n) => n.id === trackedId);
assert.equal(numOnDay2.status, 'negative', 'On Day -2, status must be negative');

// Verify 30-day retention policy prunes the 40-day-old history logs while keeping the 40-day-old active number!
const retentionOut = await db.enforceThirtyDayRetention(now);
assert.ok(retentionOut.prunedCount > 0, 'Should prune historical logs older than 30 days');

const allActiveUserNumbers = await db.getAll('user_numbers');
const preservedOldActive = allActiveUserNumbers.find((n) => n.phoneKey === '9800000040');
assert.ok(
  preservedOldActive,
  'Active number imported 40 days ago MUST NOT be deleted by 30-day history retention policy'
);

const remainingImportHistory = await db.getAll('import_history');
const oldHistoryStillThere = remainingImportHistory.find((h) => h.dateKey === toDateKey(d40));
assert.equal(
  oldHistoryStillThere,
  undefined,
  'Import history record from 40 days ago MUST be removed by 30-day retention policy'
);

console.log('   ✔ Passed 30-Day Point-in-Time Snapshot Reconstruction & 30-Day Retention Policy.');

// 5. Verify DOM ID integrity between index.html and app.js
import fs from 'node:fs';
console.log('5. Verifying DOM Element IDs & UI Wiring Integrity...');
const htmlContent = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const appJsContent = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

const htmlIds = new Set();
for (const match of htmlContent.matchAll(/id="([^"]+)"/g)) {
  htmlIds.add(match[1]);
}

const referencedIds = [];
for (const match of appJsContent.matchAll(/getElementById\('([^']+)'\)|setText\('([^']+)'/g)) {
  const id = match[1] || match[2];
  if (id) referencedIds.push(id);
}

for (const id of referencedIds) {
  assert.ok(htmlIds.has(id), `DOM element #${id} referenced in app.js must exist in index.html`);
}
console.log(`   ✔ Verified all ${referencedIds.length} DOM ID references in app.js match index.html.`);

console.log('\n=== ALL AUTOMATED TESTS PASSED SUCCESSFULLY ===');
