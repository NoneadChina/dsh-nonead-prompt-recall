/**
 * Persisted plugin settings.
 *
 * One small JSON file under `<DSH_HOME>/plugin-data/<plugin>/settings.json`.
 * Writes are atomic (tmp + rename) and serialized; reads are served from memory
 * after the first load so the capture path never awaits disk I/O.
 *
 * Pure Node (no DSH imports) so it can be unit-tested directly.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({
  /** Capture new prompts at all. */
  enabled: true,
  /** Entries kept per workspace. */
  maxEntries: 500,
  /** Drop entries older than this many days; 0 keeps everything. */
  retentionDays: 0,
});

export const MAX_ENTRIES_LIMIT = 5000;
export const MAX_RETENTION_DAYS = 3650;

/** @param {unknown} value */
function toInt(value, fallback) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/**
 * Clamp arbitrary input into a valid settings object.
 * @param {unknown} raw
 * @returns {{enabled: boolean, maxEntries: number, retentionDays: number}}
 */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    maxEntries: Math.min(MAX_ENTRIES_LIMIT, Math.max(1, toInt(source.maxEntries, DEFAULT_SETTINGS.maxEntries))),
    retentionDays: Math.min(MAX_RETENTION_DAYS, Math.max(0, toInt(source.retentionDays, DEFAULT_SETTINGS.retentionDays))),
  };
}

export class SettingsStore {
  #file;
  #now;
  #onError;
  #current = { ...DEFAULT_SETTINGS };
  #loaded = false;
  #loads = null;
  #chain = Promise.resolve();

  /**
   * @param {string} file - settings JSON path.
   * @param {{now?: () => number, onError?: (error: unknown, context: string) => void}} [options]
   */
  constructor(file, options = {}) {
    this.#file = file;
    this.#now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.#onError = typeof options.onError === 'function' ? options.onError : undefined;
  }

  #report(error, context) {
    try {
      this.#onError?.(error, context);
    } catch {
      /* reporting must never break settings */
    }
  }

  /** @returns {{enabled: boolean, maxEntries: number, retentionDays: number}} current settings. */
  get() {
    return { ...this.#current };
  }

  /**
   * Load once from disk; a missing or broken file falls back to defaults (a
   * broken file is quarantined so the next save can proceed).
   * @returns {Promise<{enabled: boolean, maxEntries: number, retentionDays: number}>}
   */
  async load() {
    if (this.#loaded) return this.get();
    if (this.#loads !== null) return this.#loads;
    this.#loads = (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.#file, 'utf8'));
        this.#current = normalizeSettings(parsed);
      } catch (error) {
        if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
          this.#current = { ...DEFAULT_SETTINGS };
        } else if (error instanceof SyntaxError) {
          await rename(this.#file, `${this.#file}.corrupt-${this.#now()}`).catch((renameError) => {
            this.#report(renameError, 'corrupt-quarantine');
          });
        } else {
          this.#report(error, 'load');
        }
        this.#current = normalizeSettings(this.#current);
      }
      this.#loaded = true;
      return this.get();
    })().finally(() => {
      this.#loads = null;
    });
    return this.#loads;
  }

  /**
   * Merge a patch, persist it atomically and return the new settings.
   * @param {{enabled?: boolean, maxEntries?: number, retentionDays?: number}} patch
   * @returns {Promise<{enabled: boolean, maxEntries: number, retentionDays: number}>}
   */
  async update(patch) {
    await this.load();
    this.#current = normalizeSettings({ ...this.#current, ...(patch !== null && typeof patch === 'object' ? patch : {}) });
    const payload = JSON.stringify({ version: 1, ...this.#current, updatedAt: this.#now() });
    const task = this.#chain.then(async () => {
      await mkdir(dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, this.#file);
    });
    // Keep the queue usable after a failed write, but let THIS caller see the
    // failure so the settings UI can report "not saved" instead of lying.
    this.#chain = task.catch((error) => {
      this.#report(error, 'persist');
    });
    await task;
    return this.get();
  }

  /** Wait for the latest scheduled save. @returns {Promise<void>} */
  async flush() {
    await this.#chain.catch(() => {});
  }
}
