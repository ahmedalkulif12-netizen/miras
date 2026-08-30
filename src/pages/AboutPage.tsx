import React from 'react';
import { Shield, Clock, Globe, Info, Mail } from 'lucide-react';
import { SimplePublicHeader } from '@/components/SimplePublicHeader';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/supportContact';

const AboutPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  return (
    <div className="min-h-dvh bg-[#fcfcfc]">
      <SimplePublicHeader />

      <main className="pt-12 pb-20">
        <div className="max-w-7xl mx-auto px-4 space-y-24">
          {/* Hero */}
          <section className="text-center space-y-8 max-w-4xl mx-auto">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-5xl md:text-7xl font-extrabold leading-tight text-neutral-900"
            >
              {isRtl ? (
                <>نحن نبني <span className="text-primary">مستقبل النقل اللوجستي</span> في المنطقة</>
              ) : (
                <>We are building the <span className="text-primary">future of logistics</span> in the region</>
              )}
            </motion.h1>
            <div className="space-y-4">
              <p className="text-xl text-muted-foreground leading-relaxed">
                {t('about_hero_desc')}
              </p>
              <div className="bg-primary/5 p-6 rounded-3xl border border-primary/10 max-w-2xl mx-auto">
                <p className={`text-sm font-bold text-primary flex items-center justify-center gap-2 ${isRtl ? '' : 'flex-row-reverse'}`}>
                  <Info size={18} /> {t('important_clarification')}
                </p>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {t('clarification_desc')}
                </p>
              </div>
            </div>
          </section>

          {/* Features Grid */}
          <section className="grid md:grid-cols-3 gap-8">
            <AboutCard 
              icon={<Shield size={32} />}
              title={t('about_feature_reliability_title')}
              description={t('about_feature_reliability_desc')}
              isRtl={isRtl}
            />
            <AboutCard 
              icon={<Globe size={32} />}
              title={t('about_feature_coverage_title')}
              description={t('about_feature_coverage_desc')}
              isRtl={isRtl}
            />
            <AboutCard 
              icon={<Clock size={32} />}
              title={t('about_feature_247_support_title')}
              description={t('about_feature_247_support_desc')}
              isRtl={isRtl}
            />
          </section>

          {/* Content */}
          <section className={`bg-white p-12 md:p-20 rounded-[64px] border border-gray-100 shadow-sm grid lg:grid-cols-2 gap-16 items-center ${isRtl ? 'text-right' : 'text-left'}`}>
             <div className="space-y-8">
                <h2 className="text-4xl font-extrabold">{t('about_vision_title')}</h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  {t('about_vision_desc')}
                </p>
                <div className="space-y-4">
                   <div className={`flex items-center gap-4 ${isRtl ? '' : 'flex-row-reverse'}`}>
                      <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center font-bold">01</div>
                      <p className="font-bold">{t('vision_point_1')}</p>
                   </div>
                   <div className={`flex items-center gap-4 ${isRtl ? '' : 'flex-row-reverse'}`}>
                      <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center font-bold">02</div>
                      <p className="font-bold">{t('vision_point_2')}</p>
                   </div>
                   <div className={`flex items-center gap-4 ${isRtl ? '' : 'flex-row-reverse'}`}>
                      <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center font-bold">03</div>
                      <p className="font-bold">{t('vision_point_3')}</p>
                   </div>
                </div>
             </div>
             <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full"></div>
                <img 
                  src="https://images.unsplash.com/photo-1519003722822-6d51cf33c7c7?auto=format&fit=crop&q=80&w=1200" 
                  alt="Logistics Fleet" 
                  className="relative rounded-[48px] shadow-2xl object-cover aspect-video"
                  referrerPolicy="no-referrer"
                />
             </div>
          </section>

          {/* Contact CTA — support email only */}
          <section className="bg-black text-white p-12 md:p-20 rounded-[64px] text-center space-y-8 overflow-hidden relative">
             <div className={`absolute top-0 ${isRtl ? 'right-0' : 'left-0'} w-64 h-64 bg-primary/20 blur-[100px]`}></div>
             <h2 className="text-4xl font-extrabold relative z-10">{t('have_enquiry')}</h2>
             <p className="text-gray-400 relative z-10">{t('enquiry_desc')}</p>
             <a
               href={supportMailto}
               className="relative z-10 flex items-center gap-4 p-5 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors max-w-md mx-auto text-left"
               dir="ltr"
             >
               <Mail className="text-primary shrink-0" size={22} />
               <div>
                 <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{t('contact_email_label')}</p>
                 <p className="font-extrabold text-base break-all">{SUPPORT_EMAIL}</p>
               </div>
             </a>
             <div className="flex justify-center relative z-10">
                <a href={supportMailto} className="px-8 py-4 bg-primary text-black rounded-2xl font-extrabold hover:scale-105 transition-all">{t('contact_via_email')}</a>
             </div>
          </section>
        </div>
      </main>

      <footer className="py-12 border-t bg-white text-center text-gray-400 text-sm">
         &copy; {new Date().getFullYear()} {t('all_rights_reserved')}
      </footer>
    </div>
  );
};

const AboutCard: React.FC<{ icon: React.ReactNode, title: string, description: string, isRtl: boolean }> = ({ icon, title, description, isRtl }) => (
  <div className={`p-10 bg-white rounded-[48px] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-primary/5 transition-all space-y-6 ${isRtl ? 'text-right' : 'text-left'}`}>
    <div className={`w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary ${isRtl ? 'mr-0' : 'ml-0'}`}>
      {icon}
    </div>
    <h3 className="text-2xl font-extrabold">{title}</h3>
    <p className="text-muted-foreground leading-relaxed">{description}</p>
  </div>
);

export default AboutPage;
