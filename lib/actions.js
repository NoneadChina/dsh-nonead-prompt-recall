/**
 * Shared history actions (export / import / export listing) used by both the
 * `/prompt-recall` command and the settings-page RPC endpoints.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { workspaceKey } from './history-store.js';

/** Upper bound on one import file, so a bad file cannot exhaust memory. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u;

/** @param {unknown} value @returns {boolean} */
export function isAbsolutePath(value) {
  return typeof value === 'string' && ABSOLUTE_PATH.test(value.trim());
}

/**
 * Write one workspace's history as a JSON export.
 * @param {{store: {list: Function}, exportsDir: string, cwd: string, dir?: string, now?: number}} deps
 * @returns {Promise<{file: string, count: number}>}
 */
export async function exportHistory({ store, exportsDir, cwd, dir, now = Date.now() }) {
  if (dir !== undefined && dir !== '' && !isAbsolutePath(dir)) {
    throw new Error('export directory must be an absolute path');
  }
  const targetDir = typeof dir === 'string' && dir.trim() !== '' ? dir.trim() : exportsDir;
  const entries = await store.list(cwd);
  const stamp = new Date(now).toISOString().replace(/[:.]/gu, '-');
  const base = `${workspaceKey(cwd)}-${stamp}`;
  const payload = JSON.stringify({
    version: 1,
    plugin: 'dsh-nonead-prompt-recall',
    cwd,
    exportedAt: now,
    entries,
  }, null, 2);
  await mkdir(targetDir, { recursive: true });
  // Two exports in the same millisecond must not overwrite each other.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const file = join(targetDir, `${base}${attempt === 0 ? '' : `-${attempt}`}.json`);
    try {
      await writeFile(file, payload, { encoding: 'utf8', flag: 'wx' });
      return { file, count: entries.length };
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('could not allocate an export file name');
}

/**
 * Build an export as an in-memory payload (browser download path). No file is
 * written on the host; the client turns `content` into a Blob and downloads it.
 * @param {{store: {list: Function}, cwd: string, now?: number}} deps
 * @returns {Promise<{filename: string, content: string, count: number}>}
 */
export async function buildExportPayload({ store, cwd, now = Date.now() }) {
  const entries = await store.list(cwd);
  const stamp = new Date(now).toISOString().replace(/[:.]/gu, '-');
  return {
    filename: `prompt-recall-${workspaceKey(cwd)}-${stamp}.json`,
    count: entries.length,
    content: JSON.stringify({
      version: 1,
      plugin: 'dsh-nonead-prompt-recall',
      cwd,
      exportedAt: now,
      entries,
    }, null, 2),
  };
}

/**
 * Merge one export file back into the current workspace. `file` may be an
 * absolute path chosen by the user, or a file name inside the exports directory.
 * Throws a human-readable error on a bad file.
 * @param {{store: {importEntries: Function}, exportsDir: string, cwd: string, file: string}} deps
 * @returns {Promise<{added: number, skipped: number}>}
 */
export async function importHistory({ store, exportsDir, cwd, file }) {
  const raw = String(file ?? '').trim();
  const name = isAbsolutePath(raw) ? raw : basename(raw);
  if (name === '' || !name.toLowerCase().endsWith('.json')) {
    throw new Error('import needs a .json file');
  }
  const path = isAbsolutePath(raw) ? raw : join(exportsDir, name);
  const info = await stat(path);
  if (!info.isFile()) throw new Error('export path is not a file');
  if (info.size > MAX_IMPORT_BYTES) throw new Error('import file is too large');
  const bytes = await readFile(path);
  const parsed = JSON.parse(bytes.toString('utf8'));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : null;
  if (entries === null) throw new Error('not a Prompt Recall export file');
  return store.importEntries(cwd, entries);
}

/**
 * File names available for import (newest first).
 * @param {{exportsDir: string}} deps
 * @returns {Promise<string[]>}
 */
export async function listExports({ exportsDir }) {
  try {
    const names = await readdir(exportsDir);
    return names.filter((name) => name.endsWith('.json')).sort().reverse();
  } catch (error) {
    if (error !== null && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }
}
