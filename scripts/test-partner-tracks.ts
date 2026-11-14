import assert from 'node:assert/strict';
import { isValidSaudiIban } from '../src/domain/accountProfiles.ts';
import {
  aggregateSettlement,
  legalNamesMatch,
  normalizeFleetPlan,
  parseIstimaraText,
  settlementCsv,
  verifyIbanOwnership,
} from '../src/domain/partnerTracks.ts';

assert.equal(isValidSaudiIban('SA0380000000608010167519'), true);
assert.equal(isValidSaudiIban('SA0380000000608010167518'), false);
assert.equal(isValidSaudiIban('SA00'), false);

assert.equal(legalNamesMatch('أحمد بن علي', 'احمد بن علي'), true);
assert.equal(legalNamesMatch('شركة الحمولات', 'شركة الحموله'), false);
assert.equal(verifyIbanOwnership({
  legalName: 'Ahmed Ali',
  accountHolderName: 'Ahmed Ali',
  iban: 'SA0380000000608010167519',
  nationalId: '1234567890',
  accountHolderNationalId: '1234567890',
}), null);
assert.equal(verifyIbanOwnership({
  legalName: 'Ahmed Ali',
  accountHolderName: 'Other Person',
  iban: 'SA0380000000608010167519',
  nationalId: '1234567890',
  accountHolderNationalId: '1234567890',
}), 'HOLDER_NAME_MISMATCH');
assert.equal(verifyIbanOwnership({
  legalName: 'Ahmed Ali',
  accountHolderName: 'Ahmed Ali',
  iban: 'SA0380000000608010167519',
  nationalId: '1234567890',
  accountHolderNationalId: '1098765432',
}), 'HOLDER_ID_MISMATCH');

const plan = normalizeFleetPlan({
  totalVehicles: 4,
  types: { hydraulic: 2, normal: 1, closed: 1 },
});
assert.equal(plan?.totalVehicles, 4);
assert.equal(normalizeFleetPlan({
  totalVehicles: 3,
  types: { hydraulic: 2, normal: 1, closed: 1 },
}), null);

const card = parseIstimaraText('نوع تويوتا هايلكس الرقم التسلسلي 12345678 أ ب ح 4321');
assert.equal(card.serial, '12345678');
assert.ok(card.plate.includes('4321'));
assert.ok(card.model.includes('تويوتا') || card.model.length > 0);

const rows = aggregateSettlement(
  [
    {
      id: 'a',
      status: 'completed',
      driverId: 'd1',
      driverName: 'سائق',
      operatorId: 'op1',
      operatorName: 'مؤسسة الغاز',
      driverNet: 100,
      completedAt: '2026-11-02T10:00:00.000Z',
    },
    {
      id: 'b',
      status: 'completed',
      driverId: 'd2',
      driverName: 'فرد',
      operatorId: '',
      operatorName: '',
      driverNet: 40,
      completedAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 'c',
      status: 'assigned',
      driverId: 'd2',
      driverName: 'فرد',
      operatorId: '',
      operatorName: '',
      driverNet: 99,
      completedAt: '2026-11-10T10:00:00.000Z',
    },
  ],
  '2026-11-01',
  '2026-11-15'
);
assert.equal(rows.length, 2);
assert.equal(rows[0].kind, 'company');
assert.equal(rows[0].netSar, 100);
assert.equal(rows[1].kind, 'individual');
const csv = settlementCsv(rows, 'JZ-2026-11-15');
assert.ok(csv.includes('BeneficiaryName'));
assert.ok(csv.includes('100.00'));
assert.ok(csv.includes('SAR'));

console.log('partner track tests passed');
