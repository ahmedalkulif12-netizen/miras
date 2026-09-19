import { useEffect } from 'react';
import { DASHBOARD_POLL_INTERVAL_MS } from '@/lib/dashboardPoll';

/**
 * Re-run a dashboard refresh on an interval and when the WebView returns to foreground.
 * Used so Capacitor iOS/Android stay in lockstep with the web live views.
 */
export function useDashboardAutoRefresh(
  enabled: boolean,
  refresh: () => void | Promise<void>,
  intervalMs = DASHBOARD_POLL_INTERVAL_MS
): void {
  useEffect(() => {
    if (!enabled) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled, refresh, intervalMs]);
}
