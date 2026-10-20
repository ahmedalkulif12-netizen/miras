import React, { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { publicKeyForCheckout } from '@/lib/tapLivePublicKey';

const TAP_CARD_SDK_URL = 'https://tap-sdks.b-cdn.net/card/1.0.2/index.js';
const CARD_MOUNT_ID = 'tap-card-frame';
/** One row of card number + MM/YY + CVV, plus the brand line. Grows if Tap reports a taller form. */
const CARD_FRAME_MIN_PX = 168;

type TapCardSdk = {
  renderTapCard: (
    elementId: string,
    config: Record<string, unknown>
  ) => { unmount?: () => void };
  tokenize: () => void;
  Theme: { LIGHT: string };
  Currencies: { SAR: string };
  Direction: { LTR: string };
  Edges: { CURVED: string };
  Locale: { EN: string; AR: string };
};

declare global {
  interface Window {
    CardSDK?: TapCardSdk;
  }
}

export type TapCardMethod = 'mada' | 'creditcard';

function loadTapCardScript(): Promise<void> {
  if (window.CardSDK?.renderTapCard) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${TAP_CARD_SDK_URL}"]`
  );
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Tap card script failed')), {
        once: true,
      });
      if (window.CardSDK?.renderTapCard) resolve();
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TAP_CARD_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Tap card script failed'));
    document.head.appendChild(script);
  });
}

function expandTapCardFrame(root: HTMLElement | null, heightPx: number) {
  if (!root) return;
  const height = `${heightPx}px`;
  root.style.overflow = 'visible';
  root.style.minHeight = height;
  root.querySelectorAll('iframe').forEach((frame) => {
    if (frame.style.height === height && frame.style.minHeight === height) return;
    frame.style.display = 'block';
    frame.style.width = '100%';
    frame.style.minHeight = height;
    frame.style.height = height;
    frame.style.maxHeight = 'none';
    frame.style.overflow = 'visible';
    frame.style.border = '0';
    frame.setAttribute('height', String(heightPx));
  });
}

/** Tap's onError / postMessage payloads nest the real reason under errors[0]. */
export function readTapCardError(data: unknown): string {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (!data || typeof data !== 'object') return 'Card form error';
  const record = data as {
    description?: string;
    message?: string;
    code?: string;
    errors?: { description?: string; code?: string; message?: string }[];
    data?: { errors?: { description?: string; code?: string; message?: string }[] };
  };
  const nested = record.errors?.[0] || record.data?.errors?.[0];
  const text =
    nested?.description ||
    nested?.message ||
    record.description ||
    record.message ||
    '';
  const code = nested?.code || record.code || '';
  if (text && code) return `${text} (${code})`;
  return text || (code ? `Card form error (${code})` : 'Card form error');
}

/** Init failures. Field mistakes after the form is ready are not fatal. */
export function isFatalTapCardError(message: string): boolean {
  return /key not found|invalid api key|2104|1224|1242|7017|merchant public key|not configured|card script failed|could not load card form|card form error|payment methods are not available/i.test(
    message
  );
}

export function TapCardFrame({
  amount,
  method,
  isRtl,
  onToken,
  onError,
  onReady,
  onUnavailable,
}: {
  amount: number;
  method: TapCardMethod;
  isRtl: boolean;
  onToken: (tokenId: string) => void;
  onError: (message: string) => void;
  onReady?: () => void;
  /** Card element could not mount. Parent opens Tap's hosted checkout. */
  onUnavailable?: (message: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [frameHeight, setFrameHeight] = useState(CARD_FRAME_MIN_PX);
  const frameHeightRef = useRef(CARD_FRAME_MIN_PX);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const onUnavailableRef = useRef(onUnavailable);
  const readyRef = useRef(false);
  const fatalReportedRef = useRef(false);
  onTokenRef.current = onToken;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  onUnavailableRef.current = onUnavailable;
  readyRef.current = ready;
  frameHeightRef.current = frameHeight;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin).includes('tap.company')) return;
      const payload = event.data as {
        event?: string;
        data?: { height?: number; errors?: { description?: string; code?: string }[] };
      };
      if (payload?.event === 'dimension') {
        const reported = Number(payload.data?.height || 0);
        if (reported >= 80) {
          setFrameHeight(Math.max(CARD_FRAME_MIN_PX, Math.min(reported + 36, 420)));
        }
        return;
      }
      if (payload?.event !== 'error' || readyRef.current) return;
      reportCardProblem(readTapCardError(payload.data || payload));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const reportCardProblem = (message: string) => {
    console.error('[tap-card]', message);
    if (!readyRef.current && isFatalTapCardError(message)) {
      if (fatalReportedRef.current) return;
      fatalReportedRef.current = true;
      if (onUnavailableRef.current) {
        setLoadError('');
        onUnavailableRef.current(message);
        return;
      }
    }
    setLoadError(message);
    onErrorRef.current(message);
  };

  useEffect(() => {
    const root = document.getElementById(CARD_MOUNT_ID);
    expandTapCardFrame(root, frameHeight);
    if (!root) return;
    const observer = new MutationObserver(() => expandTapCardFrame(root, frameHeight));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'height'],
    });
    return () => observer.disconnect();
  }, [frameHeight, ready]);

  useEffect(() => {
    let cancelled = false;
    let unmountCard: (() => void) | undefined;

    async function mount() {
      try {
        const response = await authFetch('/api/payments/tap-config');
        let config: { publicKey?: string; merchantId?: string; testMode?: boolean } = {};
        if (response.ok) {
          config = await readApiJson<typeof config>(response);
        } else if (!import.meta.env.PROD) {
          throw new Error(await readApiErrorMessage(response, 'Tap is not configured'));
        } else {
          console.warn('[tap-card] tap-config unavailable — using the live merchant public key.');
        }
        const publicKey = publicKeyForCheckout(config);
        await loadTapCardScript();
        const sdk = window.CardSDK;
        if (!sdk || cancelled) return;

        const chargeAmount = Number(amount.toFixed(2));
        const mounted = sdk.renderTapCard(CARD_MOUNT_ID, {
          publicKey,
          ...(config.merchantId ? { merchant: { id: config.merchantId } } : {}),
          transaction: {
            amount: chargeAmount,
            currency: sdk.Currencies?.SAR || 'SAR',
          },
          acceptance: {
            supportedCards: 'ALL',
          },
          fields: {
            cardHolder: false,
            expiry: true,
            cvv: true,
          },
          addons: {
            displayPaymentBrands: true,
            loader: true,
            saveCard: false,
          },
          interface: {
            locale: isRtl ? sdk.Locale.AR : sdk.Locale.EN,
            theme: sdk.Theme.LIGHT,
            edges: sdk.Edges.CURVED,
            // LTR keeps MM/YY and CVV on one visible row. Page RTL clips that row.
            direction: sdk.Direction.LTR,
          },
          onReady: () => {
            readyRef.current = true;
            if (!cancelled) setReady(true);
            expandTapCardFrame(document.getElementById(CARD_MOUNT_ID), frameHeightRef.current);
            onReadyRef.current?.();
          },
          onError: (data: unknown) => {
            reportCardProblem(readTapCardError(data));
          },
          onSuccess: (data: { id?: string }) => {
            const tokenId = String(data?.id || '');
            if (tokenId.startsWith('tok_')) onTokenRef.current(tokenId);
          },
        });
        unmountCard = mounted?.unmount;
        expandTapCardFrame(document.getElementById(CARD_MOUNT_ID), frameHeightRef.current);
      } catch (error) {
        if (cancelled) return;
        reportCardProblem(
          error instanceof Error ? error.message : 'Could not load card form'
        );
      }
    }

    void mount();
    return () => {
      cancelled = true;
      try {
        unmountCard?.();
      } catch {
        /* SDK may already be gone */
      }
    };
  }, [amount, isRtl, method]);

  return (
    <div className="space-y-2" dir="ltr">
      <style>{`
        #${CARD_MOUNT_ID},
        #${CARD_MOUNT_ID} > div {
          width: 100%;
          min-height: ${frameHeight}px;
          height: auto;
          overflow: visible;
          direction: ltr;
        }
        #${CARD_MOUNT_ID} iframe {
          display: block !important;
          width: 100% !important;
          min-height: ${frameHeight}px !important;
          height: ${frameHeight}px !important;
          max-height: none !important;
          overflow: visible !important;
          border: 0 !important;
        }
      `}</style>
      <div id={CARD_MOUNT_ID} className="tap-card-frame w-full" />
      {!ready && !loadError ? (
        <p className="text-xs font-medium text-slate-500">
          {isRtl ? 'جاري تحميل حقول البطاقة...' : 'Loading card fields...'}
        </p>
      ) : null}
      {loadError ? (
        <p className="text-xs font-bold text-red-600">{loadError}</p>
      ) : null}
    </div>
  );
}

export function tokenizeTapCard() {
  window.CardSDK?.tokenize();
}
