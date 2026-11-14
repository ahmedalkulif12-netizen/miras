/**
 * Two independent partner registration tracks:
 * individual driver vs company fleet. Bank ownership is checked locally:
 * the typed account-holder name must match the legal name, and an individual
 * must repeat the same national ID. Admin still reviews the documents.
 */

import { isAdultDateOfBirth, isValidSaudiIban, normalizeIban } from './accountProfiles';

export type PartnerTrack = 'individual' | 'company';

export const FLEET_BODY_TYPES = [
  { id: 'hydraulic', ar: 'سطحة هيدروليك', en: 'Hydraulic flatbed' },
  { id: 'normal', ar: 'سطحة عادية', en: 'Standard flatbed' },
  { id: 'closed', ar: 'سطحة مغلقة', en: 'Enclosed flatbed' },
] as const;

export type FleetBodyTypeId = (typeof FLEET_BODY_TYPES)[number]['id'];

export interface FleetPlan {
  totalVehicles: number;
  types: Record<FleetBodyTypeId, number>;
}

export interface IbanOwnershipInput {
  legalName: string;
  accountHolderName: string;
  iban: string;
  nationalId?: string;
  accountHolderNationalId?: string;
}

export type IbanOwnershipCode =
  | 'IBAN_INVALID'
  | 'HOLDER_NAME_MISMATCH'
  | 'HOLDER_ID_MISMATCH';

export interface IstimaraExtract {
  plate: string;
  serial: string;
  model: string;
  rawText: string;
}

export interface SettlementOrder {
  id: string;
  status: string;
  driverId: string;
  driverName: string;
  operatorId: string;
  operatorName: string;
  driverNet: number;
  completedAt: string;
}

export interface SettlementPayee {
  payeeId: string;
  kind: PartnerTrack;
  name: string;
  iban: string;
  identity: string;
  netSar: number;
  trips: number;
}

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;

export function normalizeLegalName(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function legalNamesMatch(left: string, right: string): boolean {
  const a = normalizeLegalName(left);
  const b = normalizeLegalName(right);
  return a.length >= 2 && a === b;
}

export function verifyIbanOwnership(input: IbanOwnershipInput): IbanOwnershipCode | null {
  if (!isValidSaudiIban(input.iban)) return 'IBAN_INVALID';
  if (!legalNamesMatch(input.legalName, input.accountHolderName)) return 'HOLDER_NAME_MISMATCH';
  if (input.nationalId !== undefined || input.accountHolderNationalId !== undefined) {
    const left = String(input.nationalId || '').replace(/\D/g, '');
    const right = String(input.accountHolderNationalId || '').replace(/\D/g, '');
    if (left.length !== 10 || left !== right) return 'HOLDER_ID_MISMATCH';
  }
  return null;
}

export function ibanOwnershipMessage(code: IbanOwnershipCode, isRtl: boolean): string {
  const ar: Record<IbanOwnershipCode, string> = {
    IBAN_INVALID: 'الآيبان غير صالح. يجب أن يكون آيباناً سعودياً صحيحاً يبدأ بـ SA.',
    HOLDER_NAME_MISMATCH: 'اسم صاحب الحساب يجب أن يطابق الاسم القانوني المسجّل تماماً.',
    HOLDER_ID_MISMATCH: 'رقم هوية صاحب الحساب يجب أن يطابق رقم الهوية أو الإقامة المسجّل.',
  };
  const en: Record<IbanOwnershipCode, string> = {
    IBAN_INVALID: 'Enter a valid Saudi IBAN starting with SA.',
    HOLDER_NAME_MISMATCH: 'The account holder name must match the registered legal name exactly.',
    HOLDER_ID_MISMATCH: 'The account holder ID must match the registered national ID or Iqama.',
  };
  return (isRtl ? ar : en)[code];
}

export function emptyFleetPlan(): FleetPlan {
  return { totalVehicles: 0, types: { hydraulic: 0, normal: 0, closed: 0 } };
}

export function fleetPlanTotal(plan: FleetPlan): number {
  return FLEET_BODY_TYPES.reduce((sum, row) => sum + Math.max(0, Number(plan.types[row.id]) || 0), 0);
}

export function normalizeFleetPlan(plan: FleetPlan): FleetPlan | null {
  const types = {
    hydraulic: Math.max(0, Math.floor(Number(plan.types.hydraulic) || 0)),
    normal: Math.max(0, Math.floor(Number(plan.types.normal) || 0)),
    closed: Math.max(0, Math.floor(Number(plan.types.closed) || 0)),
  };
  const totalVehicles = types.hydraulic + types.normal + types.closed;
  if (totalVehicles < 1 || totalVehicles > 500) return null;
  if (Math.floor(Number(plan.totalVehicles) || 0) !== totalVehicles) return null;
  return { totalVehicles, types };
}

export function parseIstimaraText(text: string): IstimaraExtract {
  const rawText = String(text || '').replace(/\s+/g, ' ').trim();
  const spacedPlate = rawText.match(
    /([A-Za-z\u0621-\u064A])\s+([A-Za-z\u0621-\u064A])\s+([A-Za-z\u0621-\u064A])\s*(\d{1,4})/
  );
  const compactPlate = rawText.match(/\b([A-Za-z])\s*([A-Za-z])\s*([A-Za-z])\s*(\d{1,4})\b/);
  const plateMatch = spacedPlate || compactPlate;
  const serialMatch =
    rawText.match(/(?:تسلسل|serial|sequence|الاستمارة|استمارة)[^\dA-Za-z]{0,12}([A-Za-z0-9]{6,15})/i) ||
    rawText.match(/\b(\d{8,12})\b/);
  const modelMatch = rawText.match(
    /(?:موديل|طراز|model|نوع)[^\p{L}\p{N}]{0,8}([\p{L}\p{N}][\p{L}\p{N} \-]{1,40})/iu
  );
  return {
    plate: plateMatch ? `${plateMatch[1]} ${plateMatch[2]} ${plateMatch[3]} ${plateMatch[4]}` : '',
    serial: serialMatch ? serialMatch[1] : '',
    model: modelMatch ? modelMatch[1].trim() : '',
    rawText,
  };
}

function inRange(iso: string, from: string, to: string): boolean {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day >= from && day <= to;
}

export function aggregateSettlement(
  orders: SettlementOrder[],
  from: string,
  to: string
): SettlementPayee[] {
  const buckets = new Map<string, SettlementPayee>();
  for (const order of orders) {
    if (String(order.status || '') !== 'completed') continue;
    if (!inRange(order.completedAt, from, to)) continue;
    const net = Number(order.driverNet);
    if (!Number.isFinite(net) || net <= 0) continue;
    const company = String(order.operatorId || '').trim();
    const payeeId = company || String(order.driverId || '').trim();
    if (!payeeId) continue;
    const current = buckets.get(payeeId) || {
      payeeId,
      kind: company ? 'company' : 'individual',
      name: company ? order.operatorName || company : order.driverName || payeeId,
      iban: '',
      identity: '',
      netSar: 0,
      trips: 0,
    };
    current.netSar = Math.round((current.netSar + net) * 100) / 100;
    current.trips += 1;
    if (!current.name && (order.operatorName || order.driverName)) {
      current.name = company ? order.operatorName : order.driverName;
    }
    buckets.set(payeeId, current);
  }
  return [...buckets.values()].sort((a, b) => b.netSar - a.netSar);
}

export function settlementCsv(rows: SettlementPayee[], reference: string): string {
  const header = [
    'BeneficiaryName',
    'IBAN',
    'Amount',
    'Currency',
    'PaymentReference',
    'Identity',
    'AccountKind',
    'Trips',
  ];
  const lines = rows.map((row) =>
    [
      row.name,
      normalizeIban(row.iban),
      row.netSar.toFixed(2),
      'SAR',
      `${reference}-${row.payeeId}`.slice(0, 40),
      row.identity,
      row.kind,
      String(row.trips),
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

export function individualStepError(input: {
  step: 1 | 2 | 3;
  name: string;
  nationalId: string;
  dateOfBirth: string;
  vehicleType: string;
  plateNumber: string;
  registrationSerial: string;
  hasIstimara: boolean;
  bankName: string;
  iban: string;
  accountHolderName: string;
  accountHolderNationalId: string;
}): IbanOwnershipCode | 'STEP_INCOMPLETE' | null {
  if (input.step === 1) {
    if (input.name.trim().length < 3) return 'STEP_INCOMPLETE';
    if (!/^[12]\d{9}$/.test(input.nationalId.replace(/\D/g, ''))) return 'STEP_INCOMPLETE';
    if (!isAdultDateOfBirth(input.dateOfBirth)) return 'STEP_INCOMPLETE';
    return null;
  }
  if (input.step === 2) {
    if (!input.vehicleType.trim() || input.plateNumber.trim().length < 4) return 'STEP_INCOMPLETE';
    if (input.registrationSerial.trim().length < 6 || !input.hasIstimara) return 'STEP_INCOMPLETE';
    return null;
  }
  if (input.bankName.trim().length < 2) return 'STEP_INCOMPLETE';
  return verifyIbanOwnership({
    legalName: input.name,
    accountHolderName: input.accountHolderName,
    iban: input.iban,
    nationalId: input.nationalId,
    accountHolderNationalId: input.accountHolderNationalId,
  });
}
