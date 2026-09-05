import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { verifyPaymentReturn } from '@/lib/paymentReturnService';
import { getActiveCheckoutDraftId } from '@/lib/checkoutDraft';
import {
  clearPendingCheckoutDraftId,
  readPendingCheckoutDraftId,
} from '@/lib/pendingCheckout';
import { rememberCustomerOrderId } from '@/lib/customerOrderMemory';
import { promoteSharedOrderToBroadcasting } from '@/lib/localOrderBridge';
import { buildClientOrdersPath } from '@/lib/authRouting';
import { allowsSandboxCheckout } from '@/lib/checkoutGating';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import { auth } from '@/lib/firebase';

/**
 * Moyasar redirects here after checkout (callback_url).
 * Order is created + broadcast only after payment verification succeeds.
 */
const PaymentCallbackPage: React.FC = () => {
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState(
    isRtl ? 'جاري التحقق من الدفع...' : 'Verifying payment...'
  );
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function handleReturn() {
      try {
        await ensureSignedInFirebaseUid(12000);
      } catch (error) {
        console.warn('[payments] Auth not ready on payment return:', error);
      }

      const draftId =
        searchParams.get('draftId') ||
        readPendingCheckoutDraftId() ||
        getActiveCheckoutDraftId();
      const legacyOrderId = searchParams.get('orderId');
      const moyasarId = searchParams.get('id');
      const status = searchParams.get('status');
      const failedStatuses = new Set(['failed', 'voided', 'cancelled']);

      if (!draftId && !legacyOrderId && !moyasarId) {
        if (!cancelled) {
          setState('error');
          setMessage(isRtl ? 'لم يتم العثور على جلسة الدفع' : 'Checkout session not found');
          setTimeout(
            () => navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true }),
            1800
          );
        }
        return;
      }

      if (status && failedStatuses.has(status.toLowerCase())) {
        clearPendingCheckoutDraftId();
        if (!cancelled) {
          setState('error');
          setMessage(isRtl ? 'فشل الدفع أو تم إلغاؤه' : 'Payment failed or was cancelled');
          setTimeout(
            () => navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true }),
            1800
          );
        }
        return;
      }

      try {
        const result = await verifyPaymentReturn({
          draftId,
          orderId: legacyOrderId,
          moyasarId,
          status,
        });

        clearPendingCheckoutDraftId();

        if (cancelled) return;

        if (!result.success || result.paymentStatus === 'failed') {
          setState('error');
          setMessage(
            result.message ||
              (isRtl ? 'فشل التحقق من الدفع' : 'Payment was not completed')
          );
          setTimeout(
            () => navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true }),
            1800
          );
          return;
        }

        setState('success');
        setMessage(isRtl ? 'تم الدفع بنجاح — جاري فتح طلباتي...' : 'Payment successful — opening My Orders...');
        const uid = auth.currentUser?.uid || '';
        if (uid && result.orderId) {
          rememberCustomerOrderId(uid, result.orderId);
        }
        navigate(
          buildClientOrdersPath({
            placed: result.orderId,
            payment: 'success',
          }),
          { replace: true }
        );
      } catch (error) {
        console.error('Payment return verification failed:', error);
        const id = draftId || legacyOrderId || '';
        const isDemo =
          id.startsWith('demo-') ||
          id.startsWith('draft-') ||
          moyasarId === 'demo' ||
          (moyasarId?.startsWith('demo-') ?? false) ||
          (error instanceof Error && error.message === 'DEV_BYPASS_NO_FIREBASE_SESSION');
        if (allowsSandboxCheckout() && isDemo && status && !failedStatuses.has(status.toLowerCase())) {
          try {
            await promoteSharedOrderToBroadcasting(id);
            clearPendingCheckoutDraftId();
            if (!cancelled) {
              setState('success');
              setMessage(
                isRtl ? 'تم الدفع بنجاح — جاري فتح طلباتي...' : 'Payment successful — opening My Orders...'
              );
              navigate(
                buildClientOrdersPath({
                  placed: id,
                  payment: 'success',
                }),
                { replace: true }
              );
            }
            return;
          } catch (promoteErr) {
            console.warn('[payments] Demo fallback promote failed:', promoteErr);
          }
        }
        if (!cancelled) {
          setState('error');
          setMessage(isRtl ? 'تعذر التحقق من الدفع' : 'Could not verify payment');
          setTimeout(
            () => navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true }),
            1800
          );
        }
      }
    }

    handleReturn();
    return () => {
      cancelled = true;
    };
  }, [isRtl, navigate, searchParams]);

  return (
            <div className="min-h-dvh flex items-center justify-center bg-[#fcfcfc] p-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-md w-full bg-white rounded-[32px] border border-gray-100 shadow-xl p-10 text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
          {state === 'error' ? (
            <AlertCircle className="text-red-500" size={32} />
          ) : state === 'success' ? (
            <CheckCircle2 className="text-green-600" size={32} />
          ) : (
            <BrandLogo size={36} className="animate-pulse" />
          )}
        </div>
        <p className="text-sm font-bold text-gray-700">{message}</p>
        {state === 'loading' && (
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        )}
      </div>
    </div>
  );
};

export default PaymentCallbackPage;
