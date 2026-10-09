import { isJsonValue, isPlainRecord } from './json.js';
import { parseSemanticId, type FieldId, type RowId, type TableId } from './ids.js';
import type { JsonObject, Table, Workbook } from './model.js';
import type { WorkbookBundleDraft, WorkbookBundleSpecDocument, WorkbookBundleState } from './bundle.js';
import { WorkbookBundleError } from './bundle-contract.js';

const SPEC_VERSION = 1;

/** Check that serialized calculations, transforms, and lineage point to real entities. */
export function validateBundleReferences(state: WorkbookBundleDraft | WorkbookBundleState): void {
  const tablesById = new Map(state.workbook.tables.map(table => [table.schema.id, table]));
  const fieldsById = new Map<FieldId, TableId>();
  const rowsById = new Map<string, TableId>();

  for (const table of state.workbook.tables) {
    for (const field of table.schema.fields) fieldsById.set(field.id, table.schema.id);
    for (const row of table.data.rows) rowsById.set(rowKey(table.schema.id, row.id), table.schema.id);
  }

  const calculationIds = new Set<string>();
  for (const calculation of state.calculations ?? []) {
    assertSpecDocument(calculation, 'Calculation');
    if (calculationIds.has(calculation.id)) throw new WorkbookBundleError(`Duplicate Calculation ID '${calculation.id}'.`);
    calculationIds.add(calculation.id);
    if (calculation.targetField !== undefined) {
      requireFieldReference(calculation.targetField, fieldsById, `Calculation '${calculation.id}' targetField`);
    }
    if (calculation.dependsOn !== undefined) {
      if (!Array.isArray(calculation.dependsOn)) {
        throw new WorkbookBundleError(`Calculation '${calculation.id}' dependsOn must be an array.`);
      }
      calculation.dependsOn.forEach(fieldId =>
        requireFieldReference(fieldId, fieldsById, `Calculation '${calculation.id}' dependency`),
      );
    }
  }

  const transformIds = new Set<string>();
  for (const transform of state.transforms ?? []) {
    assertSpecDocument(transform, 'Transform');
    if (transformIds.has(transform.id)) throw new WorkbookBundleError(`Duplicate Transform ID '${transform.id}'.`);
    transformIds.add(transform.id);
    if (transform.inputs !== undefined) {
      if (!Array.isArray(transform.inputs)) {
        throw new WorkbookBundleError(`Transform '${transform.id}' inputs must be an array.`);
      }
      transform.inputs.forEach(tableId =>
        requireTableReference(tableId, tablesById, `Transform '${transform.id}' input`),
      );
    }
    if (transform.output !== undefined) {
      requireTableReference(transform.output, tablesById, `Transform '${transform.id}' output`);
    }
  }

  const lineage = state.lineage ?? { records: [] };
  assertJsonObject(lineage, 'lineage');
  if (!Array.isArray(lineage.records)) {
    throw new WorkbookBundleError('The Lineage document must contain a records array.');
  }
  lineage.records.forEach((record, index) => {
    if (!isRecord(record)) throw new WorkbookBundleError(`Lineage record ${index} must be a JSON object.`);
    if (record.references === undefined) return;
    if (!Array.isArray(record.references)) {
      throw new WorkbookBundleError(`Lineage record ${index} references must be an array.`);
    }
    record.references.forEach((reference, referenceIndex) => {
      validateLineageReference(
        reference,
        `Lineage record ${index} reference ${referenceIndex}`,
        state.workbook,
        tablesById,
        fieldsById,
        rowsById,
        calculationIds,
        transformIds,
      );
    });
  });
}

function validateLineageReference(
  value: unknown,
  label: string,
  workbook: Workbook,
  tables: ReadonlyMap<string, Table>,
  fields: ReadonlyMap<FieldId, TableId>,
  rows: ReadonlyMap<string, TableId>,
  calculations: ReadonlySet<string>,
  transforms: ReadonlySet<string>,
): void {
  if (!isRecord(value) || !nonEmptyString(value.kind) || !nonEmptyString(value.id)) {
    throw new WorkbookBundleError(`${label} must declare a kind and ID.`);
  }

  switch (value.kind) {
    case 'workbook':
      if (value.id !== workbook.id) throw new WorkbookBundleError(`${label} does not resolve to this Workbook.`);
      return;
    case 'page':
      parseSemanticId('page', value.id);
      if (!workbook.pages.some(page => page.id === value.id)) {
        throw new WorkbookBundleError(`${label} does not resolve to a Page.`);
      }
      return;
    case 'table':
      requireTableReference(value.id, tables, label);
      return;
    case 'field': {
      const fieldId = parseSemanticId('field', value.id) as FieldId;
      const tableId = parseSemanticId('table', value.tableId) as TableId;
      if (fields.get(fieldId) !== tableId) {
        throw new WorkbookBundleError(`${label} does not resolve to a Field in the declared Table.`);
      }
      return;
    }
    case 'row': {
      const rowId = parseSemanticId('row', value.id) as RowId;
      const tableId = parseSemanticId('table', value.tableId) as TableId;
      if (rows.get(rowKey(tableId, rowId)) !== tableId) {
        throw new WorkbookBundleError(`${label} does not resolve to a Row in the declared Table.`);
      }
      return;
    }
    case 'calculation':
      if (!calculations.has(value.id)) throw new WorkbookBundleError(`${label} does not resolve to a Calculation.`);
      return;
    case 'transform':
      if (!transforms.has(value.id)) throw new WorkbookBundleError(`${label} does not resolve to a Transform.`);
      return;
    default:
      throw new WorkbookBundleError(`${label} uses unsupported reference kind '${value.kind}'.`);
  }
}

function requireFieldReference(value: unknown, fields: ReadonlyMap<FieldId, TableId>, label: string): void {
  let fieldId: FieldId;
  try {
    fieldId = parseSemanticId('field', value);
  } catch (error) {
    throw new WorkbookBundleError(`${label} has an invalid Field ID.`, { code: 'INVALID_DATA', cause: error });
  }
  if (!fields.has(fieldId)) throw new WorkbookBundleError(`${label} '${fieldId}' does not resolve to a Field.`);
}

function requireTableReference(value: unknown, tables: ReadonlyMap<string, Table>, label: string): void {
  let tableId: TableId;
  try {
    tableId = parseSemanticId('table', value);
  } catch (error) {
    throw new WorkbookBundleError(`${label} has an invalid Table ID.`, { code: 'INVALID_DATA', cause: error });
  }
  if (!tables.has(tableId)) throw new WorkbookBundleError(`${label} '${tableId}' does not resolve to a Table.`);
}

function assertSpecDocument(value: unknown, label: string): asserts value is WorkbookBundleSpecDocument {
  if (!isRecord(value) || !nonEmptyString(value.id)) {
    throw new WorkbookBundleError(`${label} document must have a non-empty ID.`);
  }
  if (value.specVersion !== undefined && value.specVersion !== SPEC_VERSION) {
    throw new WorkbookBundleError(`${label} '${value.id}' has unsupported specVersion '${String(value.specVersion)}'.`, { code: 'UNSUPPORTED_FORMAT' });
  }
  assertJsonObject(value, `${label} '${value.id}'`);
}

function assertJsonObject(value: unknown, label: string): asserts value is JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) throw new WorkbookBundleError(`${label} must be a JSON object.`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return isPlainRecord(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function rowKey(tableId: TableId, rowId: RowId): string {
  return `${tableId}\u0000${rowId}`;
}
