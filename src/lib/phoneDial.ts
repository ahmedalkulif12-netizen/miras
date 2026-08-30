/**
 * Normalize Saudi / E.164 phones for display and `tel:` dial intents.
 */

export function digitsOnlyPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/[^\d+]/g, '');
}

/** Build a `tel:` href, or null when the value is not dialable. */
export function toTelHref(raw: string | null | undefined): string | null {
  const cleaned = digitsOnlyPhone(raw);
  if (!cleaned) return null;
  // Keep leading + for E.164; strip other junk already handled.
  const normalized = cleaned.startsWith('+')
    ? `+${cleaned.slice(1).replace(/\D/g, '')}`
    : cleaned.replace(/\D/g, '');
  if (normalized.replace(/\D/g, '').length < 8) return null;
  return `tel:${normalized}`;
}

/** Human-readable Saudi-friendly spacing when possible. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const href = toTelHref(raw);
  if (!href) return (raw || '').trim();
  const n = href.replace(/^tel:/, '');
  if (n.startsWith('+966') && n.length >= 13) {
    const rest = n.slice(4);
    return `+966 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`.trim();
  }
  return n;
}

export function openNativeDialer(raw: string | null | undefined): boolean {
  const href = toTelHref(raw);
  if (!href) return false;
  window.location.href = href;
  return true;
}
