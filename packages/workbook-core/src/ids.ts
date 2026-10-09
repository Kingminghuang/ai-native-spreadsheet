/** Entity kinds whose IDs are part of the Workbook semantic model. */
export type SemanticIdKind = "workbook" | "page" | "table" | "field" | "row" | "revision";

declare const semanticIdBrand: unique symbol;

/** A typed, opaque ID. The brand prevents mixing IDs at compile time. */
export type SemanticId<Kind extends SemanticIdKind> = string & {
  readonly [semanticIdBrand]: Kind;
};

export type WorkbookId = SemanticId<"workbook">;
export type PageId = SemanticId<"page">;
export type TableId = SemanticId<"table">;
export type FieldId = SemanticId<"field">;
export type RowId = SemanticId<"row">;
export type RevisionId = SemanticId<"revision">;

const idPrefixes: Record<SemanticIdKind, string> = {
  workbook: "wb",
  page: "pg",
  table: "tbl",
  field: "fld",
  row: "row",
  revision: "rev",
};

const validId = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/;

/** Create a new collision-resistant ID with an optional human-readable kind prefix. */
export function createSemanticId<Kind extends SemanticIdKind>(
  kind: Kind,
): SemanticId<Kind> {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID !== "function") {
    throw new Error("A cryptographically secure randomUUID implementation is required.");
  }

  return `${idPrefixes[kind]}_${cryptoApi.randomUUID()}` as SemanticId<Kind>;
}

export const createWorkbookId = (): WorkbookId => createSemanticId("workbook");
export const createPageId = (): PageId => createSemanticId("page");
export const createTableId = (): TableId => createSemanticId("table");
export const createFieldId = (): FieldId => createSemanticId("field");
export const createRowId = (): RowId => createSemanticId("row");
export const createRevisionId = (): RevisionId => createSemanticId("revision");

/** Validate portable opaque spelling. Kind is supplied by reference context, not a prefix. */
export function isSemanticId<Kind extends SemanticIdKind>(
  kind: Kind,
  value: unknown,
): value is SemanticId<Kind> {
  if (typeof value !== "string") return false;

  return validId.test(value);
}

/** Validate and narrow an ID loaded from an external source. */
export function parseSemanticId<Kind extends SemanticIdKind>(
  kind: Kind,
  value: unknown,
): SemanticId<Kind> {
  if (!isSemanticId(kind, value)) {
    throw new TypeError(`Invalid ${kind} ID.`);
  }

  return value;
}
