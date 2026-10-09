import { lstat, mkdir, open, realpath, rm, stat } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PatternBudget } from './safe-pattern.js';
import { BUNDLE_LIMITS, WorkbookBundleError } from './bundle-contract.js';

export interface BundleReadBudget {
  bytes: number;
  files: number;
  rows: number;
  patterns: PatternBudget;
}

export const readBudget = new AsyncLocalStorage<BundleReadBudget>();

/** Acquire a sibling lock so Bundle operations stay serialized while the root is replaced. */
export async function withBundleLock<T>(
  directory: string,
  action: (path: string) => Promise<T>,
  createParent = false,
): Promise<T> {
  if (typeof directory !== 'string' || /[\x00-\x1f\x7f]/.test(directory)) {
    throw new WorkbookBundleError('Invalid Bundle directory path.', { code: 'INVALID_PATH' });
  }

  const requested = resolve(directory);
  if (requested === dirname(requested)) {
    throw new WorkbookBundleError('Bundle path must not be a filesystem root.', { code: 'UNSAFE_DESTINATION' });
  }
  if (createParent) await mkdir(dirname(requested), { recursive: true });

  const path = join(await realpath(dirname(requested)), basename(requested));
  const lock = join(dirname(path), `.${basename(path)}.workbook-lock`);
  const deadline = Date.now() + BUNDLE_LIMITS.lockWaitMs;

  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      if (Date.now() >= deadline) {
        throw new WorkbookBundleError(
          `Bundle '${path}' is locked; another operation is active or an orphan lock needs recovery.`,
          { code: 'CONFLICT', cause: error },
        );
      }
      await delay(25);
    }
  }

  try {
    if (await pathExists(path) && (await lstat(path)).isSymbolicLink()) {
      throw new WorkbookBundleError(`Bundle root '${path}' must not be a symlink.`, { code: 'INVALID_PATH' });
    }
    return await action(path);
  } finally {
    await rm(lock, { recursive: true });
  }
}

export async function resolveExistingDirectory(rootPath: string, relativePath: string): Promise<string> {
  const candidate = resolveEntryPath(rootPath, relativePath);
  try {
    const actual = await realpath(candidate);
    const realPathFromRoot = relative(rootPath, actual);
    if (isOutsideRoot(realPathFromRoot)) {
      throw new WorkbookBundleError(`Bundle directory '${relativePath}' resolves outside the Bundle root.`);
    }
    if (!(await stat(actual)).isDirectory()) {
      throw new WorkbookBundleError(`Revision snapshot '${relativePath}' is not a directory.`);
    }
    return actual;
  } catch (error) {
    if (error instanceof WorkbookBundleError) throw error;
    throw new WorkbookBundleError(`Could not read revision snapshot directory '${relativePath}'.`, { cause: error });
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw error;
  }
}

export function validateRelativePath(value: string): string {
  if (
    typeof value !== 'string' || value.trim().length === 0 || isAbsolute(value) ||
    value.includes('\\') || /[\x00-\x1f\x7f:]/.test(value)
  ) {
    throw new WorkbookBundleError(`Bundle path '${String(value)}' must be a normalized relative POSIX path.`, { code: 'INVALID_PATH' });
  }

  const segments = value.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new WorkbookBundleError(`Bundle path '${value}' must not contain empty, '.' or '..' segments.`, { code: 'INVALID_PATH' });
  }
  return value;
}

export function resolveEntryPath(rootPath: string, relativePath: string): string {
  const normalized = validateRelativePath(relativePath);
  const absolutePath = resolve(rootPath, ...normalized.split('/'));
  const pathFromRoot = relative(rootPath, absolutePath);
  if (isOutsideRoot(pathFromRoot)) {
    throw new WorkbookBundleError(`Bundle path '${relativePath}' escapes the Bundle root.`);
  }
  return absolutePath;
}

export async function resolveExistingFile(rootPath: string, relativePath: string): Promise<string> {
  const candidate = resolveEntryPath(rootPath, relativePath);
  const pathFromRoot = relative(rootPath, candidate);
  if (isOutsideRoot(pathFromRoot)) {
    throw new WorkbookBundleError(`Bundle path '${relativePath}' escapes the Bundle root.`);
  }

  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch (error) {
    throw new WorkbookBundleError(`Could not resolve Bundle entry '${relativePath}'.`, { code: 'IO', cause: error });
  }

  const realPathFromRoot = relative(rootPath, actual);
  if (isOutsideRoot(realPathFromRoot)) {
    throw new WorkbookBundleError(`Bundle path '${relativePath}' resolves outside the Bundle root.`);
  }
  if (!(await stat(actual)).isFile()) {
    throw new WorkbookBundleError(`Bundle entry '${relativePath}' is not a regular file.`);
  }
  return actual;
}

export async function mapSequential<T, R>(
  values: readonly T[],
  action: (value: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  for (const value of values) result.push(await action(value));
  return result;
}

/** Read one regular file with both per-file and per-import byte limits. */
export async function readBoundedFile(path: string, limit: number): Promise<Uint8Array> {
  const budget = readBudget.getStore();
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new WorkbookBundleError(`Bundle entry '${path}' is not a regular file.`, { code: 'INVALID_PATH' });
    }
    if (
      info.size > limit ||
      (budget && (budget.files + 1 > BUNDLE_LIMITS.files || budget.bytes + info.size > BUNDLE_LIMITS.totalBytes))
    ) {
      throw new WorkbookBundleError(`Bundle file '${path}' exceeds the import resource budget.`, { code: 'RESOURCE_LIMIT' });
    }
    if (budget) {
      budget.files++;
      budget.bytes += info.size;
    }

    // Fixed-size reads avoid allocating without bound if a file grows while it is read.
    const bytes = new Uint8Array(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== info.size) {
      throw new WorkbookBundleError(`Bundle file '${path}' changed during reading.`, { code: 'IO' });
    }
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as NodeJS.ErrnoException).code === code;
}

function isOutsideRoot(pathFromRoot: string): boolean {
  return pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}
