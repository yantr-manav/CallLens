// End-to-end probe of the LIVE n8n workflow — no Next.js, no browser.
//
//   node scripts/test-n8n.mjs                 # analyze a sample, expect 200
//   node scripts/test-n8n.mjs --bad-signature # expect a rejection
//   node scripts/test-n8n.mjs --file samples/call-frustrated-churn.txt
//
// Reads .env itself so there is nothing to export first. This is the fastest
// way to tell whether a problem is in n8n or in the app: if this passes, the
// workflow, the shared secret and the Groq key are all correct.
import { readFileSync } from 'node:fs';
import crypto, { randomUUID } from 'node:crypto';

// ── tiny .env reader (no dotenv dependency) ──
function loadEnv() {
  let raw = '';
  try {
    raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

// Setting process.exitCode instead of calling process.exit() lets the event loop
// drain; exiting while a keep-alive socket is still closing trips a libuv
// assertion on Windows.
async function main() {
  const fileEnv = loadEnv();
  const url = process.env.N8N_WEBHOOK_URL || fileEnv.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET || fileEnv.N8N_WEBHOOK_SECRET;

  if (!url || !secret) {
    console.error(
      'N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET must be set (.env or environment).'
    );
    return 2;
  }

  const args = process.argv.slice(2);
  const badSignature = args.includes('--bad-signature');
  const fileIdx = args.indexOf('--file');
  const file =
    fileIdx >= 0 && args[fileIdx + 1]
      ? args[fileIdx + 1]
      : 'samples/call-billing-dispute.txt';

  // Crude turn split — the app uses lib/normalize.ts, but for a transport probe
  // any reasonable segmentation is enough.
  const turns = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
      return {
        seq: i + 1,
        speaker: m ? m[1].trim() : 'unknown',
        text: m ? m[2].trim() : l.trim(),
      };
    });

  const payload = {
    conversation_id: randomUUID(),
    file_name: file.split('/').pop(),
    transcript: turns,
  };
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  console.log(`POST ${url}`);
  console.log(
    `  file=${file} turns=${turns.length} signature=${badSignature ? 'DELIBERATELY WRONG' : 'valid'}`
  );

  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': badSignature ? 'deadbeef'.repeat(8) : signature,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    console.error(
      `\nFAIL — request threw after ${Date.now() - started}ms: ${err.message}`
    );
    return 1;
  }

  const elapsed = Date.now() - started;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }

  console.log(`  HTTP ${res.status} in ${elapsed}ms`);

  // ── The bad-signature case: a rejection is the PASS condition. ──
  // n8n Cloud serves Respond-node bodies over HTTP 200, so check the envelope
  // rather than the status code (lib/n8n.ts does the same).
  if (badSignature) {
    const rejected =
      res.status === 401 ||
      (json && typeof json.error === 'string' && json.ok !== true);
    console.log(
      rejected
        ? '\nPASS — bad signature was rejected.'
        : `\nFAIL — expected a rejection, got: ${text.slice(0, 300)}`
    );
    return rejected ? 0 : 1;
  }

  if (!json) {
    console.error(`\nFAIL — non-JSON response: ${text.slice(0, 400)}`);
    return 1;
  }

  if (json.ok !== true || !json.result) {
    console.error(`\nFAIL — ${JSON.stringify(json).slice(0, 500)}`);
    if (json.error === 'Invalid signature. Webhook call rejected.') {
      console.error(
        '\n  → The Config node in n8n does not hold the same N8N_WEBHOOK_SECRET as .env.\n' +
          '    Rebuild and re-import: node scripts/build-n8n-workflow.mjs, then import\n' +
          '    n8n/CALLLENS_ANALYZE_CONVERSATION.local.json (delete the old workflow first).'
      );
    }
    return 1;
  }

  const r = json.result;
  const checks = [
    ['engine reported', json.engine === 'n8n'],
    ['model reported', typeof json.model === 'string' && json.model.length > 0],
    [
      'overall_sentiment',
      ['positive', 'neutral', 'negative'].includes(r.overall_sentiment?.label),
    ],
    ['summary present', typeof r.summary === 'string' && r.summary.length > 10],
    ['resolution.status set', typeof r.resolution?.status === 'string'],
    ['risk.escalation set', r.risk?.escalation !== undefined],
    [
      'sentence per turn',
      Array.isArray(r.sentences) && r.sentences.length === turns.length,
    ],
    [
      'evidence populated',
      Array.isArray(r.sentences) && r.sentences.some((s) => s.evidence),
    ],
    [
      'reasoning.drivers',
      Array.isArray(r.reasoning?.drivers) && r.reasoning.drivers.length > 0,
    ],
    ['under 10s', elapsed < 10_000],
  ];

  console.log(`\n  model=${json.model}`);
  console.log(
    `  sentiment=${r.overall_sentiment?.label}(${r.overall_sentiment?.score}) ` +
      `resolution=${r.resolution?.status}/${r.resolution?.likelihood} ` +
      `escalation=${r.risk?.escalation} frustration=${r.customer?.frustration}`
  );
  console.log(
    `  sentences=${r.sentences?.length}/${turns.length} emotions=${r.emotions?.length} ` +
      `moments=${r.important_moments?.length} drivers=${r.reasoning?.drivers?.length ?? 0}`
  );
  console.log('');

  let failed = 0;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) failed++;
  }

  console.log(
    failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
