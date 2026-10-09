import type {
  FieldId,
  PageId,
  RowId,
  TableId,
  WorkbookId,
} from "./ids.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

/** Logical field types are independent of a table's physical file encoding. */
export type FieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "year"
  | "yearmonth"
  | "duration"
  | "object"
  | "array"
  | "geojson"
  | "geopoint"
  | "any";

export interface FieldConstraints {
  readonly required?: boolean;
  readonly unique?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly enum?: readonly JsonValue[];
  readonly pattern?: string;
  /** JSON-compatible extension points for portable schema constraints. */
  readonly [extension: string]: JsonValue | undefined;
}

export interface Field {
  readonly id: FieldId;
  /** Mutable field name; never use it as an internal reference. */
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly type: FieldType;
  readonly format?: string | JsonObject;
  readonly constraints?: FieldConstraints;
  readonly metadata?: JsonObject;
  readonly extensions?: JsonObject;
}

export interface ForeignKeyReference {
  readonly tableId: TableId;
  readonly fields: readonly FieldId[];
}

export interface ForeignKey {
  readonly fields: readonly FieldId[];
  readonly reference: ForeignKeyReference;
}

/** Schema metadata is distinct from table rows and from calculation/transform/view specs. */
export interface TableSchema {
  readonly id: TableId;
  /** Mutable table name; internal relationships use `id`. */
  readonly name: string;
  readonly description?: string;
  readonly fields: readonly Field[];
  readonly primaryKey?: readonly FieldId[];
  readonly foreignKeys?: readonly ForeignKey[];
  readonly metadata?: JsonObject;
  readonly extensions?: JsonObject;
}

/** A row is identified independently of its position and keyed by stable Field IDs. */
export interface Row {
  readonly id: RowId;
  readonly values: Readonly<Record<FieldId, JsonValue>>;
}

export interface TableData {
  readonly tableId: TableId;
  readonly rows: readonly Row[];
}

/** A Table composes one schema with its data without putting rows in the schema. */
export interface Table {
  readonly schema: TableSchema;
  readonly data: TableData;
}

/** A Page is a view container; a table view references a Table by semantic ID. */
export interface TableViewReference {
  readonly tableId: TableId;
  readonly settings?: JsonObject;
  readonly extensions?: JsonObject;
}

export interface Page {
  readonly id: PageId;
  /** Mutable page title/name; not an identity. */
  readonly name: string;
  readonly tableViews: readonly TableViewReference[];
  readonly metadata?: JsonObject;
  /** Opaque, JSON-compatible settings owned by the Page / View layer. */
  readonly viewSettings?: JsonObject;
  readonly extensions?: JsonObject;
}

/** The MVP Workbook aggregate intentionally contains no calculation, transform, or lineage state. */
export interface Workbook {
  readonly id: WorkbookId;
  /** Mutable workbook name; internal relationships use `id`. */
  readonly name: string;
  readonly pages: readonly Page[];
  readonly tables: readonly Table[];
  readonly metadata?: JsonObject;
}
