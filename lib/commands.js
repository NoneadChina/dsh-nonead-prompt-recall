/**
 * `/prompt-recall` command surface: settings, clear, export, import.
 *
 * Pure Node apart from `node:fs`; the command handler is created with injected
 * dependencies so it can be unit-tested without a host. Output is localized
 * through `lib/i18n.js` (zh, en, ja, es, fr, de, ru, pt).
 */

import { exportHistory, importHistory, isAbsolutePath } from './actions.js';
import { translateCommand } from './i18n.js';
import { DEFAULT_SETTINGS, MAX_ENTRIES_LIMIT, MAX_RETENTION_DAYS } from './settings.js';

function ok(text) {
  return { kind: 'success', text };
}

function fail(text) {
  return { kind: 'error', text };
}

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) ? number : null;
}

/**
 * Build the `/prompt-recall` handler.
 * @param {{
 *   settings: {get: () => any, update: (patch: any) => Promise<any>},
 *   store: {list: Function, clear: Function, importEntries: Function},
 *   exportsDir: string,
 *   version: string,
 *   locale?: () => string,
 * }} deps
 * @returns {(invocation: any) => Promise<{kind: 'success'|'error', text: string}>}
 */
export function createPromptRecallCommand(deps) {
  const { settings, store, exportsDir, version } = deps;
  const locale = typeof deps.locale === 'function' ? deps.locale : () => 'en';

  return async (invocation) => {
    const t = (key, params) => translateCommand(locale(), key, params);
    try {
      const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : '';
      const [verb = 'status', ...args] = raw === '' ? ['status'] : raw.split(/\s+/u);
      const cwd = typeof invocation?.agent?.session?.header?.cwd === 'string'
        ? invocation.agent.session.header.cwd
        : '';

      if (verb === 'status' || verb === 'help') {
        const current = settings.get();
        const count = cwd === '' ? 0 : (await store.list(cwd)).length;
        return ok([
          t('title', { version }),
          t(current.enabled ? 'captureOn' : 'captureOff'),
          t('max', { max: current.maxEntries }),
          current.retentionDays === 0
            ? t('retentionForever')
            : t('retentionDays', { days: current.retentionDays }),
          t('entriesHere', { count }),
          t('usage'),
        ].join('\n'));
      }

      if (verb === 'on' || verb === 'off') {
        const next = await settings.update({ enabled: verb === 'on' });
        return ok(t(next.enabled ? 'captureNowOn' : 'captureNowOff'));
      }

      if (verb === 'max') {
        const value = integer(args[0]);
        if (value === null || value < 1 || value > MAX_ENTRIES_LIMIT) {
          return fail(t('maxErr', { limit: MAX_ENTRIES_LIMIT }));
        }
        await settings.update({ maxEntries: value });
        return ok(t('maxSet', { value }));
      }

      if (verb === 'keep') {
        const value = integer(args[0]);
        if (value === null || value < 0 || value > MAX_RETENTION_DAYS) {
          return fail(t('keepErr', { limit: MAX_RETENTION_DAYS }));
        }
        const next = await settings.update({ retentionDays: value });
        store.setLimits?.(next);
        return ok(value === 0 ? t('keepOff') : t('keepSet', { value }));
      }

      if (verb === 'reset') {
        const next = await settings.update({ ...DEFAULT_SETTINGS });
        store.setLimits?.(next);
        return ok(t('reset'));
      }

      if (verb === 'clear') {
        if (cwd === '') return fail(t('noWorkspace'));
        if (args[0] !== 'confirm') return fail(t('clearRefuse'));
        await store.clear(cwd);
        return ok(t('cleared'));
      }

      if (verb === 'export') {
        if (cwd === '') return fail(t('noWorkspace'));
        const dir = typeof args[0] === 'string' ? args[0] : '';
        if (dir !== '' && !isAbsolutePath(dir)) return fail(t('exportAbs'));
        const { file, count } = await exportHistory({ store, exportsDir, cwd, dir: dir === '' ? undefined : dir });
        return ok(t('exported', { count, file }));
      }

      if (verb === 'import') {
        if (cwd === '') return fail(t('noWorkspace'));
        const rawFile = String(args[0] ?? '').trim();
        if (rawFile === '' || !rawFile.toLowerCase().endsWith('.json')) return fail(t('importNeed'));
        try {
          const { added, skipped } = await importHistory({ store, exportsDir, cwd, file: rawFile });
          return ok(t('imported', { added, skipped }));
        } catch (error) {
          return fail(t('importFailed', { message: error instanceof Error ? error.message : String(error) }));
        }
      }

      return fail(t('unknown', { verb }));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}
