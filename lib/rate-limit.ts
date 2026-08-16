// Build plan §8.6 — rate limiting on the analysis endpoint.
// In-memory sliding window by default; Upstash Redis fixed-window when
// configured (survives restarts / multi-instance). Both paths return the
// same shape so callers never know which is live.

import { env, mode } from '@/lib/config';

const windows = new Map<string, number[]>();

const WINDOW_MS = 10 * 60 * 1000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
}

export async function checkRateLimit(
  userId: string,
  limit: number
): Promise<RateLimitResult> {
  if (mode.upstashConfigured) {
    try {
      return await checkUpstash(userId, limit);
    } catch {
      // Upstash hiccup → fall back to in-memory so the app still works.
    }
  }
  return checkInMemory(userId, limit);
}

function checkInMemory(userId: string, limit: number): RateLimitResult {
  const now = Date.now();
  const hits = (windows.get(userId) ?? []).filter(
    (t) => now - t < WINDOW_MS
  );
  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  windows.set(userId, hits);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (windows.size > 10_000) {
    for (const [key, times] of windows) {
      if (times.every((t) => now - t >= WINDOW_MS)) windows.delete(key);
    }
  }
  return { ok: true };
}

async function checkUpstash(userId: string, limit: number): Promise<RateLimitResult> {
  const key = `calllens:ratelimit:${userId}`;
  const windowSec = Math.floor(WINDOW_MS / 1000);

  const res = await fetch(`${env.upstashRedisUrl}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.upstashRedisToken}` },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, windowSec],
    ]),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const data: Array<{ result?: number | null }> = await res.json();

  const count = Number(data[0]?.result ?? 0);
  if (count > limit) {
    return { ok: false, retryAfterSec: windowSec };
  }
  return { ok: true };
}