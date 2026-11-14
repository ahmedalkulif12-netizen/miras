import React from 'react';

/** Customer receipt: service price and the customer service fee only. */
export const CustomerTripInvoice: React.FC<{
  isRtl: boolean;
  service: string;
  detail?: string;
  from?: string;
  to?: string;
  fare: number;
  fee: number;
  total: number;
  currency: string;
  feeWaived?: boolean;
}> = ({ isRtl, service, detail, from, to, fare, fee, total, currency, feeWaived }) => (
  <div className={`rounded-3xl border border-stone-200 bg-white p-5 space-y-4 ${isRtl ? 'text-right' : 'text-left'}`}>
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
        {isRtl ? 'فاتورة العميل' : 'Customer invoice'}
      </p>
      <p className="mt-1 text-lg font-black">{service}</p>
      {detail ? <p className="text-xs font-bold text-stone-500 mt-1">{detail}</p> : null}
    </div>
    <div className="space-y-2 text-sm">
      {from ? (
        <p>
          <span className="font-bold text-stone-400">{isRtl ? 'من' : 'From'}: </span>
          {from}
        </p>
      ) : null}
      {to ? (
        <p>
          <span className="font-bold text-stone-400">{isRtl ? 'إلى' : 'To'}: </span>
          {to}
        </p>
      ) : null}
    </div>
    <div className="space-y-2 border-t border-dashed border-stone-200 pt-3 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-stone-500">{isRtl ? 'سعر الخدمة' : 'Service price'}</span>
        <span className="font-bold font-mono" dir="ltr">{fare.toFixed(2)} {currency}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-stone-500">{isRtl ? 'رسوم الخدمة 5%' : 'Service fee 5%'}</span>
        <span className={`font-bold font-mono ${feeWaived ? 'line-through text-stone-300' : ''}`} dir="ltr">
          {fee.toFixed(2)} {currency}
        </span>
      </div>
      {feeWaived ? (
        <p className="text-[11px] font-bold text-emerald-600">{isRtl ? 'رسوم الخدمة مجانية' : 'Service fee waived'}</p>
      ) : null}
      <div className="flex justify-between gap-3 border-t border-stone-100 pt-2 text-base font-black">
        <span>{isRtl ? 'الإجمالي' : 'Total'}</span>
        <span className="font-mono" dir="ltr">{total.toFixed(2)} {currency}</span>
      </div>
    </div>
  </div>
);
