import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkbook, validateTableSchema, encodeTableParquet, ParquetBundleDataError, saveWorkbookBundle } from '../dist/index.js';
import { isJsonValue, JSON_LIMITS } from '../dist/json.js';
import { workbook, sandbox } from './helpers.mjs';
import { join } from 'node:path';

test('domain rejects invalid IDs, duplicate identities, types, values and local keys', () => {
  const changes = [
    w => { w.id = '?invalid'; },
    w => { w.pages.push(structuredClone(w.pages[0])); },
    w => { w.tables.push(structuredClone(w.tables[0])); },
    w => { w.tables[0].schema.fields.push(structuredClone(w.tables[0].schema.fields[0])); },
    w => { w.tables[0].data.rows.push(structuredClone(w.tables[0].data.rows[0])); },
    w => { w.tables[0].schema.fields[0].type = 'unknown'; },
    w => { w.tables[0].data.tableId = 'wrong'; },
    w => { w.tables[0].data.rows[0].values.unknown = 1; },
    w => { w.tables[0].schema.fields[0].constraints = { required: true }; w.tables[0].data.rows[0].values = {}; },
    w => { w.tables[0].schema.primaryKey = ['unknown']; },
    w => { w.tables[0].schema.primaryKey = ['fld_value']; w.tables[0].data.rows[0].values.fld_value = null; },
    w => { w.tables[0].schema.primaryKey = ['fld_value']; w.tables[0].data.rows.push({ id: 'row_two', values: { fld_value: 1 } }); },
    w => { w.tables[0].schema.fields[0].constraints = { unique: true }; w.tables[0].data.rows.push({ id: 'row_two', values: { fld_value: 1 } }); },
    w => { w.tables[0].schema.fields[0].constraints = { minimum: 10 }; },
    w => { w.tables[0].schema.fields[0].constraints = { maximum: 0 }; },
    w => { w.pages[0].tableViews[0].tableId = 'unknown'; },
    w => { w.tables[0].schema.foreignKeys = [{ fields: ['fld_value'], reference: { tableId: 'unknown', fields: ['unknown'] } }]; },
    w => { w.tables[0].schema.foreignKeys = [{ fields: ['fld_value'], reference: { tableId: 'tbl_test', fields: ['unknown'] } }]; },
    w => { w.tables[0].schema.foreignKeys = [{ fields: ['fld_value'], reference: { tableId: 'tbl_test', fields: ['fld_value', 'other'] } }]; },
  ];
  for (const change of changes) { const w = workbook(); change(w); assert.ok(validateWorkbook(w).length, String(change)); }
  const w = workbook('integer', 2 ** 53);
  assert.match(validateWorkbook(w)[0].message, /safe integer/);
  assert.throws(() => encodeTableParquet(null), ParquetBundleDataError);
});
test('enum compares canonical nested values and finite numeric constraints remain valid', () => {
  const w = workbook('object', { b: [1e300], a: 1 });
  w.tables[0].schema.fields[0].constraints = { enum: [{ a: 1, b: [1e300] }] };
  assert.deepEqual(validateWorkbook(w), []);
  w.tables[0].data.rows[0].values.fld_value = { a: 2, b: [1e300] };
  assert.ok(validateWorkbook(w).length);
  const number = workbook('number', 1e300);
  number.tables[0].schema.fields[0].constraints = { minimum: 1e21, maximum: 1e300 };
  assert.deepEqual(validateWorkbook(number), []);
  const schema = number.tables[0].schema;
  assert.deepEqual(validateTableSchema(schema), []);
});
test('JSON dense-array boundary excludes its built-in length property', () => {
  assert.equal(isJsonValue(Array(JSON_LIMITS.containerEntries).fill(null)), true);
  assert.equal(isJsonValue(Array(JSON_LIMITS.containerEntries + 1).fill(null)), false);
});
test('Calculation, Transform and Lineage require explicitly declared valid references', async t => {
  const path = join(await sandbox(t), 'bundle');
  for (const extensions of [
    { calculations: [{ id: 'c', targetField: 'unknown' }] },
    { calculations: [{ id: 'c', dependsOn: ['unknown'] }] },
    { transforms: [{ id: 't', inputs: ['unknown'] }] },
    { transforms: [{ id: 't', output: 'unknown' }] },
    { lineage: { records: [{ references: [{ kind: 'row', id: 'row_one', tableId: 'unknown' }] }] } },
    { lineage: { records: [{ references: [{ kind: 'field', id: 'fld_value', tableId: 'unknown' }] }] } },
    { lineage: { records: [{ references: [{ kind: 'page', id: 'unknown' }] }] } },
  ]) await assert.rejects(saveWorkbookBundle({ workbook: workbook(), ...extensions }, path));
});
