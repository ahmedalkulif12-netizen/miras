/** Accept only https portrait URLs for admin JSON responses. */
export function readHttpsPhoto(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    if (url.startsWith('https://')) return url;
  }
  return undefined;
}
