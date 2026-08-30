import React from 'react';
import { Phone, X } from 'lucide-react';
import { formatPhoneDisplay, openNativeDialer, toTelHref } from '@/lib/phoneDial';

interface OrderDriverCallModalProps {
  open: boolean;
  onClose: () => void;
  driverName?: string;
  phone: string | null;
  isRtl: boolean;
  /** Override title (e.g. call customer from driver app). */
  title?: string;
}

/**
 * Shows a trip party phone with a native `tel:` dial action.
 */
export const OrderDriverCallModal: React.FC<OrderDriverCallModalProps> = ({
  open,
  onClose,
  driverName,
  phone,
  isRtl,
  title,
}) => {
  if (!open) return null;

  const telHref = toTelHref(phone);
  const display = phone ? formatPhoneDisplay(phone) : '';
  const heading =
    title || (isRtl ? 'اتصال بالسائق' : 'Call driver');

  const dial = () => {
    if (!openNativeDialer(phone)) {
      /* parent should only open when phone exists; keep guard */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-call-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[28px] bg-white shadow-2xl border border-gray-100 overflow-hidden"
        dir={isRtl ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id="driver-call-title" className="font-bold text-base">
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-50 text-gray-500"
            aria-label={isRtl ? 'إغلاق' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5 text-center">
          {driverName ? (
            <p className="text-sm font-bold text-gray-800">{driverName}</p>
          ) : null}

          {telHref ? (
            <>
              <a
                href={telHref}
                className="block font-mono text-2xl font-black tracking-wide text-neutral-900 dir-ltr"
                dir="ltr"
              >
                {display}
              </a>
              <button
                type="button"
                onClick={dial}
                className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2"
              >
                <Phone size={18} />
                {isRtl ? 'اتصال الآن' : 'Dial now'}
              </button>
            </>
          ) : (
            <p className="text-sm text-gray-500 font-medium leading-relaxed">
              {isRtl
                ? 'رقم الجوال غير متوفر لهذا الطلب بعد.'
                : 'Phone number is not available for this order yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderDriverCallModal;
