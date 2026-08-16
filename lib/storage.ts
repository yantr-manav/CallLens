import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mode } from '@/lib/config';
import { getServerClient } from '@/lib/supabase/server';

export const BUCKET = 'transcripts';
const LOCAL_BLOB_DIR = path.join(process.cwd(), '.local-store', 'blobs');

export function storagePath(userId: string, fileHash: string): string {
  return `${userId}/${fileHash}.txt`;
}

// Persists the raw transcript text. Returns the storage_path used as the
// canonical reference for the file (also stored on the conversations row).
export async function saveRawTranscript(
  userId: string,
  fileHash: string,
  content: string
): Promise<string> {
  const objectPath = storagePath(userId, fileHash);

  if (mode.supabaseConfigured) {
    const client = await getServerClient();
    if (!client) throw new Error('Supabase not configured');
    const blob = new Blob([content], { type: 'text/plain' });
    const { error } = await client.storage
      .from(BUCKET)
      .upload(objectPath, blob, {
        contentType: 'text/plain',
        upsert: false, // unique(user_id, file_hash) already prevents dupes
      });
    if (error && error.message !== 'The resource already exists') {
      throw new Error(`storage upload: ${error.message}`);
    }
    return objectPath;
  }

  // Local mode — file system under .local-store/blobs.
  const localFile = path.join(LOCAL_BLOB_DIR, objectPath);
  await fs.mkdir(path.dirname(localFile), { recursive: true });
  await fs.writeFile(localFile, content, 'utf-8');
  return objectPath;
}

export async function readRawTranscript(
  objectPath: string
): Promise<string | null> {
  if (mode.supabaseConfigured) {
    const client = await getServerClient();
    if (!client) return null;
    const { data, error } = await client.storage
      .from(BUCKET)
      .download(objectPath);
    if (error || !data) return null;
    return await data.text();
  }
  try {
    return await fs.readFile(path.join(LOCAL_BLOB_DIR, objectPath), 'utf-8');
  } catch {
    return null;
  }
}