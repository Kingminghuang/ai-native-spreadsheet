export type WorkbookBundleErrorCode =
  | 'INVALID_BUNDLE'
  | 'INVALID_PATH'
  | 'INVALID_DATA'
  | 'IO'
  | 'RESOURCE_LIMIT'
  | 'UNSUPPORTED_FORMAT'
  | 'CONFLICT'
  | 'UNSAFE_DESTINATION';

export class WorkbookBundleError extends Error {
  readonly code: WorkbookBundleErrorCode;

  constructor(message: string, options?: ErrorOptions & { code?: WorkbookBundleErrorCode }) {
    super(message, options);
    this.name = 'WorkbookBundleError';
    this.code = options?.code ?? 'INVALID_BUNDLE';
  }
}

export const BUNDLE_LIMITS = Object.freeze({
  jsonFileBytes: 8 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  files: 10_000,
  revisions: 256,
  totalRows: 1_000_000,
  lockWaitMs: 10_000,
});
