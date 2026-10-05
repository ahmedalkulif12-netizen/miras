import React from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '@/components/DashboardLayout';
import { ServiceFeedbackForm } from '@/components/ServiceFeedbackForm';
import { SupportContactButtons, SupportFaqList } from '@/components/SupportFaq';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';

const SupportBody: React.FC<{ isRtl: boolean; signedIn: boolean }> = ({ isRtl, signedIn }) => (
  <div className={`max-w-3xl mx-auto space-y-8 ${isRtl ? 'text-right' : 'text-left'}`}>
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-black">{isRtl ? 'أسئلة شائعة' : 'Frequently asked questions'}</h1>
          <p className="text-base font-medium text-neutral-700">
            {isRtl
              ? 'إجابات سريعة. الدعم عبر البريد support@jzlogistics.com أو اتصال مباشر فقط.'
              : 'Quick answers. Support is by email at support@jzlogistics.com or a direct phone call only.'}
          </p>
        </div>
        <SupportFaqList isRtl={isRtl} />
        <SupportContactButtons isRtl={isRtl} />
        {signedIn ? (
          <div className="bg-white border-2 border-black rounded-[32px] p-6 space-y-4">
            <h2 className="text-xl font-black">{isRtl ? 'قيّم الخدمة' : 'Rate the service'}</h2>
            <ServiceFeedbackForm isRtl={isRtl} />
          </div>
        ) : (
          <Link to="/login" className="inline-flex min-h-14 items-center font-black underline underline-offset-4">
            {isRtl ? 'سجّل الدخول لإرسال تقييم' : 'Sign in to send feedback'}
          </Link>
        )}
  </div>
);

const SupportPage: React.FC = () => {
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { profile } = useAuth();

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#F8F9FB] px-4 py-8">
        <Link to="/" className="inline-flex min-h-12 items-center font-black mb-6">
          {isRtl ? 'العودة' : 'Back'}
        </Link>
        <SupportBody isRtl={isRtl} signedIn={false} />
      </div>
    );
  }

  return (
    <DashboardLayout title={isRtl ? 'المساعدة والدعم' : 'Help and support'}>
      <SupportBody isRtl={isRtl} signedIn />
    </DashboardLayout>
  );
};

export default SupportPage;
