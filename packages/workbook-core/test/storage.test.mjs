import test from 'node:test';
import assert from 'node:assert/strict';
import { join, basename, dirname } from 'node:path';
import { mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { saveWorkbookBundle, openWorkbookBundle, initializeWorkbookRevisionArchive, commitWorkbookRevision, openWorkbookRevisionHistory, openWorkbookRevision, openCurrentWorkbookRevision, WorkbookBundleError } from '../dist/index.js';
import { workbook, sandbox } from './helpers.mjs';
const childPath = new URL('./child.mjs', import.meta.url);
const execute = promisify(execFile);
const lockPath = path => join(dirname(path), `.${basename(path)}.workbook-lock`);
async function files(path, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    const local = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await files(path, local));
    else if (entry.isFile()) result[local] = await readFile(join(path, local));
    else result[local] = 'non-regular';
  }
  return result;
}

test('normal initialization and managed updates preserve ID and values', async t => {
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: workbook() }, path);
  await saveWorkbookBundle({ workbook: workbook('number', 2) }, path);
  assert.equal((await openWorkbookBundle(path)).workbook.tables[0].data.rows[0].values.fld_value, 2);
});
test('ordinary directories and forged format markers are preserved on rejection', async t => {
  const root = await sandbox(t);
  for (const fake of [false, true]) {
    const path = join(root, fake ? 'fake' : 'ordinary');
    await mkdir(path);
    await writeFile(join(path, 'notes.txt'), 'user notes');
    if (fake) await writeFile(join(path, 'workbook.json'), JSON.stringify({ format: 'ai-native-spreadsheet-workbook-bundle', formatVersion: 1 }));
    const before = await files(path);
    await assert.rejects(saveWorkbookBundle({ workbook: workbook() }, path), error => error.code === 'UNSAFE_DESTINATION' && Boolean(error.cause));
    assert.deepEqual(await files(path), before);
  }
});
test('cwd save is rejected in a disposable child working directory', async t => {
  const root = await sandbox(t);
  await writeFile(join(root, 'notes.txt'), 'keep');
  const { stdout } = await execute(process.execPath, [childPath.pathname, 'cwd'], { cwd: root, timeout: 3000 });
  assert.equal(JSON.parse(stdout).code, 'UNSAFE_DESTINATION');
  assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), 'keep');
});
test('unmanaged files, empty directories and symlinks prevent replacement without loss', async t => {
  const root = await sandbox(t);
  for (const extra of ['file', 'directory', 'symlink']) {
    const path = join(root, extra);
    await saveWorkbookBundle({ workbook: workbook() }, path);
    if (extra === 'file') await writeFile(join(path, 'notes.txt'), 'keep');
    if (extra === 'directory') await mkdir(join(path, 'user-folder'));
    if (extra === 'symlink') await symlink(join(path, 'workbook.json'), join(path, 'user-link'));
    const before = await files(path);
    await assert.rejects(saveWorkbookBundle({ workbook: workbook('number', 2) }, path), { code: 'UNSAFE_DESTINATION' });
    assert.deepEqual(await files(path), before);
  }
});
test('failed data validation leaves managed target bytes intact', async t => {
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: workbook() }, path);
  const before = await files(path);
  await assert.rejects(saveWorkbookBundle({ workbook: workbook('number', Infinity) }, path), { code: 'INVALID_DATA' });
  assert.deepEqual(await files(path), before);
});
test('Revision chain is immutable, stale bases and repeated transactions are classified', async t => {
  const path = join(await sandbox(t), 'archive');
  const first = await initializeWorkbookRevisionArchive({ workbook: workbook() }, path);
  const snapshotBefore = await files(join(path, first.revision.snapshotPath));
  const second = await commitWorkbookRevision(path, { workbook: workbook('number', 2) }, { baseRevisionId: first.revision.revisionId, transactionId: 'tx' });
  assert.equal(second.revision.parentRevisionId, first.revision.revisionId);
  assert.equal(second.revision.sequence, 1);
  assert.deepEqual(await files(join(path, first.revision.snapshotPath)), snapshotBefore);
  assert.deepEqual((await openWorkbookRevision(path, first.revision.revisionId)).state.workbook, first.state.workbook);
  assert.equal((await openCurrentWorkbookRevision(path)).revision.revisionId, second.revision.revisionId);
  await assert.rejects(commitWorkbookRevision(path, { workbook: workbook() }, { baseRevisionId: first.revision.revisionId, transactionId: 'new' }), { code: 'CONFLICT' });
  await assert.rejects(commitWorkbookRevision(path, { workbook: workbook() }, { baseRevisionId: second.revision.revisionId, transactionId: 'tx' }), { code: 'CONFLICT' });
  await assert.rejects(saveWorkbookBundle({ workbook: workbook() }, path), { code: 'UNSAFE_DESTINATION' });
  const history = await openWorkbookRevisionHistory(path);
  assert.equal(history.revisions.length, 2);
  assert.deepEqual((await openWorkbookRevision(path, second.revision.revisionId)).state.workbook, second.state.workbook);
  await assert.rejects(initializeWorkbookRevisionArchive({ workbook: workbook() }, path), WorkbookBundleError);
});
test('same-process contenders wait behind a controlled publication barrier', async t => {
  const path = join(await sandbox(t), 'archive');
  const first = await initializeWorkbookRevisionArchive({ workbook: workbook() }, path);
  await mkdir(lockPath(path));
  let settled = 0;
  const contenders = ['first', 'second'].map((transactionId, i) => commitWorkbookRevision(path, { workbook: workbook('number', i + 2) }, { baseRevisionId: first.revision.revisionId, transactionId }).finally(() => settled++));
  const resultsPromise = Promise.allSettled(contenders);
  await delay(60);
  assert.equal(settled, 0);
  await rm(lockPath(path), { recursive: true });
  const results = await resultsPromise;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failure = results.find(r => r.status === 'rejected');
  assert.equal(failure.reason.code, 'CONFLICT');
  const winner = results.find(r => r.status === 'fulfilled').value;
  assert.deepEqual((await openWorkbookRevision(path, winner.revision.revisionId)).state.workbook, winner.state.workbook);
  assert.equal((await openWorkbookRevisionHistory(path)).revisions.length, 2);
});
function prepareChild(t, path, base, transaction) {
  const child = fork(childPath, ['commit', path, base, transaction], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => child.kill());
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => { if (message.ready) resolve(); });
    child.once('exit', code => { if (code) reject(new Error(stderr || `child exit ${code}`)); });
  });
  const started = new Promise(resolve => child.on('message', message => { if (message.started) resolve(); }));
  const result = new Promise(resolve => child.on('message', message => { if (message.result || message.error) resolve(message); }));
  return { child, ready, started, result };
}
test('different-process contenders serialize across directory replacement', async t => {
  const path = join(await sandbox(t), 'archive');
  const first = await initializeWorkbookRevisionArchive({ workbook: workbook() }, path);
  await mkdir(lockPath(path));
  const children = ['first', 'second'].map(tx => prepareChild(t, path, first.revision.revisionId, tx));
  await Promise.all(children.map(c => c.ready));
  children.forEach(c => c.child.send({ start: true }));
  await Promise.all(children.map(c => c.started));
  await rm(lockPath(path), { recursive: true });
  const results = await Promise.all(children.map(c => c.result));
  assert.equal(results.filter(r => r.result).length, 1);
  assert.equal(results.find(r => r.error).error.code, 'CONFLICT');
  const winner = results.find(r => r.result).result;
  assert.deepEqual((await openWorkbookRevision(path, winner.revision.revisionId)).state.workbook, winner.state.workbook);
  assert.equal((await openWorkbookRevisionHistory(path)).revisions.length, 2);
});

test('write-side budgets reject unreadable new states while preserving prior successful revisions', async t => {
  const root = await sandbox(t); const path = join(root, 'archive');
  const first = await initializeWorkbookRevisionArchive({ workbook: workbook() }, path);
  const before = await files(path);
  const oversized = workbook();
  oversized.tables[0].schema.fields = Array.from({ length: 1024 }, (_, i) => ({ id: `f${i}`, name: `f${i}`, type: 'number' }));
  oversized.tables[0].data.rows = [];
  await assert.rejects(commitWorkbookRevision(path, { workbook: oversized }, { baseRevisionId: first.revision.revisionId, transactionId: 'too-wide' }), { code: 'RESOURCE_LIMIT' });
  assert.deepEqual(await files(path), before);
  assert.deepEqual((await openWorkbookRevision(path, first.revision.revisionId)).state.workbook, first.state.workbook);
  await assert.rejects(saveWorkbookBundle({ workbook: oversized }, join(root, 'new')), { code: 'RESOURCE_LIMIT' });
  assert.equal((await openWorkbookRevisionHistory(path)).revisions.length, 1);
});
