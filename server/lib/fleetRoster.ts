import admin from 'firebase-admin';

export interface AssignFleetDriverInput {
  operatorId: string;
  driverUid: string;
  driverName?: string;
  nationalId?: string;
  licenseNumber?: string;
  mobileNumber?: string;
}

/**
 * Link an existing driver to the company account.
 * Later trips for that driver pay the company Tap destination / corporate IBAN.
 */
export async function assignFleetDriver(
  db: admin.firestore.Firestore,
  input: AssignFleetDriverInput
): Promise<{ operatorId: string; driverUid: string }> {
  const operatorId = String(input.operatorId || '').trim();
  const driverUid = String(input.driverUid || '').trim();
  if (!operatorId || !driverUid) {
    throw Object.assign(new Error('operatorId and driverUid are required'), { statusCode: 400 });
  }
  if (driverUid === operatorId) {
    throw Object.assign(new Error('The company account cannot be assigned as its own driver'), {
      statusCode: 400,
    });
  }
  const operatorSnap = await db.collection('operators').doc(operatorId).get();
  if (!operatorSnap.exists) {
    throw Object.assign(new Error('Company profile not found'), { statusCode: 404 });
  }
  const driverSnap = await db.collection('drivers').doc(driverUid).get();
  if (!driverSnap.exists) {
    throw Object.assign(new Error('Driver profile not found. The driver must register first.'), {
      statusCode: 404,
      code: 'DRIVER_NOT_FOUND',
    });
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  const driver = driverSnap.data() as Record<string, unknown>;
  const batch = db.batch();
  batch.set(
    db.collection('operators').doc(operatorId).collection('drivers').doc(driverUid),
    {
      driverUid,
      operatorId,
      driverName: input.driverName || driver.fullName || driver.name || '',
      nationalId: input.nationalId || driver.nationalId || '',
      licenseNumber: input.licenseNumber || driver.licenseNumber || '',
      mobileNumber: input.mobileNumber || driver.phone || '',
      payoutAccountKind: 'company',
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );
  batch.set(
    db.collection('drivers').doc(driverUid),
    {
      operatorId,
      companyId: operatorId,
      companyName: operatorSnap.data()?.companyName || '',
      payoutAccountKind: 'company',
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();
  return { operatorId, driverUid };
}
