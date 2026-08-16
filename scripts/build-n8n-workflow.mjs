// Generates n8n/CALLLENS_ANALYZE_CONVERSATION.json — the importable n8n
// workflow. Run with: node scripts/build-n8n-workflow.mjs
import { writeFileSync } from 'node:fs';

const verifyCode = `
const crypto = require('crypto');
// HMAC-SHA256 verification (build plan §8.5). The secret lives in the
// "Webhook Secret" Set node (paste the same value as N8N_WEBHOOK_SECRET).
// JSON.stringify preserves the key order of the received body, so it matches
// the string Next.js signed.
const secret = $('Webhook Secret').first().json.webhookSecret;
const headers = $input.first().json.headers || {};
const sig = String(headers['x-signature'] || headers['X-Signature'] || '');
const body = $input.first().json.body || {};
const computed = crypto.createHmac('sha256', String(secret)).update(JSON.stringify(body)).digest('hex');
const valid = sig.length > 0 && sig === computed;
return [{ json: { valid: valid, payload: body } }];
`;

const buildCode = `
const payload = $input.first().json.payload || {};
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

const requestBody = {
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema }
};

return [{ json: { requestBody: requestBody, conversation_id: payload.conversation_id, file_name: payload.file_name || '' } }];
`;

const validateCode = `
// Extract the JSON text from the Gemini response and parse it. Routing to a
// 200 vs 502 response happens in the "Output Valid?" IF node.
const item = $input.first().json;
const data = item.json || item || {};
let text = '';
const candidates = data.candidates || [];
for (const c of candidates) {
  const parts = (c && c.content && c.content.parts) || [];
  for (const p of parts) {
    if (p && p.text) text += p.text;
  }
}
let result = null;
let ok = false;
try {
  result = JSON.parse(text);
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
    parameters: {
      assignments: {
        assignments: [
          {
            id: uid('a1'),
            name: 'webhookSecret',
            value: 'PASTE_N8N_WEBHOOK_SECRET_HERE',
            type: 'string',
          },
        ],
      },
      options: {},
    },
    id: uid('whsec'),
    name: 'Webhook Secret',
    type: 'n8n-nodes-base.set',
    typeVersion: 3,
    position: [460, 0],
  },
  {
    parameters: {
      assignments: {
        assignments: [
          {
            id: uid('a2'),
            name: 'apiKey',
            value: 'PASTE_GEMINI_API_KEY_HERE',
            type: 'string',
          },
        ],
      },
      options: {},
    },
    id: uid('gmkey'),
    name: 'Gemini Key',
    type: 'n8n-nodes-base.set',
    typeVersion: 3,
    position: [460, 160],
  },
  {
    parameters: { jsCode: verifyCode },
    id: uid('verify'),
    name: 'Verify Signature',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [0, 220],
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
    position: [0, 440],
  },
  {
    parameters: { jsCode: buildCode },
    id: uid('build'),
    name: 'Build Request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-320, 660],
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'x-goog-api-key',
            value: "={{ $('Gemini Key').first().json.apiKey }}",
          },
        ],
      },
      sendBody: true,
      specifyBody: true,
      bodyType: 'json',
      jsonBody: "={{ JSON.stringify($('Build Request').first().json.requestBody) }}",
      options: { timeout: 120000 },
    },
    id: uid('gemini'),
    name: 'Gemini',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-320, 880],
  },
  {
    parameters: { jsCode: validateCode },
    id: uid('validate'),
    name: 'Validate Output',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-320, 1100],
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
    position: [-320, 1320],
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
    position: [-520, 1540],
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
    position: [320, 660],
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
    position: [80, 1540],
  },
];

const connections = {
  Webhook: { main: [[{ node: 'Verify Signature', type: 'main', index: 0 }]] },
  'Verify Signature': {
    main: [[{ node: 'Valid Signature?', type: 'main', index: 0 }]],
  },
  'Valid Signature?': {
    main: [
      [{ node: 'Build Request', type: 'main', index: 0 }],
      [{ node: 'Respond 401', type: 'main', index: 0 }],
    ],
  },
  'Build Request': { main: [[{ node: 'Gemini', type: 'main', index: 0 }]] },
  Gemini: { main: [[{ node: 'Validate Output', type: 'main', index: 0 }]] },
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
  active: false,
  settings: {},
  pinData: {},
  meta: {
    description:
      'CallLens analysis pipeline: HMAC-verified webhook -> Gemini structured output -> respond. Deterministic pipeline, not an agent.',
  },
};

writeFileSync(
  new URL('../n8n/CALLLENS_ANALYZE_CONVERSATION.json', import.meta.url),
  JSON.stringify(workflow, null, 2)
);
console.log('wrote n8n/CALLLENS_ANALYZE_CONVERSATION.json');