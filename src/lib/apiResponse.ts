const HTML_RESPONSE_HINT =
  'The API returned HTML instead of JSON. Firebase Hosting is serving the SPA for /api/** — deploy a healthy Miras API Cloud Run service (hamula-api) and keep /api/** + /health rewrites in firebase.json, or set VITE_API_ORIGIN to the Cloud Run URL. Locally use `npm run dev`.';

export async function readApiJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();
  const trimmed = body.trimStart().toLowerCase();

  if (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    contentType.includes('text/html')
  ) {
    throw new Error(HTML_RESPONSE_HINT);
  }

  if (!contentType.includes('application/json') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error('API returned a non-JSON response');
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error('API returned invalid JSON');
  }
}

export async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await readApiJson<{ error?: string }>(res)) as { error?: string };
    return data.error || fallback;
  } catch (error) {
    if (error instanceof Error && error.message.includes('HTML instead of JSON')) {
      return error.message;
    }
    return fallback;
  }
}
