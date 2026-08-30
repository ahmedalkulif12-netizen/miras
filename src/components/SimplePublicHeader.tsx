import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '@/components/BrandLogo';
import { LanguageToggle } from '@/components/LanguageToggle';

/** Marketing/legal top bar — logo, language, home. Avoids a second floating control. */
export const SimplePublicHeader: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-stone-100 app-header-safe">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <BrandLogo size={28} withChip withWordmark />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <Link
            to="/"
            className="text-sm font-bold flex items-center gap-1 hover:text-primary transition-colors whitespace-nowrap"
          >
            {t('return_to_home')}
            <ChevronRight size={18} className={isRtl ? 'rotate-180' : ''} />
          </Link>
        </div>
      </div>
    </header>
  );
};

export default SimplePublicHeader;
