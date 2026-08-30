/**
 * Corporate contract registration schema (B2B).
 * Collection: corporate_contracts/{contractId}
 */

import type { CoreServiceType } from '@/lib/fleetServiceCatalog';

export type CorporateContractType = 'monthly' | 'annual' | 'project';

export type CorporatePaymentTerms = 'net30' | 'prepaid';

/** pending → awaiting admin; active → live; suspended → paused; rejected → denied */
export type CorporateContractStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'rejected';

export type CorporateContractServiceLine = {
  serviceType: CoreServiceType;
  enabled: boolean;
  /** Estimated monthly trips / jobs */
  monthlyTrips?: number;
  /** Free-text capacity note (e.g. "4 flatbeds", "200 tons") */
  capacityNote?: string;
};

export type CorporateContractRecord = {
  id: string;
  corporateId: string;
  /** Company profile */
  companyName: string;
  commercialRegistration: string;
  vatNumber: string;
  contactPerson: string;
  contactPhone?: string;
  billingAddress: string;
  /** Contract framing */
  contractType: CorporateContractType;
  startDate: string;
  endDate: string;
  /** Selected core services + capacity */
  services: CorporateContractServiceLine[];
  /** Payment & commercial terms */
  paymentTerms: CorporatePaymentTerms;
  /** Corporate discount % (0–100), set by corp request and/or admin */
  discountRate: number;
  /** Notes from corporate about agreed rates */
  customPricingNotes?: string;
  /** Admin-assigned pricing rules / overrides */
  adminPricingRules?: string;
  status: CorporateContractStatus;
  adminNotes?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateCorporateContractInput = {
  corporateId: string;
  companyName: string;
  commercialRegistration: string;
  vatNumber: string;
  contactPerson: string;
  contactPhone?: string;
  billingAddress: string;
  contractType: CorporateContractType;
  startDate: string;
  endDate: string;
  services: CorporateContractServiceLine[];
  paymentTerms: CorporatePaymentTerms;
  discountRate?: number;
  customPricingNotes?: string;
};
