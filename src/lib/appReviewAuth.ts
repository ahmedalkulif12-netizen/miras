/**
 * Legacy App Review mock sessions may still sit in localStorage from older
 * TestFlight builds. Production auth is Firebase Phone OTP only — this module
 * only clears those leftover keys.
 */
const SESSION_KEY = 'miras_app_review_auth';
const PENDING_ROLE_KEY = 'miras_app_review_pending_role';

export function clearAppReviewSession(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(PENDING_ROLE_KEY);
    } catch {
      /* ignore */
    }
  }
}
