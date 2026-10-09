import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function workbook(type = 'number', value = 1) {
  return { id: 'wb_test', name: 'Test', pages: [{ id: 'pg_test', name: 'Page', tableViews: [{ tableId: 'tbl_test' }] }],
    tables: [{ schema: { id: 'tbl_test', name: 'Table', fields: [{ id: 'fld_value', name: 'value', type }] },
      data: { tableId: 'tbl_test', rows: [{ id: 'row_one', values: { fld_value: value } }] } }] };
}
export async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'workbook-core-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// Rebuild only the Thrift footer, preserving real encoded pages for adversarial fixtures.
export async function rewriteMetadata(bytes, mutate) {
  const { parquetMetadata } = await import('hyparquet');
  const { ByteWriter } = await import('hyparquet-writer');
  const { writeMetadata } = await import('hyparquet-writer/src/metadata.js');
  const buffer = new Uint8Array(bytes).buffer;
  const metadata = parquetMetadata(buffer);
  mutate(metadata);
  const writer = new ByteWriter();
  writer.appendBytes(new Uint8Array(buffer, 0, buffer.byteLength - metadata.metadata_length - 8));
  writeMetadata(writer, metadata);
  writer.appendBytes(new TextEncoder().encode('PAR1'));
  return writer.getBytes();
}
