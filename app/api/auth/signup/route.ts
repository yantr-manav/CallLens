import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signUpUser } from '@/lib/auth';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
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
      { error: 'Enter a valid name, email and a password of at least 8 characters.' },
      { status: 400 }
    );
  }
  const { name, email, password } = parsed.data;
  const result = await signUpUser(name, email, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (result.needsConfirmation) {
    return NextResponse.json({ ok: true, needsConfirmation: true });
  }
  return NextResponse.json({ ok: true });
}
