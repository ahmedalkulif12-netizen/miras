import React, { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';

const TAP_CARD_SDK_URL = 'https://tap-sdks.b-cdn.net/card/1.0.2/index.js';
const CARD_MOUNT_ID = 'tap-card-frame';
/** SDK hardcodes the card iframe at 95px, which hides the MM/YY and CVV row. */
const CARD_FRAME_HEIGHT_PX = 320;

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

/** Keep the Tap iframe tall enough that expiry (MM/YY) and CVV are not clipped. */
function expandTapCardFrame(root: HTMLElement | null) {
  if (!root) return;
  root.style.overflow = 'visible';
  root.style.minHeight = `${CARD_FRAME_HEIGHT_PX}px`;
  root.querySelectorAll('iframe').forEach((frame) => {
    if (frame.style.height === `${CARD_FRAME_HEIGHT_PX}px` && frame.style.minHeight === `${CARD_FRAME_HEIGHT_PX}px`) {
      return;
    }
    frame.style.display = 'block';
    frame.style.width = '100%';
    frame.style.minHeight = `${CARD_FRAME_HEIGHT_PX}px`;
    frame.style.height = `${CARD_FRAME_HEIGHT_PX}px`;
    frame.style.maxHeight = 'none';
    frame.style.overflow = 'visible';
    frame.style.border = '0';
    frame.setAttribute('height', String(CARD_FRAME_HEIGHT_PX));
  });
}

export function TapCardFrame({
  amount,
  method,
  isRtl,
  onToken,
  onError,
  onReady,
}: {
  amount: number;
  method: TapCardMethod;
  isRtl: boolean;
  onToken: (tokenId: string) => void;
  onError: (message: string) => void;
  onReady?: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  onTokenRef.current = onToken;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin).includes('tap.company')) return;
      const payload = event.data as {
        event?: string;
        data?: { errors?: { description?: string }[] };
      };
      if (payload?.event !== 'error') return;
      const description = payload.data?.errors?.[0]?.description || 'Card form error';
      onErrorRef.current(description);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const root = document.getElementById(CARD_MOUNT_ID);
    expandTapCardFrame(root);
    if (!root) return;
    const observer = new MutationObserver(() => expandTapCardFrame(root));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'height'],
    });
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    let cancelled = false;
    let unmountCard: (() => void) | undefined;

    async function mount() {
      try {
        const response = await authFetch('/api/payments/tap-config');
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, 'Tap is not configured'));
        }
        const config = await readApiJson<{ publicKey: string; merchantId?: string }>(response);
        await loadTapCardScript();
        const sdk = window.CardSDK;
        if (!sdk || cancelled) return;

        const brands =
          method === 'mada' ? ['MADA'] : ['VISA', 'MASTERCARD'];
        const mounted = sdk.renderTapCard(CARD_MOUNT_ID, {
          publicKey: config.publicKey,
          ...(config.merchantId ? { merchant: { id: config.merchantId } } : {}),
          transaction: {
            amount: Number(amount.toFixed(2)),
            currency: sdk.Currencies.SAR,
          },
          acceptance: {
            supportedBrands: brands,
            supportedCards: 'ALL',
          },
          fields: {
            cardHolder: true,
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
            if (!cancelled) setReady(true);
            expandTapCardFrame(document.getElementById(CARD_MOUNT_ID));
            onReadyRef.current?.();
          },
          onError: (data: { message?: string; description?: string } | string) => {
            const message =
              typeof data === 'string'
                ? data
                : data?.description || data?.message || 'Card form error';
            onErrorRef.current(message);
          },
          onSuccess: (data: { id?: string }) => {
            const tokenId = String(data?.id || '');
            if (tokenId.startsWith('tok_')) onTokenRef.current(tokenId);
          },
        });
        unmountCard = mounted?.unmount;
        expandTapCardFrame(document.getElementById(CARD_MOUNT_ID));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not load card form';
        setLoadError(message);
        onErrorRef.current(message);
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
          min-height: ${CARD_FRAME_HEIGHT_PX}px;
          height: auto;
          overflow: visible;
          direction: ltr;
        }
        #${CARD_MOUNT_ID} iframe {
          display: block !important;
          width: 100% !important;
          min-height: ${CARD_FRAME_HEIGHT_PX}px !important;
          height: ${CARD_FRAME_HEIGHT_PX}px !important;
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
