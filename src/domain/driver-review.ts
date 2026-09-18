/**
 * Shared driver-moderation helpers for admin overview + manage-drivers.
 * Keep the dashboard count and the drivers inbox on the same status set.
 */

export const REVIEW_QUEUE_DRIVER_STATUSES = [
  'pending',
  'pending_review',
  'ready_for_review',
] as const;

export type ReviewQueueDriverStatus = (typeof REVIEW_QUEUE_DRIVER_STATUSES)[number];

export type MappedDriverAccountStatus =
  | 'approved'
  | 'pending'
  | 'ready_for_review'
  | 'rejected'
  | 'suspended'
  | 'banned';

const REVIEW_QUEUE = new Set<string>([
  ...REVIEW_QUEUE_DRIVER_STATUSES,
  'under_review',
  'in_review',
  'awaiting_review',
  'submitted',
  'kyc_pending',
]);

export function normalizeRawDriverStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isReviewQueueDriverStatus(status: unknown): boolean {
  return REVIEW_QUEUE.has(normalizeRawDriverStatus(status));
}

/**
 * Map Firestore accountStatus / status aliases onto the admin UI union.
 * Incomplete KYC stays `pending`; complete docs become `ready_for_review`.
 */
export function mapDriverAccountStatus(
  raw: unknown,
  docsComplete: boolean,
  options: { missing?: 'pending' | 'approved' } = {}
): MappedDriverAccountStatus {
  const value = normalizeRawDriverStatus(raw);
  const missing = options.missing ?? 'pending';

  if (!value) {
    if (missing === 'approved') return 'approved';
    return docsComplete ? 'ready_for_review' : 'pending';
  }

  if (
    value === 'approved' ||
    value === 'active' ||
    value === 'available' ||
    value === 'online' ||
    value === 'offline'
  ) {
    return 'approved';
  }
  if (value === 'blocked' || value === 'banned') return 'banned';
  if (value === 'suspended' || value === 'disabled') return 'suspended';
  if (value === 'rejected' || value === 'denied') return 'rejected';
  if (isReviewQueueDriverStatus(value)) {
    return docsComplete ? 'ready_for_review' : 'pending';
  }

  return docsComplete ? 'ready_for_review' : 'pending';
}

/** First non-empty moderation field on driver / user companion docs. */
export function readRawDriverAccountStatus(
  primary: Record<string, unknown> | null | undefined,
  secondary: Record<string, unknown> | null | undefined = null
): string {
  const keys = [
    'accountStatus',
    'status',
    'reviewStatus',
    'kycStatus',
    'moderationStatus',
    'applicationStatus',
  ];
  for (const record of [primary, secondary]) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (value != null && String(value).trim()) return String(value);
    }
  }
  return '';
}
