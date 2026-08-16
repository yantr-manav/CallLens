import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signInUser } from '@/lib/auth';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  next: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 }
    );
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Enter a valid email and password.' },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;
  const result = await signInUser(email, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}