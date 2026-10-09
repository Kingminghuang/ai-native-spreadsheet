import { PATTERN_LIMITS, type PatternBudget } from "./safe-pattern.js";
import {
  lstat,
  mkdir,
  mkdtemp,
  cp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUNDLE_LIMITS, WorkbookBundleError, type WorkbookBundleErrorCode } from './bundle-contract.js';
import {
  isNodeError,
  mapSequential,
  pathExists,
  readBoundedFile,
  readBudget,
  resolveEntryPath,
  resolveExistingDirectory,
  resolveExistingFile,
  validateRelativePath,
  withBundleLock,
} from './bundle-filesystem.js';
import {
  createRevisionId,
  parseSemanticId,
  type RevisionId,
  type TableId,
} from "./ids.js";
import type { JsonObject, Page, Table, Workbook } from "./model.js";
import { DomainValidationError, assertValidTableSchema, assertValidWorkbook } from "./validation.js";
import { ParquetBundleDataError, UnsupportedParquetFieldTypeError, PARQUET_LIMITS, decodeTableParquet, encodeTableParquet } from "./parquet-adapter.js";
import { validateBundleReferences } from './bundle-references.js';
import {
  assertJsonObject,
  collectPaths,
  createManifest,
  isRecord,
  nonEmptyString,
  parseManifest,
  parseVersionedObject,
  pathFor,
  readJsonFile,
  readLineage,
  readSpecEntries,
  validateRequiredFeatures,
  versioned,
  writeBundleFiles,
  writeJsonFile,
  WORKBOOK_BUNDLE_FORMAT,
  WORKBOOK_BUNDLE_FORMAT_VERSION,
  type ParsedManifest,
  type WorkbookBundleManifest,
  type WorkbookBundleSpecDocument,
} from './bundle-format.js';

export { WORKBOOK_BUNDLE_FORMAT, WORKBOOK_BUNDLE_FORMAT_VERSION };
export type { WorkbookBundleSpecDocument };
import {
  REVISION_HISTORY_FORMAT,
  REVISION_HISTORY_FORMAT_VERSION,
  REVISION_HISTORY_INDEX_PATH,
  REVISION_HISTORY_REQUIRED_FEATURE,
  assertPathsDoNotOverlap,
  createRevisionHistoryIndex,
  createRevisionRecord,
  parseRevisionHistoryIndex,
  parseRevisionId,
  revisionSnapshotPath,
  sameBundleState,
  type CommitWorkbookRevisionOptions,
  type InitializeWorkbookRevisionArchiveOptions,
  type WorkbookRevisionHistoryIndex,
  type WorkbookRevisionRecord,
  type WorkbookRevisionSnapshot,
} from './revision-history.js';

export {
  REVISION_HISTORY_FORMAT,
  REVISION_HISTORY_FORMAT_VERSION,
  REVISION_HISTORY_REQUIRED_FEATURE,
};
export type {
  CommitWorkbookRevisionOptions,
  InitializeWorkbookRevisionArchiveOptions,
  WorkbookRevisionHistoryIndex,
  WorkbookRevisionRecord,
  WorkbookRevisionSnapshot,
};

export { BUNDLE_LIMITS, WorkbookBundleError } from './bundle-contract.js';
export type { WorkbookBundleErrorCode } from './bundle-contract.js';

export type WorkbookEntityKind =
  | "workbook"
  | "page"
  | "table"
  | "field"
  | "row"
  | "calculation"
  | "transform";

export interface WorkbookLineageReference {
  readonly kind: WorkbookEntityKind;
  readonly id: string;
  /** Required when kind is field or row. */
  readonly tableId?: string;
}

export interface WorkbookBundleDraft {
  readonly workbook: Workbook;
  readonly calculations?: readonly WorkbookBundleSpecDocument[];
  readonly transforms?: readonly WorkbookBundleSpecDocument[];
  /** JSON object containing a `records` array. Omitted means an empty lineage document. */
  readonly lineage?: JsonObject;
  readonly requiredFeatures?: readonly string[];
  readonly extensions?: JsonObject;
}

export interface WorkbookBundleState {
  readonly workbook: Workbook;
  readonly calculations: readonly WorkbookBundleSpecDocument[];
  readonly transforms: readonly WorkbookBundleSpecDocument[];
  readonly lineage: JsonObject;
  readonly requiredFeatures: readonly string[];
  readonly extensions: JsonObject;
}



async function bundleBoundary<T>(label: string, action: () => Promise<T>): Promise<T> {
  try { return await readBudget.run({ bytes: 0, files: 0, rows: 0, patterns: { remaining: PATTERN_LIMITS.work } }, action); }
  catch (error) {
    if (error instanceof WorkbookBundleError) throw error;
    let code: WorkbookBundleErrorCode;
    if (error instanceof ParquetBundleDataError) code = error.code;
    else if (error instanceof DomainValidationError) code = error.issues.some(issue => /budget/.test(issue.message)) ? 'RESOURCE_LIMIT' : 'INVALID_DATA';
    else if (error instanceof UnsupportedParquetFieldTypeError) code = 'INVALID_DATA';
    else if (isNodeError(error, 'ERR_INVALID_ARG_VALUE')) code = 'INVALID_PATH';
    else if (typeof error === 'object' && error !== null && 'code' in error) code = 'IO';
    else if (error instanceof TypeError || error instanceof SyntaxError) code = 'INVALID_DATA';
    else throw error; // Do not disguise unrelated programming errors.
    throw new WorkbookBundleError(`${label}: ${error instanceof Error ? error.message : String(error)}`, { code, cause: error });
  }
}

interface OpenedWorkbookBundle {
  readonly rootPath: string;
  readonly manifest: ParsedManifest;
  readonly state: WorkbookBundleState;
}

interface LoadedRevisionArchive extends OpenedWorkbookBundle {
  readonly index: WorkbookRevisionHistoryIndex;
  readonly snapshots: ReadonlyMap<RevisionId, WorkbookBundleState>;
}

/** Save one complete, committed Workbook state as a portable Bundle directory. */
async function saveWorkbookBundleInternal(
  draft: WorkbookBundleDraft,
  destination: string,
): Promise<void> {
  assertValidWorkbook(draft.workbook);
  const normalized = normalizeDraft(draft);
  assertCoreBundleDraft(normalized);
  validateBundleReferences(normalized);

  const destinationPath = resolve(destination);
  if (destinationPath === dirname(destinationPath)) {
    throw new WorkbookBundleError("The Bundle destination must not be a filesystem root.");
  }
  const parentPath = dirname(destinationPath);
  await mkdir(parentPath, { recursive: true });
  const temporaryPath = await mkdtemp(join(parentPath, `.${basename(destinationPath)}.tmp-`));
  let published = false;

  try {
    const manifest = createManifest(normalized);
    await writeBundleFiles(temporaryPath, normalized, manifest);
    await publishDirectory(temporaryPath, destinationPath);
    published = true;
  } finally {
    if (!published) await rm(temporaryPath, { recursive: true, force: true });
  }
}

/** Open and fully validate a Bundle, including every snapshot in a history profile. */
async function openWorkbookBundleInternal(directory: string): Promise<WorkbookBundleState> {
  const opened = await openWorkbookBundleCore(directory);
  await loadRevisionArchive(opened);
  return opened.state;
}

/** Read the current head as a complete immutable snapshot. */
async function openCurrentWorkbookRevisionInternal(directory: string): Promise<WorkbookRevisionSnapshot> {
  const archive = await openWorkbookRevisionArchive(directory);
  const revision = archive.index.revisions.at(-1);
  if (revision === undefined || revision.revisionId !== archive.index.currentRevisionId) {
    throw new WorkbookBundleError("The revision history has no valid current head.");
  }
  const state = archive.snapshots.get(revision.revisionId);
  if (state === undefined) throw new WorkbookBundleError("The current revision snapshot is missing.");
  return { revision, state };
}

/** Read the validated, parent-first metadata index for this Workbook. */
async function openWorkbookRevisionHistoryInternal(directory: string): Promise<WorkbookRevisionHistoryIndex> {
  const archive = await openWorkbookRevisionArchive(directory);
  return archive.index;
}

/** Read one exact historical revision without consulting a newer snapshot. */
async function openWorkbookRevisionInternal(
  directory: string,
  revisionId: RevisionId,
): Promise<WorkbookRevisionSnapshot> {
  const requestedRevisionId = parseRevisionId(revisionId, "revisionId");
  const archive = await openWorkbookRevisionArchive(directory);
  const revision = archive.index.revisions.find((item) => item.revisionId === requestedRevisionId);
  if (revision === undefined) throw new WorkbookBundleError(`Revision '${requestedRevisionId}' does not exist in this Workbook.`);
  const state = archive.snapshots.get(requestedRevisionId);
  if (state === undefined) throw new WorkbookBundleError(`Revision '${requestedRevisionId}' has no readable snapshot.`);
  return { revision, state };
}

/** Create a portable archive with one genesis revision and its full snapshot. */
async function initializeWorkbookRevisionArchiveInternal(
  draft: WorkbookBundleDraft,
  destination: string,
  options: InitializeWorkbookRevisionArchiveOptions = {},
): Promise<WorkbookRevisionSnapshot> {
  const state = normalizeRevisionSourceDraft(draft);
  const revisionId = createRevisionId();
  const revision = createRevisionRecord({
    revisionId,
    sequence: 0,
    parentRevisionId: null,
    transactionId: null,
    actorId: options.actorId ?? null,
    submittedAgainstRevisionId: null,
    ...(options.summary === undefined ? {} : { summary: options.summary }),
    committedAt: options.committedAt ?? new Date().toISOString(),
    snapshotPath: revisionSnapshotPath(revisionId),
  });
  const index = createRevisionHistoryIndex(state.workbook.id, revision.revisionId, [revision]);
  const destinationPath = resolve(destination);
  if (await pathExists(destinationPath)) {
    throw new WorkbookBundleError("A revision archive can only be initialized at a new destination.");
  }
  await publishRevisionArchive(destinationPath, state, index);
  return { revision, state };
}

/**
 * Commit one complete Workbook state as a child of the current head. Stale
 * submissions are rejected so this API cannot silently create a branch.
 */
async function commitWorkbookRevisionInternal(
  directory: string,
  draft: WorkbookBundleDraft,
  options: CommitWorkbookRevisionOptions,
): Promise<WorkbookRevisionSnapshot> {
  const archive = await openWorkbookRevisionArchive(directory);
  const currentRevision = archive.index.revisions.at(-1);
  if (currentRevision === undefined || currentRevision.revisionId !== archive.index.currentRevisionId) {
    throw new WorkbookBundleError("The revision history has no valid current head.");
  }
  const baseRevisionId = parseRevisionId(options.baseRevisionId, "baseRevisionId");
  if (baseRevisionId !== currentRevision.revisionId) {
    throw new WorkbookBundleError(`Bundle '${archive.rootPath}' baseRevisionId '${baseRevisionId}' is stale; current head is '${currentRevision.revisionId}'. Re-read or rebase.`, { code: "CONFLICT" });
  }
  const state = normalizeRevisionSourceDraft(draft);
  if (state.workbook.id !== archive.index.workbookId) {
    throw new WorkbookBundleError("A revision commit must keep the same workbookId.");
  }
  if (typeof options.transactionId !== "string" || options.transactionId.trim().length === 0 || options.transactionId !== options.transactionId.trim()) {
    throw new WorkbookBundleError("A revision commit requires a non-empty transactionId without surrounding whitespace.");
  }
  if (archive.index.revisions.some((item) => item.transactionId === options.transactionId)) {
    throw new WorkbookBundleError(`Transaction '${options.transactionId}' already has a committed Revision.`, { code: 'CONFLICT' });
  }
  const revisionId = createRevisionId();
  const revision = createRevisionRecord({
    revisionId,
    sequence: currentRevision.sequence + 1,
    parentRevisionId: currentRevision.revisionId,
    transactionId: options.transactionId,
    actorId: options.actorId ?? null,
    submittedAgainstRevisionId: baseRevisionId,
    ...(options.summary === undefined ? {} : { summary: options.summary }),
    committedAt: options.committedAt ?? new Date().toISOString(),
    snapshotPath: revisionSnapshotPath(revisionId),
  });
  const index = createRevisionHistoryIndex(state.workbook.id, revisionId, [...archive.index.revisions, revision]);
  await publishRevisionArchive(archive.rootPath, state, index, archive.rootPath);
  return { revision, state };
}

/** Read and validate Bundle v1 state without interpreting the revision profile. */
async function openWorkbookBundleCore(directory: string): Promise<OpenedWorkbookBundle> {
  const rootPath = await realpath(resolve(directory));
  const rootInfo = await stat(rootPath);
  if (!rootInfo.isDirectory()) throw new WorkbookBundleError("The Bundle path must be a directory.");

  const manifestFile = await resolveExistingFile(rootPath, "workbook.json");
  const manifestValue = await readJsonFile(manifestFile, "workbook.json");
  let manifest = parseManifest(manifestValue, rootPath);
  const verifiedPaths = new Map<string, string>();
  await mapSequential([...manifest.absolutePaths.keys()], async (entryPath) => {
    verifiedPaths.set(entryPath, await resolveExistingFile(rootPath, entryPath));
  });
  const realEntryPaths = [...verifiedPaths.values(), manifestFile];
  if (new Set(realEntryPaths).size !== realEntryPaths.length) {
    throw new WorkbookBundleError("Manifest entries must not alias the same file.");
  }
  manifest = { ...manifest, absolutePaths: verifiedPaths };

  const schemaDocuments = await mapSequential(manifest.entries.schemas, async (entry) => {
    const document = await readJsonFile(pathFor(manifest, entry.path), entry.path);
    const schema = parseVersionedObject(document, entry.path);
    if (schema.id !== entry.tableId) {
      throw new WorkbookBundleError(`Schema ID at '${entry.path}' does not match its manifest tableId.`);
    }
    return schema;
  });

  const pageDocuments = await mapSequential(manifest.entries.views, async (entry) => {
    const document = await readJsonFile(pathFor(manifest, entry.path), entry.path);
    const page = parseVersionedObject(document, entry.path);
    if (page.id !== entry.pageId) {
      throw new WorkbookBundleError(`Page ID at '${entry.path}' does not match its manifest pageId.`);
    }
    return page as unknown as Page;
  });

  const calculations = await readSpecEntries(manifest, manifest.entries.calculations, "calculation");
  const transforms = await readSpecEntries(manifest, manifest.entries.transforms, "transform");
  const lineage = await readLineage(manifest);

  const schemasByTableId = new Map<string, JsonObject>();
  for (const schema of schemaDocuments) schemasByTableId.set(String(schema.id), schema);
  const parquetEntriesByTableId = new Map(manifest.entries.tables.map((entry) => [entry.tableId, entry]));
  if (parquetEntriesByTableId.size !== manifest.entries.tables.length) {
    throw new WorkbookBundleError("The manifest contains duplicate Table data entries.");
  }
  if (schemasByTableId.size !== schemaDocuments.length) {
    throw new WorkbookBundleError("The manifest contains duplicate Table Schema entries.");
  }
  if (!sameStringSet(schemasByTableId.keys(), parquetEntriesByTableId.keys())) {
    throw new WorkbookBundleError("Every Table must have exactly one Schema and one Parquet data entry.");
  }

  const tables: Table[] = await mapSequential(schemaDocuments, async (schemaDocument) => {
    const tableId = String(schemaDocument.id);
    const dataEntry = parquetEntriesByTableId.get(tableId);
    if (dataEntry === undefined) throw new WorkbookBundleError(`Table '${tableId}' is missing its Parquet data entry.`);
    try { assertValidTableSchema(schemaDocument); }
    catch (error) { throw new WorkbookBundleError(`Schema for Table '${tableId}': ${error instanceof Error ? error.message : String(error)}`, { code: 'INVALID_DATA', cause: error }); }
    const schema = schemaDocument as unknown as Table["schema"];
    const dataPath = pathFor(manifest, dataEntry.path);
    const bytes = await readBoundedFile(dataPath, PARQUET_LIMITS.fileBytes);
    let data: Table['data'];
    try { data = await decodeTableParquet(bytes, schema); }
    catch (error) { throw new WorkbookBundleError(`Parquet entry '${dataEntry.path}', Table '${tableId}': ${error instanceof Error ? error.message : String(error)}`, { code: error instanceof ParquetBundleDataError ? error.code : 'INVALID_DATA', cause: error }); }
    const budget = readBudget.getStore();
    if (budget) {
      budget.rows += data.rows.length;
      if (budget.rows > BUNDLE_LIMITS.totalRows) throw new WorkbookBundleError(`Table '${tableId}' exceeds the total import row budget.`, { code: 'RESOURCE_LIMIT' });
    }
    return { schema, data };
  });

  const workbook: Workbook = {
    id: parseSemanticId("workbook", manifest.workbook.id),
    name: manifest.workbook.name,
    pages: pageDocuments,
    tables,
    ...(manifest.workbook.metadata === undefined ? {} : { metadata: manifest.workbook.metadata }),
  };
  assertValidWorkbook(workbook, readBudget.getStore()?.patterns);

  const state: WorkbookBundleState = {
    workbook,
    calculations,
    transforms,
    lineage,
    requiredFeatures: manifest.requiredFeatures,
    extensions: manifest.extensions,
  };
  validateBundleReferences(state);
  return { rootPath, manifest, state };
}

async function openWorkbookRevisionArchive(directory: string): Promise<LoadedRevisionArchive> {
  const opened = await openWorkbookBundleCore(directory);
  const archive = await loadRevisionArchive(opened);
  if (archive === undefined) throw new WorkbookBundleError("The Bundle does not declare the revision-history-v1 profile.");
  return archive;
}

async function loadRevisionArchive(opened: OpenedWorkbookBundle): Promise<LoadedRevisionArchive | undefined> {
  const featureEnabled = opened.state.requiredFeatures.includes(REVISION_HISTORY_REQUIRED_FEATURE);
  const extension = opened.state.extensions.revisionHistory;
  if (!featureEnabled) {
    if (extension !== undefined) {
      throw new WorkbookBundleError("The revisionHistory extension requires the revision-history-v1 feature.");
    }
    return undefined;
  }
  if (!isRecord(extension) || Array.isArray(extension)) {
    throw new WorkbookBundleError("A revision-history-v1 Bundle must declare extensions.revisionHistory.path.");
  }
  const extensionRecord = extension as Record<string, unknown>;
  if (!nonEmptyString(extensionRecord.path)) {
    throw new WorkbookBundleError("A revision-history-v1 Bundle must declare extensions.revisionHistory.path.");
  }
  const indexPath = validateRelativePath(extensionRecord.path);
  const rootEntryPaths = collectPaths(opened.manifest.entries);
  assertPathsDoNotOverlap([indexPath, ...rootEntryPaths], "The revision history index must not overlap a Bundle entry.");
  const indexFile = await resolveExistingFile(opened.rootPath, indexPath);
  const coreRealPaths = new Set([
    await realpath(join(opened.rootPath, "workbook.json")),
    ...opened.manifest.absolutePaths.values(),
  ]);
  if (coreRealPaths.has(indexFile)) {
    throw new WorkbookBundleError("The revision history index must not alias a current-state Bundle file.");
  }
  const index = parseRevisionHistoryIndex(
    await readJsonFile(indexFile, indexPath),
    opened.state.workbook.id,
    indexPath,
    rootEntryPaths,
  );

  const snapshotStates = new Map<RevisionId, WorkbookBundleState>();
  const snapshotRealPaths = new Set<string>();
  for (const revision of index.revisions) {
    const snapshotRoot = await resolveExistingDirectory(opened.rootPath, revision.snapshotPath);
    if (snapshotRealPaths.has(snapshotRoot)) {
      throw new WorkbookBundleError("Revision snapshot paths must not alias the same directory.");
    }
    snapshotRealPaths.add(snapshotRoot);
    const snapshot = await openWorkbookBundleCore(snapshotRoot);
    if (snapshot.state.workbook.id !== index.workbookId) {
      throw new WorkbookBundleError(`Revision '${revision.revisionId}' snapshot belongs to another Workbook.`);
    }
    if (
      snapshot.state.requiredFeatures.includes(REVISION_HISTORY_REQUIRED_FEATURE)
      || snapshot.state.extensions.revisionHistory !== undefined
    ) {
      throw new WorkbookBundleError(`Revision '${revision.revisionId}' snapshot must be a plain Bundle v1 state.`);
    }
    snapshotStates.set(revision.revisionId, snapshot.state);
  }

  const currentRevision = index.revisions.at(-1);
  if (currentRevision === undefined || currentRevision.revisionId !== index.currentRevisionId) {
    throw new WorkbookBundleError("Revision history currentRevisionId must identify the final revision in the linear chain.");
  }
  const currentSnapshot = snapshotStates.get(currentRevision.revisionId);
  if (currentSnapshot === undefined || !sameBundleState(opened.state, currentSnapshot)) {
    throw new WorkbookBundleError("The root Bundle state does not match the declared current revision snapshot.");
  }
  return { ...opened, index, snapshots: snapshotStates };
}

function normalizeRevisionSourceDraft(draft: WorkbookBundleDraft): WorkbookBundleState {
  assertValidWorkbook(draft.workbook);
  const state = normalizeDraft(draft);
  assertCoreBundleDraft(state);
  validateBundleReferences(state);
  return state;
}

function assertCoreBundleDraft(state: WorkbookBundleState): void {
  if (
    state.requiredFeatures.includes(REVISION_HISTORY_REQUIRED_FEATURE)
    || state.extensions.revisionHistory !== undefined
  ) {
    throw new WorkbookBundleError("Use revision archive APIs to create or update a revision-history-v1 Bundle.");
  }
}

function withRevisionHistoryProfile(state: WorkbookBundleState): WorkbookBundleState {
  const requiredFeatures = state.requiredFeatures.includes(REVISION_HISTORY_REQUIRED_FEATURE)
    ? state.requiredFeatures
    : [...state.requiredFeatures, REVISION_HISTORY_REQUIRED_FEATURE];
  const extensions: JsonObject = {
    ...state.extensions,
    revisionHistory: { path: REVISION_HISTORY_INDEX_PATH },
  };
  const profiled = { ...state, requiredFeatures, extensions };
  validateRequiredFeatures(profiled.requiredFeatures);
  return profiled;
}

async function publishRevisionArchive(
  destinationPath: string,
  state: WorkbookBundleState,
  index: WorkbookRevisionHistoryIndex,
  previousRootPath?: string,
): Promise<void> {
  if (destinationPath === dirname(destinationPath)) {
    throw new WorkbookBundleError("The revision archive destination must not be a filesystem root.");
  }
  const parentPath = dirname(destinationPath);
  await mkdir(parentPath, { recursive: true });
  const temporaryPath = await mkdtemp(join(parentPath, `.${basename(destinationPath)}.revision-tmp-`));
  let published = false;
  try {
    await writeRevisionArchiveFiles(temporaryPath, state, index, previousRootPath);
    await publishDirectory(temporaryPath, destinationPath);
    published = true;
  } finally {
    if (!published) await rm(temporaryPath, { recursive: true, force: true });
  }
}

async function writeRevisionArchiveFiles(
  rootPath: string,
  state: WorkbookBundleState,
  index: WorkbookRevisionHistoryIndex,
  previousRootPath?: string,
): Promise<void> {
  const previousRevisionIds = new Set<RevisionId>();
  if (previousRootPath !== undefined) {
    for (const revision of index.revisions.slice(0, -1)) {
      previousRevisionIds.add(revision.revisionId);
      const sourcePath = await resolveExistingDirectory(previousRootPath, revision.snapshotPath);
      const destination = resolveEntryPath(rootPath, revision.snapshotPath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(sourcePath, destination, { recursive: true, errorOnExist: true, force: false });
    }
  }

  for (const revision of index.revisions) {
    if (previousRevisionIds.has(revision.revisionId)) continue;
    const snapshotRoot = resolveEntryPath(rootPath, revision.snapshotPath);
    await mkdir(snapshotRoot, { recursive: true });
    const snapshotManifest = createManifest(state);
    await writeBundleFiles(snapshotRoot, state, snapshotManifest);
  }

  const indexPath = resolveEntryPath(rootPath, REVISION_HISTORY_INDEX_PATH);
  await mkdir(dirname(indexPath), { recursive: true });
  await writeJsonFile(indexPath, index);

  const rootState = withRevisionHistoryProfile(state);
  await writeBundleFiles(rootPath, rootState, createManifest(rootState));
}

function normalizeDraft(draft: WorkbookBundleDraft): WorkbookBundleState {
  const calculations = draft.calculations ?? [];
  const transforms = draft.transforms ?? [];
  const lineage = draft.lineage ?? { records: [] };
  const requiredFeatures = draft.requiredFeatures ?? [];
  const extensions = draft.extensions ?? {};
  assertJsonObject(lineage, "lineage");
  assertJsonObject(extensions, "extensions");
  if (!Array.isArray(lineage.records)) {
    throw new WorkbookBundleError("The Lineage document must contain a records array.");
  }
  validateRequiredFeatures(requiredFeatures);
  return { workbook: draft.workbook, calculations, transforms, lineage, requiredFeatures, extensions };
}

async function publishDirectory(temporaryPath: string, destinationPath: string): Promise<void> {
  // Verify the complete staged artifact within the same reader budgets before
  // touching the old tree. Successful saves must always be readable.
  await readBudget.run({ bytes: 0, files: 0, rows: 0, patterns: { remaining: PATTERN_LIMITS.work } }, async () => {
    const staged = await openWorkbookBundleCore(temporaryPath);
    await loadRevisionArchive(staged);
  });
  let destinationExists = false;
  try {
    await lstat(destinationPath);
    destinationExists = true;
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }

  if (!destinationExists) {
    await rename(temporaryPath, destinationPath);
    return;
  }

  const stagedManifest = await readJsonFile(join(temporaryPath, 'workbook.json'), 'staged manifest') as WorkbookBundleManifest;
  await assertSafeDestination(destinationPath, stagedManifest.requiredFeatures.includes(REVISION_HISTORY_REQUIRED_FEATURE));
  const parentPath = dirname(destinationPath);
  const backupPath = await mkdtemp(join(parentPath, `.${basename(destinationPath)}.backup-`));
  await rm(backupPath, { recursive: true, force: true });
  await rename(destinationPath, backupPath);
  try {
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rename(backupPath, destinationPath);
    throw error;
  }
  await rm(backupPath, { recursive: true, force: true });
}

function sameStringSet(left: Iterable<string>, right: Iterable<string>): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export async function saveWorkbookBundle(draft: WorkbookBundleDraft, destination: string): Promise<void> {
  return bundleBoundary(`Save Bundle '${destination}'`, () => withBundleLock(destination, async path => {
    await assertSafeDestination(path, false);
    return saveWorkbookBundleInternal(draft, path);
  }, true));
}
export async function openWorkbookBundle(directory: string): Promise<WorkbookBundleState> {
  return bundleBoundary(`Open Bundle '${directory}'`, () => withBundleLock(directory, openWorkbookBundleInternal));
}
export async function openCurrentWorkbookRevision(directory: string): Promise<WorkbookRevisionSnapshot> {
  return bundleBoundary(`Read current Revision '${directory}'`, () => withBundleLock(directory, openCurrentWorkbookRevisionInternal));
}
export async function openWorkbookRevisionHistory(directory: string): Promise<WorkbookRevisionHistoryIndex> {
  return bundleBoundary(`Read Revision history '${directory}'`, () => withBundleLock(directory, openWorkbookRevisionHistoryInternal));
}
export async function openWorkbookRevision(directory: string, revisionId: RevisionId): Promise<WorkbookRevisionSnapshot> {
  return bundleBoundary(`Read Revision '${revisionId}' in '${directory}'`, () => withBundleLock(directory, path => openWorkbookRevisionInternal(path, revisionId)));
}
export async function initializeWorkbookRevisionArchive(draft: WorkbookBundleDraft, destination: string, options: InitializeWorkbookRevisionArchiveOptions = {}): Promise<WorkbookRevisionSnapshot> {
  return bundleBoundary(`Initialize archive '${destination}'`, () => withBundleLock(destination, async path => {
    await assertSafeDestination(path, false);
    return initializeWorkbookRevisionArchiveInternal(draft, path, options);
  }, true));
}
export async function commitWorkbookRevision(directory: string, draft: WorkbookBundleDraft, options: CommitWorkbookRevisionOptions): Promise<WorkbookRevisionSnapshot> {
  return bundleBoundary(`Commit Revision in '${directory}'`, () => withBundleLock(directory, async path => {
    await assertSafeDestination(path, true);
    return commitWorkbookRevisionInternal(path, draft, options);
  }));
}

/** A replaceable tree must be a fully valid Bundle with exactly the declared files.
 * Extra files, directories, symlinks and special files cause rejection, never removal.
 */
async function assertSafeDestination(path: string, allowHistory: boolean): Promise<void> {
  const cwd = await realpath(process.cwd());
  const fromDestination = relative(path, cwd);
  if (fromDestination === '' || (!fromDestination.startsWith(`..${sep}`) && fromDestination !== '..' && !isAbsolute(fromDestination))) {
    throw new WorkbookBundleError(`Refusing to replace the working directory or its ancestor '${path}'.`, { code: 'UNSAFE_DESTINATION' });
  }
  if (!(await pathExists(path))) return;
  try {
    await readBudget.run({ bytes: 0, files: 0, rows: 0, patterns: { remaining: PATTERN_LIMITS.work } }, async () => {
      const opened = await openWorkbookBundleCore(path);
      const archive = await loadRevisionArchive(opened);
      if (archive && !allowHistory) throw new WorkbookBundleError('Use commitWorkbookRevision to preserve existing Revision history.');
      const files = new Set<string>();
      const directories = new Set<string>();
      const addFile = (file: string) => {
        files.add(file);
        let parent = dirname(file);
        while (parent !== '.') { directories.add(parent); parent = dirname(parent); }
      };
      const addBundle = (manifest: ParsedManifest, prefix = '') => {
        addFile(join(prefix, 'workbook.json'));
        collectPaths(manifest.entries).forEach(file => addFile(join(prefix, file)));
        ['schemas', 'calculations', 'transforms', 'views', 'lineage', 'tables'].forEach(dir => directories.add(join(prefix, dir)));
      };
      addBundle(opened.manifest);
      if (archive) {
        addFile(String((opened.state.extensions.revisionHistory as JsonObject).path));
        for (const revision of archive.index.revisions) {
          const manifestFile = join(path, revision.snapshotPath, 'workbook.json');
          const manifest = parseManifest(await readJsonFile(manifestFile, revision.snapshotPath), join(path, revision.snapshotPath));
          addBundle(manifest, revision.snapshotPath);
        }
      }
      const walk = async (prefix: string): Promise<void> => {
        for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
          const local = join(prefix, entry.name);
          if (entry.isFile() && files.has(local)) continue;
          if (entry.isDirectory() && directories.has(local)) { await walk(local); continue; }
          throw new WorkbookBundleError(`Unmanaged content '${local}' prevents Bundle replacement.`);
        }
      };
      await walk('');
    });
  } catch (error) {
    throw new WorkbookBundleError(`Refusing to replace Bundle target '${path}': ${error instanceof Error ? error.message : String(error)}`, { code: 'UNSAFE_DESTINATION', cause: error });
  }
}
