import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isJsonValue, isPlainRecord, jsonProblem } from './json.js';
import { isSemanticId } from './ids.js';
import type { JsonObject, Workbook } from './model.js';
import type { WorkbookBundleState } from './bundle.js';
import { BUNDLE_LIMITS, WorkbookBundleError } from './bundle-contract.js';
import { mapSequential, readBoundedFile, readBudget, resolveEntryPath, validateRelativePath } from './bundle-filesystem.js';
import { encodeTableParquet } from './parquet-adapter.js';
import { REVISION_HISTORY_REQUIRED_FEATURE } from './revision-history.js';

export const WORKBOOK_BUNDLE_FORMAT = 'ai-native-spreadsheet-workbook-bundle' as const;
export const WORKBOOK_BUNDLE_FORMAT_VERSION = 1 as const;
export type WorkbookBundleSpecDocument = JsonObject & { readonly id: string };

const SUPPORTED_REQUIRED_FEATURES = new Set<string>([REVISION_HISTORY_REQUIRED_FEATURE]);
const SPEC_VERSION = 1 as const;

interface ManifestFileEntry {
  readonly id: string;
  readonly path: string;
}

export interface WorkbookBundleManifest {
  readonly format: typeof WORKBOOK_BUNDLE_FORMAT;
  readonly formatVersion: typeof WORKBOOK_BUNDLE_FORMAT_VERSION;
  readonly workbook: {
    readonly id: string;
    readonly name: string;
    readonly metadata?: JsonObject;
  };
  readonly entries: {
    readonly schemas: readonly { readonly tableId: string; readonly path: string }[];
    readonly calculations: readonly ManifestFileEntry[];
    readonly transforms: readonly ManifestFileEntry[];
    readonly views: readonly { readonly pageId: string; readonly path: string }[];
    readonly lineage: { readonly path: string };
    readonly tables: readonly { readonly tableId: string; readonly path: string }[];
  };
  readonly requiredFeatures: readonly string[];
  readonly extensions: JsonObject;
}

export interface ParsedManifest extends WorkbookBundleManifest {
  readonly absolutePaths: ReadonlyMap<string, string>;
}

export function createManifest(state: WorkbookBundleState): WorkbookBundleManifest {
  const schemas = state.workbook.tables.map((table, index) => ({
    tableId: table.schema.id,
    path: `schemas/table-${ordinal(index)}.json`,
  }));
  const tables = state.workbook.tables.map((table, index) => ({
    tableId: table.schema.id,
    path: `tables/table-${ordinal(index)}.parquet`,
  }));
  const views = state.workbook.pages.map((page, index) => ({
    pageId: page.id,
    path: `views/page-${ordinal(index)}.json`,
  }));
  const calculations = state.calculations.map((document, index) => ({
    id: document.id,
    path: `calculations/calculation-${ordinal(index)}.json`,
  }));
  const transforms = state.transforms.map((document, index) => ({
    id: document.id,
    path: `transforms/transform-${ordinal(index)}.json`,
  }));
  return {
    format: WORKBOOK_BUNDLE_FORMAT,
    formatVersion: WORKBOOK_BUNDLE_FORMAT_VERSION,
    workbook: {
      id: state.workbook.id,
      name: state.workbook.name,
      ...(state.workbook.metadata === undefined ? {} : { metadata: state.workbook.metadata }),
    },
    entries: {
      schemas,
      calculations,
      transforms,
      views,
      lineage: { path: "lineage/lineage.json" },
      tables,
    },
    requiredFeatures: [...state.requiredFeatures],
    extensions: state.extensions,
  };
}

export async function writeBundleFiles(
  rootPath: string,
  state: WorkbookBundleState,
  manifest: WorkbookBundleManifest,
): Promise<void> {
  const directories = ["schemas", "calculations", "transforms", "views", "lineage", "tables"];
  await settleAll(directories.map((directory) => mkdir(join(rootPath, directory), { recursive: true })));

  await settleAll(state.workbook.tables.map(async (table, index) => {
    const schemaEntry = manifest.entries.schemas[index];
    const tableEntry = manifest.entries.tables[index];
    if (schemaEntry === undefined || tableEntry === undefined) throw new WorkbookBundleError("Could not construct Table entries.");
    await writeJsonFile(join(rootPath, schemaEntry.path), versioned(table.schema));
    await writeFile(join(rootPath, tableEntry.path), encodeTableParquet(table));
  }));
  await settleAll(state.workbook.pages.map(async (page, index) => {
    const entry = manifest.entries.views[index];
    if (entry === undefined) throw new WorkbookBundleError("Could not construct Page entries.");
    await writeJsonFile(join(rootPath, entry.path), versioned(page));
  }));
  await settleAll([
    ...state.calculations.map(async (document, index) => {
      const entry = manifest.entries.calculations[index];
      if (entry === undefined) throw new WorkbookBundleError("Could not construct Calculation entries.");
      await writeJsonFile(join(rootPath, entry.path), versioned(document));
    }),
    ...state.transforms.map(async (document, index) => {
      const entry = manifest.entries.transforms[index];
      if (entry === undefined) throw new WorkbookBundleError("Could not construct Transform entries.");
      await writeJsonFile(join(rootPath, entry.path), versioned(document));
    }),
    writeJsonFile(join(rootPath, manifest.entries.lineage.path), versioned(state.lineage)),
  ]);
  // Publish the manifest last inside the complete staging directory.
  await writeJsonFile(join(rootPath, "workbook.json"), manifest);
}

export function versioned(value: unknown): JsonObject {
  if (!isRecord(value)) throw new WorkbookBundleError("A JSON Bundle document must be an object.");
  if (value.specVersion !== undefined && value.specVersion !== SPEC_VERSION) {
    throw new WorkbookBundleError(`Unsupported JSON specification version '${String(value.specVersion)}'.`);
  }
  let clone: unknown;
  try {
    clone = JSON.parse(JSON.stringify(value)) as unknown;
  } catch (error) {
    throw new WorkbookBundleError("Could not serialize JSON Bundle document.", { cause: error });
  }
  assertJsonObject(clone, "JSON Bundle document");
  return { ...clone, specVersion: SPEC_VERSION };
}

export async function readSpecEntries(
  manifest: ParsedManifest,
  entries: readonly ManifestFileEntry[],
  kind: "calculation" | "transform",
): Promise<WorkbookBundleSpecDocument[]> {
  return mapSequential(entries, async (entry) => {
    const document = parseVersionedObject(await readJsonFile(pathFor(manifest, entry.path), entry.path), entry.path);
    if (document.id !== entry.id) {
      throw new WorkbookBundleError(`${kind} ID at '${entry.path}' does not match its manifest entry.`);
    }
    return document as WorkbookBundleSpecDocument;
  });
}

export async function readLineage(manifest: ParsedManifest): Promise<JsonObject> {
  const entryPath = manifest.entries.lineage.path;
  const document = parseVersionedObject(await readJsonFile(pathFor(manifest, entryPath), entryPath), entryPath);
  if (!Array.isArray(document.records)) throw new WorkbookBundleError("The Lineage document must contain a records array.");
  return document;
}

export function parseManifest(value: unknown, rootPath: string): ParsedManifest {
  if (!isRecord(value)) throw new WorkbookBundleError("The Bundle manifest must be a JSON object.");
  if (value.format !== WORKBOOK_BUNDLE_FORMAT) throw new WorkbookBundleError("This is not an AI-native Spreadsheet Workbook Bundle.");
  if (value.formatVersion !== WORKBOOK_BUNDLE_FORMAT_VERSION) {
    throw new WorkbookBundleError(`Unsupported Workbook Bundle formatVersion '${String(value.formatVersion)}'.`, { code: 'UNSUPPORTED_FORMAT' });
  }
  if (!isRecord(value.workbook)) throw new WorkbookBundleError("The manifest must contain Workbook metadata.");
  const workbookId = parseManifestId("workbook", value.workbook.id, "workbook.id");
  if (!nonEmptyString(value.workbook.name)) throw new WorkbookBundleError("Manifest workbook.name must be a non-empty string.");
  if (value.workbook.metadata !== undefined) assertJsonObject(value.workbook.metadata, "workbook.metadata");
  if (!isRecord(value.entries)) throw new WorkbookBundleError("The manifest must contain entries.");

  const schemas = parseEntryArray(value.entries.schemas, "schemas", "tableId", "table");
  const calculations = parseEntryArray(value.entries.calculations, "calculations", "id");
  const transforms = parseEntryArray(value.entries.transforms, "transforms", "id");
  const views = parseEntryArray(value.entries.views, "views", "pageId", "page");
  const tables = parseEntryArray(value.entries.tables, "tables", "tableId", "table");
  if (!isRecord(value.entries.lineage) || !nonEmptyString(value.entries.lineage.path)) {
    throw new WorkbookBundleError("The manifest must contain a Lineage file entry.");
  }
  const lineage = { path: value.entries.lineage.path };
  const requiredFeatures = value.requiredFeatures;
  if (!Array.isArray(requiredFeatures) || !requiredFeatures.every(nonEmptyString)) {
    throw new WorkbookBundleError("Manifest requiredFeatures must be an array of non-empty strings.");
  }
  validateRequiredFeatures(requiredFeatures);
  const extensions = value.extensions === undefined ? {} : value.extensions;
  assertJsonObject(extensions, "manifest.extensions");

  const entries = { schemas, calculations, transforms, views, lineage, tables };
  const paths = collectPaths(entries);
  if (paths.length + 1 > BUNDLE_LIMITS.files) throw new WorkbookBundleError('Manifest entry count resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
  if (new Set(paths).size !== paths.length) {
    throw new WorkbookBundleError("Manifest entries must not declare the same path more than once.");
  }
  const reserved = new Set(["workbook.json"]);
  for (const path of paths) {
    if (reserved.has(path)) throw new WorkbookBundleError(`Manifest entry path '${path}' conflicts with workbook.json.`);
    reserved.add(path);
  }
  const absolutePaths = new Map<string, string>();
  for (const path of reserved) {
    if (path === "workbook.json") continue;
    absolutePaths.set(path, resolveEntryPath(rootPath, path));
  }

  const manifest: WorkbookBundleManifest = {
    format: WORKBOOK_BUNDLE_FORMAT,
    formatVersion: WORKBOOK_BUNDLE_FORMAT_VERSION,
    workbook: {
      id: workbookId,
      name: value.workbook.name,
      ...(value.workbook.metadata === undefined ? {} : { metadata: value.workbook.metadata as JsonObject }),
    },
    entries,
    requiredFeatures: [...requiredFeatures],
    extensions,
  };
  validateManifestEntryIds(manifest);
  return { ...manifest, absolutePaths };
}

function parseEntryArray<K extends string>(
  value: unknown,
  label: string,
  idProperty: K,
  idKind?: "page" | "table",
): Array<{ readonly path: string } & Record<K, string>> {
  if (!Array.isArray(value)) throw new WorkbookBundleError(`Manifest entries.${label} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new WorkbookBundleError(`Manifest entries.${label}[${index}] must be an object.`);
    const id = entry[idProperty];
    if (idKind === "page" || idKind === "table") parseManifestId(idKind, id, `entries.${label}[${index}].${idProperty}`);
    else if (!nonEmptyString(id)) throw new WorkbookBundleError(`Manifest entries.${label}[${index}].${idProperty} must be a non-empty string.`);
    if (!nonEmptyString(entry.path)) throw new WorkbookBundleError(`Manifest entries.${label}[${index}].path must be a non-empty string.`);
    return { [idProperty]: id as string, path: validateRelativePath(entry.path) } as { readonly path: string } & Record<K, string>;
  });
}

function validateManifestEntryIds(manifest: WorkbookBundleManifest): void {
  assertUniqueIds(manifest.entries.schemas.map(({ tableId }) => tableId), "Schema Table ID");
  assertUniqueIds(manifest.entries.tables.map(({ tableId }) => tableId), "Table data Table ID");
  assertUniqueIds(manifest.entries.views.map(({ pageId }) => pageId), "Page ID");
  assertUniqueIds(manifest.entries.calculations.map(({ id }) => id), "Calculation ID");
  assertUniqueIds(manifest.entries.transforms.map(({ id }) => id), "Transform ID");
}

export function collectPaths(entries: WorkbookBundleManifest["entries"]): string[] {
  return [
    ...entries.schemas.map(({ path }) => path),
    ...entries.calculations.map(({ path }) => path),
    ...entries.transforms.map(({ path }) => path),
    ...entries.views.map(({ path }) => path),
    entries.lineage.path,
    ...entries.tables.map(({ path }) => path),
  ].map(validateRelativePath).sort();
}

export function pathFor(manifest: ParsedManifest, relativePath: string): string {
  const resolved = manifest.absolutePaths.get(relativePath);
  if (resolved === undefined) throw new WorkbookBundleError(`Path '${relativePath}' is not declared by the manifest.`);
  return resolved;
}

export async function readJsonFile(path: string, description: string): Promise<unknown> {
  try {
    const bytes = await readBoundedFile(path, BUNDLE_LIMITS.jsonFileBytes);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(source);
    const problem = jsonProblem(value);
    if (problem !== undefined) throw new WorkbookBundleError(`JSON entry '${description}': ${problem}`, { code: /budget/.test(problem) ? 'RESOURCE_LIMIT' : 'INVALID_DATA' });
    return value;
  } catch (error) {
    if (error instanceof WorkbookBundleError) throw error;
    throw new WorkbookBundleError(`Could not read JSON Bundle entry '${description}'.`, { code: error instanceof SyntaxError || error instanceof TypeError ? 'INVALID_DATA' : 'IO', cause: error });
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  let serialized: string;
  try {
    assertJsonObject(value, path);
    serialized = `${JSON.stringify(value, null, 2)}\n`;
  } catch (error) {
    throw new WorkbookBundleError(`Could not serialize JSON Bundle entry '${path}'.`, { cause: error });
  }
  if (Buffer.byteLength(serialized, 'utf8') > BUNDLE_LIMITS.jsonFileBytes) throw new WorkbookBundleError(`JSON entry '${path}' exceeds the file byte budget.`, { code: 'RESOURCE_LIMIT' });
  await writeFile(path, serialized, "utf8");
}

export function parseVersionedObject(value: unknown, description: string): JsonObject {
  if (!isRecord(value)) throw new WorkbookBundleError(`Bundle entry '${description}' must be a JSON object.`);
  if (value.specVersion !== SPEC_VERSION) {
    throw new WorkbookBundleError(`Bundle entry '${description}' has unsupported specVersion '${String(value.specVersion)}'.`, { code: 'UNSUPPORTED_FORMAT' });
  }
  const { specVersion: _specVersion, ...document } = value;
  assertJsonObject(document, description);
  return document;
}

export function validateRequiredFeatures(features: readonly string[]): void {
  const seen = new Set<string>();
  for (const feature of features) {
    if (!nonEmptyString(feature)) throw new WorkbookBundleError("requiredFeatures values must be non-empty strings.");
    if (seen.has(feature)) throw new WorkbookBundleError(`Duplicate required feature '${feature}'.`);
    seen.add(feature);
    if (!SUPPORTED_REQUIRED_FEATURES.has(feature)) {
      throw new WorkbookBundleError(`Unsupported required Workbook Bundle feature '${feature}'.`, { code: 'UNSUPPORTED_FORMAT' });
    }
  }
}

function assertUniqueIds(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new WorkbookBundleError(`Manifest contains duplicate ${label} values.`);
}

function parseManifestId(kind: "workbook" | "page" | "table", value: unknown, label: string): string {
  if (!isSemanticId(kind, value)) throw new WorkbookBundleError(`Manifest ${label} must be a valid ${kind} ID.`);
  return value;
}

export function assertJsonObject(value: unknown, label: string): asserts value is JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) throw new WorkbookBundleError(`${label} must be a JSON object.`);
}

export function isRecord(value: unknown): value is Record<string, any> {
  return isPlainRecord(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ordinal(value: number): string {
  return String(value).padStart(6, "0");
}

async function settleAll(tasks: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed !== undefined) throw failed.reason;
}
