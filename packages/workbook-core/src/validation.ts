import { isPlainRecord as isRecord, isJsonValue, isJsonObject, jsonProblem, ownValue } from "./json.js";
import { patternProblem, testSafePattern, PATTERN_LIMITS, type PatternBudget } from "./safe-pattern.js";
import { isSemanticId, type FieldId } from "./ids.js";
import type {
  Field,
  FieldConstraints,
  FieldType,
  JsonObject,
  JsonValue,
  Page,
  Row,
  Table,
  TableSchema,
  Workbook,
} from "./model.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class DomainValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

const fieldTypes = new Set<FieldType>([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "time",
  "year",
  "yearmonth",
  "duration",
  "object",
  "array",
  "geojson",
  "geopoint",
  "any",
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateMetadata(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && !isJsonObject(value)) {
    addIssue(issues, path, "must be a JSON object.");
  }
}

function validateConstraints(
  constraints: unknown,
  path: string,
  issues: ValidationIssue[],
): constraints is FieldConstraints {
  if (constraints === undefined) return true;
  if (!isRecord(constraints)) {
    addIssue(issues, path, "must be an object.");
    return false;
  }

  let valid = true;
  for (const key of ["required", "unique"] as const) {
    const value = constraints[key];
    if (value !== undefined && typeof value !== "boolean") {
      addIssue(issues, `${path}.${key}`, "must be a boolean.");
      valid = false;
    }
  }

  for (const key of ["minimum", "maximum"] as const) {
    const value = constraints[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      addIssue(issues, `${path}.${key}`, "must be a finite number.");
      valid = false;
    }
  }

  for (const key of ["minLength", "maxLength"] as const) {
    const value = constraints[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0)) {
      addIssue(issues, `${path}.${key}`, "must be a non-negative integer.");
      valid = false;
    }
  }

  const pattern = constraints.pattern;
  if (pattern !== undefined) {
    if (typeof pattern !== "string") {
      addIssue(issues, `${path}.pattern`, "must be a string.");
      valid = false;
    } else {
      try {
        const problem = patternProblem(pattern);
        if (problem !== undefined) throw new Error(problem);
      } catch {
        addIssue(issues, `${path}.pattern`, "must use the bounded pattern subset (literals, classes, ., ^, $, *, +, ?; no groups or alternation).");
        valid = false;
      }
    }
  }

  const enumValues = constraints.enum;
  if (enumValues !== undefined && (!Array.isArray(enumValues) || !enumValues.every((item) => isJsonValue(item)))) {
    addIssue(issues, `${path}.enum`, "must be an array of JSON values.");
    valid = false;
  }

  for (const [key, value] of Object.entries(constraints)) {
    if (!(Object.hasOwn({ required: true, unique: true, minimum: true, maximum: true, minLength: true, maxLength: true, pattern: true, enum: true }, key)) && !isJsonValue(value)) {
      addIssue(issues, `${path}.${key}`, "must be a JSON value.");
      valid = false;
    }
  }

  if (typeof constraints.minimum === "number" && typeof constraints.maximum === "number" && constraints.minimum > constraints.maximum) {
    addIssue(issues, path, "minimum cannot exceed maximum.");
    valid = false;
  }
  if (typeof constraints.minLength === "number" && typeof constraints.maxLength === "number" && constraints.minLength > constraints.maxLength) {
    addIssue(issues, path, "minLength cannot exceed maxLength.");
    valid = false;
  }

  return valid;
}

function validateField(
  value: unknown,
  path: string,
  fields: Set<string>,
  issues: ValidationIssue[],
): value is Field {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object.");
    return false;
  }

  let valid = true;
  if (!isSemanticId("field", value.id)) {
    addIssue(issues, `${path}.id`, "must be a valid Field ID.");
    valid = false;
  } else if (fields.has(value.id)) {
    addIssue(issues, `${path}.id`, "must be unique within the Workbook.");
    valid = false;
  } else {
    fields.add(value.id);
  }

  if (!nonEmptyString(value.name)) {
    addIssue(issues, `${path}.name`, "must be a non-empty string.");
    valid = false;
  }
  for (const key of ["title", "description"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      addIssue(issues, `${path}.${key}`, "must be a string when provided.");
      valid = false;
    }
  }
  if (typeof value.type !== "string" || !fieldTypes.has(value.type as FieldType)) {
    addIssue(issues, `${path}.type`, "must be a supported logical field type.");
    valid = false;
  }
  if (value.format !== undefined && typeof value.format !== "string" && !isJsonObject(value.format)) {
    addIssue(issues, `${path}.format`, "must be a string or JSON object.");
    valid = false;
  }
  if (!validateConstraints(value.constraints, `${path}.constraints`, issues)) valid = false;
  validateMetadata(value.metadata, `${path}.metadata`, issues);
  validateMetadata(value.extensions, `${path}.extensions`, issues);

  return valid;
}

function validateTableSchemaValue(
  value: unknown,
  path: string,
  tableIds: Set<string>,
  fields: Set<string>,
  issues: ValidationIssue[],
): value is TableSchema {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object.");
    return false;
  }

  let valid = true;
  if (!isSemanticId("table", value.id)) {
    addIssue(issues, `${path}.id`, "must be a valid Table ID.");
    valid = false;
  } else if (tableIds.has(value.id)) {
    addIssue(issues, `${path}.id`, "must be unique within the Workbook.");
    valid = false;
  } else {
    tableIds.add(value.id);
  }
  if (!nonEmptyString(value.name)) {
    addIssue(issues, `${path}.name`, "must be a non-empty string.");
    valid = false;
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    addIssue(issues, `${path}.description`, "must be a string when provided.");
    valid = false;
  }
  validateMetadata(value.metadata, `${path}.metadata`, issues);
  validateMetadata(value.extensions, `${path}.extensions`, issues);

  if (!Array.isArray(value.fields)) {
    addIssue(issues, `${path}.fields`, "must be an array.");
    return false;
  }
  if (value.fields.length === 0) {
    addIssue(issues, `${path}.fields`, "must contain at least one Field.");
    valid = false;
  }

  const tableFieldIds = new Set<string>();
  value.fields.forEach((field, index) => {
    const before = fields.size;
    const fieldValid = validateField(field, `${path}.fields[${index}]`, fields, issues);
    if (isRecord(field) && isSemanticId("field", field.id)) tableFieldIds.add(field.id);
    if (!fieldValid || fields.size === before) valid = false;
  });

  if (value.primaryKey !== undefined) {
    if (!Array.isArray(value.primaryKey) || value.primaryKey.length === 0) {
      addIssue(issues, `${path}.primaryKey`, "must be a non-empty array of Field IDs.");
      valid = false;
    } else {
      validateFieldIdList(value.primaryKey, tableFieldIds, `${path}.primaryKey`, issues, () => { valid = false; });
    }
  }

  if (value.foreignKeys !== undefined) {
    if (!Array.isArray(value.foreignKeys)) {
      addIssue(issues, `${path}.foreignKeys`, "must be an array.");
      valid = false;
    } else {
      value.foreignKeys.forEach((foreignKey, index) => {
        if (!isRecord(foreignKey)) {
          addIssue(issues, `${path}.foreignKeys[${index}]`, "must be an object.");
          valid = false;
          return;
        }
        if (!Array.isArray(foreignKey.fields) || foreignKey.fields.length === 0) {
          addIssue(issues, `${path}.foreignKeys[${index}].fields`, "must be a non-empty array of Field IDs.");
          valid = false;
        } else {
          validateFieldIdList(foreignKey.fields, tableFieldIds, `${path}.foreignKeys[${index}].fields`, issues, () => { valid = false; });
        }
        if (!isRecord(foreignKey.reference)) {
          addIssue(issues, `${path}.foreignKeys[${index}].reference`, "must be an object.");
          valid = false;
          return;
        }
        if (!isSemanticId("table", foreignKey.reference.tableId)) {
          addIssue(issues, `${path}.foreignKeys[${index}].reference.tableId`, "must be a valid Table ID.");
          valid = false;
        }
        if (!Array.isArray(foreignKey.reference.fields) || foreignKey.reference.fields.length === 0) {
          addIssue(issues, `${path}.foreignKeys[${index}].reference.fields`, "must be a non-empty array of Field IDs.");
          valid = false;
        } else {
          const referencedFieldIds = new Set<string>();
          foreignKey.reference.fields.forEach((fieldId, fieldIndex) => {
            if (!isSemanticId("field", fieldId)) {
              addIssue(issues, `${path}.foreignKeys[${index}].reference.fields[${fieldIndex}]`, "must be a valid Field ID.");
              valid = false;
            } else if (referencedFieldIds.has(fieldId)) {
              addIssue(issues, `${path}.foreignKeys[${index}].reference.fields[${fieldIndex}]`, "must not repeat a referenced Field ID.");
              valid = false;
            } else {
              referencedFieldIds.add(fieldId);
            }
          });
        }
        if (Array.isArray(foreignKey.fields) && Array.isArray(foreignKey.reference.fields) && foreignKey.fields.length !== foreignKey.reference.fields.length) {
          addIssue(issues, `${path}.foreignKeys[${index}]`, "source and referenced key arities must match.");
          valid = false;
        }
      });
    }
  }

  return valid;
}

function validateFieldIdList(
  fields: readonly unknown[],
  knownFieldIds: Set<string>,
  path: string,
  issues: ValidationIssue[],
  markInvalid: () => void,
): void {
  const seen = new Set<string>();
  fields.forEach((fieldId, index) => {
    if (!isSemanticId("field", fieldId)) {
      addIssue(issues, `${path}[${index}]`, "must be a valid Field ID.");
      markInvalid();
      return;
    }
    if (!knownFieldIds.has(fieldId)) {
      addIssue(issues, `${path}[${index}]`, "does not belong to this Table.");
      markInvalid();
    }
    if (seen.has(fieldId)) {
      addIssue(issues, `${path}[${index}]`, "must not repeat a Field ID.");
      markInvalid();
    }
    seen.add(fieldId);
  });
}

function valueMatchesFieldType(type: FieldType, value: JsonValue): boolean {
  if (value === null || type === "any") return true;
  switch (type) {
    case "string":
    case "date":
    case "datetime":
    case "time":
    case "year":
    case "yearmonth":
    case "duration":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
    case "geojson":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "geopoint":
      return Array.isArray(value) || isRecord(value);
  }
}

function validateRow(
  value: unknown,
  path: string,
  schema: TableSchema,
  patternBudget: PatternBudget,
  enums: ReadonlyMap<string, ReadonlySet<string>>,
  fieldsById: Map<string, Field>,
  rowIds: Set<string>,
  issues: ValidationIssue[],
): value is Row {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object.");
    return false;
  }

  let valid = true;
  if (!isSemanticId("row", value.id)) {
    addIssue(issues, `${path}.id`, "must be a valid Row ID.");
    valid = false;
  } else if (rowIds.has(value.id)) {
    addIssue(issues, `${path}.id`, "must be unique within the Table.");
    valid = false;
  } else {
    rowIds.add(value.id);
  }

  if (!isRecord(value.values)) {
    addIssue(issues, `${path}.values`, "must be an object keyed by Field ID.");
    return false;
  }
  for (const [fieldId, fieldValue] of Object.entries(value.values)) {
    if (!isSemanticId("field", fieldId) || !fieldsById.has(fieldId)) {
      addIssue(issues, `${path}.values.${fieldId}`, "must reference a Field in this Table.");
      valid = false;
      continue;
    }
    if (!isJsonValue(fieldValue)) {
      addIssue(issues, `${path}.values.${fieldId}`, "must be a JSON value.");
      valid = false;
      continue;
    }

    const field = fieldsById.get(fieldId);
    if (field === undefined) continue;
    if (!valueMatchesFieldType(field.type, fieldValue)) {
      addIssue(issues, `${path}.values.${fieldId}`, field.type === 'integer' ? 'must be a JavaScript safe integer in ±(2^53−1), without a fractional part.' : `does not match Field type '${field.type}'.`);
      valid = false;
    }
    if (!validateValueConstraints(field, fieldValue, `${path}.values.${fieldId}`, issues, patternBudget, enums)) valid = false;
  }

  for (const field of schema.fields) {
    if (field.constraints?.required === true && (ownValue(value.values, field.id) === undefined || ownValue(value.values, field.id) === null)) {
      addIssue(issues, `${path}.values.${field.id}`, "is required.");
      valid = false;
    }
  }
  for (const fieldId of schema.primaryKey ?? []) {
    if (ownValue(value.values, fieldId) === undefined || ownValue(value.values, fieldId) === null) {
      addIssue(issues, `${path}.values.${fieldId}`, "primary key values are required.");
      valid = false;
    }
  }

  return valid;
}

function validateValueConstraints(
  field: Field,
  value: JsonValue,
  path: string,
  issues: ValidationIssue[],
  patternBudget: PatternBudget,
  enums: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const constraints = field.constraints;
  if (constraints === undefined || value === null) return true;
  let valid = true;

  if (constraints.enum !== undefined && !enums.get(field.id)?.has(stableJsonKey(value))) {
    addIssue(issues, path, "is not one of the Field's enum values.");
    valid = false;
  }
  if (typeof value === "number") {
    if (constraints.minimum !== undefined && value < constraints.minimum) {
      addIssue(issues, path, `must be greater than or equal to ${constraints.minimum}.`);
      valid = false;
    }
    if (constraints.maximum !== undefined && value > constraints.maximum) {
      addIssue(issues, path, `must be less than or equal to ${constraints.maximum}.`);
      valid = false;
    }
  }
  if (typeof value === "string") {
    const length = constraints.minLength !== undefined || constraints.maxLength !== undefined ? [...value].length : 0;
    if (constraints.minLength !== undefined && length < constraints.minLength) {
      addIssue(issues, path, `must contain at least ${constraints.minLength} characters.`);
      valid = false;
    }
    if (constraints.maxLength !== undefined && length > constraints.maxLength) {
      addIssue(issues, path, `must contain at most ${constraints.maxLength} characters.`);
      valid = false;
    }
    if (constraints.pattern !== undefined) {
      try {
        if (!testSafePattern(constraints.pattern, value, patternBudget)) {
          addIssue(issues, path, `must match pattern '${constraints.pattern}'.`);
          valid = false;
        }
      } catch (error) {
        addIssue(issues, path, (error as Error).message);
        valid = false;
      }
    }
  }

  return valid;
}

function validateTableData(table: Table, path: string, issues: ValidationIssue[], patternBudget: PatternBudget): boolean {
  if (!isSemanticId("table", table.data.tableId) || table.data.tableId !== table.schema.id) {
    addIssue(issues, `${path}.data.tableId`, "must match the Table Schema ID.");
    return false;
  }
  if (!Array.isArray(table.data.rows)) {
    addIssue(issues, `${path}.data.rows`, "must be an array.");
    return false;
  }

  if (table.data.rows.length * table.schema.fields.length > 1_000_000) {
    addIssue(issues, path, 'Table row/field validation work budget exceeded.');
    return false;
  }
  let valid = true;
  const enums = new Map(table.schema.fields.filter(field => field.constraints?.enum !== undefined)
    .map(field => [field.id, new Set(field.constraints!.enum!.map(stableJsonKey))]));
  const rowIds = new Set<string>();
  const fieldsById = new Map(table.schema.fields.map((field) => [field.id, field]));
  table.data.rows.forEach((row, index) => {
    if (!validateRow(row, `${path}.data.rows[${index}]`, table.schema, patternBudget, enums, fieldsById, rowIds, issues)) valid = false;
  });
  if (!validateRowUniqueness(table.data.rows, table.schema, path, issues)) valid = false;
  return valid;
}

function stableJsonKey(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonKey).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonKey(value[key] as JsonValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateRowUniqueness(
  rows: readonly unknown[],
  schema: TableSchema,
  tablePath: string,
  issues: ValidationIssue[],
): boolean {
  let valid = true;
  const uniqueFields = schema.fields.filter((field) => field.constraints?.unique === true);
  const seenByField = new Map<FieldId, Set<string>>(uniqueFields.map((field) => [field.id, new Set()]));
  const primaryKey = schema.primaryKey ?? [];
  const seenPrimaryKeys = new Set<string>();

  rows.forEach((row, rowIndex) => {
    if (!isRecord(row)) return;
    const rowValues = row.values;
    if (!isRecord(rowValues)) return;
    for (const field of uniqueFields) {
      const value = ownValue(rowValues, field.id);
      if (value === undefined || value === null || !isJsonValue(value)) continue;
      const key = stableJsonKey(value);
      const seen = seenByField.get(field.id);
      if (seen?.has(key)) {
        addIssue(issues, `${tablePath}.data.rows[${rowIndex}].values.${field.id}`, "must be unique within the Table.");
        valid = false;
      } else {
        seen?.add(key);
      }
    }

    if (primaryKey.length === 0) return;
    const values = primaryKey.map((fieldId) => ownValue(rowValues, fieldId));
    if (values.some((value) => value === undefined || value === null || !isJsonValue(value))) return;
    const key = stableJsonKey(values as JsonValue[]);
    if (seenPrimaryKeys.has(key)) {
      addIssue(issues, `${tablePath}.data.rows[${rowIndex}].values`, "primary key tuple must be unique within the Table.");
      valid = false;
    } else {
      seenPrimaryKeys.add(key);
    }
  });

  return valid;
}

/** Collect structural and row-value issues without mutating the supplied Workbook. */
export function validateWorkbook(value: unknown, patternBudget: PatternBudget = { remaining: PATTERN_LIMITS.work }): ValidationIssue[] {
  const problem = jsonProblem(value);
  if (problem !== undefined) return [{ path: "$", message: problem }];
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ path: "$", message: "must be a Workbook object." }];
  }

  if (!isSemanticId("workbook", value.id)) {
    addIssue(issues, "$.id", "must be a valid Workbook ID.");
  }
  if (!nonEmptyString(value.name)) addIssue(issues, "$.name", "must be a non-empty string.");
  validateMetadata(value.metadata, "$.metadata", issues);

  if (!Array.isArray(value.pages)) {
    addIssue(issues, "$.pages", "must be an array.");
  }
  if (!Array.isArray(value.tables)) {
    addIssue(issues, "$.tables", "must be an array.");
  }
  if (!Array.isArray(value.pages) || !Array.isArray(value.tables)) return issues;

  const pageIds = new Set<string>();
  value.pages.forEach((page, index) => {
    validatePage(page, `$.pages[${index}]`, pageIds, issues);
  });

  const tableIds = new Set<string>();
  const fields = new Set<string>();
  const tables = new Map<string, Table>();
  value.tables.forEach((table, index) => {
    if (!isRecord(table)) {
      addIssue(issues, `$.tables[${index}]`, "must be a Table object.");
      return;
    }
    if (!validateTableSchemaValue(table.schema, `$.tables[${index}].schema`, tableIds, fields, issues)) return;
    const schema = table.schema as TableSchema;
    if (!isRecord(table.data)) {
      addIssue(issues, `$.tables[${index}].data`, "must be a Table data object.");
      return;
    }
    tables.set(schema.id, table as unknown as Table);
    validateTableData(table as unknown as Table, `$.tables[${index}]`, issues, patternBudget);
  });

  value.tables.forEach((table, tableIndex) => {
    if (!isRecord(table) || !isRecord(table.schema)) return;
    const foreignKeys = table.schema.foreignKeys;
    if (!Array.isArray(foreignKeys)) return;
    foreignKeys.forEach((foreignKey, keyIndex) => {
      if (!isRecord(foreignKey) || !isRecord(foreignKey.reference)) return;
      const targetId = foreignKey.reference.tableId;
      if (!isSemanticId("table", targetId)) return;
      const target = tables.get(targetId);
      if (target === undefined) {
        addIssue(issues, `$.tables[${tableIndex}].schema.foreignKeys[${keyIndex}].reference.tableId`, "does not reference a Table in this Workbook.");
        return;
      }
      if (!Array.isArray(foreignKey.reference.fields)) return;
      const targetFields = new Set(target.schema.fields.map((field) => field.id));
      foreignKey.reference.fields.forEach((fieldId, fieldIndex) => {
        if (isSemanticId("field", fieldId) && !targetFields.has(fieldId)) {
          addIssue(issues, `$.tables[${tableIndex}].schema.foreignKeys[${keyIndex}].reference.fields[${fieldIndex}]`, "does not belong to the referenced Table.");
        }
      });
    });
  });

  for (let pageIndex = 0; pageIndex < value.pages.length; pageIndex += 1) {
    const page = value.pages[pageIndex];
    if (!isRecord(page) || !Array.isArray(page.tableViews)) continue;
    page.tableViews.forEach((tableView, viewIndex) => {
      if (!isRecord(tableView) || !isSemanticId("table", tableView.tableId)) return;
      if (!tables.has(tableView.tableId)) {
        addIssue(issues, `$.pages[${pageIndex}].tableViews[${viewIndex}].tableId`, "does not reference a Table in this Workbook.");
      }
    });
  }

  return issues;
}

function validatePage(
  value: unknown,
  path: string,
  pageIds: Set<string>,
  issues: ValidationIssue[],
): value is Page {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be a Page object.");
    return false;
  }
  let valid = true;
  if (!isSemanticId("page", value.id)) {
    addIssue(issues, `${path}.id`, "must be a valid Page ID.");
    valid = false;
  } else if (pageIds.has(value.id)) {
    addIssue(issues, `${path}.id`, "must be unique within the Workbook.");
    valid = false;
  } else {
    pageIds.add(value.id);
  }
  if (!nonEmptyString(value.name)) {
    addIssue(issues, `${path}.name`, "must be a non-empty string.");
    valid = false;
  }
  validateMetadata(value.metadata, `${path}.metadata`, issues);
  validateMetadata(value.viewSettings, `${path}.viewSettings`, issues);
  validateMetadata(value.extensions, `${path}.extensions`, issues);
  if (!Array.isArray(value.tableViews)) {
    addIssue(issues, `${path}.tableViews`, "must be an array.");
    return false;
  }
  value.tableViews.forEach((tableView, index) => {
    if (!isRecord(tableView) || !isSemanticId("table", tableView.tableId)) {
      addIssue(issues, `${path}.tableViews[${index}].tableId`, "must be a valid Table ID.");
      valid = false;
      return;
    }
    validateMetadata(tableView.settings, `${path}.tableViews[${index}].settings`, issues);
    validateMetadata(tableView.extensions, `${path}.tableViews[${index}].extensions`, issues);
  });
  return valid;
}

/** Throw a structured error for invalid external or newly-created Workbook values. */
export function assertValidWorkbook(value: unknown, patternBudget?: PatternBudget): asserts value is Workbook {
  const issues = validateWorkbook(value, patternBudget);
  if (issues.length > 0) throw new DomainValidationError(issues);
}

export function validateTableSchema(value: unknown): ValidationIssue[] {
  const problem = jsonProblem(value);
  if (problem !== undefined) return [{ path: "$", message: problem }];
  const issues: ValidationIssue[] = [];
  const tableIds = new Set<string>();
  const fields = new Set<string>();
  validateTableSchemaValue(value, "$", tableIds, fields, issues);
  return issues;
}

export function assertValidTableSchema(value: unknown): asserts value is TableSchema {
  const issues = validateTableSchema(value);
  if (issues.length > 0) throw new DomainValidationError(issues);
}

/** Validate local schema/rows; cross-Table FK resolution belongs to Workbook validation. */
export function validateTable(value: unknown): ValidationIssue[] {
  const problem = jsonProblem(value);
  if (problem !== undefined) return [{ path: '$', message: problem }];
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path: '$', message: 'must be a Table object.' }];
  if (!validateTableSchemaValue(value.schema, '$.schema', new Set(), new Set(), issues)) return issues;
  if (!isRecord(value.data)) return [...issues, { path: '$.data', message: 'must be a Table data object.' }];
  validateTableData(value as unknown as Table, '$', issues, { remaining: PATTERN_LIMITS.work });
  return issues;
}
export function assertValidTable(value: unknown): asserts value is Table {
  const issues = validateTable(value);
  if (issues.length > 0) throw new DomainValidationError(issues);
}
