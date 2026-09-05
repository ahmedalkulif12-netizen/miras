/**
 * Log the exact Firestore / Firebase client error (code + message) for order writes.
 */

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
  console.error(`[firestore] ${context} failed`, {
    name: err?.name || null,
    code: err?.code || null,
    message: err?.message || String(error),
    stack: err?.stack || null,
    customData: err?.customData ?? null,
    ...(extra || {}),
    raw: error,
  });
}
