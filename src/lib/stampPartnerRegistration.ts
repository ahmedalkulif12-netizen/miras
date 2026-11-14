import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { FleetPlan, PartnerTrack } from '@/domain/partnerTracks';

export async function stampPartnerRegistration(input: {
  uid: string;
  track: PartnerTrack;
  vehicleModel?: string;
  fleetPlan?: FleetPlan | null;
  transportLicense?: string;
  ibanVerification: {
    status: 'matched';
    method: 'name_and_id_exact' | 'company_name_exact';
    legalName: string;
    accountHolderName: string;
    nationalId?: string;
    commercialRegistration?: string;
  };
}): Promise<void> {
  const payload = {
    registrationTrack: input.track,
    ibanVerification: {
      ...input.ibanVerification,
      checkedAt: new Date().toISOString(),
    },
    ...(input.vehicleModel ? { vehicleModel: input.vehicleModel.trim() } : {}),
    ...(input.fleetPlan ? { fleetPlan: input.fleetPlan } : {}),
    ...(input.transportLicense ? { transportLicense: input.transportLicense.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  const collectionName = input.track === 'company' ? 'operators' : 'drivers';
  await updateDoc(doc(db, collectionName, input.uid), payload);
}
