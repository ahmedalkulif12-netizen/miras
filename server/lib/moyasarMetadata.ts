/**
 * Moyasar hosted invoice metadata must be string values (no null / numbers).
 * Sending other types is a common cause of invoice create 400s.
 */
export function toMoyasarMetadata(
  input: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      out[key] = value ? 'true' : 'false';
      continue;
    }
    const str = String(value).trim();
    if (!str || str === 'null' || str === 'undefined') continue;
    out[key] = str.slice(0, 250);
  }
  return out;
}
