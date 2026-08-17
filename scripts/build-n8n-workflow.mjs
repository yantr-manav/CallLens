// Generates the importable n8n workflow. Run with:
//   node scripts/build-n8n-workflow.mjs
//
// Emits TWO files:
//   n8n/CALLLENS_ANALYZE_CONVERSATION.json        placeholders — safe to commit
//   n8n/CALLLENS_ANALYZE_CONVERSATION.local.json  real secrets — gitignored
// Import the .local.json into n8n Cloud so there is nothing to paste by hand.
// (The previous single-file approach meant the committed workflow still said
// PASTE_N8N_WEBHOOK_SECRET_HERE, which is exactly what was live in n8n Cloud —
// every signed request from the app was rejected.)
//
// The prompt, schema and model all come from lib/analysis-contract.json, which
// lib/groq.ts also reads. That is deliberate: the n8n path and the in-app
// fallback path are provably the same prompt and cannot drift.
//
// n8n 2.x compatibility notes (do not regress these):
//  - Secrets live in ONE chained Code node ("Config"): chained Code nodes are
//    guaranteed to carry the input json forward ({...$json}), while n8n 2.x Set
//    nodes (fields.values) were observed to emit EMPTY {} output in this
//    container — they silently dropped the webhook payload.
//  - Code nodes read secrets from the input chain, not from cross-node $() refs
//    (refs to nodes that didn't execute throw "Node 'X' hasn't been executed").
//  - The Groq call uses require('https'), not the httpRequest node, which
//    mangled the JSON body here.
import { writeFileSync, readFileSync } from 'node:fs';

const contract = JSON.parse(
  readFileSync(new URL('../lib/analysis-contract.json', import.meta.url), 'utf8')
);

const SECRET_PLACEHOLDER = 'PASTE_N8N_WEBHOOK_SECRET_HERE';
const KEY_PLACEHOLDER = 'PASTE_GROQ_API_KEY_HERE';

const realSecret = process.env.N8N_WEBHOOK_SECRET || '';
const realKey = process.env.GROQ_API_KEY || '';

// ── Node source ──────────────────────────────────────────────────────────────

const configCode = (secret, key) => `
// Single place for the two secrets. Code-node pass-through is reliable in
// n8n 2.x (unlike Set nodes, which dropped the payload in this setup).
const inp = $json || {};
return [{ json: { ...inp, N8N_WEBHOOK_SECRET: '${secret}', GROQ_API_KEY: '${key}' } }];
`;

const verifyCode = `
const crypto = require('crypto');
// HMAC-SHA256 verification. The secret arrives from the "Config" node chained
// upstream. JSON.stringify preserves the key order of the received body, so it
// reproduces the exact string Next.js signed in lib/n8n.ts.
const inp = $input.first().json || {};
const secret = String(inp.N8N_WEBHOOK_SECRET || inp.webhookSecret || '');
const headers = inp.headers || {};
const sig = String(headers['x-signature'] || headers['X-Signature'] || '');
const body = inp.body;
// n8n 2.x may deliver the body already parsed (object) or as the raw string.
const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});
const computed = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
const valid = sig.length > 0 && secret.length > 0 && sig === computed;
return [{ json: { ...inp, valid: valid } }];
`;

const buildCode = `
const inp = $input.first().json || {};
const apiKey = String(inp.GROQ_API_KEY || inp.apiKey || '');
// The signed payload is nested under .body on the webhook item — reading it off
// the root was why callbackUrl used to come out empty. Mirror the string/object
// tolerance of the Verify Signature node.
const rawBody = inp.body;
let payload = {};
try {
  payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody || {});
} catch (e) {
  payload = {};
}
const transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
let lines = transcript.map(function (t) { return t.speaker + ': ' + t.text; }).join('\\n');

// Rules text + the literal JSON schema, baked at build time from
// lib/analysis-contract.json. Must stay byte-identical to buildSystemPrompt()
// in lib/groq.ts. Groq's json_object mode enforces no shape, so omitting the
// schema here makes the model invent its own keys — an earlier build did
// exactly that and silently dropped resolution/risk/customer.
const systemPrompt = ${JSON.stringify(
  contract.systemPrompt +
    '\n\nSCHEMA — your reply must be a single JSON object with EXACTLY these keys and types:\n' +
    JSON.stringify(contract.jsonSchema)
)};

// ── Token budget (mirrors planRequest() in lib/groq.ts) ──
// Groq admits a request only if prompt_tokens + max_completion_tokens is within
// the tier's TPM limit — the REQUESTED total, not actual usage. A fixed 8192
// returned HTTP 413 "Request too large" on an 11-turn transcript.
const TPM_LIMIT = ${JSON.stringify(contract.tpmLimit)};
const TPM_MARGIN = ${JSON.stringify(contract.tpmSafetyMargin)};
const SYS_TOKENS = ${JSON.stringify(contract.systemPromptTokens)};
const CHARS_PER_TOKEN = ${JSON.stringify(contract.charsPerToken)};
const MIN_COMPLETION = ${JSON.stringify(contract.minCompletionTokens)};
const MAX_COMPLETION = ${JSON.stringify(contract.maxCompletionTokens)};
const MAX_USER_CHARS = ${JSON.stringify(contract.maxUserChars)};

let truncatedChars = 0;
if (lines.length > MAX_USER_CHARS) {
  truncatedChars = lines.length - MAX_USER_CHARS;
  const cut = lines.slice(0, MAX_USER_CHARS);
  const lastNewline = cut.lastIndexOf('\\n');
  lines = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
}
const promptTokens = SYS_TOKENS + Math.ceil(lines.length / CHARS_PER_TOKEN);
const available = TPM_LIMIT - TPM_MARGIN - promptTokens;
const maxCompletion = Math.max(MIN_COMPLETION, Math.min(MAX_COMPLETION, available));

const requestBody = {
  model: ${JSON.stringify(contract.model)},
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: lines }
  ],
  temperature: ${JSON.stringify(contract.temperature)},
  reasoning_effort: ${JSON.stringify(contract.reasoningEffort)},
  max_completion_tokens: maxCompletion,
  response_format: { type: 'json_object' }
};

return [{ json: {
  ...inp,
  requestBody: requestBody,
  conversation_id: payload.conversation_id,
  file_name: payload.file_name || '',
  turnCount: transcript.length,
  truncatedChars: truncatedChars,
  GROQ_API_KEY: apiKey
} }];
`;

const groqCallCode = `
// require('https') — the n8n 2.x httpRequest node mangled JSON bodies here,
// and Code nodes have neither global fetch nor $helpers. This sends the exact
// bytes we built (needs NODE_FUNCTION_ALLOW_BUILTIN=crypto,https on a
// self-hosted container — n8n Cloud allows all builtins by default).
const https = require('https');
const inp = $input.first().json || {};
const payload = JSON.stringify(inp.requestBody || {});
let status = 0;
let text = '';
let parsed = null;
await new Promise(function (resolve) {
  const req = https.request(${JSON.stringify(contract.endpoint)}, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': 'Bearer ' + String(inp.GROQ_API_KEY || '')
    }
  }, function (res) {
    status = res.statusCode || 0;
    res.setEncoding('utf8');
    res.on('data', function (c) { text += c; });
    res.on('end', function () {
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
      resolve();
    });
  });
  // Never outlive the app's own budget — a hung socket here would hold the
  // caller's connection open until it timed out on its side.
  req.setTimeout(25000, function () { req.destroy(new Error('groq socket timeout')); });
  req.on('error', function (e) { text = String(e && e.message ? e.message : e); resolve(); });
  req.write(payload);
  req.end();
});
return [{ json: { ...inp, httpStatus: status, groqResponse: parsed, groqRaw: text.slice(0, 2000) } }];
`;

const validateCode = `
// Extract the JSON text from the Groq chat-completion response and parse it.
// Routing to the 200 vs 502 Respond node happens in "Output Valid?".
// NOTE: this variable MUST be named 'inp' — the return spreads {...inp} to carry
// the whole chain forward. It was previously declared as 'item', which threw
// ReferenceError and killed every execution before it could respond.
const inp = $input.first().json || {};
const data = inp.groqResponse || {};
const choices = data.choices || [];
const msg = (choices[0] && choices[0].message) || {};
let text = typeof msg.content === 'string' ? msg.content : '';

let cleaned = text.trim();
// Groq may (rarely) wrap JSON in markdown fences — strip them before parsing.
if (cleaned.indexOf('\\u0060\\u0060\\u0060') === 0) {
  cleaned = cleaned.replace(/^\\u0060\\u0060\\u0060(?:json)?\\s*/i, '').replace(/\\s*\\u0060\\u0060\\u0060$/, '');
}

let result = null;
let ok = false;
try {
  result = JSON.parse(cleaned);
  ok = true;
} catch (e) {
  // gpt-oss spends part of max_completion_tokens on reasoning, so a long
  // transcript can truncate the JSON. Salvage up to the last closing brace
  // rather than discarding the whole analysis.
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > 0) {
    try { result = JSON.parse(cleaned.slice(0, lastBrace + 1)); ok = true; } catch (e2) { ok = false; }
  }
}
if (ok && (!result || typeof result !== 'object')) ok = false;

return [{ json: {
  ...inp,
  ok: ok,
  result: result,
  failureReason: ok ? '' : ('groq status ' + String(inp.httpStatus) + ': ' + String(inp.groqRaw || '').slice(0, 400))
} }];
`;

// ── Graph ────────────────────────────────────────────────────────────────────

const uid = (s) => s;

const buildNodes = (secret, key) => [
  {
    parameters: {
      httpMethod: 'POST',
      path: 'calllens-analyze',
      responseMode: 'responseNode',
      options: {},
    },
    id: uid('webhook'),
    name: 'Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 0],
    webhookId: 'calllens-analyze-webhook',
  },
  {
    parameters: { jsCode: configCode(secret, key) },
    id: uid('config'),
    name: 'Config',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [220, 0],
  },
  {
    parameters: { jsCode: verifyCode },
    id: uid('verify'),
    name: 'Verify Signature',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [440, 0],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        combinator: 'and',
        conditions: [
          {
            id: uid('c1'),
            leftValue: '={{ $json.valid }}',
            rightValue: '=true',
            operator: { type: 'boolean', operation: 'equals' },
          },
        ],
      },
    },
    id: uid('if1'),
    name: 'Valid Signature?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [660, 0],
  },
  {
    parameters: { jsCode: buildCode },
    id: uid('build'),
    name: 'Build Request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [880, -120],
  },
  {
    parameters: { jsCode: groqCallCode },
    id: uid('groq'),
    name: 'Call Groq',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1100, -120],
  },
  {
    parameters: { jsCode: validateCode },
    id: uid('validate'),
    name: 'Validate Output',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1320, -120],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        combinator: 'and',
        conditions: [
          {
            id: uid('c2'),
            leftValue: '={{ $json.ok }}',
            rightValue: '=true',
            operator: { type: 'boolean', operation: 'equals' },
          },
        ],
      },
    },
    id: uid('if2'),
    name: 'Output Valid?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [1540, -120],
  },
  {
    // The finished analysis, returned on the SAME connection the app is still
    // holding open. No callback, no polling, no job state.
    parameters: {
      respondWith: 'json',
      responseBody:
        "={{ JSON.stringify({ ok: true, engine: 'n8n', model: $json.requestBody.model, result: $json.result }) }}",
      responseCode: 200,
      options: {
        responseHeaders: {
          entries: [{ name: 'Content-Type', value: 'application/json' }],
        },
      },
    },
    id: uid('r200'),
    name: 'Respond 200',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [1760, -240],
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody:
        '={{ JSON.stringify({ ok: false, error: "invalid_output", detail: $json.failureReason }) }}',
      responseCode: 502,
      options: {
        responseHeaders: {
          entries: [{ name: 'Content-Type', value: 'application/json' }],
        },
      },
    },
    id: uid('r502'),
    name: 'Respond 502',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [1760, 0],
  },
  {
    parameters: {
      respondWith: 'text',
      responseBody: '{"error":"Invalid signature. Webhook call rejected."}',
      responseCode: 401,
      options: {
        responseHeaders: {
          entries: [{ name: 'Content-Type', value: 'application/json' }],
        },
      },
    },
    id: uid('r401'),
    name: 'Respond 401',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [880, 160],
  },
];

const connections = {
  Webhook: { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
  Config: { main: [[{ node: 'Verify Signature', type: 'main', index: 0 }]] },
  'Verify Signature': {
    main: [[{ node: 'Valid Signature?', type: 'main', index: 0 }]],
  },
  'Valid Signature?': {
    main: [
      [{ node: 'Build Request', type: 'main', index: 0 }],
      [{ node: 'Respond 401', type: 'main', index: 0 }],
    ],
  },
  'Build Request': { main: [[{ node: 'Call Groq', type: 'main', index: 0 }]] },
  'Call Groq': { main: [[{ node: 'Validate Output', type: 'main', index: 0 }]] },
  'Validate Output': {
    main: [[{ node: 'Output Valid?', type: 'main', index: 0 }]],
  },
  'Output Valid?': {
    main: [
      [{ node: 'Respond 200', type: 'main', index: 0 }],
      [{ node: 'Respond 502', type: 'main', index: 0 }],
    ],
  },
};

const buildWorkflow = (secret, key) => ({
  name: 'CALLLENS_ANALYZE_CONVERSATION',
  nodes: buildNodes(secret, key),
  connections,
  // Imported as ACTIVE: DELETE the old workflow first, otherwise it keeps
  // ownership of the /webhook/calllens-analyze path and your import does
  // nothing.
  active: true,
  settings: {},
  pinData: {},
  meta: {
    description: `CallLens synchronous analysis pipeline: HMAC-verified webhook -> Groq ${contract.model} -> validated JSON returned on the same request (~4-6s). Deterministic pipeline, not an agent.`,
  },
});

// ── Emit ─────────────────────────────────────────────────────────────────────

const publicPath = new URL(
  '../n8n/CALLLENS_ANALYZE_CONVERSATION.json',
  import.meta.url
);
const publicJson = JSON.stringify(
  buildWorkflow(SECRET_PLACEHOLDER, KEY_PLACEHOLDER),
  null,
  2
);

// Belt and braces: never let a real key reach the committed artifact.
if (/gsk_[A-Za-z0-9]/.test(publicJson)) {
  throw new Error('refusing to write: a real Groq key leaked into the public workflow');
}
writeFileSync(publicPath, publicJson);
console.log('wrote n8n/CALLLENS_ANALYZE_CONVERSATION.json (placeholders)');

if (realSecret && realKey) {
  writeFileSync(
    new URL('../n8n/CALLLENS_ANALYZE_CONVERSATION.local.json', import.meta.url),
    JSON.stringify(buildWorkflow(realSecret, realKey), null, 2)
  );
  console.log(
    'wrote n8n/CALLLENS_ANALYZE_CONVERSATION.local.json (real secrets, gitignored) — import THIS one'
  );
} else {
  console.warn(
    'N8N_WEBHOOK_SECRET / GROQ_API_KEY not in env — skipped .local.json.\n' +
      '  Run with them exported to get an import-ready file, e.g.:\n' +
      '  node -r dotenv/config scripts/build-n8n-workflow.mjs dotenv_config_path=.env'
  );
}

// ── structural self-check: every connection references a real node ──
const names = new Set(buildNodes(SECRET_PLACEHOLDER, KEY_PLACEHOLDER).map((n) => n.name));
for (const [from, conns] of Object.entries(connections)) {
  if (!names.has(from)) throw new Error(`connection source missing: ${from}`);
  for (const branch of conns.main) {
    for (const t of branch) {
      if (!names.has(t.node)) throw new Error(`connection target missing: ${t.node}`);
    }
  }
}
// Every node except the terminal Respond nodes must be reachable.
const reachable = new Set(['Webhook']);
let changed = true;
while (changed) {
  changed = false;
  for (const [from, conns] of Object.entries(connections)) {
    if (!reachable.has(from)) continue;
    for (const branch of conns.main) {
      for (const t of branch) {
        if (!reachable.has(t.node)) {
          reachable.add(t.node);
          changed = true;
        }
      }
    }
  }
}
for (const n of names) {
  if (!reachable.has(n)) throw new Error(`unreachable node: ${n}`);
}
console.log('structural check: all nodes reachable & connections valid');
