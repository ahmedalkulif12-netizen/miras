import { authFetch } from '@/lib/authApi';
import { resolveApiUrl } from '@/lib/apiUrl';

export interface ServiceFeedbackInput {
  rating: number;
  comment: string;
  orderId?: string | null;
}

const LOCAL_QUEUE_KEY = 'jz_feedback_queue';

function rememberLocally(input: ServiceFeedbackInput) {
  try {
    const prev = JSON.parse(localStorage.getItem(LOCAL_QUEUE_KEY) || '[]');
    const next = Array.isArray(prev) ? prev : [];
    next.push({ ...input, savedAt: new Date().toISOString() });
    localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(next.slice(-20)));
  } catch {
    /* private mode */
  }
}

export interface DriverReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: string | null;
}

export interface DriverRatingSummary {
  average: number | null;
  count: number;
  reviews: DriverReview[];
}

/** Trip ratings left for the signed-in driver. */
export async function fetchMyDriverRatings(): Promise<DriverRatingSummary> {
  const response = await authFetch(resolveApiUrl('/api/driver/ratings'));
  if (!response.ok) {
    throw new Error(`RATINGS_${response.status}`);
  }
  const payload = (await response.json()) as Partial<DriverRatingSummary>;
  return {
    average: typeof payload.average === 'number' ? payload.average : null,
    count: Number(payload.count) || 0,
    reviews: Array.isArray(payload.reviews) ? payload.reviews : [],
  };
}

/** Saves a star rating and comment. Falls back to this device if the API is unreachable. */
export async function submitServiceFeedback(input: ServiceFeedbackInput): Promise<void> {
  const rating = Math.round(input.rating);
  const comment = input.comment.trim().slice(0, 1000);
  if (rating < 1 || rating > 5) {
    throw new Error('RATING_REQUIRED');
  }
  const body = JSON.stringify({
    rating,
    comment,
    orderId: input.orderId || null,
  });
  try {
    const response = await authFetch(resolveApiUrl('/api/feedback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || `FEEDBACK_${response.status}`);
    }
  } catch (error) {
    rememberLocally({ rating, comment, orderId: input.orderId });
    if (error instanceof Error && error.message === 'RATING_REQUIRED') throw error;
    console.warn('[feedback] stored on this device after API miss:', error);
  }
}
