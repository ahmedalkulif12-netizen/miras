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
import { formatOrderServiceLabel } from '@/lib/serviceLabels';
import { allowsSandboxCheckout } from '@/lib/checkoutGating';
import { buildClientOrdersPath, CUSTOMER_SERVICES_PATH } from '@/lib/authRouting';
import { auth } from '@/lib/firebase';

/**
 * Explicit payment checkout screen (local/demo gateway stand-in).
 * User must confirm payment here — never auto-jumps to tracking.
 * Production Moyasar returns still land on /payment-callback.
 */
const PaymentCheckoutPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [paying, setPaying] = useState(false);

  const draftId =
    searchParams.get('draftId') ||
    readPendingCheckoutDraftId() ||
    getActiveCheckoutDraftId() ||
    '';

  const method = (searchParams.get('method') || 'mada').toLowerCase();

  const draft = useMemo(
    () => (draftId ? loadCheckoutDraft(draftId) : null),
    [draftId]
  );

  const amount = Number(draft?.financials?.customerTotal || 0);
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
      persistPendingCheckoutDraftId(draftId);
      const result = await verifyPaymentReturn({
        draftId,
        moyasarId: `demo-checkout-${Date.now()}`,
        status: 'paid',
      });

      clearPendingCheckoutDraftId();

      if (!result.success) {
        toast.error(
          result.message ||
            (isRtl ? 'لم يكتمل الدفع' : 'Payment was not completed'),
          { id: 'gateway-pay' }
        );
        navigate(buildClientOrdersPath({ payment: 'failed' }), { replace: true });
        return;
      }

      toast.success(isRtl ? 'تم الدفع بنجاح' : 'Payment successful', {
        id: 'gateway-pay',
      });
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
      className="min-h-dvh flex items-center justify-center bg-[#f0f2f5] p-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-md w-full space-y-4">
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
      <div className="bg-white rounded-[32px] border border-gray-100 shadow-xl overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ShieldCheck size={20} className="text-emerald-300" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/60 font-bold">
                {isRtl ? 'بوابة الدفع الآمنة' : 'Secure payment gateway'}
              </p>
              <p className="text-sm font-bold">Miras Checkout</p>
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

          <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
            {isRtl
              ? 'لن يتم إنشاء الطلب أو البحث عن سائق إلا بعد تأكيد الدفع أدناه.'
              : 'The order is created and drivers are notified only after you confirm payment below.'}
          </p>

          <button
            type="button"
            disabled={paying || amount <= 0}
            onClick={() => void confirmPayment()}
            className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <CheckCircle2 size={18} />
            {paying
              ? isRtl
                ? 'جاري الدفع...'
                : 'Processing…'
              : isRtl
                ? 'ادفع الآن وأكّد الطلب'
                : 'Pay now & confirm order'}
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
