import React, { useState } from 'react';
import { ChevronDown, Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import {
  HAS_SUPPORT_PHONE,
  SUPPORT_EMAIL,
  supportMailto,
  supportTelHref,
} from '@/lib/supportContact';

const FAQ = [
  {
    qAr: 'كيف أحجز نقل حمولة؟',
    qEn: 'How do I book a load?',
    aAr: 'اختر نوع الخدمة، ثم حدّد موقع التحميل، ثم موقع التنزيل. بعد ظهور المسافة والتكلفة اضغط استمرار للدفع.',
    aEn: 'Choose the service, set the pickup, then the drop-off. When the distance and cost appear, tap Continue to pay.',
  },
  {
    qAr: 'هل يمكنني تغيير موقع التحميل بعد اختياره؟',
    qEn: 'Can I change the pickup after I confirm it?',
    aAr: 'نعم. قبل الدفع اضغط تعديل المواقع وارجع إلى الخطوة الأولى.',
    aEn: 'Yes. Before payment, tap Edit locations and return to step 1.',
  },
  {
    qAr: 'متى يظهر السائق على الخريطة؟',
    qEn: 'When does the driver appear on the map?',
    aAr: 'بعد الدفع وقبول السائق للطلب. أثناء البحث عن سائق يبقى التتبع متوقفاً.',
    aEn: 'After payment and after a driver accepts. Tracking stays off while the app is still searching.',
  },
  {
    qAr: 'كيف أسجّل الدخول؟',
    qEn: 'How do I sign in?',
    aAr: 'برقم الجوال ورمز التحقق فقط. لا يوجد دخول بالبريد أو بجوجل.',
    aEn: 'With your mobile number and a one-time code only. Email and Google sign-in are not offered.',
  },
  {
    qAr: 'كيف أقيّم الخدمة؟',
    qEn: 'How do I rate the service?',
    aAr: 'بعد اكتمال الرحلة تظهر نجوم وتعليق. يمكنك أيضاً إرسال تقييم من الملف الشخصي أو من هذه الصفحة.',
    aEn: 'After the trip you can leave stars and a comment. You can also send feedback from your profile or this page.',
  },
];

export const SupportContactButtons: React.FC<{ isRtl: boolean }> = ({ isRtl }) => {
  const callSupport = () => {
    if (!HAS_SUPPORT_PHONE || !supportTelHref) {
      toast.message(
        isRtl
          ? `خط الاتصال غير مفعّل بعد. راسلنا على ${SUPPORT_EMAIL}`
          : `The phone line is not connected yet. Email ${SUPPORT_EMAIL}`
      );
      return;
    }
    window.location.href = supportTelHref;
  };

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <a
        href={supportMailto}
        className="min-h-16 rounded-3xl bg-[#FFCC00] text-black border-2 border-black font-black text-base flex items-center justify-center gap-2 px-4 text-center"
      >
        <Mail size={22} className="shrink-0" />
        <span>
          {isRtl ? 'البريد الإلكتروني' : 'Email'}
          <span className="block text-xs font-bold" dir="ltr">{SUPPORT_EMAIL}</span>
        </span>
      </a>
      <button
        type="button"
        onClick={callSupport}
        className="min-h-16 rounded-3xl bg-black text-[#FFCC00] border-2 border-black font-black text-base flex items-center justify-center gap-2"
      >
        <Phone size={22} />
        {isRtl ? 'اتصال مباشر' : 'Phone call'}
      </button>
    </div>
  );
};

export const SupportFaqList: React.FC<{ isRtl: boolean }> = ({ isRtl }) => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {FAQ.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.qEn} className="rounded-3xl border-2 border-black bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : index)}
              className={`w-full min-h-16 px-5 py-4 flex items-center justify-between gap-3 text-base font-black ${isRtl ? 'text-right' : 'text-left'}`}
              aria-expanded={expanded}
            >
              <span>{isRtl ? item.qAr : item.qEn}</span>
              <ChevronDown size={22} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            {expanded && (
              <p className={`px-5 pb-5 text-base font-medium text-neutral-800 leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
                {isRtl ? item.aAr : item.aEn}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
