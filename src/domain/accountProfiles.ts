/**
 * Individual driver (أفراد) vs company fleet (مؤسسة / شركة مشغلة) profiles.
 * Company trips pay the operator's corporate IBAN. Individual trips pay the
 * driver's own IBAN.
 */

export type PayoutAccountKind = 'individual' | 'company';

export interface PayoutBankAccount {
  iban: string;
  bankName: string;
  accountHolderName: string;
  /** Bank transfer reference the beneficiary statement should show. */
  transferIdentification?: string;
}

export interface IndividualDriverCompliance {
  nationalId: string;
  dateOfBirth: string;
  licenseNumber: string;
  mobileNumber: string;
  vehicleSequenceNumber: string;
  plateNumber: string;
  plateDigits: string;
  plateLetterRight: string;
  plateLetterMiddle: string;
  plateLetterLeft: string;
  operatingCardNumber: string;
  operatingCardExpiry: string;
  bank: PayoutBankAccount;
}

export interface CompanyFleetCompliance {
  companyName: string;
  commercialRegistration: string;
  bank: PayoutBankAccount;
}

const ARABIC_PLATE_LETTER = 'أبحدرسصطعقكلمنهويىةإأآ';

export function normalizeIban(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function isValidSaudiIban(iban: string): boolean {
  return /^SA\d{22}$/.test(normalizeIban(iban));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** True when the person is at least 18 on `today`. */
export function isAdultDateOfBirth(isoDate: string, today: Date = new Date()): boolean {
  if (!isIsoDate(isoDate)) return false;
  const [year, month, day] = isoDate.split('-').map(Number);
  const adult = new Date(Date.UTC(year + 18, month - 1, day));
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return adult.getTime() <= now;
}

function isPlateLetter(value: string): boolean {
  const letter = String(value || '').trim();
  if (letter.length < 1 || letter.length > 2) return false;
  if (/^[A-Za-z]$/.test(letter)) return true;
  return [...letter].every((ch) => ARABIC_PLATE_LETTER.includes(ch));
}

/**
 * First parsed letter is the right letter on a Saudi plate (Arabic RTL),
 * then middle, then left. Digits are `plate_number` for WASL.
 */
export function parseSaudiPlateParts(input: string): {
  plateDigits: string;
  plateLetterRight: string;
  plateLetterMiddle: string;
  plateLetterLeft: string;
} | null {
  const arabic = new Set([...ARABIC_PLATE_LETTER]);
  const letters: string[] = [];
  const digits: string[] = [];
  for (const ch of String(input || '').trim()) {
    if (/\d/.test(ch)) {
      if (digits.length < 4) digits.push(ch);
      continue;
    }
    if (/[A-Za-z]/.test(ch) || arabic.has(ch)) {
      if (letters.length < 3) letters.push(ch);
    }
  }
  if (letters.length !== 3 || digits.length < 1) return null;
  return {
    plateLetterRight: letters[0],
    plateLetterMiddle: letters[1],
    plateLetterLeft: letters[2],
    plateDigits: digits.join(''),
  };
}

export function resolvePlateParts(input: {
  plateNumber: string;
  plateLetterRight?: string;
  plateLetterMiddle?: string;
  plateLetterLeft?: string;
}): {
  plateDigits: string;
  plateLetterRight: string;
  plateLetterMiddle: string;
  plateLetterLeft: string;
} | null {
  const parsed = parseSaudiPlateParts(input.plateNumber);
  const right = String(input.plateLetterRight || parsed?.plateLetterRight || '').trim();
  const middle = String(input.plateLetterMiddle || parsed?.plateLetterMiddle || '').trim();
  const left = String(input.plateLetterLeft || parsed?.plateLetterLeft || '').trim();
  const digits = parsed?.plateDigits || '';
  if (!digits || !isPlateLetter(right) || !isPlateLetter(middle) || !isPlateLetter(left)) {
    return null;
  }
  return {
    plateDigits: digits,
    plateLetterRight: right,
    plateLetterMiddle: middle,
    plateLetterLeft: left,
  };
}

export type ProfileFieldCode =
  | 'DATE_OF_BIRTH_INVALID'
  | 'LICENSE_NUMBER_INVALID'
  | 'PLATE_LETTERS_INVALID'
  | 'OPERATING_CARD_INVALID'
  | 'OPERATING_CARD_EXPIRY_INVALID'
  | 'BANK_NAME_REQUIRED'
  | 'ACCOUNT_HOLDER_REQUIRED'
  | 'IBAN_INVALID'
  | 'TRANSFER_ID_REQUIRED'
  | 'COMPANY_NAME_REQUIRED'
  | 'CR_INVALID';

export function validatePayoutBank(
  bank: Partial<PayoutBankAccount> | null | undefined,
  options: { requireTransferId?: boolean } = {}
): ProfileFieldCode | null {
  const bankName = String(bank?.bankName || '').trim();
  const holder = String(bank?.accountHolderName || '').trim();
  const transferId = String(bank?.transferIdentification || '').trim();
  if (bankName.length < 2) return 'BANK_NAME_REQUIRED';
  if (holder.length < 2) return 'ACCOUNT_HOLDER_REQUIRED';
  if (!isValidSaudiIban(String(bank?.iban || ''))) return 'IBAN_INVALID';
  if (options.requireTransferId && (transferId.length < 2 || transferId.length > 40)) {
    return 'TRANSFER_ID_REQUIRED';
  }
  return null;
}

export function normalizePayoutBank(
  bank: Partial<PayoutBankAccount>,
  options: { requireTransferId?: boolean } = {}
): PayoutBankAccount {
  const code = validatePayoutBank(bank, options);
  if (code) {
    throw Object.assign(new Error(code), { statusCode: 400, code });
  }
  const transferIdentification = String(bank.transferIdentification || '').trim();
  return {
    iban: normalizeIban(String(bank.iban || '')),
    bankName: String(bank.bankName || '').trim(),
    accountHolderName: String(bank.accountHolderName || '').trim(),
    ...(transferIdentification ? { transferIdentification } : {}),
  };
}

export function validateIndividualCompliance(input: {
  dateOfBirth: string;
  licenseNumber: string;
  plateNumber: string;
  plateLetterRight?: string;
  plateLetterMiddle?: string;
  plateLetterLeft?: string;
  operatingCardNumber: string;
  operatingCardExpiry: string;
  bank: Partial<PayoutBankAccount>;
}): ProfileFieldCode | null {
  if (!isAdultDateOfBirth(String(input.dateOfBirth || '').trim())) return 'DATE_OF_BIRTH_INVALID';
  if (!/^[A-Za-z0-9-]{4,20}$/.test(String(input.licenseNumber || '').trim())) {
    return 'LICENSE_NUMBER_INVALID';
  }
  if (
    !resolvePlateParts({
      plateNumber: input.plateNumber,
      plateLetterRight: input.plateLetterRight,
      plateLetterMiddle: input.plateLetterMiddle,
      plateLetterLeft: input.plateLetterLeft,
    })
  ) {
    return 'PLATE_LETTERS_INVALID';
  }
  if (!/^[A-Za-z0-9/-]{4,30}$/.test(String(input.operatingCardNumber || '').trim())) {
    return 'OPERATING_CARD_INVALID';
  }
  if (!isIsoDate(String(input.operatingCardExpiry || '').trim())) {
    return 'OPERATING_CARD_EXPIRY_INVALID';
  }
  return validatePayoutBank(input.bank, { requireTransferId: true });
}

export function validateCompanyCompliance(input: {
  companyName: string;
  commercialRegistration: string;
  bank: Partial<PayoutBankAccount>;
}): ProfileFieldCode | null {
  if (String(input.companyName || '').trim().length < 2) return 'COMPANY_NAME_REQUIRED';
  if (!/^\d{10}$/.test(String(input.commercialRegistration || '').replace(/\D/g, ''))) {
    return 'CR_INVALID';
  }
  return validatePayoutBank(input.bank, { requireTransferId: false });
}

/**
 * A driver linked to a fleet operator is paid on the company IBAN.
 * An unlinked driver is paid on their own IBAN.
 */
export function resolvePayoutAccount(input: {
  driverId: string;
  operatorId?: string | null;
}): { kind: PayoutAccountKind; ownerId: string } {
  const operatorId = String(input.operatorId || '').trim();
  if (operatorId) return { kind: 'company', ownerId: operatorId };
  return { kind: 'individual', ownerId: String(input.driverId || '').trim() };
}

export function profileFieldMessage(code: ProfileFieldCode, isRtl: boolean): string {
  const ar: Record<ProfileFieldCode, string> = {
    DATE_OF_BIRTH_INVALID: 'أدخل تاريخ ميلاد صالحاً (18 سنة على الأقل)',
    LICENSE_NUMBER_INVALID: 'رقم رخصة القيادة غير صالح',
    PLATE_LETTERS_INVALID: 'أدخل حروف اللوحة الثلاثة مع الأرقام (مثال: أ ب ح 1234)',
    OPERATING_CARD_INVALID: 'رقم كرت التشغيل غير صالح',
    OPERATING_CARD_EXPIRY_INVALID: 'أدخل تاريخ انتهاء كرت التشغيل',
    BANK_NAME_REQUIRED: 'اسم البنك مطلوب',
    ACCOUNT_HOLDER_REQUIRED: 'اسم صاحب الحساب مطلوب',
    IBAN_INVALID: 'الآيبان يجب أن يبدأ بـ SA ويتبعه 22 رقماً',
    TRANSFER_ID_REQUIRED: 'معرّف التحويل مطلوب (من 2 إلى 40 حرفاً)',
    COMPANY_NAME_REQUIRED: 'اسم الشركة مطلوب',
    CR_INVALID: 'السجل التجاري يجب أن يكون 10 أرقام',
  };
  const en: Record<ProfileFieldCode, string> = {
    DATE_OF_BIRTH_INVALID: 'Enter a valid date of birth (18 or older)',
    LICENSE_NUMBER_INVALID: 'Driver license number is invalid',
    PLATE_LETTERS_INVALID: 'Enter the three plate letters and digits (e.g. A B C 1234)',
    OPERATING_CARD_INVALID: 'Operating card number is invalid',
    OPERATING_CARD_EXPIRY_INVALID: 'Enter the operating card expiry date',
    BANK_NAME_REQUIRED: 'Bank name is required',
    ACCOUNT_HOLDER_REQUIRED: 'Account holder name is required',
    IBAN_INVALID: 'IBAN must start with SA followed by 22 digits',
    TRANSFER_ID_REQUIRED: 'Transfer identification is required (2–40 characters)',
    COMPANY_NAME_REQUIRED: 'Company name is required',
    CR_INVALID: 'Commercial registration must be 10 digits',
  };
  return (isRtl ? ar : en)[code];
}
