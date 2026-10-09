import { Worker } from "node:worker_threads";
import { deserializeTCompactProtocol } from "hyparquet/src/thrift.js";
import { isJsonValue, isJsonObject, ownValue } from "./json.js";
import { assertValidTableSchema, assertValidTable } from "./validation.js";
import {
  parquetMetadata,
  parquetReadObjects,
  parquetSchema,
} from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";
import { parseSemanticId, type FieldId, type RowId, type TableId } from "./ids.js";
import type { Field, FieldType, JsonValue, Row, TableData, TableSchema } from "./model.js";

export const PARQUET_LIMITS = Object.freeze({ fileBytes: 64 * 1024 * 1024, rows: 100_000, columns: 1024, decodedBytes: 128 * 1024 * 1024 });

const ROW_ID_COLUMN = "_row_id";

type ParquetType = "BOOLEAN" | "DOUBLE" | "INT64" | "JSON" | "STRING";

export class UnsupportedParquetFieldTypeError extends Error {
  readonly fieldId: string;
  readonly fieldType: string;

  constructor(field: Pick<Field, "id" | "type">) {
    super(`Field '${field.id}' uses unsupported Parquet logical type '${field.type}'.`);
    this.name = "UnsupportedParquetFieldTypeError";
    this.fieldId = field.id;
    this.fieldType = field.type;
  }
}

export class ParquetBundleDataError extends Error {
  readonly code: "INVALID_DATA" | "RESOURCE_LIMIT";
  constructor(message: string, options?: ErrorOptions & { code?: "INVALID_DATA" | "RESOURCE_LIMIT" }) {
    super(message, options);
    this.name = "ParquetBundleDataError";
    this.code = options?.code ?? "INVALID_DATA";
  }
}

/**
 * Encode a Table with one stable row ID column and one stable-ID column per Field.
 * Logical types use the canonical physical mapping defined by the Bundle v1 contract.
 */
export function encodeTableParquet(table: { readonly schema: TableSchema; readonly data: TableData }): Uint8Array {
  try {
    assertValidTable(table);
  } catch (error) {
    throw new ParquetBundleDataError(`Invalid Table '${table?.schema?.id}' for lossless Parquet encoding.`, { cause: error });
  }
  if (table.schema.fields.length + 1 > PARQUET_LIMITS.columns || table.data.rows.length > PARQUET_LIMITS.rows) {
    throw new ParquetBundleDataError(`Table '${table.schema.id}' exceeds Parquet row/column resource budgets.`, { code: 'RESOURCE_LIMIT' });
  }
  const columns = [
    {
      name: ROW_ID_COLUMN,
      data: table.data.rows.map((row) => row.id),
      type: "STRING" as const,
      nullable: false,
    },
    ...table.schema.fields.map((field) => {
      const type = parquetType(field.type);
      const data = table.data.rows.map((row) => ownValue(row.values, field.id) ?? null);
      return {
        name: fieldColumnName(field.id),
        data: data.map((value) => encodeValue(field, value)),
        type,
        nullable: true,
      };
    }),
  ];

  try {
    const bytes = new Uint8Array(parquetWriteBuffer({ columnData: columns, codec: "UNCOMPRESSED" }));
    if (bytes.byteLength > PARQUET_LIMITS.fileBytes) throw new ParquetBundleDataError('Encoded Parquet file resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
    return bytes;
  } catch (error) {
    if (error instanceof ParquetBundleDataError) throw error;
    throw new ParquetBundleDataError("Could not encode Table data as Parquet.", { cause: error });
  }
}

/** Read and strictly validate the physical Parquet column contract for one Table. */
export async function decodeTableParquetInternal(
  bytes: Uint8Array,
  schema: TableSchema,
): Promise<TableData> {
  try { assertValidTableSchema(schema); }
  catch (error) { throw new ParquetBundleDataError('Invalid Parquet Table Schema.', { cause: error }); }
  if (bytes.byteLength > PARQUET_LIMITS.fileBytes) throw new ParquetBundleDataError('Parquet file resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
  const buffer = toArrayBuffer(bytes);
  if (bytes.length < 12) throw new ParquetBundleDataError('Parquet file is truncated.');
  if (new DataView(buffer).getUint32(bytes.length - 8, true) > 8 * 1024 * 1024) {
    throw new ParquetBundleDataError('Parquet footer resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
  }
  let metadata;
  let tree;
  let rawRows;
  try {
    metadata = parquetMetadata(buffer);
    tree = parquetSchema(metadata);

  } catch (error) {
    throw new ParquetBundleDataError(`Could not read Parquet data for Table '${schema.id}'.`, { cause: error });
  }

  if (metadata.num_rows < 0n || metadata.num_rows > BigInt(PARQUET_LIMITS.rows) || tree.children.length > PARQUET_LIMITS.columns) {
    throw new ParquetBundleDataError(`Table '${schema.id}' exceeds Parquet row/column resource budgets.`, { code: 'RESOURCE_LIMIT' });
  }
  let decodedBytes = 0;
  let actualDecodedBytes = 0;
  let groupRows = 0n;
  for (const group of metadata.row_groups) {
    groupRows += group.num_rows;
    if (group.num_rows < 0n || group.num_rows > BigInt(PARQUET_LIMITS.rows)) throw new ParquetBundleDataError('Parquet row group resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
    if (group.columns.length !== tree.children.length) throw new ParquetBundleDataError('Parquet row group column count mismatch.');
    for (const column of group.columns) {
      if (column.file_path !== undefined) throw new ParquetBundleDataError('External Parquet column files are not supported.');
      const meta = column.meta_data;
      if (!meta || meta.num_values !== group.num_rows || meta.total_compressed_size < 0n) throw new ParquetBundleDataError('Invalid flat Parquet column value count or size.');
      const offset = Number(meta.dictionary_page_offset ?? meta.data_page_offset);
      const finish = offset + Number(meta.total_compressed_size);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(finish) || offset < 4 || finish > buffer.byteLength - metadata.metadata_length - 8) throw new ParquetBundleDataError('Parquet column data is out of bounds.');
      const reader = { view: new DataView(buffer, 0, finish), offset };
      let pageBytes = 0;
      let dataValues = 0;
      while (reader.offset < finish) {
        const headerStart = reader.offset;
        const thrift = deserializeTCompactProtocol(reader);
        const header = { uncompressed_page_size: thrift.field_2, compressed_page_size: thrift.field_3 };
        const count = thrift.field_5?.field_1 ?? thrift.field_8?.field_1 ?? thrift.field_7?.field_1;
        if (!Number.isSafeInteger(header.uncompressed_page_size) || header.uncompressed_page_size < 0 || header.uncompressed_page_size > PARQUET_LIMITS.decodedBytes
          || !Number.isSafeInteger(header.compressed_page_size) || header.compressed_page_size < 0 || reader.offset + header.compressed_page_size > finish
          || (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count > PARQUET_LIMITS.rows))) {
          throw new ParquetBundleDataError('Parquet page resource budget or bounds exceeded.', { code: 'RESOURCE_LIMIT' });
        }
        pageBytes += header.uncompressed_page_size + reader.offset - headerStart;
        actualDecodedBytes += header.uncompressed_page_size + reader.offset - headerStart;
        if (actualDecodedBytes > PARQUET_LIMITS.decodedBytes) throw new ParquetBundleDataError('Parquet total page decoded budget exceeded.', { code: 'RESOURCE_LIMIT' });
        if (thrift.field_5 || thrift.field_8) dataValues += count;
        if (pageBytes > PARQUET_LIMITS.decodedBytes) throw new ParquetBundleDataError('Parquet page decoded budget exceeded.', { code: 'RESOURCE_LIMIT' });
        reader.offset += header.compressed_page_size;
      }

      if (dataValues !== Number(group.num_rows)) throw new ParquetBundleDataError('Parquet data page value counts do not match the row group.');
      const size = column.meta_data?.total_uncompressed_size;
      if (size !== BigInt(pageBytes)) throw new ParquetBundleDataError('Parquet decoded page sizes do not match column metadata.');
      if (size === undefined || size < 0n || size > BigInt(PARQUET_LIMITS.decodedBytes)) throw new ParquetBundleDataError('Invalid Parquet decoded size budget.', { code: 'RESOURCE_LIMIT' });
      decodedBytes += Number(size);
    }
  }
  if (groupRows !== metadata.num_rows) throw new ParquetBundleDataError('Parquet row group counts do not match total rows.');
  if (decodedBytes > PARQUET_LIMITS.decodedBytes) throw new ParquetBundleDataError('Parquet decoded size resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
  const expected = new Map<string, { type: ParquetType; field?: Field }>();
  expected.set(ROW_ID_COLUMN, { type: "STRING" });
  for (const field of schema.fields) {
    expected.set(fieldColumnName(field.id), { type: parquetType(field.type), field });
  }

  const children = tree.children;
  const actualNames = children.map(({ element }) => element.name);
  if (actualNames.length !== expected.size || new Set(actualNames).size !== actualNames.length) {
    throw new ParquetBundleDataError(`Table '${schema.id}' has a missing, duplicate, or extra Parquet column.`);
  }

  for (const child of children) {
    const name = child.element.name;
    const expectedColumn = expected.get(name);
    if (expectedColumn === undefined) {
      throw new ParquetBundleDataError(`Table '${schema.id}' contains unexpected Parquet column '${name}'.`);
    }
    if (child.children.length !== 0 || child.element.repetition_type === "REPEATED" || !matchesParquetType(child.element, expectedColumn.type)) {
      throw new ParquetBundleDataError(`Parquet column '${name}' does not match the Bundle v1 physical type for Table '${schema.id}'.`);
    }
  }

  try { rawRows = await parquetReadObjects({ file: buffer }); }
  catch (error) { throw new ParquetBundleDataError(`Could not decode Table '${schema.id}'.`, { cause: error }); }
  if (metadata.num_rows > BigInt(Number.MAX_SAFE_INTEGER) || Number(metadata.num_rows) !== rawRows.length) {
    throw new ParquetBundleDataError(`Table '${schema.id}' has an invalid Parquet row count.`);
  }

  const seenRowIds = new Set<string>();
  const rows: Row[] = rawRows.map((raw, rowIndex) => {
    const rowId = raw[ROW_ID_COLUMN];
    if (typeof rowId !== "string") {
      throw new ParquetBundleDataError(`Table '${schema.id}' row ${rowIndex} is missing its string Row ID.`);
    }
    if (seenRowIds.has(rowId)) throw new ParquetBundleDataError(`Table '${schema.id}' has duplicate Row ID '${rowId}'.`);
    seenRowIds.add(rowId);
    let parsedRowId: RowId;
    try { parsedRowId = parseSemanticId('row', rowId); }
    catch (error) { throw new ParquetBundleDataError(`Table '${schema.id}' row ${rowIndex} has an invalid Row ID.`, { cause: error }); }
    const values: Record<string, JsonValue> = {};
    for (const field of schema.fields) {
      const columnName = fieldColumnName(field.id);
      const value = raw[columnName];
      if (value === undefined) {
        throw new ParquetBundleDataError(`Table '${schema.id}' row ${rowIndex} is missing column '${columnName}'.`);
      }
      Object.defineProperty(values, field.id, { value: decodeValue(field, value), enumerable: true, writable: true, configurable: true });
    }
    return {
      id: parsedRowId,
      values: values as Record<FieldId, JsonValue>,
    };
  });

  const data = { tableId: schema.id as TableId, rows };
  try { assertValidTable({ schema, data }); }
  catch (error) {
    throw new ParquetBundleDataError(`Table '${schema.id}' decoded values are invalid: ${error instanceof Error ? error.message : String(error)}`, { code: error instanceof Error && /budget/.test(error.message) ? 'RESOURCE_LIMIT' : 'INVALID_DATA', cause: error });
  }
  return data;
}

export function fieldColumnName(fieldId: string): string {
  return `field:${fieldId}`;
}

function parquetType(type: FieldType): ParquetType {
  switch (type) {
    case "string":
    case "date":
    case "datetime":
    case "time":
    case "year":
    case "yearmonth":
    case "duration":
      return "STRING";
    case "number":
      return "DOUBLE";
    case "integer":
      return "INT64";
    case "boolean":
      return "BOOLEAN";
    case "object":
    case "array":
    case "geojson":
    case "geopoint":
    case "any":
      return "JSON";
    default:
      throw new Error(`Unsupported logical Field type '${String(type)}'.`);
  }
}

function encodeValue(field: Field, value: JsonValue): JsonValue | bigint {
  if (value === null) return null;
  switch (field.type) {
    case "string":
    case "date":
    case "datetime":
    case "time":
    case "year":
    case "yearmonth":
    case "duration":
      if (typeof value !== "string") throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new UnsupportedParquetFieldTypeError(field);
      return BigInt(value);
    case "boolean":
      if (typeof value !== "boolean") throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "array":
      if (!Array.isArray(value)) throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "geojson":
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "geopoint":
      if (!Array.isArray(value) && (typeof value !== "object" || value === null)) throw new UnsupportedParquetFieldTypeError(field);
      return value;
    case "any":
      return value;
    default:
      throw new UnsupportedParquetFieldTypeError(field);
  }
}

function decodeValue(field: Field, value: unknown): JsonValue {
  if (value === null) return null;
  switch (field.type) {
    case "string":
    case "date":
    case "datetime":
    case "time":
    case "year":
    case "yearmonth":
    case "duration":
      if (typeof value !== "string") throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain UTF-8 strings.`);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain a finite DOUBLE number.`);
      }
      return value;
    case "integer": {
      const integer = typeof value === "bigint" ? Number(value) : value;
      if (typeof integer !== "number" || !Number.isSafeInteger(integer)) {
        throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' contains an integer outside JavaScript's safe range.`);
      }
      return integer;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain booleans.`);
      return value;
    case "object":
      if (!isJsonObject(value)) throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain JSON objects.`);
      return value;
    case "array":
      if (!isJsonArray(value)) throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain JSON arrays.`);
      return value;
    case "geojson":
      if (!isJsonObject(value)) throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain GeoJSON objects.`);
      return value;
    case "geopoint":
      if (!isJsonArray(value) && !isJsonObject(value)) throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' must contain JSON arrays or objects.`);
      return value;
    case "any":
      if (!isJsonValue(value)) throw new ParquetBundleDataError(`Column '${fieldColumnName(field.id)}' contains an invalid JSON value.`);
      return value;
    default:
      throw new UnsupportedParquetFieldTypeError(field);
  }
}

function matchesParquetType(
  element: { readonly type?: string; readonly converted_type?: string; readonly logical_type?: { readonly type?: string; readonly bitWidth?: number; readonly isSigned?: boolean } },
  expected: ParquetType,
): boolean {
  switch (expected) {
    case "STRING":
      return element.type === "BYTE_ARRAY" && (element.converted_type === "UTF8" || element.logical_type?.type === "STRING");
    case "JSON":
      return element.type === "BYTE_ARRAY" && (element.converted_type === "JSON" || element.logical_type?.type === "JSON");
    case "INT64":
      return element.type === 'INT64'
        && (element.converted_type === undefined || element.converted_type === 'INT_64')
        && (element.logical_type === undefined || (element.logical_type.type === 'INTEGER' && element.logical_type.bitWidth === 64 && element.logical_type.isSigned === true));
    case "DOUBLE":
    case "BOOLEAN":
      return element.type === expected && element.converted_type === undefined && element.logical_type === undefined;
  }
}

function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value) && isJsonValue(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Decode untrusted Parquet in a terminable worker, with bounded heap and wall time. */
export async function decodeTableParquet(bytes: Uint8Array, schema: TableSchema): Promise<TableData> {
  if (bytes.byteLength > PARQUET_LIMITS.fileBytes) throw new ParquetBundleDataError('Parquet file resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
  try { assertValidTableSchema(schema); }
  catch (error) { throw new ParquetBundleDataError('Invalid Parquet Table Schema.', { cause: error }); }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parquet-worker.js', import.meta.url), {
      workerData: { bytes, schema },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
    });
    let settled = false;
    const finish = (error?: Error, data?: TableData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(data!);
    };
    const timer = setTimeout(() => finish(new ParquetBundleDataError(`Table '${schema.id}' Parquet decode time budget exceeded.`, { code: 'RESOURCE_LIMIT' })), 5000);
    worker.once('message', (message: { data?: TableData; error?: Error; code?: "INVALID_DATA" | "RESOURCE_LIMIT" }) => {
      if (message.error) finish(new ParquetBundleDataError(`Table '${schema.id}': ${message.error.message}`, { cause: message.error, ...(message.code === undefined ? {} : { code: message.code }) }));
      else finish(undefined, message.data);
    });
    worker.once('error', error => finish(new ParquetBundleDataError(`Table '${schema.id}' Parquet worker failed.`, { code: (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'RESOURCE_LIMIT' : 'INVALID_DATA', cause: error })));
    worker.once('exit', code => { if (!settled) finish(new ParquetBundleDataError(`Table '${schema.id}' Parquet worker exited (${code}).`)); });
  });
}
