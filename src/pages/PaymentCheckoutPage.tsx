import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CreditCard, ShieldCheck, X, CheckCircle2 } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { toast } from 'sonner';
import {
  getActiveCheckoutDraftId,
  loadCheckoutDraft,
} from '@/lib/checkoutDraft';
import {
  clearPendingCheckoutDraftId,
  persistPendingCheckoutDraftId,
  readPendingCheckoutDraftId,
} from '@/lib/pendingCheckout';
import { rememberCustomerOrderId } from '@/lib/customerOrderMemory';
import { verifyPaymentReturn } from '@/lib/paymentReturnService';
import { createPaymentIntent, type CheckoutPaymentMethod } from '@/lib/paymentService';
import { formatOrderServiceLabel } from '@/lib/serviceLabels';
import { allowsSandboxCheckout } from '@/lib/checkoutGating';
import { buildClientOrdersPath, CUSTOMER_SERVICES_PATH } from '@/lib/authRouting';
import { auth } from '@/lib/firebase';
import { TapCardFrame, tokenizeTapCard, type TapCardMethod } from '@/components/TapCardFrame';

/**
 * Explicit payment checkout screen (local/demo gateway stand-in).
 * User must confirm payment here — never auto-jumps to tracking.
 * Production Tap returns still land on /payment-callback.
 */
const PaymentCheckoutPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [paying, setPaying] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [useHostedCheckout, setUseHostedCheckout] = useState(false);
  const hostedStarted = React.useRef(false);

  const draftId =
    searchParams.get('draftId') ||
    readPendingCheckoutDraftId() ||
    getActiveCheckoutDraftId() ||
    '';

  const method = (searchParams.get('method') || 'mada').toLowerCase();
  const cardMethod: TapCardMethod | null =
    method === 'mada' || method === 'creditcard' ? method : null;
  const useTapCard = Boolean(cardMethod) && !allowsSandboxCheckout();

  const draft = useMemo(
    () => (draftId ? loadCheckoutDraft(draftId) : null),
    [draftId]
  );

  const amount = Number(draft?.financials?.customerTotal || 0);
  const serviceFee = Number(draft?.financials?.serviceFee || 0);
  const distanceKm = Number(draft?.distanceKm || 0);
  const methodLabel =
    method === 'applepay'
      ? isRtl
        ? 'Apple Pay'
        : 'Apple Pay'
      : method === 'creditcard'
        ? isRtl
          ? 'فيزا / ماستركارد'
          : 'Visa / Mastercard'
        : isRtl
          ? 'مدى'
          : 'Mada';

  const finishPaid = async (tapChargeId: string, status: string) => {
    persistPendingCheckoutDraftId(draftId);
    const result = await verifyPaymentReturn({
      draftId,
      tapChargeId,
      status,
    });
    clearPendingCheckoutDraftId();
    if (!result.success) {
      toast.error(
        result.message || (isRtl ? 'لم يكتمل الدفع' : 'Payment was not completed'),
        { id: 'gateway-pay' }
      );
      navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true });
      return;
    }
    toast.success(isRtl ? 'تم الدفع بنجاح' : 'Payment successful', { id: 'gateway-pay' });
    const uid = auth.currentUser?.uid || '';
    if (uid && result.orderId) rememberCustomerOrderId(uid, result.orderId);
    navigate(
      buildClientOrdersPath({ placed: result.orderId, payment: 'success' }),
      { replace: true }
    );
  };

  const payWithTapCard = () => {
    if (!draftId || amount <= 0) {
      toast.error(isRtl ? 'جلسة الدفع غير موجودة' : 'Checkout session missing');
      return;
    }
    setPaying(true);
    toast.loading(isRtl ? 'جاري التحقق من البطاقة...' : 'Checking card details...', {
      id: 'gateway-pay',
    });
    tokenizeTapCard();
  };

  const onTapToken = async (tokenId: string) => {
    try {
      const intent = await createPaymentIntent(
        draftId,
        method as CheckoutPaymentMethod,
        tokenId
      );
      const status = (intent.status || '').toLowerCase();
      const paid = status === 'captured' || status === 'authorized' || status === 'paid';
      if (intent.paymentUrl && !paid) {
        toast.success(isRtl ? 'جاري التحقق من البطاقة...' : 'Verifying your card...', {
          id: 'gateway-pay',
        });
        window.location.assign(intent.paymentUrl);
        return;
      }
      await finishPaid(intent.tapChargeId, intent.status || 'captured');
    } catch (error) {
      console.error('[payment-checkout] tap token charge failed:', error);
      const message = error instanceof Error ? error.message : '';
      toast.error(message || (isRtl ? 'فشل الدفع' : 'Payment failed'), { id: 'gateway-pay' });
      setPaying(false);
    }
  };

  const payOnHostedPage = async () => {
    if (!draftId || amount <= 0) {
      toast.error(isRtl ? 'جلسة الدفع غير موجودة' : 'Checkout session missing');
      hostedStarted.current = false;
      return;
    }
    setPaying(true);
    toast.loading(
      isRtl ? 'جاري فتح صفحة الدفع الآمنة...' : 'Opening the secure payment page...',
      { id: 'gateway-pay' }
    );
    try {
      const intent = await createPaymentIntent(draftId, method as CheckoutPaymentMethod);
      if (intent.sandbox || !intent.paymentUrl) {
        throw new Error(
          isRtl ? 'لم يُرجع تاب رابط الدفع' : 'Tap did not return a payment link'
        );
      }
      window.location.assign(intent.paymentUrl);
    } catch (error) {
      console.error('[payment-checkout] hosted checkout failed:', error);
      hostedStarted.current = false;
      const message = error instanceof Error ? error.message : '';
      toast.error(message || (isRtl ? 'فشل فتح الدفع' : 'Could not open payment'), {
        id: 'gateway-pay',
      });
      setPaying(false);
    }
  };

  const openHostedCheckout = () => {
    if (hostedStarted.current || cardReady) return;
    hostedStarted.current = true;
    setUseHostedCheckout(true);
    void payOnHostedPage();
  };

  const cancelPayment = () => {
    clearPendingCheckoutDraftId();
    toast.message(isRtl ? 'تم إلغاء الدفع' : 'Payment cancelled');
    navigate(CUSTOMER_SERVICES_PATH, { replace: true });
  };

  const confirmPayment = async () => {
    if (!draftId) {
      toast.error(isRtl ? 'جلسة الدفع غير موجودة' : 'Checkout session missing');
      navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true });
      return;
    }

    if (!allowsSandboxCheckout()) {
      toast.error(
        isRtl
          ? 'الدفع التجريبي غير متاح في الإنتاج'
          : 'Demo checkout is not available in production'
      );
      navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true });
      return;
    }

    setPaying(true);
    toast.loading(isRtl ? 'جاري تأكيد الدفع...' : 'Confirming payment...', {
      id: 'gateway-pay',
    });

    try {
      await finishPaid(`demo-checkout-${Date.now()}`, 'paid');
    } catch (error) {
      console.error('[payment-checkout] confirm failed:', error);
      toast.error(isRtl ? 'فشل تأكيد الدفع' : 'Payment confirmation failed', {
        id: 'gateway-pay',
      });
      navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true });
    } finally {
      setPaying(false);
    }
  };

  if (!draftId || !draft) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center bg-[#f7f7f8] p-6"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="max-w-md w-full space-y-4">
          <div className="flex justify-end">
            <LanguageToggle />
          </div>
        <div className="bg-white rounded-[28px] border border-gray-100 shadow-lg p-8 text-center space-y-4">
          <BrandLogo size={40} className="mx-auto" />
          <p className="text-sm font-bold text-gray-700">
            {isRtl ? 'لا توجد جلسة دفع نشطة' : 'No active checkout session'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/b2c/client', { replace: true })}
            className="w-full py-3 rounded-xl bg-black text-white font-bold text-sm"
          >
            {isRtl ? 'العودة للحجز' : 'Back to booking'}
          </button>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-dvh flex items-center justify-center bg-[#f0f2f5] p-4 sm:p-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-lg w-full space-y-4">
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
      <div className={`bg-white rounded-[32px] border border-gray-100 shadow-xl ${useTapCard ? 'overflow-visible' : 'overflow-hidden'}`}>
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ShieldCheck size={20} className="text-emerald-300" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/60 font-bold">
                {isRtl ? 'بوابة الدفع الآمنة' : 'Secure payment gateway'}
              </p>
              <p className="text-sm font-bold">JZ Logistics Checkout</p>
            </div>
          </div>
          <BrandLogo size={28} />
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3">
            {draft.serviceType ? (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-medium">
                  {isRtl ? 'الخدمة' : 'Service'}
                </span>
                <span className="font-bold text-right max-w-[60%]">
                  {(() => {
                    const details = (draft.serviceDetails || {}) as {
                      waterType?: string;
                      capacity?: string;
                      type?: string;
                    };
                    const label = formatOrderServiceLabel(draft.serviceType, details, t);
                    return label.subtitle
                      ? `${label.title} — ${label.subtitle}`
                      : label.title;
                  })()}
                </span>
              </div>
            ) : null}
            {Number.isFinite(distanceKm) && distanceKm > 0 ? (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-medium">
                  {isRtl ? 'المسافة' : 'Distance'}
                </span>
                <span className="font-bold">
                  {distanceKm.toFixed(1)} {isRtl ? 'كم' : 'km'}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">
                {isRtl ? 'رسوم الخدمة' : 'Service fee'}
              </span>
              <span className="font-bold">
                {serviceFee.toFixed(2)} {isRtl ? 'ر.س' : 'SAR'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">
                {isRtl ? 'المبلغ المستحق' : 'Amount due'}
              </span>
              <span className="font-black text-lg">
                {amount.toFixed(2)} {isRtl ? 'ر.س' : 'SAR'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">
                {isRtl ? 'طريقة الدفع' : 'Payment method'}
              </span>
              <span className="font-bold flex items-center gap-1.5">
                <CreditCard size={14} />
                {methodLabel}
              </span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>{isRtl ? 'مرجع المسودة' : 'Draft ref'}</span>
              <span className="font-mono">{draftId.slice(0, 18)}…</span>
            </div>
          </div>

          {useTapCard && cardMethod ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-slate-800">
                {isRtl ? 'بيانات البطاقة' : 'Card details'}
              </p>
              <TapCardFrame
                amount={amount}
                method={cardMethod}
                isRtl={isRtl}
                onReady={() => setCardReady(true)}
                onToken={(tokenId) => void onTapToken(tokenId)}
                onUnavailable={() => openHostedCheckout()}
                onError={(message) => {
                  setPaying(false);
                  toast.error(message, { id: 'gateway-pay' });
                }}
              />
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
              {isRtl
                ? 'لن يتم إنشاء الطلب أو البحث عن سائق إلا بعد تأكيد الدفع أدناه.'
                : 'The order is created and drivers are notified only after you confirm payment below.'}
            </p>
          )}

          <button
            type="button"
            disabled={paying || amount <= 0 || (useTapCard && !cardReady && !useHostedCheckout)}
            onClick={() =>
              void (useTapCard && cardReady
                ? payWithTapCard()
                : useTapCard
                  ? payOnHostedPage()
                  : confirmPayment())
            }
            className="w-full min-h-12 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <CheckCircle2 size={18} />
            {paying
              ? isRtl
                ? 'جاري الدفع...'
                : 'Processing…'
              : isRtl
                ? 'ادفع الآن'
                : 'Pay Now'}
          </button>

          <button
            type="button"
            disabled={paying}
            onClick={cancelPayment}
            className="w-full py-3 rounded-2xl border border-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center gap-2 hover:bg-gray-50 disabled:opacity-60"
          >
            <X size={16} />
            {isRtl ? 'إلغاء والعودة' : 'Cancel and go back'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default PaymentCheckoutPage;
