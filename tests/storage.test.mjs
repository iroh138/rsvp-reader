// SPDX-License-Identifier: AGPL-3.0-only
// ARH-02: migration planning. Real IndexedDB behaviour (upgrade, rollback, blocked tabs, newer database)
// is tested in the browser by tests/e2e/storage.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, migrationPlan } from '../src/storage.js';

const four = [() => {}, () => {}, () => {}, () => {}];

test('a new database runs every migration in order', () => {
  assert.deepEqual(migrationPlan(0, 4, four), [1, 2, 3, 4]);
});

test('an existing database runs only the missing migrations, even when versions were skipped', () => {
  assert.deepEqual(migrationPlan(1, 4, four), [2, 3, 4]);
  assert.deepEqual(migrationPlan(3, 4, four), [4]);
  assert.deepEqual(migrationPlan(4, 4, four), []);
});

test('negative: a target without a migration, or a broken stored version, is an error', () => {
  assert.throws(() => migrationPlan(0, 5, four));
  assert.throws(() => migrationPlan(0, 0, four));
  assert.throws(() => migrationPlan(-1, 2, four));
  assert.throws(() => migrationPlan(1.5, 2, four));
});

test('the app schema is version 1 and creates the four stores every release has used', () => {
  assert.equal(MIGRATIONS.length, 1);
  const created = [];
  MIGRATIONS[0]({ createObjectStore: (name, opts) => created.push([name, opts]) });
  assert.deepEqual(created, [
    ['documents', { keyPath: 'id' }],
    ['files', { keyPath: 'docId' }],
    ['pages', { keyPath: ['docId', 'pageIndex'] }],
    ['progress', { keyPath: 'docId' }],
  ]);
});

test('shipped migrations cannot be edited by accident', () => {
  assert.ok(Object.isFrozen(MIGRATIONS));
});
