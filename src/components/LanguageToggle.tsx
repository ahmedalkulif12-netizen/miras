import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LanguageToggleProps {
  className?: string;
  compact?: boolean;
}

/** Shared AR/EN switch — lives in headers so it never overlays maps, CTAs, or nav. */
export const LanguageToggle: React.FC<LanguageToggleProps> = ({
  className = '',
  compact = false,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar');

  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(isAr ? 'en' : 'ar')}
      className={`inline-flex items-center justify-center shrink-0 rounded-full border border-stone-200 bg-white text-neutral-700 hover:bg-stone-50 active:scale-[0.98] transition-all ${
        compact ? 'h-9 w-9' : 'h-9 w-9 sm:h-10 sm:w-auto sm:gap-1.5 sm:px-3'
      } ${className}`}
      title={isAr ? 'Switch to English' : 'تحويل للعربية'}
      aria-label={isAr ? 'Switch to English' : 'تحويل للعربية'}
    >
      <Globe className="w-4 h-4 text-neutral-500" />
      {compact ? null : (
        <span className="hidden sm:inline text-[11px] font-black tracking-wide">
          {isAr ? 'EN' : 'AR'}
        </span>
      )}
    </button>
  );
};

export default LanguageToggle;
