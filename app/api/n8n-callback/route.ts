import 'server-only';
import { NextRequest } from 'next/server';
import { env } from '@/lib/config';
import { analysisResultSchema } from '@/lib/validation';
import { getStore } from '@/lib/db/store';
import { Errors, json } from '@/lib/errors';

// ── POST /api/n8n-callback ──
// Alternative async path: if the n8n webhook responds immediately and posts
// the result back here when the LLM finishes, this stores it. Protected by the
// SAME HMAC scheme (n8n signs with N8N_WEBHOOK_SECRET). Sync mode is primary.
export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-signature');
  if (!signature) return json({ error: 'Missing signature.' }, 401);

  const bodyText = await req.text();
  const expected = await hmacHex(bodyText, env.n8nWebhookSecret);
  // Constant-time-ish comparison (timingSafeEqual would need equal-length buffers).
  if (expected.length !== signature.length || expected !== signature) {
    return json({ error: 'Invalid signature.' }, 401);
  }

  let parsed: { conversation_id?: string; result?: unknown };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }
  const conversationId = parsed.conversation_id;
  if (!conversationId) return json({ error: 'Missing conversation_id.' }, 400);

  const validated = analysisResultSchema.safeParse(parsed.result);
  if (!validated.success) {
    return json({ error: Errors.invalidOutput }, 502);
  }

  try {
    await getStore().createAnalysis({
      conversationId,
      result: validated.data,
    });
  } catch {
    return json({ error: Errors.serviceUnavailable }, 502);
  }

  return json({ ok: true }, 200);
}

async function hmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}