/**
 * Per-workspace prompt history store.
 *
 * One JSON file per workspace under `<rootDir>/<workspaceKey>.json`; entries are
 * kept newest-first and written atomically (tmp + rename). The store is
 * process-wide and cheap to read: `list()` loads once and then serves memory.
 *
 * This module is pure Node (no DSH imports) so it can be unit-tested directly.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const HISTORY_VERSION = 1;
export const DEFAULT_MAX_ENTRIES = 500;
export const MAX_TEXT_CHARS = 32_000;
export const MAX_TOTAL_CHARS = 2_000_000;
export const MAX_SESSION_ID_CHARS = 200;

/** Keep metadata fields bounded; imported files are untrusted input. */
function normalizeSessionId(value) {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_SESSION_ID_CHARS) : undefined;
}

/**
 * Normalize a workspace path into a stable identity.
 *
 * Windows paths are case-insensitive, so they are lower-cased; POSIX paths keep
 * their case. Backslashes are folded to forward slashes so both spellings of the
 * same Windows directory share one history file.
 *
 * @param {string} cwd - workspace directory.
 * @returns {string} normalized identity ('' when empty).
 */
export function normalizeWorkspacePath(cwd) {
  const raw = typeof cwd === 'string' ? cwd.trim() : '';
  if (raw === '') return '';
  let out = raw.replace(/\\/gu, '/').replace(/\/+/gu, '/');
  if (out.length > 1) out = out.replace(/\/+$/u, '');
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/**
 * Stable file-name key for one workspace.
 * @param {string} cwd - workspace directory.
 * @returns {string} 24-hex-character key ('' for an empty workspace).
 */
export function workspaceKey(cwd) {
  const normalized = normalizeWorkspacePath(cwd);
  if (normalized === '') return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24);
}

/**
 * Clamp one prompt for storage.
 * @param {string} text - raw prompt text.
 * @returns {string} trimmed text, bounded to MAX_TEXT_CHARS.
 */
export function normalizeEntryText(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.replace(/\r\n/gu, '\n').trim();
  if (trimmed === '') return '';
  return trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS) : trimmed;
}

function sanitizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const item of entries) {
    if (typeof item === 'string') {
      const text = normalizeEntryText(item);
      if (text !== '') out.push({ text, at: 0 });
      continue;
    }
    if (item === null || typeof item !== 'object') continue;
    const text = normalizeEntryText(item.text);
    if (text === '') continue;
    out.push({
      text,
      at: Number.isFinite(item.at) ? Number(item.at) : 0,
      ...(normalizeSessionId(item.sessionId) !== undefined ? { sessionId: normalizeSessionId(item.sessionId) } : {}),
    });
  }
  return out;
}

function totalChars(entries) {
  let sum = 0;
  for (const entry of entries) sum += entry.text.length;
  return sum;
}

export class HistoryStore {
  #rootDir;
  #maxEntries;
  #retentionDays;
  #now;
  #onError;
  #records = new Map();
  #loads = new Map();
  #chains = new Map();

  /**
   * @param {string} rootDir - directory holding one JSON file per workspace.
   * @param {{maxEntries?: number, retentionDays?: number, now?: () => number, onError?: (error: unknown, context: string) => void}} [options]
   */
  constructor(rootDir, options = {}) {
    this.#rootDir = rootDir;
    this.#maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_ENTRIES;
    this.#retentionDays = Number.isSafeInteger(options.retentionDays) && options.retentionDays > 0
      ? options.retentionDays
      : 0;
    this.#now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.#onError = typeof options.onError === 'function' ? options.onError : undefined;
  }

  /**
   * Apply new limits (from settings); cached records are trimmed immediately and
   * a trimmed record is written back so the change survives a restart.
   * @param {{maxEntries?: number, retentionDays?: number}} limits
   */
  setLimits(limits = {}) {
    if (Number.isSafeInteger(limits.maxEntries) && limits.maxEntries > 0) this.#maxEntries = limits.maxEntries;
    if (Number.isSafeInteger(limits.retentionDays) && limits.retentionDays >= 0) this.#retentionDays = limits.retentionDays;
    for (const record of this.#records.values()) {
      if (this.#trimRecord(record)) this.#persist(record.key);
    }
  }

  /** Trim one record; @returns {boolean} whether entries were dropped. */
  #trimRecord(record) {
    const before = record.entries.length;
    this.#trim(record.entries);
    return record.entries.length !== before;
  }

  #report(error, context) {
    try {
      this.#onError?.(error, context);
    } catch {
      /* reporting must never break the capture path */
    }
  }

  /** @returns {string} directory holding the history files. */
  get rootDir() {
    return this.#rootDir;
  }

  /**
   * File holding one workspace's history.
   * @param {string} cwd - workspace directory.
   * @returns {string} absolute-ish path ('' when the workspace is invalid).
   */
  filePath(cwd) {
    const key = workspaceKey(cwd);
    return key === '' ? '' : join(this.#rootDir, `${key}.json`);
  }

  /**
   * Newest-first history of one workspace.
   * @param {string} cwd - workspace directory.
   * @returns {Promise<Array<{text: string, at: number, sessionId?: string}>>}
   */
  async list(cwd) {
    const record = await this.#ensureLoaded(cwd);
    if (record === null) return [];
    // Retention can expire entries while the process runs; trim on every read so
    // the UI never shows entries the settings already excluded.
    if (this.#trimRecord(record)) this.#persist(record.key);
    return record.entries.map((entry) => ({ ...entry }));
  }

  /**
   * Append one submitted prompt (newest-first, consecutive duplicates skipped).
   * @param {string} cwd - workspace directory.
   * @param {string} text - prompt text.
   * @param {{at?: number, sessionId?: string}} [meta]
   * @returns {Promise<boolean>} whether a new entry was stored.
   */
  async append(cwd, text, meta = {}) {
    const normalized = normalizeEntryText(text);
    if (normalized === '') return false;
    const record = await this.#ensureLoaded(cwd);
    if (record === null) return false;

    const newest = record.entries[0];
    if (newest !== undefined && newest.text === normalized) return false;

    const entry = { text: normalized, at: Number.isFinite(meta.at) ? Number(meta.at) : this.#now() };
    const sessionId = normalizeSessionId(meta.sessionId);
    if (sessionId !== undefined) entry.sessionId = sessionId;
    record.entries.unshift(entry);
    this.#trim(record.entries);
    this.#persist(record.key);
    return true;
  }

  /**
   * Wait until every scheduled write has settled (used by tests and shutdown).
   * @returns {Promise<void>}
   */
  async flush() {
    const pending = [...this.#chains.values()];
    await Promise.allSettled(pending);
  }

  /**
   * Delete one workspace's history (memory + file). A queued write for the same
   * workspace is awaited first so it cannot resurrect the file afterwards.
   * @param {string} cwd - workspace directory.
   * @returns {Promise<boolean>} whether a workspace was addressed.
   */
  async clear(cwd) {
    const key = workspaceKey(cwd);
    if (key === '') return false;
    await (this.#chains.get(key) ?? Promise.resolve());
    this.#chains.delete(key);
    this.#records.delete(key);
    this.#loads.delete(key);
    await rm(join(this.#rootDir, `${key}.json`), { force: true }).catch((error) => {
      this.#report(error, 'clear');
    });
    return true;
  }

  /**
   * Merge exported entries into one workspace, skipping exact duplicates
   * (same timestamp + text), then persist.
   * @param {string} cwd - workspace directory.
   * @param {ReadonlyArray<{text?: unknown, at?: unknown, sessionId?: unknown}>} entries
   * @returns {Promise<{added: number, skipped: number}>}
   */
  async importEntries(cwd, entries) {
    const record = await this.#ensureLoaded(cwd);
    if (record === null || !Array.isArray(entries)) return { added: 0, skipped: 0 };
    const seen = new Set(record.entries.map((entry) => `${entry.at}\u0000${entry.text}`));
    let added = 0;
    let skipped = 0;
    for (const item of entries) {
      const text = normalizeEntryText(item?.text);
      if (text === '') {
        skipped += 1;
        continue;
      }
      const at = Number.isFinite(item?.at) ? Number(item.at) : 0;
      const dedupeKey = `${at}\u0000${text}`;
      if (seen.has(dedupeKey)) {
        skipped += 1;
        continue;
      }
      seen.add(dedupeKey);
      const entry = { text, at };
      const sessionId = normalizeSessionId(item?.sessionId);
      if (sessionId !== undefined) entry.sessionId = sessionId;
      record.entries.push(entry);
      added += 1;
    }
    record.entries.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    this.#trim(record.entries);
    if (added > 0) this.#persist(record.key);
    return { added, skipped };
  }

  #trim(entries) {
    // Keep the invariant newest-first even for hand-edited/imported files, so the
    // count and retention rules below always drop the oldest entries.
    entries.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    if (this.#retentionDays > 0) {
      const cutoff = this.#now() - this.#retentionDays * 86_400_000;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const at = entries[index].at;
        if (at > 0 && at < cutoff) entries.splice(index, 1);
      }
    }
    while (entries.length > this.#maxEntries) entries.pop();
    while (entries.length > 1 && totalChars(entries) > MAX_TOTAL_CHARS) entries.pop();
  }

  async #ensureLoaded(cwd) {
    const key = workspaceKey(cwd);
    if (key === '') return null;

    const cached = this.#records.get(key);
    if (cached !== undefined) return cached;

    const inFlight = this.#loads.get(key);
    if (inFlight !== undefined) return inFlight;

    const promise = this.#load(key, cwd).finally(() => {
      this.#loads.delete(key);
    });
    this.#loads.set(key, promise);
    return promise;
  }

  async #load(key, cwd) {
    const file = join(this.#rootDir, `${key}.json`);
    let data = null;
    let corrupt = false;

    try {
      const raw = await readFile(file, 'utf8');
      data = JSON.parse(raw);
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
        data = null;
      } else if (error instanceof SyntaxError) {
        corrupt = true;
        await rename(file, `${file}.corrupt-${Date.now()}`).catch((renameError) => {
          this.#report(renameError, 'corrupt-quarantine');
        });
      } else {
        this.#report(error, 'load');
        data = null;
      }
    }

    const entries = sanitizeEntries(data?.entries);
    const beforeTrim = JSON.stringify(entries);
    const record = {
      key,
      cwd: typeof data?.cwd === 'string' && data.cwd !== '' ? data.cwd : String(cwd),
      entries,
      corrupt,
    };
    this.#trim(record.entries);
    this.#records.set(key, record);
    // If the file held entries outside the current limits, write the trimmed
    // version once so the on-disk file matches what the UI shows.
    if (data !== null && JSON.stringify(record.entries) !== beforeTrim) {
      this.#persist(key);
    }
    return record;
  }

  #persist(key) {
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => this.#writeNow(key))
      .catch((error) => {
        /* A failed write must not break the capture path; the next append retries. */
        this.#report(error, 'persist');
      });
    this.#chains.set(key, next);
  }

  async #writeNow(key) {
    const record = this.#records.get(key);
    if (record === undefined) return;
    await mkdir(this.#rootDir, { recursive: true });
    const payload = JSON.stringify({
      version: HISTORY_VERSION,
      cwd: record.cwd,
      updatedAt: this.#now(),
      entries: record.entries,
    });
    const file = join(this.#rootDir, `${key}.json`);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, file);
  }
}
