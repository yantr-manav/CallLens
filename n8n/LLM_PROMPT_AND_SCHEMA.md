# CallLens — LLM Prompt & Structured Output Schema

This is the exact system prompt and JSON schema embedded in the n8n workflow
(`CALLLENS_ANALYZE_CONVERSATION.json`) and enforced on the Next.js side by
`lib/validation.ts` (defense in depth: the contract is validated at every
boundary — see build plan §3, §8.4).

## Model

`gemini-2.0-flash` (Google AI Studio, free tier) with:

- `responseMimeType: "application/json"` (Gemini structured output)
- `responseSchema`: the JSON schema below (enum-restricted, nullable where
  evidence may be absent)
- `temperature: 0.1`

## System prompt (verbatim)

```
You are CallLens, a precise conversation-intelligence engine. You analyze
call transcripts and return ONLY strict JSON matching the provided schema.

HARD RULES — these determine your quality score, never violate them:
1. Classify sentiment from MEANING and CONTEXT, not keyword matching.
   Example: "I am not unhappy" is NOT negative. "That's just great" said
   sarcastically is NOT positive. Read the conversation, not the dictionary.
2. Any metric without direct transcript evidence → null. NEVER guess.
3. agent.* fields (empathy, clarity, professionalism) are null unless a
   speaker is clearly the agent (agent, rep, support, advisor, etc.).
4. customer.* fields are null unless a customer/caller is clearly
   identifiable. For unlabeled transcripts (speaker unknown_1/unknown_2)
   you must NOT guess which side is which.
5. Do NOT expose chain-of-thought. Explanations (summary, evidence,
   intent.description, important_moments.event) must be short,
   evidence-backed sentences quoting the transcript.
6. Enums: use ONLY the allowed values in the schema. Every sentence must
   get a sentiment label from positive|neutral|negative.
7. Sentences: emit one object per transcript turn (seq must match the
   input seq numbering exactly). If you cannot split into turns, emit one
   object per sentence with seq incremented.
8. Sentiment score is 0-100 (50 = neutral). Confidence is 0-1.
9. important_moments: up to 6 moments that changed the conversation arc
   (issue raised, resolution offered, frustration spike, resolution).
   Never invent a seq that doesn't exist in the transcript.
10. emotions: up to 5 aggregate emotion labels with 0-100 intensity.

Respond with the JSON object ONLY.
```

## JSON schema (Gemini `responseSchema` — abbreviated type form)

```json
{
  "type": "object",
  "required": ["overall_sentiment", "summary", "intent", "resolution",
               "risk", "customer", "agent", "emotions",
               "important_moments", "sentences"],
  "properties": {
    "overall_sentiment": {
      "type": "object",
      "required": ["label", "score", "confidence"],
      "properties": {
        "label": { "type": "string", "enum": ["positive", "neutral", "negative"] },
        "score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "summary": { "type": "string", "maxLength": 500 },
    "intent": {
      "type": "object",
      "required": ["category", "description"],
      "properties": {
        "category": { "type": "string", "maxLength": 40 },
        "description": { "type": "string", "maxLength": 200 }
      }
    },
    "resolution": {
      "type": "object",
      "required": ["status", "likelihood"],
      "properties": {
        "status": { "type": "string",
                    "enum": ["resolved", "unresolved", "partial", "unknown"] },
        "likelihood": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 }
      }
    },
    "risk": {
      "type": "object",
      "required": ["escalation"],
      "properties": {
        "escalation": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 }
      }
    },
    "customer": {
      "type": "object",
      "required": ["frustration", "satisfaction", "effort"],
      "properties": {
        "frustration": { "type": ["string", "null"], "enum": ["low", "medium", "high"] },
        "satisfaction": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 },
        "effort": { "type": ["string", "null"], "enum": ["low", "medium", "high"] }
      }
    },
    "agent": {
      "type": "object",
      "required": ["empathy", "clarity", "professionalism"],
      "properties": {
        "empathy": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 },
        "clarity": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 },
        "professionalism": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 }
      }
    },
    "emotions": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["label", "intensity"],
        "properties": {
          "label": { "type": "string", "maxLength": 40 },
          "intensity": { "type": "integer", "minimum": 0, "maximum": 100 }
        }
      }
    },
    "important_moments": {
      "type": "array",
      "maxItems": 6,
      "items": {
        "type": "object",
        "required": ["seq", "speaker", "event"],
        "properties": {
          "seq": { "type": "integer", "minimum": 1 },
          "speaker": { "type": "string", "maxLength": 40 },
          "event": { "type": "string", "maxLength": 200 }
        }
      }
    },
    "sentences": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["seq", "speaker", "text", "sentiment", "score",
                     "confidence", "emotion"],
        "properties": {
          "seq": { "type": "integer", "minimum": 1 },
          "speaker": { "type": "string", "maxLength": 40 },
          "text": { "type": "string", "minLength": 1, "maxLength": 2000 },
          "sentiment": { "type": "string",
                         "enum": ["positive", "neutral", "negative"] },
          "score": { "type": "integer", "minimum": 0, "maximum": 100 },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "emotion": { "type": "string", "maxLength": 40 },
          "evidence": { "type": "string", "maxLength": 200 }
        }
      }
    }
  }
}
```

## Webhook contract (Next.js → n8n)

Payload (HMAC-SHA256 signed with `N8N_WEBHOOK_SECRET` in `X-Signature`):

```json
{
  "conversation_id": "uuid",
  "file_name": "sample.txt",
  "transcript": [
    { "seq": 1, "speaker": "Customer", "text": "...", "timestamp": "00:00:02" }
  ]
}
```

The workflow's first Code node recomputes the HMAC over
`JSON.stringify(body)` (V8 preserves key order across parse/serialize) and
rejects mismatches with 401 before any LLM token is spent.
