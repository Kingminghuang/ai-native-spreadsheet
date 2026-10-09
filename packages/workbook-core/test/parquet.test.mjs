import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { parquetMetadata } from 'hyparquet';
import { decodeTableParquet, saveWorkbookBundle, openWorkbookBundle, ParquetBundleDataError } from '../dist/index.js';
import { workbook, sandbox, rewriteMetadata } from './helpers.mjs';
async function annotated(schemaElement, data = [42n]) {
  const bytes = new Uint8Array(parquetWriteBuffer({ codec: 'UNCOMPRESSED', columnData: [
    { name: '_row_id', type: 'STRING', data: ['row_one'] },
    { name: 'field:fld_value', type: 'INT64', data },
  ] }));
  const result = await rewriteMetadata(bytes, metadata => Object.assign(metadata.schema[2], schemaElement));
  const element = parquetMetadata(new Uint8Array(result).buffer).schema[2];
  for (const [key, value] of Object.entries(schemaElement)) assert.deepEqual(element[key], value);
  return result;
}
test('signed INT64 optional annotations import as safe integers', async t => {
  for (const schemaElement of [{ converted_type: 'INT_64' }, { logical_type: { type: 'INTEGER', bitWidth: 64, isSigned: true } }, { converted_type: 'INT_64', logical_type: { type: 'INTEGER', bitWidth: 64, isSigned: true } }]) {
    const w = workbook('integer', 42);
    assert.deepEqual(await decodeTableParquet(await annotated(schemaElement), w.tables[0].schema), w.tables[0].data);
    const path = join(await sandbox(t), 'bundle');
    await saveWorkbookBundle({ workbook: w }, path);
    await writeFile(join(path, 'tables/table-000000.parquet'), await annotated(schemaElement));
    assert.deepEqual((await openWorkbookBundle(path)).workbook, w);
  }
});
test('non-equivalent INT64 annotations and unsafe integers remain rejected', async () => {
  const schema = workbook('integer').tables[0].schema;
  for (const annotation of [{ converted_type: 'UINT_64' }, { logical_type: { type: 'INTEGER', bitWidth: 64, isSigned: false } }, { logical_type: { type: 'INTEGER', bitWidth: 32, isSigned: true } }, { converted_type: 'TIMESTAMP_MICROS' }, { converted_type: 'DECIMAL', scale: 0, precision: 8 }, { converted_type: 'UINT_64', logical_type: { type: 'INTEGER', bitWidth: 64, isSigned: true } }]) {
    await assert.rejects(decodeTableParquet(await annotated(annotation), schema), ParquetBundleDataError);
  }
  await assert.rejects(decodeTableParquet(await annotated({ converted_type: 'INT_64' }, [9007199254740992n]), schema), /safe range/);
});
test('real pyarrow 19.0.1 stable-ID files import; different semantics fail', async t => {
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/pyarrow-int64.parquet', import.meta.url)));
  assert.match(parquetMetadata(bytes.buffer).created_by, /arrow version 19.0.1/);
  const w = workbook('integer');
  w.tables[0].data.rows = [
    { id: 'row_min', values: { fld_value: -Number.MAX_SAFE_INTEGER } },
    { id: 'row_max', values: { fld_value: Number.MAX_SAFE_INTEGER } },
  ];
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: w }, path);
  await writeFile(join(path, 'tables/table-000000.parquet'), bytes);
  assert.deepEqual((await openWorkbookBundle(path)).workbook, w);
  for (const name of ['unsafe-int64', 'uint64', 'timestamp', 'decimal']) {
    const fixture = new Uint8Array(await readFile(new URL(`./fixtures/pyarrow-${name}.parquet`, import.meta.url)));
    await assert.rejects(decodeTableParquet(fixture, w.tables[0].schema), ParquetBundleDataError);
  }
});
