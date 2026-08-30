import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface TermsConsentProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** Mandatory T&C + Privacy consent. Opens the combined `/legal` page. */
export const TermsConsent: React.FC<TermsConsentProps> = ({
  checked,
  onChange,
  disabled = false,
}) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  return (
    <label
      className={`flex items-start gap-3 p-4 bg-stone-50 rounded-2xl border transition-colors ${
        checked ? 'border-primary/40 bg-primary/5' : 'border-stone-100'
      } ${disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer hover:border-primary/20'}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-300 text-primary accent-primary cursor-pointer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`text-xs text-stone-600 leading-relaxed font-bold ${isRtl ? 'text-right' : 'text-left'}`}>
        {t('accept_terms_lead')}{' '}
        <Link
          to="/legal"
          className="text-neutral-900 underline underline-offset-2 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {t('accept_terms_link')}
        </Link>
        .
      </span>
    </label>
  );
};

export default TermsConsent;
