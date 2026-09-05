/**
 * Log and format the exact Firestore / Firebase client error (code + message).
 */

export function firestoreErrorParts(error: unknown): { code: string; message: string } {
  const err = error as {
    code?: unknown;
    message?: unknown;
  };
  const code = String(err?.code || '').trim();
  const message = String(err?.message || (error instanceof Error ? error.message : error) || '').trim();
  return { code, message };
}

export function formatFirestoreErrorDetails(error: unknown): string {
  const { code, message } = firestoreErrorParts(error);
  if (code && message && !message.toLowerCase().includes(code.toLowerCase())) {
    return `${code}: ${message}`;
  }
  return message || code || 'unknown-error';
}

export function logFirestoreWriteError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const err = error as {
    name?: string;
    code?: string;
    message?: string;
    stack?: string;
    customData?: unknown;
  };
  const { code, message } = firestoreErrorParts(error);
  console.error(`[firestore] ${context} failed`, {
    name: err?.name || null,
    code: code || err?.code || null,
    message: message || err?.message || String(error),
    stack: err?.stack || null,
    customData: err?.customData ?? null,
    ...(extra || {}),
    raw: error,
  });
}
