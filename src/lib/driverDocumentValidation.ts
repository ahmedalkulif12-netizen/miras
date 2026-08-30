/**
 * Smart validation for Saudi driver KYC fields + document uploads.
 * Used before driver registration / OTP so incomplete or malformed data never submits.
 */

import type {
  DriverDocumentKey,
  DriverDocumentUploadStatuses,
} from '@/lib/userProfile';

export const DRIVER_DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const DRIVER_DOC_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

const ALLOWED_DOC_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);

const ALLOWED_DOC_EXT = new Set(['.jpg', '.jpeg', '.png']);

/** Arabic letters commonly used on KSA plates (plus hamza variants). */
const ARABIC_PLATE_LETTER = 'أبحدرسصطعقكلمنهويىةإأآ';
const LATIN_PLATE_LETTER = 'A-Za-z';

export type DriverValidationCode =
  | 'PLATE_REQUIRED'
  | 'PLATE_INVALID'
  | 'NATIONAL_ID_REQUIRED'
  | 'NATIONAL_ID_INVALID'
  | 'REGISTRATION_REQUIRED'
  | 'REGISTRATION_INVALID'
  | 'DOCUMENTS_INCOMPLETE'
  | 'DOCUMENT_TYPE_INVALID'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_EMPTY'
  | 'DOCUMENT_CORRUPT'
  | 'VEHICLE_TYPE_REQUIRED';

export interface DriverValidationResult {
  ok: boolean;
  code?: DriverValidationCode;
  /** Missing document keys when code is DOCUMENTS_INCOMPLETE. */
  missingDocs?: DriverDocumentKey[];
  /** Document that failed type / empty / corrupt checks. */
  invalidDoc?: DriverDocumentKey;
  /** Normalized values when ok. */
  normalized?: {
    plateNumber: string;
    nationalId: string;
    registrationSerial: string;
  };
}

export const REQUIRED_DRIVER_DOCS: DriverDocumentKey[] = [
  'id',
  'registration',
  'permit',
  'license',
];

export function normalizePlateNumber(input: string): string {
  return input
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Display formatter: spaces letters (أ ب ج / A B C) and separates the digit group.
 * Example outputs: "أ ب ج 1234" | "A B C 1234" | "1234 أ ب ج"
 */
export function formatSaudiPlateForDisplay(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[_-]+/g, ' ')
    .toUpperCase();

  const arabicSet = new Set([...ARABIC_PLATE_LETTER]);
  const letters: string[] = [];
  const digits: string[] = [];
  let sawDigitFirst = false;
  let decidedOrder = false;

  for (const ch of cleaned) {
    if (/\d/.test(ch)) {
      if (!decidedOrder) {
        sawDigitFirst = letters.length === 0;
        decidedOrder = true;
      }
      if (digits.length < 4) digits.push(ch);
      continue;
    }
    if (/[A-Z]/.test(ch) || arabicSet.has(ch)) {
      if (!decidedOrder) {
        sawDigitFirst = false;
        decidedOrder = true;
      }
      if (letters.length < 3) letters.push(ch);
    }
  }

  const letterPart = letters.join(' ');
  const digitPart = digits.join('');
  if (!letterPart && !digitPart) return '';
  if (!letterPart) return digitPart;
  if (!digitPart) return letterPart;
  return sawDigitFirst ? `${digitPart} ${letterPart}` : `${letterPart} ${digitPart}`;
}

/**
 * Accepts common Saudi plate shapes:
 *   ABC 1234 | 1234 ABC | أ ب ج 1234 | 1234 أ ب ج | ABC1234
 * Letters may be Latin or Arabic; 1–4 digits.
 */
export function isValidSaudiPlateNumber(input: string): boolean {
  const formatted = formatSaudiPlateForDisplay(input);
  if (!formatted || formatted.length < 4 || formatted.length > 24) return false;

  const letterClass = `[${LATIN_PLATE_LETTER}${ARABIC_PLATE_LETTER}]`;
  // Prefer spaced letters for Arabic; Latin may be spaced or glued in validation.
  const letters = `${letterClass}(?:\\s${letterClass}){2}|${letterClass}{3}`;
  const digits = '\\d{1,4}';

  const lettersThenDigits = new RegExp(`^(?:${letters})\\s${digits}$`);
  const digitsThenLetters = new RegExp(`^${digits}\\s(?:${letters})$`);

  return lettersThenDigits.test(formatted) || digitsThenLetters.test(formatted);
}

/** Strip to digits only. */
export function normalizeNationalId(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Saudi National ID (starts with 1) or Iqama (starts with 2) — 10 digits + checksum.
 */
export function isValidSaudiNationalIdOrIqama(input: string): boolean {
  const id = normalizeNationalId(input);
  if (!/^[12]\d{9}$/.test(id)) return false;

  // Official Luhn-style checksum used by Absher / MOI validators.
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) {
      const doubled = Number(id[i]) * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += Number(id[i]);
    }
  }
  return sum % 10 === 0;
}

/**
 * Vehicle registration / استمارة (Emarah) serial — alphanumeric, typically 6–15 chars.
 */
export function normalizeRegistrationSerial(input: string): string {
  return input.trim().replace(/\s+/g, '').toUpperCase();
}

export function isValidRegistrationSerial(input: string): boolean {
  const serial = normalizeRegistrationSerial(input);
  return /^[A-Z0-9\u0600-\u06FF]{6,15}$/i.test(serial);
}

function isJpegOrPngHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  return jpeg || png;
}

export function validateDriverDocumentFile(file: File): DriverValidationResult {
  if (!file || file.size <= 0) {
    return { ok: false, code: 'DOCUMENT_EMPTY' };
  }
  if (file.size > DRIVER_DOC_MAX_BYTES) {
    return { ok: false, code: 'DOCUMENT_TOO_LARGE' };
  }

  const mime = (file.type || '').toLowerCase();
  const ext = file.name.includes('.')
    ? `.${file.name.split('.').pop()!.toLowerCase()}`
    : '';

  const mimeOk = mime ? ALLOWED_DOC_MIME.has(mime) : false;
  const extOk = ext ? ALLOWED_DOC_EXT.has(ext) : false;
  if (!mimeOk && !extOk) {
    return { ok: false, code: 'DOCUMENT_TYPE_INVALID' };
  }

  return { ok: true };
}

/**
 * Decode the file to confirm it is a real (non-corrupt) JPEG/PNG image.
 */
export async function inspectDriverDocumentFile(file: File): Promise<DriverValidationResult> {
  const basic = validateDriverDocumentFile(file);
  if (!basic.ok) return basic;

  try {
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!isJpegOrPngHeader(header)) {
      return { ok: false, code: 'DOCUMENT_CORRUPT' };
    }

    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const tooSmall = bitmap.width < 8 || bitmap.height < 8;
      bitmap.close();
      if (tooSmall) return { ok: false, code: 'DOCUMENT_CORRUPT' };
      return { ok: true };
    }

    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (img.naturalWidth < 8 || img.naturalHeight < 8) {
          reject(new Error('IMAGE_TOO_SMALL'));
          return;
        }
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('IMAGE_DECODE_FAILED'));
      };
      img.src = url;
    });
    return { ok: true };
  } catch {
    return { ok: false, code: 'DOCUMENT_CORRUPT' };
  }
}

/** Client pre-screen: all four files attached, JPEG/PNG, not empty or corrupt. */
export async function assertRequiredDriverDocumentFiles(
  files: Partial<Record<DriverDocumentKey, File | undefined>>
): Promise<DriverValidationResult> {
  const missingDocs = getMissingDriverDocumentsFromFiles(files);
  if (missingDocs.length > 0) {
    return { ok: false, code: 'DOCUMENTS_INCOMPLETE', missingDocs };
  }
  for (const key of REQUIRED_DRIVER_DOCS) {
    const file = files[key];
    if (!file) {
      return { ok: false, code: 'DOCUMENTS_INCOMPLETE', missingDocs: [key] };
    }
    const check = await inspectDriverDocumentFile(file);
    if (!check.ok) {
      return { ...check, invalidDoc: key };
    }
  }
  return { ok: true };
}

export function getMissingDriverDocuments(
  statuses: DriverDocumentUploadStatuses
): DriverDocumentKey[] {
  return REQUIRED_DRIVER_DOCS.filter((key) => statuses[key] !== 'uploaded');
}

export function getMissingDriverDocumentsFromFiles(
  files: Partial<Record<DriverDocumentKey, File | undefined>>
): DriverDocumentKey[] {
  return REQUIRED_DRIVER_DOCS.filter((key) => !files[key] || files[key]!.size <= 0);
}

export function formatMissingDocumentsMessage(
  missing: DriverDocumentKey[],
  locale: 'ar' | 'en' = 'ar'
): string {
  const labels = missing.map((key) => getDriverDocumentLabel(key, locale));
  if (!labels.length) {
    return locale === 'ar' ? 'يرجى رفع جميع المستندات المطلوبة' : 'Upload all required documents';
  }
  return locale === 'ar' ? `ناقص: ${labels.join('، ')}` : `Missing: ${labels.join(', ')}`;
}

/**
 * Full pre-submit check for driver registration (plate + ID + استمارة + docs).
 */
export function validateDriverRegistrationInput(input: {
  plateNumber: string;
  nationalId: string;
  registrationSerial: string;
  vehicleType?: string;
  documentUploadStatuses: DriverDocumentUploadStatuses;
  documentFiles?: Partial<Record<DriverDocumentKey, File>>;
}): DriverValidationResult {
  if (!input.vehicleType?.trim()) {
    return { ok: false, code: 'VEHICLE_TYPE_REQUIRED' };
  }

  const plateNumber = formatSaudiPlateForDisplay(input.plateNumber);
  if (!plateNumber) {
    return { ok: false, code: 'PLATE_REQUIRED' };
  }
  if (!isValidSaudiPlateNumber(plateNumber)) {
    return { ok: false, code: 'PLATE_INVALID' };
  }

  const nationalId = normalizeNationalId(input.nationalId);
  if (!nationalId) {
    return { ok: false, code: 'NATIONAL_ID_REQUIRED' };
  }
  if (!isValidSaudiNationalIdOrIqama(nationalId)) {
    return { ok: false, code: 'NATIONAL_ID_INVALID' };
  }

  const registrationSerial = normalizeRegistrationSerial(input.registrationSerial);
  if (!registrationSerial) {
    return { ok: false, code: 'REGISTRATION_REQUIRED' };
  }
  if (!isValidRegistrationSerial(registrationSerial)) {
    return { ok: false, code: 'REGISTRATION_INVALID' };
  }

  const missingDocs = input.documentFiles
    ? getMissingDriverDocumentsFromFiles(input.documentFiles)
    : getMissingDriverDocuments(input.documentUploadStatuses);
  if (missingDocs.length > 0) {
    return { ok: false, code: 'DOCUMENTS_INCOMPLETE', missingDocs };
  }

  if (input.documentFiles) {
    for (const key of REQUIRED_DRIVER_DOCS) {
      const file = input.documentFiles[key];
      if (!file) continue;
      const fileCheck = validateDriverDocumentFile(file);
      if (!fileCheck.ok) return fileCheck;
    }
  }

  return {
    ok: true,
    normalized: { plateNumber, nationalId, registrationSerial },
  };
}

export function getDriverValidationMessage(
  result: DriverValidationResult,
  locale: 'ar' | 'en' = 'ar'
): string {
  const code = result.code;
  const en: Record<DriverValidationCode, string> = {
    PLATE_REQUIRED: 'Enter the vehicle plate number.',
    PLATE_INVALID:
      'Invalid plate format. Use a Saudi plate like ABC 1234 or 1234 ABC (3 letters + up to 4 digits).',
    NATIONAL_ID_REQUIRED: 'Enter your National ID or Iqama number.',
    NATIONAL_ID_INVALID:
      'Invalid National ID / Iqama. It must be 10 digits starting with 1 (citizen) or 2 (resident).',
    REGISTRATION_REQUIRED: 'Enter the vehicle registration (Istimara / Emarah) serial.',
    REGISTRATION_INVALID:
      'Invalid registration serial. Use 6–15 letters or digits from the Istimara card.',
    DOCUMENTS_INCOMPLETE:
      'Upload all required documents: driving license, National ID/Iqama, vehicle registration (Istimara), and operating permit.',
    DOCUMENT_TYPE_INVALID: 'Documents must be JPEG or PNG images.',
    DOCUMENT_TOO_LARGE: 'Each document must be 5 MB or smaller.',
    DOCUMENT_EMPTY: 'Selected file is empty. Choose a valid document.',
    DOCUMENT_CORRUPT: 'This file is corrupted or not a readable JPEG/PNG image.',
    VEHICLE_TYPE_REQUIRED: 'Select a vehicle type.',
  };

  const ar: Record<DriverValidationCode, string> = {
    PLATE_REQUIRED: 'يرجى إدخال رقم لوحة المركبة.',
    PLATE_INVALID:
      'صيغة اللوحة غير صحيحة. استخدم لوحة سعودية مثل أ ب ج 1234 أو ABC 1234 (3 أحرف + حتى 4 أرقام).',
    NATIONAL_ID_REQUIRED: 'يرجى إدخال رقم الهوية الوطنية أو الإقامة.',
    NATIONAL_ID_INVALID:
      'رقم الهوية/الإقامة غير صحيح. يجب أن يكون 10 أرقام ويبدأ بـ 1 (مواطن) أو 2 (مقيم).',
    REGISTRATION_REQUIRED: 'يرجى إدخال رقم الاستمارة / الإمارة.',
    REGISTRATION_INVALID:
      'رقم الاستمارة غير صحيح. استخدم 6–15 حرفاً أو رقماً كما في بطاقة الاستمارة.',
    DOCUMENTS_INCOMPLETE:
      'يرجى رفع جميع المستندات المطلوبة: رخصة القيادة، الهوية/الإقامة، استمارة المركبة، وكرت التشغيل.',
    DOCUMENT_TYPE_INVALID: 'يجب أن تكون الملفات بصيغة JPEG أو PNG.',
    DOCUMENT_TOO_LARGE: 'حجم كل مستند يجب ألا يتجاوز 5 ميغابايت.',
    DOCUMENT_EMPTY: 'الملف فارغ. اختر مستنداً صالحاً.',
    DOCUMENT_CORRUPT: 'الملف تالف أو ليس صورة JPEG/PNG قابلة للقراءة.',
    VEHICLE_TYPE_REQUIRED: 'يرجى اختيار نوع المركبة.',
  };

  if (code === 'DOCUMENTS_INCOMPLETE' && result.missingDocs?.length) {
    return formatMissingDocumentsMessage(result.missingDocs, locale);
  }
  if (!code) {
    return locale === 'ar' ? 'بيانات السائق غير مكتملة' : 'Driver details are incomplete';
  }
  const base = (locale === 'ar' ? ar : en)[code];
  if (result.invalidDoc) {
    const label = getDriverDocumentLabel(result.invalidDoc, locale);
    return locale === 'ar' ? `${base} — ${label}` : `${base} (${label})`;
  }
  return base;
}

export function getDriverDocumentLabel(
  key: DriverDocumentKey,
  locale: 'ar' | 'en'
): string {
  const labels: Record<DriverDocumentKey, { ar: string; en: string }> = {
    id: { ar: 'صورة الهوية / الإقامة', en: 'National ID / Iqama' },
    registration: { ar: 'صورة الاستمارة', en: 'Vehicle Registration / Istimara' },
    permit: { ar: 'كارت التشغيل', en: 'Operating Card' },
    license: { ar: 'صورة رخصة القيادة', en: "Driver's License" },
  };
  return labels[key][locale];
}

export function getDriverDocumentHint(
  key: DriverDocumentKey,
  locale: 'ar' | 'en'
): string {
  const hints: Record<DriverDocumentKey, { ar: string; en: string }> = {
    id: { ar: 'JPEG / PNG', en: 'JPEG / PNG photo of ID or Iqama' },
    registration: { ar: 'JPEG / PNG', en: 'JPEG / PNG photo of Istimara' },
    permit: { ar: 'JPEG / PNG', en: 'JPEG / PNG photo of operating card' },
    license: { ar: 'JPEG / PNG', en: 'JPEG / PNG photo of driving license' },
  };
  return hints[key][locale];
}
