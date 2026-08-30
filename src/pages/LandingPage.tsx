import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Clock, MapPin, Mail, Menu, X } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { getServiceIcon } from '@/lib/serviceIcons';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/supportContact';
import { useAuth } from '@/hooks/useAuth';
import {
  resolveLoginEntryPath,
  resolveRegisterEntryPath,
} from '@/lib/authRouting';
import { DevBypassPanel } from '@/components/DevBypassPanel';

const LandingPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { profile, loading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = () => setMobileNavOpen(false);

  const loginPath = resolveLoginEntryPath(loading ? null : profile);
  const registerPath = resolveRegisterEntryPath(loading ? null : profile);

  return (
    <div className="flex flex-col min-h-dvh bg-blue-50/50">
      {/* Header */}
      <header className="sticky top-0 w-full z-50 bg-blue-50/90 backdrop-blur-xl border-b border-stone-200/50 app-header-safe">
        <div className="max-w-7xl mx-auto px-4 py-4 md:py-5 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size={32} withChip withWordmark />
          </div>
          <nav className="hidden md:flex gap-10 text-sm font-semibold text-neutral-600">
            <a href="#services" className="hover:text-primary transition-colors">{t('services')}</a>
            <a href="#features" className="hover:text-primary transition-colors">{t('features')}</a>
            <a href="#contact" className="hover:text-primary transition-colors">{t('contact')}</a>
            <Link to="/admin/login" className="flex items-center gap-2 text-neutral-400 hover:text-neutral-900 transition-all group" title="إدارة المنصة">
              <Shield size={18} className="group-hover:fill-primary/20 group-hover:text-primary transition-all" />
              <span className="text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-all">للمدير</span>
            </Link>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageToggle className="hidden sm:inline-flex" />
            <Link
              to={loginPath}
              className="inline-flex px-3 sm:px-5 py-2 sm:py-2.5 rounded-full border border-neutral-200 text-xs sm:text-sm font-bold text-neutral-800 hover:bg-neutral-900 hover:text-white hover:border-neutral-900 transition-all shadow-sm text-center leading-tight"
            >
              {t('auth_login')}
            </Link>
            <Link
              to={registerPath}
              className="inline-flex px-3 sm:px-5 py-2 sm:py-2.5 rounded-full bg-neutral-900 text-white text-xs sm:text-sm font-bold hover:bg-neutral-800 transition-all shadow-sm text-center leading-tight"
            >
              {t('auth_register')}
            </Link>
            <LanguageToggle compact className="sm:hidden" />
            <button
              type="button"
              className="md:hidden w-11 h-11 rounded-2xl border border-neutral-200 bg-white flex items-center justify-center text-neutral-800"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {mobileNavOpen && (
          <div className="md:hidden border-t border-stone-200/70 bg-white/95 backdrop-blur-xl px-4 py-4 space-y-2">
            <a href="#services" onClick={closeMobileNav} className="block px-4 py-3 rounded-2xl font-bold text-neutral-800 hover:bg-stone-50">
              {t('services')}
            </a>
            <a href="#features" onClick={closeMobileNav} className="block px-4 py-3 rounded-2xl font-bold text-neutral-800 hover:bg-stone-50">
              {t('features')}
            </a>
            <a href="#contact" onClick={closeMobileNav} className="block px-4 py-3 rounded-2xl font-bold text-neutral-800 hover:bg-stone-50">
              {t('contact')}
            </a>
            <Link
              to={loginPath}
              onClick={closeMobileNav}
              className="block px-4 py-3 rounded-2xl font-bold text-center border border-neutral-200 text-neutral-800"
            >
              {t('auth_login')}
            </Link>
            <Link
              to={registerPath}
              onClick={closeMobileNav}
              className="block px-4 py-3 rounded-2xl font-bold text-center bg-neutral-900 text-white"
            >
              {t('auth_register')}
            </Link>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="relative pt-16 md:pt-24 pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="flex flex-col gap-8 relative z-10"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full w-fit">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
              <span className="text-primary font-bold tracking-wider text-[10px] uppercase">{t('first_logistics_platform')}</span>
            </div>
            <h1 className={`text-6xl md:text-8xl font-black leading-[1] text-neutral-900 tracking-tight ${isRtl ? 'text-right' : 'text-left'}`}>
              {t('hero_title').split(' ').slice(0, 2).join(' ')} <br />
              <span className="text-primary drop-shadow-sm">{t('hero_title').split(' ').slice(2).join(' ')}</span>
            </h1>
            <p className={`text-neutral-600 text-xl max-w-lg leading-relaxed font-medium ${isRtl ? 'text-right' : 'text-left'}`}>
              {t('hero_subtitle')}
            </p>
            <DevBypassPanel isRtl={isRtl} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            className="relative"
          >
            <div className="absolute inset-0 bg-primary/15 blur-[140px] rounded-full translate-x-10 translate-y-10"></div>
            <div className="relative p-3 bg-white/50 backdrop-blur-sm border border-white/50 rounded-[54px] shadow-2xl">
              <img
                src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=1200"
                alt="Logistics Services"
                className="relative rounded-[42px] object-cover aspect-[4/3] brightness-[1.02]"
                referrerPolicy="no-referrer"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Services Grid */}
      <section id="services" className="py-32 bg-white rounded-[60px] shadow-sm relative z-20 scroll-mt-28">
        <div className="max-w-7xl mx-auto px-4">
          <div className={`flex flex-col md:flex-row justify-between items-end gap-6 mb-20 ${isRtl ? 'text-right' : 'text-left'}`}>
            <div className="space-y-4">
              <h2 className="text-4xl md:text-5xl font-black text-neutral-900 tracking-tight">{t('logistics_services_title')}</h2>
              <p className="text-neutral-500 font-medium text-lg max-w-xl">{t('logistics_services_desc')}</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <ServiceCard
              icon={React.createElement(getServiceIcon('furniture_moving'), { className: 'w-10 h-10 text-primary' })}
              title={t('service_furniture_title')}
              description={t('service_furniture_desc')}
              isRtl={isRtl}
            />
            <ServiceCard
              icon={React.createElement(getServiceIcon('flatbed'), { className: 'w-10 h-10 text-primary' })}
              title={t('service_flatbed_title')}
              description={t('service_flatbed_desc')}
              isRtl={isRtl}
            />
            <ServiceCard
              icon={React.createElement(getServiceIcon('water_tanker'), { className: 'w-10 h-10 text-primary' })}
              title={t('service_water_tank_title')}
              description={t('service_water_tank_desc')}
              isRtl={isRtl}
            />
            <ServiceCard
              icon={React.createElement(getServiceIcon('heavy_equipment'), { className: 'w-10 h-10 text-primary' })}
              title={t('service_heavy_equip_title')}
              description={t('service_heavy_equip_desc')}
              isRtl={isRtl}
            />
            <ServiceCard
              icon={React.createElement(getServiceIcon('refrigerated'), { className: 'w-10 h-10 text-primary' })}
              title={t('service_refrigerated_title')}
              description={t('service_refrigerated_desc')}
              isRtl={isRtl}
            />
            <ServiceCard
              icon={React.createElement(getServiceIcon('distribution'), { className: 'w-10 h-10 text-primary' })}
              title={t('service_distribution_title')}
              description={t('service_distribution_desc')}
              isRtl={isRtl}
            />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-24 bg-neutral-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,184,0,0.15),transparent)]"></div>
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-12 relative z-10 text-center">
          <StatBox number="+10k" label={t('stat_trucks')} />
          <StatBox number="+150k" label={t('stat_operations')} />
          <StatBox number="+30" label={t('stat_cities')} />
          <StatBox number="24/7" label={t('stat_support')} />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-32 bg-blue-50/50 scroll-mt-28">
        <div className={`max-w-7xl mx-auto px-4 ${isRtl ? 'text-right' : 'text-left'}`}>
          <div className="text-center max-w-2xl mx-auto mb-24">
            <h2 className="text-4xl md:text-5xl font-black text-neutral-900 mb-6 tracking-tight">{t('why_miras')}</h2>
            <p className="text-neutral-500 text-lg font-medium">{t('why_miras_desc')}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-16">
            <FeatureItem
              icon={<Clock className="w-8 h-8" />}
              title={t('feature_pricing_title')}
              description={t('feature_pricing_desc')}
              isRtl={isRtl}
            />
            <FeatureItem
              icon={<Shield className="w-8 h-8" />}
              title={t('feature_security_title')}
              description={t('feature_security_desc')}
              isRtl={isRtl}
            />
            <FeatureItem
              icon={<MapPin className="w-8 h-8" />}
              title={t('feature_tracking_title')}
              description={t('feature_tracking_desc')}
              isRtl={isRtl}
            />
          </div>
        </div>
      </section>

      {/* Contact Us — support email only */}
      <section id="contact" className="py-28 bg-white relative scroll-mt-28">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-14 space-y-4">
            <h2 className="text-4xl md:text-5xl font-black text-neutral-900 tracking-tight">
              {t('contact_section_title')}
            </h2>
            <p className="text-neutral-500 text-lg font-medium leading-relaxed">
              {t('contact_section_desc')}
            </p>
          </div>

          <a
            href={supportMailto}
            className={`group flex items-start gap-5 p-8 rounded-[32px] bg-stone-50 border border-stone-100 hover:bg-white hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all ${isRtl ? 'text-right' : 'text-left'}`}
          >
            <div className="w-14 h-14 rounded-2xl bg-primary/15 text-neutral-900 flex items-center justify-center shrink-0 group-hover:bg-primary transition-colors">
              <Mail className="w-6 h-6" />
            </div>
            <div className="space-y-2 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                {t('contact_email_label')}
              </p>
              <p className="text-2xl font-black text-neutral-900 tracking-tight break-all" dir="ltr">
                {SUPPORT_EMAIL}
              </p>
            </div>
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto py-20 bg-white border-t border-stone-100">
        <div className={`max-w-7xl mx-auto px-4 grid md:grid-cols-4 gap-16 ${isRtl ? 'text-right' : 'text-left'}`}>
          <div className="flex flex-col gap-6">
            <div className={`flex items-center gap-3 ${isRtl ? '' : 'flex-row-reverse'}`}>
              <BrandLogo size={28} withChip withWordmark />
            </div>
            <p className="text-neutral-500 leading-relaxed font-medium">{t('footer_desc')}</p>
          </div>
          <div className="space-y-6">
            <h4 className="font-bold text-neutral-900 text-lg">{t('company')}</h4>
            <ul className="text-neutral-500 font-medium flex flex-col gap-3">
              <li>
                <Link to="/about" className="hover:text-primary transition-colors">
                  {t('about')}
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-primary transition-colors">
                  {t('terms_conditions')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-primary transition-colors">
                  {t('privacy_policy')}
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="font-bold text-neutral-900 text-lg">{t('support')}</h4>
            <ul className="text-neutral-500 font-medium flex flex-col gap-3">
              <li className="text-neutral-400 text-sm">{t('faq')} — {isRtl ? 'قريباً' : 'coming soon'}</li>
              <li>
                <a href="#contact" className="hover:text-primary transition-colors">
                  {t('contact')}
                </a>
              </li>
              <li>
                <a
                  href={supportMailto}
                  className="inline-flex items-center gap-2 hover:text-primary transition-colors break-all"
                  dir="ltr"
                >
                  <Mail size={14} className="shrink-0" />
                  <span className="font-semibold">{SUPPORT_EMAIL}</span>
                </a>
              </li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="font-bold text-neutral-900 text-lg">{t('admin_portal')}</h4>
            <div className="pt-2">
              <Link
                to="/admin/login"
                className="px-6 py-3 bg-neutral-900 text-white rounded-2xl text-sm font-bold inline-flex items-center gap-2 hover:bg-neutral-800 transition-all shadow-xl shadow-neutral-900/10 active:scale-95"
              >
                <Shield size={16} className="text-primary" /> {t('admin_login')}
              </Link>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 mt-20 pt-10 border-t border-stone-50 text-center text-[10px] font-black text-neutral-400 tracking-[0.2em] uppercase">
          &copy; {new Date().getFullYear()} {t('all_rights_reserved')}
        </div>
      </footer>
    </div>
  );
};

const StatBox: React.FC<{ number: string; label: string }> = ({ number, label }) => (
  <div className="flex flex-col gap-2">
    <h3 className="text-5xl font-black text-primary font-mono tracking-tighter">{number}</h3>
    <p className="text-neutral-400 text-sm font-bold tracking-widest">{label}</p>
  </div>
);

const FeatureItem: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  isRtl: boolean;
}> = ({ icon, title, description, isRtl }) => (
  <div className="flex flex-col items-center md:items-start gap-6 group">
    <div className="w-20 h-20 rounded-3xl bg-white shadow-xl shadow-primary/5 flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all duration-500">
      {icon}
    </div>
    <div className={`space-y-3 ${isRtl ? 'text-right' : 'text-left'}`}>
      <h3 className="text-2xl font-black text-neutral-900">{title}</h3>
      <p className="text-neutral-500 font-medium leading-relaxed">{description}</p>
    </div>
  </div>
);

const ServiceCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  isRtl: boolean;
}> = ({ icon, title, description, isRtl }) => (
  <div
    className={`p-8 rounded-[40px] bg-stone-50 border border-stone-100 hover:bg-white hover:shadow-2xl hover:shadow-primary/10 transition-all group overflow-hidden relative ${isRtl ? 'text-right' : 'text-left'}`}
  >
    <div
      className={`absolute top-0 ${isRtl ? 'right-0' : 'left-0'} w-24 h-24 bg-primary/5 rounded-bl-full translate-x-12 -translate-y-12 group-hover:translate-x-6 group-hover:-translate-y-6 transition-all duration-700`}
    ></div>
    <div
      className={`w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all ${isRtl ? 'ml-auto' : 'mr-auto'}`}
    >
      {icon}
    </div>
    <h3 className="text-xl font-black mb-4 text-neutral-900">{title}</h3>
    <p className="text-neutral-500 leading-relaxed font-sm font-medium">{description}</p>
  </div>
);

export default LandingPage;
