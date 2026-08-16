import type { FileValidationError } from '@/lib/validation';

// Build plan §8.6 — explicit, user-facing failure messages. Never expose raw
// error objects or stack traces.
export function fileErrorMessage(error: FileValidationError): string {
  switch (error) {
    case 'invalid_extension':
      return 'Only .txt files are supported.';
    case 'invalid_mime':
      return 'Only .txt files are supported.';
    case 'too_large':
      return 'File exceeds the 2 MB limit.';
    case 'empty':
      return "This file doesn't contain any readable text.";
    case 'invalid_utf8':
      return 'The file could not be read as valid UTF-8 text.';
  }
}

export const Errors = {
  unauthorized: 'Sign in to continue.',
  noFile: 'Please upload a .txt transcript file.',
  unsupportedMime: 'Only .txt files are supported.',
  invalidContent: "This file doesn't contain any readable text.",
  noTurns: 'No readable transcript content was found in this file.',
  serviceUnavailable: 'Analysis service is temporarily unavailable. Please try again.',
  invalidOutput: 'The analysis returned an unexpected result. Please retry.',
  rateLimited: "You've reached the analysis limit for now — try again shortly.",
  notFound: 'Report not found.',
} as const;

export function json(body: unknown, status: number) {
  return Response.json(body, { status });
}