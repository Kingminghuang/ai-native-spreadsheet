import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { saveWorkbookBundle, openWorkbookBundle, validateWorkbook } from '../dist/index.js';
import { workbook, sandbox } from './helpers.mjs';
test('domain and portable Bundle baseline', async t => {
  const w = workbook();
  assert.deepEqual(validateWorkbook(w), []);
  const path = join(await sandbox(t), 'bundle');
  await saveWorkbookBundle({ workbook: w }, path);
  assert.deepEqual((await openWorkbookBundle(path)).workbook, w);
});
