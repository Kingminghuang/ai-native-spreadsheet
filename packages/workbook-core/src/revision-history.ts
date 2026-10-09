import { BUNDLE_LIMITS, WorkbookBundleError } from './bundle-contract.js';
import { validateRelativePath } from './bundle-filesystem.js';
import { parseSemanticId, type RevisionId } from './ids.js';
import type { Workbook } from './model.js';
import type { WorkbookBundleState } from './bundle.js';

export const REVISION_HISTORY_REQUIRED_FEATURE = 'revision-history-v1' as const;
export const REVISION_HISTORY_FORMAT = 'ai-native-spreadsheet-revision-history' as const;
export const REVISION_HISTORY_FORMAT_VERSION = 1 as const;
export const REVISION_HISTORY_INDEX_PATH = 'history/index.json';
const REVISION_SNAPSHOT_DIRECTORY = 'history/snapshots';

export interface WorkbookRevisionRecord {
  readonly revisionId: RevisionId;
  readonly sequence: number;
  readonly parentRevisionId: RevisionId | null;
  readonly committedAt: string;
  readonly transactionId: string | null;
  readonly actorId: string | null;
  readonly submittedAgainstRevisionId: RevisionId | null;
  readonly summary?: string;
  readonly snapshotPath: string;
}

export interface WorkbookRevisionHistoryIndex {
  readonly format: typeof REVISION_HISTORY_FORMAT;
  readonly formatVersion: typeof REVISION_HISTORY_FORMAT_VERSION;
  readonly workbookId: Workbook["id"];
  readonly currentRevisionId: RevisionId;
  readonly revisions: readonly WorkbookRevisionRecord[];
}

export interface WorkbookRevisionSnapshot {
  readonly revision: WorkbookRevisionRecord;
  readonly state: WorkbookBundleState;
}

export interface InitializeWorkbookRevisionArchiveOptions {
  readonly actorId?: string;
  readonly summary?: string;
  readonly committedAt?: string;
}

export interface CommitWorkbookRevisionOptions {
  /** The revision this submitted state was prepared against; commits are linear. */
  readonly baseRevisionId: RevisionId;
  readonly transactionId: string;
  readonly actorId?: string;
  readonly summary?: string;
  readonly committedAt?: string;
}

export function parseRevisionHistoryIndex(
  value: unknown,
  expectedWorkbookId: Workbook["id"],
  indexPath: string,
  rootEntryPaths: readonly string[],
): WorkbookRevisionHistoryIndex {
  if (!isRecord(value)) throw new WorkbookBundleError("The revision history index must be a JSON object.");
  if (value.format !== REVISION_HISTORY_FORMAT || value.formatVersion !== REVISION_HISTORY_FORMAT_VERSION) {
    throw new WorkbookBundleError("The revision history index has an unsupported format or formatVersion.");
  }
  let workbookId: Workbook["id"];
  try {
    workbookId = parseSemanticId("workbook", value.workbookId);
  } catch (error) {
    throw new WorkbookBundleError("The revision history index must declare a valid workbookId.", { cause: error });
  }
  if (workbookId !== expectedWorkbookId) {
    throw new WorkbookBundleError("The revision history index belongs to another Workbook.");
  }
  const currentRevisionId = parseRevisionId(value.currentRevisionId, "currentRevisionId");
  if (!Array.isArray(value.revisions) || value.revisions.length === 0) {
    throw new WorkbookBundleError("The revision history index must contain at least one Revision.");
  }

  if (value.revisions.length > BUNDLE_LIMITS.revisions) throw new WorkbookBundleError('Revision count resource budget exceeded.', { code: 'RESOURCE_LIMIT' });
  const records = value.revisions.map(parseRevisionRecord);
  const recordsById = new Map<RevisionId, WorkbookRevisionRecord>();
  const sequenceById = new Map<RevisionId, number>();
  const transactionIds = new Set<string>();
  const snapshotPaths: string[] = [];
  const allPaths = [...rootEntryPaths, indexPath];
  for (let index = 0; index < records.length; index += 1) {
    const revision = records[index];
    if (revision === undefined) throw new WorkbookBundleError("The revision history index contains an unreadable Revision.");
    if (recordsById.has(revision.revisionId)) {
      throw new WorkbookBundleError(`Duplicate revisionId '${revision.revisionId}'.`);
    }
    if (revision.sequence !== index) {
      throw new WorkbookBundleError("Revision sequence values must start at zero and increase by one in parent-first order.");
    }
    if (index === 0) {
      if (revision.parentRevisionId !== null || revision.transactionId !== null || revision.submittedAgainstRevisionId !== null) {
        throw new WorkbookBundleError("The genesis Revision must not have a parent, transaction, or submitted base revision.");
      }
    } else {
      const parent = records[index - 1];
      if (parent === undefined || revision.parentRevisionId !== parent.revisionId) {
        throw new WorkbookBundleError("Every non-root Revision must name the immediately preceding Revision as its sole parent.");
      }
      if (revision.transactionId === null || revision.submittedAgainstRevisionId === null) {
        throw new WorkbookBundleError("Every committed non-root Revision must record its transactionId and submittedAgainstRevisionId.");
      }
      if (transactionIds.has(revision.transactionId)) {
        throw new WorkbookBundleError(`Duplicate transactionId '${revision.transactionId}' in revision history.`);
      }
      transactionIds.add(revision.transactionId);
      const baseSequence = sequenceById.get(revision.submittedAgainstRevisionId);
      if (baseSequence === undefined || baseSequence > index - 1) {
        throw new WorkbookBundleError(`Revision '${revision.revisionId}' has an unknown or non-ancestor submittedAgainstRevisionId.`);
      }
    }
    recordsById.set(revision.revisionId, revision);
    sequenceById.set(revision.revisionId, revision.sequence);
    snapshotPaths.push(revision.snapshotPath);
  }

  if (!recordsById.has(currentRevisionId)) {
    throw new WorkbookBundleError("The currentRevisionId does not resolve to a Revision.");
  }
  const finalRevision = records.at(-1);
  if (finalRevision?.revisionId !== currentRevisionId) {
    throw new WorkbookBundleError("currentRevisionId must identify the final Revision in the history index.");
  }
  assertPathsDoNotOverlap([...allPaths, ...snapshotPaths], "Revision snapshot, history index, and current-state paths must be distinct.");
  return {
    format: REVISION_HISTORY_FORMAT,
    formatVersion: REVISION_HISTORY_FORMAT_VERSION,
    workbookId,
    currentRevisionId,
    revisions: records,
  };
}

function parseRevisionRecord(value: unknown): WorkbookRevisionRecord {
  if (!isRecord(value)) throw new WorkbookBundleError("Each revision history entry must be an object.");
  const revisionId = parseRevisionId(value.revisionId, "revisionId");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
    throw new WorkbookBundleError(`Revision '${revisionId}' must have a non-negative integer sequence.`);
  }
  let parentRevisionId: RevisionId | null;
  if (value.parentRevisionId === null) parentRevisionId = null;
  else parentRevisionId = parseRevisionId(value.parentRevisionId, "parentRevisionId");
  if (!isUtcTimestamp(value.committedAt)) {
    throw new WorkbookBundleError(`Revision '${revisionId}' must have an RFC 3339 UTC committedAt timestamp.`);
  }
  const transactionId = nullableNonEmptyString(value.transactionId, `Revision '${revisionId}' transactionId`);
  const actorId = nullableNonEmptyString(value.actorId, `Revision '${revisionId}' actorId`);
  let submittedAgainstRevisionId: RevisionId | null;
  if (value.submittedAgainstRevisionId === null) submittedAgainstRevisionId = null;
  else submittedAgainstRevisionId = parseRevisionId(value.submittedAgainstRevisionId, "submittedAgainstRevisionId");
  if (value.summary !== undefined && typeof value.summary !== "string") {
    throw new WorkbookBundleError(`Revision '${revisionId}' summary must be a string when provided.`);
  }
  let snapshotPath: string;
  try {
    snapshotPath = validateRelativePath(value.snapshotPath);
  } catch (error) {
    throw new WorkbookBundleError(`Revision '${revisionId}' must declare a safe relative snapshotPath.`, { cause: error });
  }
  return {
    revisionId,
    sequence: value.sequence as number,
    parentRevisionId,
    committedAt: value.committedAt,
    transactionId,
    actorId,
    submittedAgainstRevisionId,
    ...(value.summary === undefined ? {} : { summary: value.summary }),
    snapshotPath,
  };
}

export function parseRevisionId(value: unknown, label: string): RevisionId {
  try {
    return parseSemanticId("revision", value);
  } catch (error) {
    throw new WorkbookBundleError(`${label} must be a valid opaque Revision ID.`, { cause: error });
  }
}

function nullableNonEmptyString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!nonEmptyString(value)) throw new WorkbookBundleError(`${label} must be null or a non-empty string.`);
  return value;
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function assertPathsDoNotOverlap(paths: readonly string[], message: string): void {
  const validated = paths.map(validateRelativePath).sort();
  for (let index = 1; index < validated.length; index += 1) {
    const previous = validated[index - 1];
    const current = validated[index];
    if (previous === undefined || current === undefined) continue;
    if (current === previous || current.startsWith(`${previous}/`)) throw new WorkbookBundleError(message);
  }
}

export function sameBundleState(left: WorkbookBundleState, right: WorkbookBundleState): boolean {
  const coreState = (state: WorkbookBundleState) => {
    const extensions = Object.fromEntries(
      Object.entries(state.extensions).filter(([key]) => key !== "revisionHistory"),
    );
    return {
      workbook: state.workbook,
      calculations: state.calculations,
      transforms: state.transforms,
      lineage: state.lineage,
      requiredFeatures: state.requiredFeatures.filter((feature) => feature !== REVISION_HISTORY_REQUIRED_FEATURE),
      extensions,
    };
  };
  return canonicalJson(coreState(left)) === canonicalJson(coreState(right));
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new WorkbookBundleError("Could not compare Bundle state as JSON.");
  return JSON.stringify(sortJsonKeys(JSON.parse(serialized) as unknown));
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonKeys(value[key])]));
  }
  return value;
}

export function createRevisionRecord(record: WorkbookRevisionRecord): WorkbookRevisionRecord {
  const revisionId = parseRevisionId(record.revisionId, "revisionId");
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 0) {
    throw new WorkbookBundleError("Revision sequence must be a non-negative safe integer.");
  }
  if (!isUtcTimestamp(record.committedAt)) {
    throw new WorkbookBundleError("Revision committedAt must be an RFC 3339 UTC timestamp.");
  }
  if (record.transactionId !== null && !nonEmptyString(record.transactionId)) {
    throw new WorkbookBundleError("Revision transactionId must be null or a non-empty string.");
  }
  if (record.actorId !== null && !nonEmptyString(record.actorId)) {
    throw new WorkbookBundleError("Revision actorId must be null or a non-empty string.");
  }
  if (record.summary !== undefined && typeof record.summary !== "string") {
    throw new WorkbookBundleError("Revision summary must be a string when provided.");
  }
  const snapshotPath = validateRelativePath(record.snapshotPath);
  return { ...record, revisionId, snapshotPath };
}

export function createRevisionHistoryIndex(
  workbookId: Workbook["id"],
  currentRevisionId: RevisionId,
  revisions: readonly WorkbookRevisionRecord[],
): WorkbookRevisionHistoryIndex {
  const index = {
    format: REVISION_HISTORY_FORMAT,
    formatVersion: REVISION_HISTORY_FORMAT_VERSION,
    workbookId,
    currentRevisionId,
    revisions: revisions.map(createRevisionRecord),
  } satisfies WorkbookRevisionHistoryIndex;
  parseRevisionHistoryIndex(index, workbookId, REVISION_HISTORY_INDEX_PATH, []);
  return index;
}

export function revisionSnapshotPath(revisionId: RevisionId): string {
  return `${REVISION_SNAPSHOT_DIRECTORY}/${revisionId}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

