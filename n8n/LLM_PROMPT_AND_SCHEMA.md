# LLM prompt & schema contract

> **This file is documentation, not the source of truth.**
> The live prompt, schema, model and token budget all come from
> [`lib/analysis-contract.json`](../lib/analysis-contract.json), which
> `scripts/build-n8n-workflow.mjs` bakes into the n8n **Build Request** node and
> `lib/groq.ts` reads at runtime. Edit the contract, then re-run the generator
> and re-import the workflow. Keep this file in step when you do.

## Model

| | |
|---|---|
| Endpoint | `https://api.groq.com/openai/v1/chat/completions` (OpenAI-compatible) |
| Model | `openai/gpt-oss-120b` |
| Fallback model | `openai/gpt-oss-20b` (`reasoning_effort: low`, ~1.5s) |
| `temperature` | `0.1` |
| `reasoning_effort` | `medium` |
| `response_format` | `{ "type": "json_object" }` |
| `max_completion_tokens` | computed per request — see *Token budget* |

### Model notes (learned the hard way)

- **`llama-3.3-70b-versatile` is decommissioned.** It returns
  `model_not_found`, and it was still hardcoded in the workflow — every live
  analysis failed because of it. Do not resurrect it.
- **`qwen/qwen3.6-27b` cannot do `json_object` mode** — it fails with
  `json_validate_failed`. Do not use it as a fallback.
- **`json_object` enforces no schema.** Groq guarantees only that the reply
  parses as JSON. The schema below is therefore repeated verbatim *inside the
  system prompt*, and `analysisResultSchema` in `lib/validation.ts` is the real
  gate. An earlier build sent only the rules text and the model quietly dropped
  `resolution`, `risk` and `customer` — which is what rendered as
  "Resolution: Unknown / Escalation Risk: —" across every report.
- **gpt-oss models spend part of the completion budget on reasoning tokens**, so
  a long transcript can truncate the JSON mid-object. Both engines salvage up to
  the last `}` rather than discarding the analysis.

### Token budget

Groq's free tier admits a request only if
`prompt_tokens + max_completion_tokens <= 8000` — the *requested* total, not
actual usage. A fixed `max_completion_tokens: 8192` therefore returned
**HTTP 413 "Request too large"** on an 11-turn transcript.

`planRequest()` in `lib/groq.ts` (mirrored verbatim in the n8n Build Request
node) trims the transcript to `maxUserChars` on a line boundary, estimates the
prompt size, and gives the completion whatever is left between
`minCompletionTokens` and `maxCompletionTokens`.

## Prompt structure

```
system: <hard rules>  +  "SCHEMA — your reply must be a single JSON object
                          with EXACTLY these keys and types:"  +  <jsonSchema>
user:   "<speaker>: <text>" joined by newlines, one line per normalized turn
```

The hard rules cover: judging sentiment from meaning rather than keywords;
preferring an evidence-based estimate over a null; nulling `agent.*` /
`customer.*` only when no such speaker can be identified; never exposing
chain-of-thought; emitting exactly one `sentences[]` entry per input turn with a
matching `seq`; and requiring a verbatim `evidence` quote on every sentence.

## Response schema

Top-level keys: `overall_sentiment`, `summary`, `intent`, `resolution`, `risk`,
`customer`, `agent`, `emotions`, `important_moments`, `reasoning`, `sentences`.

| Field | Shape |
|---|---|
| `overall_sentiment` | `{ label: positive\|neutral\|negative, score: 0-100, confidence: 0-1 }` |
| `summary` | string, ≤500 chars |
| `intent` | `{ category ≤40, description ≤200 }` |
| `resolution` | `{ status: resolved\|unresolved\|partial\|unknown, likelihood: 0-100\|null }` |
| `risk` | `{ escalation: 0-100\|null }` |
| `customer` | `{ frustration: low\|medium\|high\|null, satisfaction: 0-100\|null, effort: low\|medium\|high\|null }` |
| `agent` | `{ empathy, clarity, professionalism }` — each `0-100\|null` |
| `emotions` | ≤5 × `{ label ≤40, intensity: 0-100 }` |
| `important_moments` | ≤6 × `{ seq, speaker ≤40, event ≤200 }` |
| `reasoning` | `{ drivers: 2-5 × { factor, direction, weight: 0-100, evidence }, counter_signals: ≤4 × { observation, evidence } }` |
| `sentences` | ≥1 × `{ seq, speaker, text, sentiment, score: 0-100, confidence: 0-1, emotion, evidence }` |

`reasoning` is what the **Why this verdict** card renders: weighted drivers with
verbatim quotes, plus the evidence that pointed the other way. It is stored
inside `analyses.raw_json` (jsonb), so it needed no migration.

### Normalization is deliberately forgiving

`lib/normalize-result.ts` always runs a coercing mapper and validates **once**
at the end. It rounds floats into the integer score fields, maps enum synonyms
(`solved`/`closed` → `resolved`), buckets numeric 0–100 values into
`low|medium|high`, de-duplicates emotions, drops blank sentences, and truncates
long strings at word boundaries.

It refuses to invent a report, though: if there are no usable sentences, or the
summary fell back to a placeholder *and* every derived metric is null, it
returns `null` so the caller drops to the next engine rather than persisting
something plausible-looking and false.

## Webhook contract

**Request** — `POST /webhook/calllens-analyze`, header
`X-Signature: <hex HMAC-SHA256 of the raw body, keyed with N8N_WEBHOOK_SECRET>`:

```json
{
  "conversation_id": "<uuid>",
  "file_name": "call.txt",
  "transcript": [{ "seq": 1, "speaker": "agent", "text": "…" }]
}
```

Field order matters: the HMAC is computed over `JSON.stringify()` of the payload
and Zod emits keys in schema-declaration order, so reordering
`analyzePayloadSchema` changes the signature.

**Responses**

| Node | Code | Body |
|---|---|---|
| Respond 200 | 200 | `{ ok: true, engine: "n8n", model, result }` |
| Respond 502 | 502 | `{ ok: false, error: "invalid_output", detail }` |
| Respond 401 | 401 | `{ error: "Invalid signature. Webhook call rejected." }` |

n8n Cloud serves Respond-node bodies over HTTP 200 in some configurations, so
`lib/n8n.ts` detects failures from the envelope (`ok`/`error`) rather than
trusting the status code.
