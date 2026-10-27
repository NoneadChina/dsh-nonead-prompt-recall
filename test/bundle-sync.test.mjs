import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('lib/client.js is generated from src and matches the host RPC channel', async () => {
  const build = join(ROOT, 'scripts', 'build-client.mjs');
  execFileSync(process.execPath, [build], { stdio: 'ignore' });
  execFileSync(process.execPath, [build, '--check'], { stdio: 'ignore' });

  const { RPC_CHANNEL } = await import('../lib/index.js');
  assert.match(RPC_CHANNEL, /^\/[a-z0-9-]+$/u, 'host channels are absolute paths');

  const bundle = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8');
  assert.ok(bundle.includes('window.__ModuleLoader__.load('), 'bundle uses the DSH module loader');
  assert.ok(bundle.includes(RPC_CHANNEL), 'client and host use the same channel');
  assert.doesNotMatch(bundle, /^\s*(?:import|export)\s/mu, 'bundle has no unresolved ESM syntax');
});
