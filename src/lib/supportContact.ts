/**
 * Public support contacts — client-safe VITE_* values.
 * Phone / WhatsApp stay unset until a real business line is provided
 * (do not ship fake +966 5X XXX XXXX placeholders).
 */

/** Canonical public support inbox — never fall back to a personal address. */
export const OFFICIAL_SUPPORT_EMAIL = 'support@miras.com';

function readEnv(name: string): string {
  try {
    const viteVal = import.meta.env?.[name as keyof ImportMetaEnv];
    if (typeof viteVal === 'string' && viteVal.trim()) return viteVal.trim();
  } catch {
    // Node (tsx) does not always populate import.meta.env
  }
  if (typeof process !== 'undefined' && typeof process.env?.[name] === 'string') {
    return process.env[name]!.trim();
  }
  return '';
}

export const SUPPORT_EMAIL = readEnv('VITE_SUPPORT_EMAIL') || OFFICIAL_SUPPORT_EMAIL;
export const CORPORATE_EMAIL = readEnv('VITE_CORPORATE_EMAIL') || SUPPORT_EMAIL;

export const SUPPORT_PHONE_DISPLAY = readEnv('VITE_SUPPORT_PHONE_DISPLAY');
export const SUPPORT_PHONE_TEL = readEnv('VITE_SUPPORT_PHONE_TEL');
export const SUPPORT_WHATSAPP_NUMBER = readEnv('VITE_SUPPORT_WHATSAPP');
export const SUPPORT_WHATSAPP_DISPLAY =
  readEnv('VITE_SUPPORT_WHATSAPP_DISPLAY') || SUPPORT_PHONE_DISPLAY;

export const HAS_SUPPORT_PHONE = Boolean(SUPPORT_PHONE_TEL);
export const HAS_SUPPORT_WHATSAPP = Boolean(SUPPORT_WHATSAPP_NUMBER);

export const supportMailto = `mailto:${SUPPORT_EMAIL}`;
export const corporateMailto = `mailto:${CORPORATE_EMAIL}`;
export const supportTelHref = HAS_SUPPORT_PHONE ? `tel:${SUPPORT_PHONE_TEL}` : '';
export const supportWhatsAppHref = HAS_SUPPORT_WHATSAPP
  ? `https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/^\+/, '')}`
  : '';
