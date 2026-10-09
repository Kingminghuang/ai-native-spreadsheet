import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, rm, symlink, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { validateWorkbook, saveWorkbookBundle, openWorkbookBundle, initializeWorkbookRevisionArchive, commitWorkbookRevision, WorkbookBundleError, decodeTableParquet, BUNDLE_LIMITS, PARQUET_LIMITS } from '../dist/index.js';
import { testSafePattern, patternProblem, PATTERN_LIMITS } from '../dist/safe-pattern.js';
import { workbook, sandbox, rewriteMetadata } from './helpers.mjs';
async function fresh(t) {
  const root = await sandbox(t); const path = join(root, 'bundle');
  await saveWorkbookBundle({ workbook: workbook() }, path);
  return { root, path, manifest: JSON.parse(await readFile(join(path, 'workbook.json'), 'utf8')) };
}
async function updateManifest(path, manifest) { await writeFile(join(path, 'workbook.json'), JSON.stringify(manifest)); }

test('missing files, corrupt JSON, schema and Parquet produce contextual Bundle errors with causes', async t => {
  {
    const { path } = await fresh(t);
    await rm(join(path, 'schemas/table-000000.json'));
    await assert.rejects(openWorkbookBundle(path), e => e instanceof WorkbookBundleError && e.code === 'IO' && /schemas/.test(e.message) && Boolean(e.cause));
  }
  for (const [file, content, expected] of [['schemas/table-000000.json', '{broken', 'INVALID_DATA'], ['tables/table-000000.parquet', 'garbage', 'INVALID_DATA']]) {
    const { path } = await fresh(t);
    await writeFile(join(path, file), content);
    await assert.rejects(openWorkbookBundle(path), e => e instanceof WorkbookBundleError && e.code === expected && e.message.includes(file) && Boolean(e.cause));
  }
  {
    const { path } = await fresh(t);
    const file = join(path, 'schemas/table-000000.json');
    const schema = JSON.parse(await readFile(file, 'utf8')); schema.fields[0].constraints = { minimum: 10 };
    await writeFile(file, JSON.stringify(schema));
    await assert.rejects(openWorkbookBundle(path), e => e.code === 'INVALID_DATA' && /greater than/.test(e.message) && Boolean(e.cause));
  }
});
test('malformed stable Row ID and references are classified at Bundle boundary', async t => {
  const { path } = await fresh(t);
  const bytes = parquetWriteBuffer({ codec: 'UNCOMPRESSED', columnData: [{ name: '_row_id', type: 'STRING', data: [''] }, { name: 'field:fld_value', type: 'DOUBLE', data: [1] }] });
  await writeFile(join(path, 'tables/table-000000.parquet'), new Uint8Array(bytes));
  await assert.rejects(openWorkbookBundle(path), e => e.code === 'INVALID_DATA' && /Row ID/.test(e.message) && Boolean(e.cause));
  const other = await fresh(t);
  await assert.rejects(saveWorkbookBundle({ workbook: workbook(), transforms: [{ id: 'tr_test', inputs: ['?invalid'] }] }, other.path), e => e instanceof WorkbookBundleError && e.code === 'INVALID_DATA' && /Transform/.test(e.message) && Boolean(e.cause));
});
test('versions, required features and unresolved references fail whole import', async t => {
  for (const mutate of [m => { m.formatVersion = 99; }, m => { m.requiredFeatures = ['future']; }]) {
    const { path, manifest } = await fresh(t); mutate(manifest); await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), { code: 'UNSUPPORTED_FORMAT' });
  }
  {
    const { path } = await fresh(t); const file = join(path, 'views/page-000000.json');
    const page = JSON.parse(await readFile(file, 'utf8')); page.tableViews[0].tableId = 'unknown';
    await writeFile(file, JSON.stringify(page));
    await assert.rejects(openWorkbookBundle(path), { code: 'INVALID_DATA' });
  }
  {
    const { path } = await fresh(t); const file = join(path, 'schemas/table-000000.json');
    const schema = JSON.parse(await readFile(file, 'utf8')); schema.specVersion = 2;
    await writeFile(file, JSON.stringify(schema));
    await assert.rejects(openWorkbookBundle(path), { code: 'UNSUPPORTED_FORMAT' });
  }
});
test('portable path policy rejects traversal, NUL, drive paths, backslashes and aliases', async t => {
  for (const entry of ['../outside.json', '/absolute.json', 'schemas/./table.json', 'schemas/a\u0000.json', 'C:/outside.json', 'schemas\\table.json']) {
    const { path, manifest } = await fresh(t);
    manifest.entries.schemas[0].path = entry; await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), e => e instanceof WorkbookBundleError && e.code === 'INVALID_PATH');
  }
  {
    const { root, path, manifest } = await fresh(t);
    const outside = join(root, 'outside.json'); await writeFile(outside, '{}');
    await symlink(outside, join(path, 'schemas/escape.json'));
    manifest.entries.schemas[0].path = 'schemas/escape.json'; await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), /outside/);
  }
  {
    const { path, manifest } = await fresh(t);
    await symlink(join(path, 'schemas/table-000000.json'), join(path, 'schemas/alias.json'));
    manifest.entries.calculations = [{ id: 'calc_alias', path: 'schemas/alias.json' }]; await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), /alias/);
  }
  {
    const { path, manifest } = await fresh(t);
    manifest.entries.lineage.path = manifest.entries.views[0].path; await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), /same path/);
  }
});
test('cycles and 20,000-level nesting yield issues without RangeError', () => {
  const cycle = workbook(); cycle.metadata = {}; cycle.metadata.self = cycle.metadata;
  assert.match(validateWorkbook(cycle)[0].message, /cycles/);
  const deep = workbook(); let value = {}; const nested = value;
  for (let i = 0; i < 20_000; i++) { value.child = {}; value = value.child; }
  deep.metadata = nested;
  assert.match(validateWorkbook(deep)[0].message, /budget/);
});
test('import byte, entry, depth, revision and Parquet row budgets are enforced', async t => {
  {
    const { path } = await fresh(t); const handle = await open(join(path, 'workbook.json'), 'r+');
    await handle.truncate(BUNDLE_LIMITS.jsonFileBytes + 1); await handle.close();
    await assert.rejects(openWorkbookBundle(path), { code: 'RESOURCE_LIMIT' });
  }
  {
    const { path, manifest } = await fresh(t);
    manifest.entries.calculations = Array.from({ length: BUNDLE_LIMITS.files }, (_, i) => ({ id: `c${i}`, path: `calculations/${i}.json` }));
    await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), { code: 'RESOURCE_LIMIT' });
  }
  {
    const { path, manifest } = await fresh(t);
    manifest.extensions = JSON.parse('{"child":'.repeat(70) + 'null' + '}'.repeat(70));
    await updateManifest(path, manifest);
    await assert.rejects(openWorkbookBundle(path), { code: 'RESOURCE_LIMIT' });
  }
  {
    const path = join(await sandbox(t), 'archive');
    await initializeWorkbookRevisionArchive({ workbook: workbook() }, path);
    const file = join(path, 'history/index.json'); const index = JSON.parse(await readFile(file, 'utf8'));
    index.revisions = Array(BUNDLE_LIMITS.revisions + 1).fill(index.revisions[0]);
    await writeFile(file, JSON.stringify(index));
    await assert.rejects(openWorkbookBundle(path), { code: 'RESOURCE_LIMIT' });
  }
  {
    const w = workbook();
    const raw = parquetWriteBuffer({ codec: 'UNCOMPRESSED', columnData: [{ name: '_row_id', type: 'STRING', data: ['row_one'] }, { name: 'field:fld_value', type: 'DOUBLE', data: [1] }] });
    const bytes = await rewriteMetadata(new Uint8Array(raw), m => { m.num_rows = BigInt(PARQUET_LIMITS.rows + 1); });
    await assert.rejects(decodeTableParquet(bytes, w.tables[0].schema), /budget/);
  }
});
test('every retained historical snapshot is validated', async t => {
  const path = join(await sandbox(t), 'archive');
  const first = await initializeWorkbookRevisionArchive({ workbook: workbook() }, path);
  await commitWorkbookRevision(path, { workbook: workbook('number', 2) }, { baseRevisionId: first.revision.revisionId, transactionId: 'tx' });
  await rm(join(path, first.revision.snapshotPath, 'tables/table-000000.parquet'));
  await assert.rejects(openWorkbookBundle(path), e => e.code === 'IO' && /table-000000/.test(e.message));
});
test('pathological short regex has an external process hard timeout', async t => {
  const { stdout } = await promisify(execFile)(process.execPath, [new URL('./child.mjs', import.meta.url).pathname, 'regex'], { cwd: await sandbox(t), timeout: 3000 });
  const result = JSON.parse(stdout);
  assert.ok(result.issues.length);
  assert.ok(result.elapsed < 500);
});
test('bounded pattern subset matches supported JavaScript syntax and limits work', () => {
  for (const pattern of ['^a+$', 'a*b?', '^[a-z]+[0-9]?$', '^\\d+\\s?\\w*$', '^.*$', 'a?a?a?b', '^$', '[^a]*', '\\[x\\]']) {
    assert.equal(patternProblem(pattern), undefined);
    for (const subject of ['', 'a', 'aa', 'a1', '123 x', 'bbb', '[x]', 'a\n']) assert.equal(testSafePattern(pattern, subject), new RegExp(pattern).test(subject), `${pattern}: ${subject}`);
  }
  for (const pattern of ['^(a+)+$', '(?=a)', '(a)\\1', 'a|b', 'a{2}', 'a+?']) assert.ok(patternProblem(pattern));
  assert.throws(() => testSafePattern('a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*$', 'a'.repeat(PATTERN_LIMITS.subjectLength)), /budget/);
});

test('many individually bounded regex matches share a cumulative domain/import budget', async t => {
  const w = workbook('string', 'a'.repeat(10_000));
  w.tables[0].schema.fields[0].constraints = { pattern: '^' + 'a*'.repeat(100) + 'b$' };
  w.tables[0].data.rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, values: { fld_value: 'a'.repeat(10_000) } }));
  const started = Date.now();
  const issues = validateWorkbook(w);
  assert.ok(issues.some(issue => /Cumulative/.test(issue.message)));
  assert.ok(Date.now() - started < 1000);
  // Build a valid state first, then introduce the hostile schema during import.
  delete w.tables[0].schema.fields[0].constraints;
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: w }, path);
  const schemaPath = join(path, 'schemas/table-000000.json');
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  schema.fields[0].constraints = { pattern: '^' + 'a*'.repeat(100) + 'b$' };
  await writeFile(schemaPath, JSON.stringify(schema));
  await assert.rejects(openWorkbookBundle(path), { code: 'RESOURCE_LIMIT' });
});
test('Parquet footer cannot under-report actual decoded page sizes', async () => {
  const raw = parquetWriteBuffer({ codec: 'UNCOMPRESSED', columnData: [{ name: '_row_id', type: 'STRING', data: ['row_one'] }, { name: 'field:fld_value', type: 'DOUBLE', data: [1] }] });
  const bytes = await rewriteMetadata(new Uint8Array(raw), m => { m.row_groups[0].columns[0].meta_data.total_uncompressed_size = 1n; });
  await assert.rejects(decodeTableParquet(bytes, workbook().tables[0].schema), /page sizes/);
});
