import { saveWorkbookBundle, commitWorkbookRevision, validateWorkbook } from '../dist/index.js';
import { workbook } from './helpers.mjs';
const [mode, path, base, transaction] = process.argv.slice(2);
if (mode === 'cwd') {
  try { await saveWorkbookBundle({ workbook: workbook() }, '.'); process.exitCode = 1; }
  catch (error) { process.stdout.write(JSON.stringify({ name: error.name, code: error.code })); }
} else if (mode === 'regex') {
  const w = workbook('string', 'a'.repeat(26) + 'b');
  w.tables[0].schema.fields[0].constraints = { pattern: '^(a+)+$' };
  const started = Date.now();
  const issues = validateWorkbook(w);
  process.stdout.write(JSON.stringify({ issues, elapsed: Date.now() - started }));
} else if (mode === 'commit') {
  process.send({ ready: true });
  process.once('message', async () => {
    const pending = commitWorkbookRevision(path, { workbook: workbook('number', transaction === 'first' ? 2 : 3) }, { baseRevisionId: base, transactionId: transaction });
    process.send({ started: true });
    try { const result = await pending; process.send({ result }); }
    catch (error) { process.send({ error: { name: error.name, code: error.code, message: error.message } }); }
    process.disconnect();
  });
}
