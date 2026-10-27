/**
 * `/prompt-recall` command surface: settings, clear, export, import.
 *
 * Pure Node apart from `node:fs`; the command handler is created with injected
 * dependencies so it can be unit-tested without a host.
 */

import { exportHistory, importHistory, isAbsolutePath } from './actions.js';
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
 *   locale?: () => 'zh' | 'en',
 * }} deps
 * @returns {(invocation: any) => Promise<{kind: 'success'|'error', text: string}>}
 */
export function createPromptRecallCommand(deps) {
  const { settings, store, exportsDir, version } = deps;
  const locale = typeof deps.locale === 'function' ? deps.locale : () => 'en';

  return async (invocation) => {
    const zh = locale() === 'zh';
    const t = (en, cn) => (zh ? cn : en);
    try {
      const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : '';
      const [verb = 'status', ...args] = raw === '' ? ['status'] : raw.split(/\s+/u);
      const cwd = typeof invocation?.agent?.session?.header?.cwd === 'string'
        ? invocation.agent.session.header.cwd
        : '';

      if (verb === 'status' || verb === 'help') {
        const current = settings.get();
        const count = cwd === '' ? 0 : (await store.list(cwd)).length;
        const keep = current.retentionDays === 0 ? t('forever', '永久') : `${current.retentionDays}d`;
        return ok([
          t(`Prompt Recall v${version}`, `提示词召回 v${version}`),
          t(`capture: ${current.enabled ? 'on' : 'off'}`, `捕获：${current.enabled ? '开' : '关'}`),
          t(`max entries: ${current.maxEntries}`, `每工作区上限：${current.maxEntries}`),
          t(`retention: ${keep}`, `保留：${keep}`),
          t(`entries here: ${count}`, `当前工作区条数：${count}`),
          t('usage: status | on | off | max <n> | keep <days> | clear confirm | export | import <file> | reset', '用法：status | on | off | max <n> | keep <days> | clear confirm | export | import <file> | reset'),
        ].join('\n'));
      }

      if (verb === 'on' || verb === 'off') {
        const next = await settings.update({ enabled: verb === 'on' });
        return ok(t(`capture is now ${next.enabled ? 'on' : 'off'}`, `捕获已${next.enabled ? '开启' : '关闭'}`));
      }

      if (verb === 'max') {
        const value = integer(args[0]);
        if (value === null || value < 1 || value > MAX_ENTRIES_LIMIT) {
          return fail(t(`max must be an integer between 1 and ${MAX_ENTRIES_LIMIT}`, `max 必须是 1 到 ${MAX_ENTRIES_LIMIT} 之间的整数`));
        }
        await settings.update({ maxEntries: value });
        return ok(t(`max entries set to ${value}`, `每工作区上限已设为 ${value}`));
      }

      if (verb === 'keep') {
        const value = integer(args[0]);
        if (value === null || value < 0 || value > MAX_RETENTION_DAYS) {
          return fail(t(`keep must be 0..${MAX_RETENTION_DAYS} days (0 = forever)`, `keep 必须是 0 到 ${MAX_RETENTION_DAYS} 天（0 = 永久）`));
        }
        const next = await settings.update({ retentionDays: value });
        store.setLimits?.(next);
        return ok(value === 0
          ? t('retention disabled (keep forever)', '已关闭过期清理（永久保留）')
          : t(`entries older than ${value} days will be dropped`, `将清理超过 ${value} 天的历史`));
      }

      if (verb === 'reset') {
        const next = await settings.update({ ...DEFAULT_SETTINGS });
        store.setLimits?.(next);
        return ok(t('settings reset to defaults', '设置已恢复默认'));
      }

      if (verb === 'clear') {
        if (cwd === '') return fail(t('no workspace for this session', '当前会话没有工作区'));
        if (args[0] !== 'confirm') {
          return fail(t('refusing to clear; run `/prompt-recall clear confirm`', '为避免误删，请执行 `/prompt-recall clear confirm`'));
        }
        await store.clear(cwd);
        return ok(t('prompt history cleared for this workspace', '已清空当前工作区的提示词历史'));
      }

      if (verb === 'export') {
        if (cwd === '') return fail(t('no workspace for this session', '当前会话没有工作区'));
        const dir = typeof args[0] === 'string' ? args[0] : '';
        if (dir !== '' && !isAbsolutePath(dir)) {
          return fail(t('export directory must be an absolute path', '导出目录必须是绝对路径'));
        }
        const { file, count } = await exportHistory({ store, exportsDir, cwd, dir: dir === '' ? undefined : dir });
        return ok(t(`exported ${count} entries to ${file}`, `已导出 ${count} 条到 ${file}`));
      }

      if (verb === 'import') {
        if (cwd === '') return fail(t('no workspace for this session', '当前会话没有工作区'));
        const rawFile = String(args[0] ?? '').trim();
        if (rawFile === '' || !rawFile.toLowerCase().endsWith('.json')) {
          return fail(t('import needs a .json file name or absolute path', 'import 需要 .json 文件名或绝对路径'));
        }
        try {
          const { added, skipped } = await importHistory({ store, exportsDir, cwd, file: rawFile });
          return ok(t(`imported ${added} entries (${skipped} skipped)`, `已导入 ${added} 条（跳过 ${skipped} 条）`));
        } catch (error) {
          return fail(t(`import failed: ${error instanceof Error ? error.message : String(error)}`, `导入失败：${error instanceof Error ? error.message : String(error)}`));
        }
      }

      return fail(t(`unknown subcommand: ${verb}`, `未知子命令：${verb}`));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}
