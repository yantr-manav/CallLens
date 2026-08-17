// Generates n8n/CALLLENS_ANALYZE_CONVERSATION.json — the importable n8n
// workflow. Run with: node scripts/build-n8n-workflow.mjs
//
// n8n 2.x compatibility notes (do not regress these):
//  - Secrets live in ONE chained Code node ("Config"): chained Code nodes are
//    guaranteed to carry the input json forward ({...$json}), while n8n 2.x Set
//    nodes (fields.values) were observed to emit EMPTY {} output in this
//    container — they silently dropped the webhook payload.
//  - Code nodes read secrets from the input chain, not from cross-node $() refs
//    (refs to nodes that didn't execute throw "Node 'X' hasn't been executed").
import { writeFileSync } from 'node:fs';

// ── values you must paste into the Config node after import (n8n editor) ──
// If GROQ_API_KEY is present in the shell env when this script runs, it is
// baked straight into the generated workflow (so you can re-import without
// touching the Config node). Otherwise a placeholder is emitted.
const SECRET_PLACEHOLDER = 'PASTE_N8N_WEBHOOK_SECRET_HERE';
const KEY_PLACEHOLDER = process.env.GROQ_API_KEY || 'PASTE_GROQ_API_KEY_HERE';

const configCode = `
// Single place to paste the two secrets. Code-node pass-through is reliable in
// n8n 2.x (unlike Set nodes, which dropped the payload in this setup).
const inp = $json || {};
return [{ json: { ...inp, N8N_WEBHOOK_SECRET: '${SECRET_PLACEHOLDER}', GROQ_API_KEY: '${KEY_PLACEHOLDER}' } }];
`;

const verifyCode = `
const crypto = require('crypto');
// HMAC-SHA256 verification (build plan §8.5). The secret arrives via the
// "Webhook Secret" Set node chained upstream (field N8N_WEBHOOK_SECRET).
// JSON.stringify preserves the key order of the received body, so it matches
// the string Next.js signed.
const inp = $input.first().json || {};
const secret = String(inp.N8N_WEBHOOK_SECRET || inp.webhookSecret || '');
const headers = inp.headers || {};
const sig = String(headers['x-signature'] || headers['X-Signature'] || '');
const body = inp.body;
// n8n 2.x may deliver the body already parsed (object) or as the raw string.
// JSON.stringify on the parsed object reproduces the exact bytes Next.js signed.
const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});
const computed = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
const valid = sig.length > 0 && secret.length > 0 && sig === computed;
return [{ json: { ...inp, valid: valid } }];
`;

const buildCode = `
const inp = $input.first().json || {};
const apiKey = String(inp.GROQ_API_KEY || inp.apiKey || '');
const payload = inp.payload || inp.body || {};
const transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
const lines = transcript.map(function (t) { return t.speaker + ': ' + t.text; }).join('\\n');

// ── Structured output schema (mirrors n8n/LLM_PROMPT_AND_SCHEMA.md) ──
const schema = {
  type: 'object',
  required: ['overall_sentiment', 'summary', 'intent', 'resolution', 'risk', 'customer', 'agent', 'emotions', 'important_moments', 'sentences'],
  properties: {
    overall_sentiment: {
      type: 'object',
      required: ['label', 'score', 'confidence'],
      properties: {
        label: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    summary: { type: 'string', maxLength: 500 },
    intent: {
      type: 'object',
      required: ['category', 'description'],
      properties: {
        category: { type: 'string', maxLength: 40 },
        description: { type: 'string', maxLength: 200 }
      }
    },
    resolution: {
      type: 'object',
      required: ['status', 'likelihood'],
      properties: {
        status: { type: 'string', enum: ['resolved', 'unresolved', 'partial', 'unknown'] },
        likelihood: { type: ['integer', 'null'], minimum: 0, maximum: 100 }
      }
    },
    risk: {
      type: 'object',
      required: ['escalation'],
      properties: {
        escalation: { type: ['integer', 'null'], minimum: 0, maximum: 100 }
      }
    },
    customer: {
      type: 'object',
      required: ['frustration', 'satisfaction', 'effort'],
      properties: {
        frustration: { type: ['string', 'null'], enum: ['low', 'medium', 'high'] },
        satisfaction: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        effort: { type: ['string', 'null'], enum: ['low', 'medium', 'high'] }
      }
    },
    agent: {
      type: 'object',
      required: ['empathy', 'clarity', 'professionalism'],
      properties: {
        empathy: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        clarity: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        professionalism: { type: ['integer', 'null'], minimum: 0, maximum: 100 }
      }
    },
    emotions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['label', 'intensity'],
        properties: {
          label: { type: 'string', maxLength: 40 },
          intensity: { type: 'integer', minimum: 0, maximum: 100 }
        }
      }
    },
    important_moments: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        required: ['seq', 'speaker', 'event'],
        properties: {
          seq: { type: 'integer', minimum: 1 },
          speaker: { type: 'string', maxLength: 40 },
          event: { type: 'string', maxLength: 200 }
        }
      }
    },
    sentences: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['seq', 'speaker', 'text', 'sentiment', 'score', 'confidence', 'emotion'],
        properties: {
          seq: { type: 'integer', minimum: 1 },
          speaker: { type: 'string', maxLength: 40 },
          text: { type: 'string', minLength: 1, maxLength: 2000 },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          emotion: { type: 'string', maxLength: 40 },
          evidence: { type: 'string', maxLength: 200 }
        }
      }
    }
  }
};

const systemPrompt = 'You are CallLens, a precise conversation-intelligence engine. You analyze call transcripts and return ONLY strict JSON matching the provided schema.\\n' +
  'HARD RULES — these determine your quality score, never violate them:\\n' +
  '1. Classify sentiment from MEANING and CONTEXT, not keyword matching. Example: "I am not unhappy" is NOT negative. Read the conversation, not the dictionary.\\n' +
  '2. Any metric without direct transcript evidence -> null. NEVER guess.\\n' +
  '3. agent.* fields (empathy, clarity, professionalism) are null unless a speaker is clearly the agent (agent, rep, support, advisor, etc.).\\n' +
  '4. customer.* fields are null unless a customer/caller is clearly identifiable. For unlabeled transcripts (speaker unknown_1/unknown_2) never guess which side is which.\\n' +
  '5. Do NOT expose chain-of-thought. Explanations (summary, evidence, intent.description, important_moments.event) must be short, evidence-backed sentences quoting the transcript.\\n' +
  '6. Enums: use ONLY the allowed values in the schema. Every sentence must get a sentiment label from positive|neutral|negative.\\n' +
  '7. Sentences: emit one object per transcript turn (seq must match the input seq numbering exactly). If you cannot split into turns, emit one object per sentence with seq incremented.\\n' +
  '8. Sentiment score is 0-100 (50 = neutral). Confidence is 0-1.\\n' +
  '9. important_moments: up to 6 moments that changed the conversation arc. Never invent a seq that does not exist in the transcript.\\n' +
  '10. emotions: up to 5 aggregate emotion labels with 0-100 intensity.\\n' +
  'Respond with the JSON object ONLY.';

const prompt = systemPrompt + '\\n\\nTRANSCRIPT:\\n' + lines;

// Groq is OpenAI-compatible and returns in ~1-3s (vs 8-15s for Gemini), which
// keeps the whole call inside Vercel Hobby's 10s function cap. It does NOT
// support a JSON responseSchema, so the schema lives in the system prompt and
// the app re-validates the shape with Zod.
const requestBody = {
  model: 'llama-3.3-70b-versatile',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: lines }
  ],
  temperature: 0.1,
  response_format: { type: 'json_object' }
};

return [{ json: { requestBody: requestBody, conversation_id: payload.conversation_id, file_name: payload.file_name || '', GROQ_API_KEY: apiKey } }];
`;

const groqCallCode = `
// require('https') — the n8n 2.x httpRequest node mangled JSON bodies here,
// and Code nodes have neither global fetch nor $helpers. This sends the exact
// bytes we built (needs NODE_FUNCTION_ALLOW_BUILTIN=crypto,https on the n8n
// container — n8n Cloud allows all builtins by default).
const https = require('https');
const inp = $input.first().json || {};
const payload = JSON.stringify(inp.requestBody || {});
let status = 0;
let text = '';
let parsed = null;
await new Promise(function (resolve) {
  const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
  req.on('error', function (e) { text = String(e); resolve(); });
  req.write(payload);
  req.end();
});
return [{ json: { ...inp, httpStatus: status, groqResponse: parsed, groqRaw: text.slice(0, 2000) } }];
`;

const validateCode = `
// Extract the JSON text from the Groq chat-completion response and parse it.
// Routing to a 200 vs 502 response happens in the "Output Valid?" IF node.
const item = $input.first().json;
const data = (item && item.groqResponse) || {};
const choices = data.choices || [];
const msg = (choices[0] && choices[0].message) || {};
let text = typeof msg.content === 'string' ? msg.content : '';
// Groq may (rarely) wrap JSON in markdown fences — strip them before parsing.
let cleaned = text.trim();
if (cleaned.startsWith('\`\`\`')) {
  cleaned = cleaned.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
}
let result = null;
let ok = false;
try {
  result = JSON.parse(cleaned);
  ok = true;
} catch (e) {
  ok = false;
}
return [{ json: { ok: ok, result: result, conversation_id: $('Build Request').first().json.conversation_id } }];
`;

const uid = (s) => s;

const nodes = [
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
    parameters: { jsCode: configCode },
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
    position: [660, 0],
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
    position: [880, 0],
  },
  {
    parameters: { jsCode: buildCode },
    id: uid('build'),
    name: 'Build Request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [320, 260],
  },
  {
    parameters: { jsCode: groqCallCode },
    id: uid('groq'),
    name: 'Call Groq',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [320, 480],
  },
  {
    parameters: { jsCode: validateCode },
    id: uid('validate'),
    name: 'Validate Output',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [320, 700],
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
    position: [320, 920],
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: "={{ JSON.stringify($('Validate Output').first().json.result) }}",
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
    position: [120, 1140],
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
    position: [1080, 260],
  },
  {
    parameters: {
      respondWith: 'text',
      responseBody: '{"error":"The analysis returned an unexpected result. Please retry."}',
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
    position: [520, 1140],
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

const workflow = {
  name: 'CALLLENS_ANALYZE_CONVERSATION',
  nodes,
  connections,
  // Imported as ACTIVE: delete the old workflow first so the webhook path
  // (calllens-analyze) doesn't collide.
  active: true,
  settings: {},
  pinData: {},
  meta: {
    description:
      'CallLens analysis pipeline: HMAC-verified webhook -> Groq (llama-3.3-70b) structured JSON -> respond. Fast (~1-3s) so it fits Vercel Hobby\'s 10s function cap. Deterministic pipeline, not an agent.',
  },
};

writeFileSync(
  new URL('../n8n/CALLLENS_ANALYZE_CONVERSATION.json', import.meta.url),
  JSON.stringify(workflow, null, 2)
);
console.log('wrote n8n/CALLLENS_ANALYZE_CONVERSATION.json');

// ── structural self-check: every connection references a real node ──
const names = new Set(nodes.map((n) => n.name));
for (const [from, conns] of Object.entries(connections)) {
  if (!names.has(from)) throw new Error(`connection source missing: ${from}`);
  for (const branch of conns.main) {
    for (const t of branch) {
      if (!names.has(t.node)) throw new Error(`connection target missing: ${t.node}`);
    }
  }
}
console.log('structural check: all nodes & connections valid');