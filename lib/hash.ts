// SHA-256 content hash — the idempotency key. Re-submitting the same file
// returns the cached analysis instead of re-billing the LLM.

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function sha256File(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  return sha256Hex(new Uint8Array(buffer));
}