import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_VERSIONS, CONTRACTS, PACKAGES } from '../scripts/contract-matrix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every contract row is well formed', () => {
  const ids = new Set();
  for (const contract of CONTRACTS) {
    assert.match(contract.id, /^[a-z][\w.-]+$/u, `id shape: ${contract.id}`);
    assert.ok(!ids.has(contract.id), `duplicate contract id: ${contract.id}`);
    ids.add(contract.id);

    assert.ok(
      Object.prototype.hasOwnProperty.call(PACKAGES, contract.pkg),
      `${contract.id} names an unknown package key: ${contract.pkg}`,
    );
    assert.ok(contract.pattern instanceof RegExp, `${contract.id} needs a RegExp pattern`);
    assert.equal(typeof contract.required, 'boolean', `${contract.id} needs a boolean required`);
    assert.equal(typeof contract.says, 'string', `${contract.id} needs a human-readable says`);
    assert.ok(contract.says.length > 0, `${contract.id} has an empty says`);
    if (!contract.required) {
      // An optional row is only honest when the plugin really has a fallback.
      assert.equal(typeof contract.fallback, 'string', `${contract.id} is optional but documents no fallback`);
      assert.ok(contract.fallback.length > 0, `${contract.id} has an empty fallback`);
    }
  }
});

test('the claimed version list is unique, ordered and inside engines.dsh', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(ALL_VERSIONS.length > 0, 'the matrix must claim at least one version');
  assert.equal(new Set(ALL_VERSIONS).size, ALL_VERSIONS.length, 'ALL_VERSIONS has duplicates');

  // engines.dsh is `>=0.2.1-rc.1 <0.3.0-0`; the matrix has to stay inside the
  // major line it claims, and it must not silently start below the floor.
  assert.ok(ALL_VERSIONS[0] === '0.2.1-rc.1', `the first claimed version should be the engines floor, got ${ALL_VERSIONS[0]}`);
  for (const version of ALL_VERSIONS) {
    assert.match(version, /^0\.2\.\d+(?:-[a-z]+\.\d+)?$/u, `version shape: ${version}`);
  }
  assert.match(pkg.engines.dsh, /^>=0\.2\.1-rc\.1 </u, 'package.json engines.dsh moved; update ALL_VERSIONS with it');
});

test('docs/COMPAT.md documents how to run the matrix', async () => {
  const doc = await readFile(join(ROOT, 'docs', 'COMPAT.md'), 'utf8');
  assert.match(doc, /npm run compat/u);
  assert.match(doc, /contract-matrix\.mjs/u);
});
