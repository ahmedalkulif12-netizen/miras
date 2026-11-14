/** Western digits 0-9. Eastern Arabic and Persian digits are converted before parse. */

const EASTERN = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';

export function toEnglishDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const index = EASTERN.indexOf(digit);
    return index >= 0 ? String(index % 10) : digit;
  });
}

export function parseEnglishNumber(raw: string): number {
  const normalized = toEnglishDigits(raw).replace(/,/g, '').trim();
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
