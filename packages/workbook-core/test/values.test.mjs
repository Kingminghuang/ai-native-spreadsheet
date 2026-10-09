import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { validateWorkbook, validateTableSchema, encodeTableParquet, decodeTableParquet, saveWorkbookBundle, openWorkbookBundle, ParquetBundleDataError, WorkbookBundleError, createTableId, isSemanticId } from '../dist/index.js';
import { workbook, sandbox, rewriteMetadata } from './helpers.mjs';

const logicalValues = {
  string: '中文\u0000é', number: 1.5, integer: Number.MAX_SAFE_INTEGER, boolean: true,
  date: '2026-10-09', datetime: '2026-10-09T01:02:03Z', time: '01:02:03', year: '2026', yearmonth: '2026-10', duration: 'P2D',
  object: { nested: [1e300, null, { key: 'value' }] }, array: [1e21, true, { x: 2 }], geojson: { type: 'Point', coordinates: [1, 2] }, geopoint: [121.4, 31.2], any: { mixed: [false, 1e16] },
};
for (const [type, value] of Object.entries(logicalValues)) test(`lossless ${type} adapter and Bundle round trip`, async t => {
  const w = workbook(type, value);
  assert.deepEqual(validateWorkbook(w), []);
  const table = w.tables[0];
  assert.deepEqual(await decodeTableParquet(encodeTableParquet(table), table.schema), table.data);
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: w }, path);
  assert.deepEqual((await openWorkbookBundle(path)).workbook, w);
});

test('finite DOUBLE numbers and nested metadata use one value contract', async t => {
  const path = join(await sandbox(t), 'bundle');
  for (const value of [1.5, 1e16, 1e21, 1e300, -1e300, Number.MIN_VALUE]) {
    const w = workbook('number', value);
    w.metadata = { nested: [value] };
    await saveWorkbookBundle({ workbook: w, extensions: { large: value } }, path);
    const state = await openWorkbookBundle(path);
    assert.deepEqual(state.workbook, w);
    assert.equal(state.extensions.large, value);
  }
});
test('integer safe range is enforced by both domain and direct adapter', async () => {
  for (const value of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    const w = workbook('integer', value);
    assert.deepEqual(await decodeTableParquet(encodeTableParquet(w.tables[0]), w.tables[0].schema), w.tables[0].data);
  }
  for (const value of [2 ** 53, -(2 ** 53), 1.5, NaN, Infinity, -Infinity]) {
    const w = workbook('integer', value);
    assert.ok(validateWorkbook(w).length);
    assert.throws(() => encodeTableParquet(w.tables[0]), ParquetBundleDataError);
  }
});
test('adapter rejects lossy JSON values and non-plain containers', () => {
  const sparse = Array(3);
  const cycle = {}; cycle.self = cycle;
  const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('must not invoke'); } });
  const hidden = Object.defineProperty({}, 'x', { value: 1 });
  for (const value of [{ x: undefined }, new Date(), NaN, Infinity, 9007199254740993n, new Uint8Array([1]), new Map(), sparse, cycle, accessor, hidden, { [Symbol('x')]: 1 }]) {
    const w = workbook('any', value);
    assert.ok(validateWorkbook(w).length);
    assert.throws(() => encodeTableParquet(w.tables[0]), ParquetBundleDataError);
  }
  for (const constraints of [new Map([['minimum', 10]]), Object.create({ minimum: 10 }), new (class Constraints { minimum = 10; })(), { constructor: () => 1 }]) {
    const w = workbook(); w.tables[0].schema.fields[0].constraints = constraints;
    assert.ok(validateWorkbook(w).length);
    assert.throws(() => encodeTableParquet(w.tables[0]), ParquetBundleDataError);
  }
  const inherited = workbook();
  inherited.tables[0].data.rows[0].values = Object.create({ fld_value: 1 });
  inherited.tables[0].schema.fields[0].constraints = { required: true, minimum: 10 };
  inherited.tables[0].schema.primaryKey = ['fld_value'];
  assert.ok(validateWorkbook(inherited).length);
});
test('plain/null-prototype JSON and own constructor values round trip safely', async t => {
  const w = workbook('object', Object.assign(Object.create(null), { constructor: 'own', nested: 1e300 }));
  w.tables[0].schema.fields[0].constraints = JSON.parse('{"__proto__":{"x":true},"constructor":"extension"}');
  assert.deepEqual(validateWorkbook(w), []);
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: w }, path);
  assert.deepEqual((await openWorkbookBundle(path)).workbook.tables[0].data.rows[0].values.fld_value, { constructor: 'own', nested: 1e300 });
});
test('missing cells become null, empty tables retain columns, duplicate rows fail adapter', async () => {
  const w = workbook(); delete w.tables[0].data.rows[0].values.fld_value;
  const data = await decodeTableParquet(encodeTableParquet(w.tables[0]), w.tables[0].schema);
  assert.equal(data.rows[0].values.fld_value, null);
  w.tables[0].data.rows = [];
  assert.deepEqual(await decodeTableParquet(encodeTableParquet(w.tables[0]), w.tables[0].schema), w.tables[0].data);
  const bytes = new Uint8Array(parquetWriteBuffer({ columnData: [{ name: '_row_id', type: 'STRING', data: ['row_a', 'row_a'] }, { name: 'field:fld_value', type: 'DOUBLE', data: [1, 2] }], codec: 'UNCOMPRESSED' }));
  await assert.rejects(decodeTableParquet(bytes, w.tables[0].schema), /duplicate Row ID/);
});
test('all JSON logical columns reject nested overflow on decode', async () => {
  for (const type of ['object', 'array', 'geojson', 'geopoint', 'any']) {
    const value = type === 'array' ? '[1e999]' : '{"nested":1e999}';
    const bytes = new Uint8Array(parquetWriteBuffer({ columnData: [{ name: '_row_id', type: 'STRING', data: ['row_a'] }, { name: 'field:fld_value', type: 'BYTE_ARRAY', data: [new TextEncoder().encode(value)] }], codec: 'UNCOMPRESSED' }));
    const jsonBytes = await rewriteMetadata(bytes, metadata => { metadata.schema[2].converted_type = 'JSON'; });
    await assert.rejects(decodeTableParquet(jsonBytes, workbook(type).tables[0].schema), /must contain|invalid JSON/);
  }
});
test('FK specification and prefix-free IDs survive rename and Bundle transport', async t => {
  const w = workbook('integer', 42);
  w.id = '01JWORKBOOK'; w.pages[0].id = '01JPAGE';
  w.tables[0].schema.foreignKeys = [{ fields: ['fld_value'], reference: { tableId: '01JCUSTOMERS', fields: ['01JID'] } }];
  w.tables.push({ schema: { id: '01JCUSTOMERS', name: 'customers', fields: [{ id: '01JID', name: 'id', type: 'integer' }] }, data: { tableId: '01JCUSTOMERS', rows: [{ id: '01JROW', values: { '01JID': 42 } }] } });
  const path = join(await sandbox(t), 'bundle');
  const calculations = [{ id: 'calc_literal', targetField: 'fld_value', expression: { op: 'literal', value: 'fld_notreal' }, dependsOn: ['01JID'] }];
  await saveWorkbookBundle({ workbook: w, calculations }, path);
  w.tables[1].schema.name = 'renamed'; w.tables[1].schema.fields[0].name = 'renamed';
  await saveWorkbookBundle({ workbook: w, calculations }, path);
  assert.deepEqual((await openWorkbookBundle(path)).workbook, w);
  assert.ok(isSemanticId('table', '01JTABLE'));
  assert.match(createTableId(), /^tbl_/);
  await assert.rejects(saveWorkbookBundle({ workbook: w, calculations: [{ ...calculations[0], dependsOn: ['unknown'] }] }, path), WorkbookBundleError);
  assert.ok(validateTableSchema({ ...w.tables[0].schema, foreignKeys: [{ fieldIds: ['fld_value'], reference: { tableId: '01JCUSTOMERS', fieldIds: ['01JID'] } }] }).length);
});
