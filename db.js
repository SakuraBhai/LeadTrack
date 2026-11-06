/**
 * LeadTrack Pro - IndexedDB Storage & 30-Day History Engine
 *
 * Object Stores:
 * 1. user_numbers    - Active numbers in User section (never deleted by 30-day retention)
 * 2. agent_numbers   - Active numbers in Agent section (never deleted by 30-day retention)
 * 3. agents          - Agent profiles for agent-wise tracking and statistics
 * 4. import_history  - 30-day log of screenshot & manual import batches
 * 5. status_history  - 30-day log of every status transition (Pending / Positive / Negative)
 * 6. daily_reports   - 30-day daily snapshot summaries for User and Agent modules
 * 7. activity_log    - 30-day audit trail of all user/agent actions
 */

const DB_NAME = 'LeadTrackNumberManagementDB';
const DB_VERSION = 1;
const RETENTION_DAYS = 30;

/**
 * Format a Date or timestamp into local YYYY-MM-DD key
 */
export function toDateKey(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get array of last N date keys (YYYY-MM-DD), ending today
 */
export function getLastNDaysKeys(days = RETENTION_DAYS, referenceDate = new Date()) {
  const keys = [];
  const base = new Date(referenceDate);
  base.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    keys.push(toDateKey(d));
  }
  return keys;
}

/**
 * Normalize phone number to canonical digits for duplicate comparison within the same list.
 * Keeps last 10 digits if >= 10 digits, or full digits if shorter (7-9 digits).
 */
export function normalizePhoneKey(rawPhone) {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Format phone number nicely for display while preserving country code if provided
 */
export function formatPhoneDisplay(rawPhone) {
  const cleaned = String(rawPhone || '').trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return cleaned;
}

class LeadTrackDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. User Numbers Store (strictly isolated from Agent numbers)
        if (!db.objectStoreNames.contains('user_numbers')) {
          const userStore = db.createObjectStore('user_numbers', { keyPath: 'id' });
          userStore.createIndex('phoneKey', 'phoneKey', { unique: true });
          userStore.createIndex('status', 'status', { unique: false });
          userStore.createIndex('importDateKey', 'importDateKey', { unique: false });
          userStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 2. Agent Numbers Store (strictly isolated from User numbers)
        if (!db.objectStoreNames.contains('agent_numbers')) {
          const agentStore = db.createObjectStore('agent_numbers', { keyPath: 'id' });
          agentStore.createIndex('phoneKey', 'phoneKey', { unique: true });
          agentStore.createIndex('status', 'status', { unique: false });
          agentStore.createIndex('agentId', 'agentId', { unique: false });
          agentStore.createIndex('importDateKey', 'importDateKey', { unique: false });
          agentStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 3. Agents Profile Store
        if (!db.objectStoreNames.contains('agents')) {
          const agentsStore = db.createObjectStore('agents', { keyPath: 'id' });
          agentsStore.createIndex('name', 'name', { unique: false });
        }

        // 4. Import History Store (30-day retention)
        if (!db.objectStoreNames.contains('import_history')) {
          const importStore = db.createObjectStore('import_history', { keyPath: 'id' });
          importStore.createIndex('module', 'module', { unique: false });
          importStore.createIndex('dateKey', 'dateKey', { unique: false });
          importStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 5. Status Change History Store (30-day retention)
        if (!db.objectStoreNames.contains('status_history')) {
          const statusStore = db.createObjectStore('status_history', { keyPath: 'id' });
          statusStore.createIndex('module', 'module', { unique: false });
          statusStore.createIndex('numberId', 'numberId', { unique: false });
          statusStore.createIndex('dateKey', 'dateKey', { unique: false });
          statusStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 6. Daily Reports Store (30-day retention, key = YYYY-MM-DD)
        if (!db.objectStoreNames.contains('daily_reports')) {
          const dailyStore = db.createObjectStore('daily_reports', { keyPath: 'dateKey' });
          dailyStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 7. Activity Log Store (30-day retention)
        if (!db.objectStoreNames.contains('activity_log')) {
          const logStore = db.createObjectStore('activity_log', { keyPath: 'id' });
          logStore.createIndex('module', 'module', { unique: false });
          logStore.createIndex('dateKey', 'dateKey', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    await this.ensureDefaultAgents();
    await this.enforceThirtyDayRetention();
    await this.syncDailyReport(toDateKey(new Date()));
    return this.db;
  }

  /**
   * Generic helper to read all records from an object store
   */
  async getAll(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Ensure default agents exist for Agent-wise tracking
   */
  async ensureDefaultAgents() {
    const existing = await this.getAll('agents');
    if (existing.length > 0) return existing;

    const defaults = [
      {
        id: 'agent-1',
        name: 'Aarav Sharma',
        code: 'AG-101',
        region: 'North Desk',
        color: '#6366f1',
        createdAt: new Date().toISOString()
      },
      {
        id: 'agent-2',
        name: 'Priya Nair',
        code: 'AG-102',
        region: 'West Desk',
        color: '#10b981',
        createdAt: new Date().toISOString()
      },
      {
        id: 'agent-3',
        name: 'Rohan Verma',
        code: 'AG-103',
        region: 'Enterprise Desk',
        color: '#f59e0b',
        createdAt: new Date().toISOString()
      }
    ];

    const tx = this.db.transaction('agents', 'readwrite');
    const store = tx.objectStore('agents');
    for (const ag of defaults) {
      store.put(ag);
    }
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    return defaults;
  }

  /**
   * Add a new Agent profile
   */
  async addAgent({ name, code, region, color }) {
    await this.init();
    const id = 'agent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'];
    const agent = {
      id,
      name: name.trim(),
      code: (code || `AG-${Math.floor(100 + Math.random() * 900)}`).trim(),
      region: (region || 'General Desk').trim(),
      color: color || palette[Math.floor(Math.random() * palette.length)],
      createdAt: new Date().toISOString()
    };

    const tx = this.db.transaction(['agents', 'activity_log'], 'readwrite');
    tx.objectStore('agents').put(agent);
    this._writeActivityLogInTx(tx, {
      module: 'agent',
      action: 'AGENT_CREATED',
      summary: `Created agent profile: ${agent.name} (${agent.code})`,
      details: { agentId: agent.id, name: agent.name, code: agent.code }
    });

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    return agent;
  }

  /**
   * Delete an Agent profile (reassigns any numbers to first available agent)
   */
  async deleteAgent(agentId) {
    await this.init();
    const agents = await this.getAll('agents');
    if (agents.length <= 1) {
      throw new Error('At least one agent must remain in Agent Management.');
    }
    const target = agents.find((a) => a.id === agentId);
    const fallback = agents.find((a) => a.id !== agentId);

    const agentNumbers = await this.getAll('agent_numbers');
    const tx = this.db.transaction(['agents', 'agent_numbers', 'activity_log'], 'readwrite');
    tx.objectStore('agents').delete(agentId);

    const numStore = tx.objectStore('agent_numbers');
    for (const num of agentNumbers) {
      if (num.agentId === agentId && fallback) {
        num.agentId = fallback.id;
        num.agentName = fallback.name;
        numStore.put(num);
      }
    }

    this._writeActivityLogInTx(tx, {
      module: 'agent',
      action: 'AGENT_DELETED',
      summary: `Deleted agent ${target ? target.name : agentId} (reassigned numbers to ${fallback.name})`,
      details: { deletedAgentId: agentId, fallbackAgentId: fallback.id }
    });

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  /**
   * 30-DAY RETENTION POLICY:
   * - Automatically removes historical records older than 30 days from:
   *   `import_history`, `status_history`, `daily_reports`, `activity_log`.
   * - NEVER deletes active numbers from `user_numbers` or `agent_numbers`,
   *   even if their `importedAt` date is older than 30 days!
   */
  async enforceThirtyDayRetention(referenceDate = new Date()) {
    if (!this.db) return { prunedCount: 0 };

    const validDateKeys = new Set(getLastNDaysKeys(RETENTION_DAYS, referenceDate));
    const cutoffDate = new Date(referenceDate);
    cutoffDate.setHours(0, 0, 0, 0);
    cutoffDate.setDate(cutoffDate.getDate() - (RETENTION_DAYS - 1));
    const cutoffMs = cutoffDate.getTime();

    const historyStores = ['import_history', 'status_history', 'daily_reports', 'activity_log'];
    let prunedCount = 0;

    const tx = this.db.transaction(historyStores, 'readwrite');

    for (const storeName of historyStores) {
      const store = tx.objectStore(storeName);
      const req = store.openCursor();
      await new Promise((resolve, reject) => {
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) {
            resolve();
            return;
          }
          const val = cursor.value;
          const recordDateKey = val.dateKey;
          const recordTimeMs = val.timestamp ? new Date(val.timestamp).getTime() : 0;

          const isOlderThan30Days =
            (recordDateKey && !validDateKeys.has(recordDateKey) && recordDateKey < Array.from(validDateKeys)[0]) ||
            (recordTimeMs > 0 && recordTimeMs < cutoffMs);

          if (isOlderThan30Days) {
            cursor.delete();
            prunedCount++;
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });

    return {
      prunedCount,
      cutoffDateKey: toDateKey(cutoffDate),
      cutoffIso: cutoffDate.toISOString()
    };
  }

  /**
   * Internal helper to write an activity log entry inside an active transaction
   */
  _writeActivityLogInTx(tx, { module, action, summary, details = {}, customTimestamp = null }) {
    const now = customTimestamp ? new Date(customTimestamp) : new Date();
    const entry = {
      id: 'log-' + now.getTime() + '-' + Math.random().toString(36).slice(2, 7),
      module, // 'user' | 'agent' | 'system'
      action,
      summary,
      details,
      timestamp: now.toISOString(),
      dateKey: toDateKey(now)
    };
    tx.objectStore('activity_log').put(entry);
    return entry;
  }

  /**
   * Import numbers (from OCR Screenshot or Manual Entry) into either User or Agent section.
   * Automatically deduplicates against both the incoming batch AND existing numbers in that section.
   */
  async importNumbers({
    module, // 'user' | 'agent'
    rawNumbers, // Array of strings or { phone, notes, status, sourceFile }
    sourceType = 'ocr', // 'ocr' | 'manual'
    sourceFiles = [],
    agentId = null,
    defaultStatus = 'pending',
    customTimestamp = null
  }) {
    await this.init();
    if (module !== 'user' && module !== 'agent') {
      throw new Error('Invalid module: must be "user" or "agent"');
    }

    const storeName = module === 'user' ? 'user_numbers' : 'agent_numbers';
    const existingRecords = await this.getAll(storeName);
    const existingPhoneKeys = new Set(existingRecords.map((r) => r.phoneKey));

    let agentObj = null;
    if (module === 'agent') {
      const agents = await this.getAll('agents');
      agentObj = agents.find((a) => a.id === agentId) || agents[0];
    }

    const now = customTimestamp ? new Date(customTimestamp) : new Date();
    const isoNow = now.toISOString();
    const dateKey = toDateKey(now);

    const addedRecords = [];
    const duplicateNumbers = [];
    const seenInBatch = new Set();

    for (const item of rawNumbers) {
      const rawPhone = typeof item === 'string' ? item : item.phone;
      const notes = typeof item === 'object' && item.notes ? item.notes : '';
      const itemSourceFile = typeof item === 'object' && item.sourceFile ? item.sourceFile : (sourceFiles[0] || (sourceType === 'ocr' ? 'Gallery Screenshot' : 'Manual Entry'));
      const initialStatus = (typeof item === 'object' && item.status) ? item.status : defaultStatus;

      const phoneKey = normalizePhoneKey(rawPhone);
      if (!phoneKey || phoneKey.length < 7) continue;

      if (existingPhoneKeys.has(phoneKey) || seenInBatch.has(phoneKey)) {
        duplicateNumbers.push(formatPhoneDisplay(rawPhone));
        continue;
      }

      seenInBatch.add(phoneKey);
      existingPhoneKeys.add(phoneKey);

      const id = `${module}-num-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
      const record = {
        id,
        module,
        phone: formatPhoneDisplay(rawPhone),
        rawPhone: String(rawPhone).trim(),
        phoneKey,
        status: initialStatus, // 'pending' | 'positive' | 'negative'
        sourceType,
        sourceFile: itemSourceFile,
        notes,
        agentId: module === 'agent' && agentObj ? agentObj.id : null,
        agentName: module === 'agent' && agentObj ? agentObj.name : null,
        importedAt: isoNow,
        importDateKey: dateKey,
        updatedAt: isoNow,
        statusUpdatedAt: isoNow
      };

      addedRecords.push(record);
    }

    const txStores = [storeName, 'import_history', 'status_history', 'activity_log'];
    const tx = this.db.transaction(txStores, 'readwrite');
    const numStore = tx.objectStore(storeName);
    const statusStore = tx.objectStore('status_history');
    const importStore = tx.objectStore('import_history');

    for (const rec of addedRecords) {
      numStore.put(rec);

      // Record initial status event in status_history so date-based snapshot reconstruction knows its exact initial status
      statusStore.put({
        id: `st-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        numberId: rec.id,
        phone: rec.phone,
        phoneKey: rec.phoneKey,
        module: rec.module,
        agentId: rec.agentId,
        agentName: rec.agentName,
        previousStatus: null,
        newStatus: rec.status,
        reason: sourceType === 'ocr' ? 'Imported via OCR Screenshot' : 'Added via Manual Entry',
        timestamp: isoNow,
        dateKey
      });
    }

    const importBatch = {
      id: `imp-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      module,
      sourceType,
      sourceFiles: sourceFiles.length ? sourceFiles : [sourceType === 'ocr' ? 'Gallery Screenshot' : 'Manual Entry'],
      agentId: agentObj ? agentObj.id : null,
      agentName: agentObj ? agentObj.name : null,
      importedCount: addedRecords.length,
      duplicateCount: duplicateNumbers.length,
      numbers: addedRecords.map((r) => r.phone),
      timestamp: isoNow,
      dateKey
    };

    if (addedRecords.length > 0 || duplicateNumbers.length > 0) {
      importStore.put(importBatch);
      this._writeActivityLogInTx(tx, {
        module,
        action: sourceType === 'ocr' ? 'OCR_IMPORT' : 'MANUAL_IMPORT',
        summary: `Imported ${addedRecords.length} number(s) into ${module.toUpperCase()} list (${duplicateNumbers.length} duplicate(s) skipped)`,
        details: {
          importedCount: addedRecords.length,
          duplicateCount: duplicateNumbers.length,
          sourceFiles: importBatch.sourceFiles,
          agentName: agentObj ? agentObj.name : null
        },
        customTimestamp: isoNow
      });
    }

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });

    await this.syncDailyReport(dateKey);
    return {
      addedRecords,
      duplicateNumbers,
      importBatch
    };
  }

  /**
   * Update status of a single number or multiple numbers (Positive / Negative / Pending)
   * Saves exact date and time in `status_history` and updates the active number record immediately.
   */
  async updateNumbersStatus({
    module, // 'user' | 'agent'
    numberIds, // Array of IDs
    newStatus, // 'positive' | 'negative' | 'pending'
    customTimestamp = null
  }) {
    await this.init();
    if (!['positive', 'negative', 'pending'].includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    const storeName = module === 'user' ? 'user_numbers' : 'agent_numbers';
    const now = customTimestamp ? new Date(customTimestamp) : new Date();
    const isoNow = now.toISOString();
    const dateKey = toDateKey(now);

    const tx = this.db.transaction([storeName, 'status_history', 'activity_log'], 'readwrite');
    const numStore = tx.objectStore(storeName);
    const statusStore = tx.objectStore('status_history');

    const updatedRecords = [];

    for (const id of numberIds) {
      const rec = await new Promise((resolve, reject) => {
        const req = numStore.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (!rec) continue;
      const prevStatus = rec.status;
      rec.status = newStatus;
      rec.updatedAt = isoNow;
      rec.statusUpdatedAt = isoNow;
      numStore.put(rec);
      updatedRecords.push(rec);

      statusStore.put({
        id: `st-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        numberId: rec.id,
        phone: rec.phone,
        phoneKey: rec.phoneKey,
        module: rec.module,
        agentId: rec.agentId,
        agentName: rec.agentName,
        previousStatus: prevStatus,
        newStatus,
        reason: prevStatus === newStatus ? 'Status re-confirmed' : `Moved from ${prevStatus} to ${newStatus}`,
        timestamp: isoNow,
        dateKey
      });
    }

    if (updatedRecords.length > 0) {
      const label =
        updatedRecords.length === 1
          ? `${updatedRecords[0].phone} → ${newStatus.toUpperCase()}`
          : `${updatedRecords.length} numbers → ${newStatus.toUpperCase()}`;

      this._writeActivityLogInTx(tx, {
        module,
        action: 'STATUS_CHANGE',
        summary: `[${module.toUpperCase()}] Status changed: ${label}`,
        details: {
          count: updatedRecords.length,
          newStatus,
          phones: updatedRecords.slice(0, 10).map((r) => r.phone)
        },
        customTimestamp: isoNow
      });
    }

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });

    await this.syncDailyReport(dateKey);
    return updatedRecords;
  }

  /**
   * Edit an existing number's phone, notes, status, or assigned agent
   */
  async editNumber({ module, id, phone, notes, status, agentId }) {
    await this.init();
    const storeName = module === 'user' ? 'user_numbers' : 'agent_numbers';
    const allInStore = await this.getAll(storeName);
    const current = allInStore.find((r) => r.id === id);
    if (!current) throw new Error('Number record not found.');

    const newPhoneKey = normalizePhoneKey(phone);
    if (!newPhoneKey || newPhoneKey.length < 7) {
      throw new Error('Please enter a valid mobile number (at least 7 digits).');
    }

    // Check duplicate against other records in the same list
    const duplicate = allInStore.find((r) => r.id !== id && r.phoneKey === newPhoneKey);
    if (duplicate) {
      throw new Error(`Duplicate number ${formatPhoneDisplay(phone)} already exists in the ${module.toUpperCase()} list.`);
    }

    let agentObj = null;
    if (module === 'agent') {
      const agents = await this.getAll('agents');
      agentObj = agents.find((a) => a.id === (agentId || current.agentId)) || agents[0];
    }

    const now = new Date();
    const isoNow = now.toISOString();
    const dateKey = toDateKey(now);
    const prevStatus = current.status;
    const nextStatus = status || current.status;

    const updated = {
      ...current,
      phone: formatPhoneDisplay(phone),
      rawPhone: String(phone).trim(),
      phoneKey: newPhoneKey,
      notes: notes !== undefined ? notes : current.notes,
      status: nextStatus,
      agentId: module === 'agent' && agentObj ? agentObj.id : null,
      agentName: module === 'agent' && agentObj ? agentObj.name : null,
      updatedAt: isoNow,
      statusUpdatedAt: prevStatus !== nextStatus ? isoNow : current.statusUpdatedAt
    };

    const tx = this.db.transaction([storeName, 'status_history', 'activity_log'], 'readwrite');
    tx.objectStore(storeName).put(updated);

    if (prevStatus !== nextStatus) {
      tx.objectStore('status_history').put({
        id: `st-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        numberId: updated.id,
        phone: updated.phone,
        phoneKey: updated.phoneKey,
        module: updated.module,
        agentId: updated.agentId,
        agentName: updated.agentName,
        previousStatus: prevStatus,
        newStatus: nextStatus,
        reason: 'Updated via Edit Number dialog',
        timestamp: isoNow,
        dateKey
      });
    }

    this._writeActivityLogInTx(tx, {
      module,
      action: 'NUMBER_EDITED',
      summary: `Edited number ${updated.phone} in ${module.toUpperCase()} list`,
      details: { id: updated.id, phone: updated.phone, status: updated.status }
    });

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });

    await this.syncDailyReport(dateKey);
    return updated;
  }

  /**
   * Delete one or more numbers from User or Agent list
   */
  async deleteNumbers({ module, numberIds }) {
    await this.init();
    const storeName = module === 'user' ? 'user_numbers' : 'agent_numbers';
    const tx = this.db.transaction([storeName, 'activity_log'], 'readwrite');
    const store = tx.objectStore(storeName);

    const deletedPhones = [];
    for (const id of numberIds) {
      const rec = await new Promise((resolve) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (rec) {
        deletedPhones.push(rec.phone);
        store.delete(id);
      }
    }

    if (deletedPhones.length > 0) {
      this._writeActivityLogInTx(tx, {
        module,
        action: 'NUMBER_DELETED',
        summary: `Deleted ${deletedPhones.length} number(s) from ${module.toUpperCase()} list`,
        details: { count: deletedPhones.length, phones: deletedPhones.slice(0, 10) }
      });
    }

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });

    await this.syncDailyReport(toDateKey(new Date()));
    return deletedPhones.length;
  }

  /**
   * POINT-IN-TIME HISTORICAL SNAPSHOT ENGINE (30-Day History System)
   *
   * When the user selects any previous date `targetDateKey` (YYYY-MM-DD) within the last 30 days:
   * - Reconstructs the exact User and Agent number lists as they existed on `targetDateKey`
   *   and their exact status (Positive / Negative / Pending) as of the end of `targetDateKey`.
   * - Also provides the specific imports and status transitions that happened ON `targetDateKey`.
   */
  async getHistoricalSnapshotForDate(targetDateKey) {
    await this.init();
    const todayKey = toDateKey(new Date());

    const [
      userNumbers,
      agentNumbers,
      agents,
      importHistory,
      statusHistory,
      activityLog
    ] = await Promise.all([
      this.getAll('user_numbers'),
      this.getAll('agent_numbers'),
      this.getAll('agents'),
      this.getAll('import_history'),
      this.getAll('status_history'),
      this.getAll('activity_log')
    ]);

    // If targetDateKey is today, current live lists ARE the exact state, plus today's events
    const endOfTargetDayIso = `${targetDateKey}T23:59:59.999Z`;

    // Group status history events by numberId, sorted chronologically
    const eventsByNumberId = new Map();
    for (const ev of statusHistory) {
      if (ev.dateKey <= targetDateKey) {
        if (!eventsByNumberId.has(ev.numberId)) {
          eventsByNumberId.set(ev.numberId, []);
        }
        eventsByNumberId.get(ev.numberId).push(ev);
      }
    }
    for (const [, list] of eventsByNumberId) {
      list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    const reconstructList = (records) => {
      const result = [];
      for (const rec of records) {
        // Only include numbers imported on or before targetDateKey
        if (rec.importDateKey > targetDateKey) continue;

        if (targetDateKey >= todayKey) {
          result.push({
            ...rec,
            snapshotDateKey: targetDateKey,
            importedOnSelectedDate: rec.importDateKey === targetDateKey,
            changedOnSelectedDate: toDateKey(rec.statusUpdatedAt) === targetDateKey
          });
          continue;
        }

        const historyUpToDate = eventsByNumberId.get(rec.id) || [];
        let statusOnDate = 'pending';
        let statusTimestampOnDate = rec.importedAt;
        let changedOnSelectedDate = false;

        if (historyUpToDate.length > 0) {
          const latestEvent = historyUpToDate[historyUpToDate.length - 1];
          statusOnDate = latestEvent.newStatus;
          statusTimestampOnDate = latestEvent.timestamp;
          changedOnSelectedDate = historyUpToDate.some((e) => e.dateKey === targetDateKey && e.previousStatus !== null);
        } else {
          // If the number was imported >30 days ago and had no status change in the last 30 days,
          // its status on targetDateKey was its current status
          statusOnDate = rec.status;
          statusTimestampOnDate = rec.statusUpdatedAt;
        }

        result.push({
          ...rec,
          status: statusOnDate,
          statusUpdatedAt: statusTimestampOnDate,
          snapshotDateKey: targetDateKey,
          importedOnSelectedDate: rec.importDateKey === targetDateKey,
          changedOnSelectedDate
        });
      }
      return result;
    };

    const userSnapshot = reconstructList(userNumbers);
    const agentSnapshot = reconstructList(agentNumbers);

    const dayImports = importHistory.filter((imp) => imp.dateKey === targetDateKey);
    const dayStatusChanges = statusHistory.filter(
      (st) => st.dateKey === targetDateKey && st.previousStatus !== null
    );
    const dayActivities = activityLog
      .filter((log) => log.dateKey === targetDateKey)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const computeStats = (list, modName) => {
      const total = list.length;
      const positive = list.filter((r) => r.status === 'positive').length;
      const negative = list.filter((r) => r.status === 'negative').length;
      const pending = list.filter((r) => r.status === 'pending').length;
      const importedOnDay = dayImports
        .filter((i) => i.module === modName)
        .reduce((acc, i) => acc + (i.importedCount || 0), 0);
      const statusChangesOnDay = dayStatusChanges.filter((s) => s.module === modName).length;
      return { total, positive, negative, pending, importedOnDay, statusChangesOnDay };
    };

    return {
      dateKey: targetDateKey,
      endOfTargetDayIso,
      userNumbers: userSnapshot,
      agentNumbers: agentSnapshot,
      agents,
      userStats: computeStats(userSnapshot, 'user'),
      agentStats: computeStats(agentSnapshot, 'agent'),
      dayImports,
      dayStatusChanges,
      dayActivities
    };
  }

  /**
   * Synchronize and persist the Daily Report record for a given `dateKey`
   */
  async syncDailyReport(dateKey = toDateKey(new Date())) {
    await this.init();
    const snapshot = await this.getHistoricalSnapshotForDate(dateKey);
    const report = {
      dateKey,
      timestamp: new Date().toISOString(),
      user: snapshot.userStats,
      agent: snapshot.agentStats,
      totalImportsOnDay: snapshot.userStats.importedOnDay + snapshot.agentStats.importedOnDay,
      totalStatusChangesOnDay:
        snapshot.userStats.statusChangesOnDay + snapshot.agentStats.statusChangesOnDay
    };

    const tx = this.db.transaction('daily_reports', 'readwrite');
    tx.objectStore('daily_reports').put(report);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    return report;
  }

  /**
   * Build complete 30-Day Daily Reports series for charts, calendar badges, and historical table
   */
  async getThirtyDayReports(referenceDate = new Date()) {
    await this.init();
    const dateKeys = getLastNDaysKeys(RETENTION_DAYS, referenceDate);
    const reports = [];
    for (const key of dateKeys) {
      const snap = await this.getHistoricalSnapshotForDate(key);
      reports.push({
        dateKey: key,
        user: snap.userStats,
        agent: snap.agentStats,
        dayImportsCount: snap.userStats.importedOnDay + snap.agentStats.importedOnDay,
        dayStatusChangesCount:
          snap.userStats.statusChangesOnDay + snap.agentStats.statusChangesOnDay
      });
    }
    return reports;
  }

  /**
   * Seed realistic multi-day historical data (plus a >30-day active number to demonstrate retention policy!)
   * so the user can immediately test and verify 30-day history, calendar snapshots, and retention rules.
   */
  async seedSampleThirtyDayData() {
    await this.init();
    const agents = await this.ensureDefaultAgents();
    const now = new Date();

    const makeDateDaysAgo = (daysAgo, hour = 14, minute = 30) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, minute, 0, 0);
      return d;
    };

    // 1. Add an active number imported 45 days ago (to prove active numbers >30 days old are NOT deleted!)
    // AND an old history log 45 days ago (which WILL be pruned by enforceThirtyDayRetention!)
    const date45DaysAgo = makeDateDaysAgo(45, 10, 15);
    await this.importNumbers({
      module: 'user',
      rawNumbers: [
        {
          phone: '+91 98100 45001',
          notes: 'Legacy VIP Lead (Imported 45 days ago - preserved as active number)',
          status: 'positive',
          sourceFile: 'legacy_contacts_sep.png'
        }
      ],
      sourceType: 'ocr',
      sourceFiles: ['legacy_contacts_sep.png'],
      customTimestamp: date45DaysAgo.toISOString()
    });

    // 2. Seed User & Agent imports across several dates within the last 30 days
    const sampleDays = [
      {
        daysAgo: 25,
        userPhones: ['+91 98201 11001', '+91 98201 11002', '+91 98201 11003'],
        agentPhones: ['+91 97110 22001', '+91 97110 22002'],
        agentIdx: 0,
        fileUser: 'whatsapp_leads_day25.png',
        fileAgent: 'agent_calllog_day25.png'
      },
      {
        daysAgo: 14,
        userPhones: ['+91 98201 14001', '+91 98201 14002', '+91 98201 14003', '+91 98201 14004'],
        agentPhones: ['+91 97110 24001', '+91 97110 24002', '+91 97110 24003'],
        agentIdx: 1,
        fileUser: 'inbound_sheet_day14.png',
        fileAgent: 'priya_leads_day14.png'
      },
      {
        daysAgo: 7,
        userPhones: ['+91 98201 17001', '+91 98201 17002', '+91 98201 17003'],
        agentPhones: ['+91 97110 27001', '+91 97110 27002', '+91 97110 27003'],
        agentIdx: 2,
        fileUser: 'campaign_ocr_day7.png',
        fileAgent: 'rohan_ocr_day7.png'
      },
      {
        daysAgo: 2,
        userPhones: ['+91 98201 19001', '+91 98201 19002', '+91 98201 19003'],
        agentPhones: ['+91 97110 29001', '+91 97110 29002'],
        agentIdx: 0,
        fileUser: 'gallery_leads_day2.png',
        fileAgent: 'aarav_leads_day2.png'
      },
      {
        daysAgo: 0,
        userPhones: ['+91 98201 20001', '+91 98201 20002', '+91 98201 20003', '+91 98201 20004'],
        agentPhones: ['+91 97110 30001', '+91 97110 30002', '+91 97110 30003'],
        agentIdx: 1,
        fileUser: 'today_gallery_scan.png',
        fileAgent: 'today_agent_scan.png'
      }
    ];

    for (const batch of sampleDays) {
      const importTime = makeDateDaysAgo(batch.daysAgo, 11, 0);
      const userRes = await this.importNumbers({
        module: 'user',
        rawNumbers: batch.userPhones.map((p, idx) => ({
          phone: p,
          notes: `Imported ${batch.daysAgo === 0 ? 'today' : batch.daysAgo + 'd ago'} (#${idx + 1})`,
          sourceFile: batch.fileUser
        })),
        sourceType: 'ocr',
        sourceFiles: [batch.fileUser],
        customTimestamp: importTime.toISOString()
      });

      const assignedAgent = agents[batch.agentIdx % agents.length];
      const agentRes = await this.importNumbers({
        module: 'agent',
        rawNumbers: batch.agentPhones.map((p, idx) => ({
          phone: p,
          notes: `Assigned to ${assignedAgent.name} (#${idx + 1})`,
          sourceFile: batch.fileAgent
        })),
        sourceType: 'ocr',
        sourceFiles: [batch.fileAgent],
        agentId: assignedAgent.id,
        customTimestamp: importTime.toISOString()
      });

      // Perform status transitions a couple hours later or the next day
      const statusTime = makeDateDaysAgo(Math.max(0, batch.daysAgo - 1), 16, 20);
      if (userRes.addedRecords[0]) {
        await this.updateNumbersStatus({
          module: 'user',
          numberIds: [userRes.addedRecords[0].id],
          newStatus: 'positive',
          customTimestamp: statusTime.toISOString()
        });
      }
      if (userRes.addedRecords[1]) {
        await this.updateNumbersStatus({
          module: 'user',
          numberIds: [userRes.addedRecords[1].id],
          newStatus: 'negative',
          customTimestamp: statusTime.toISOString()
        });
      }
      if (agentRes.addedRecords[0]) {
        await this.updateNumbersStatus({
          module: 'agent',
          numberIds: [agentRes.addedRecords[0].id],
          newStatus: 'positive',
          customTimestamp: statusTime.toISOString()
        });
      }
      if (agentRes.addedRecords[1] && batch.daysAgo >= 7) {
        await this.updateNumbersStatus({
          module: 'agent',
          numberIds: [agentRes.addedRecords[1].id],
          newStatus: 'negative',
          customTimestamp: statusTime.toISOString()
        });
      }
    }

    // Run 30-day retention policy to prune the 45-day-old history logs while keeping the 45-day-old active number!
    const retentionResult = await this.enforceThirtyDayRetention(now);
    await this.syncDailyReport(toDateKey(now));
    return retentionResult;
  }

  /**
   * Clear all database records (with confirmation from UI)
   */
  async clearAllData() {
    await this.init();
    const stores = [
      'user_numbers',
      'agent_numbers',
      'import_history',
      'status_history',
      'daily_reports',
      'activity_log'
    ];
    const tx = this.db.transaction(stores, 'readwrite');
    for (const s of stores) {
      tx.objectStore(s).clear();
    }
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }
}

/**
 * Convert an array of objects to RFC-4180 compliant CSV string and trigger browser download
 */
export function exportRecordsToCSV(filename, headers, rows) {
  const escapeCell = (val) => {
    const str = val === null || val === undefined ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map((h) => escapeCell(h.label)).join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h.key])).join(','))
  ];

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return csvContent;
}

export const db = new LeadTrackDatabase();
