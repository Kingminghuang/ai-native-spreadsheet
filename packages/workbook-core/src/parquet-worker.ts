import { parentPort, workerData } from 'node:worker_threads';
import { decodeTableParquetInternal, ParquetBundleDataError } from './parquet-adapter.js';
try {
  parentPort!.postMessage({ data: await decodeTableParquetInternal(workerData.bytes, workerData.schema) });
} catch (error) {
  parentPort!.postMessage({ code: error instanceof ParquetBundleDataError ? error.code : 'INVALID_DATA', error: error instanceof Error ? error : new Error(String(error)) });
}
