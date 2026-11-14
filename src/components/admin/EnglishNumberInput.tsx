import React, { useState } from 'react';
import { parseEnglishNumber, toEnglishDigits } from '@/lib/englishDigits';

interface Props {
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
  max?: number;
  className?: string;
  ariaLabel?: string;
}

/** Text input locked to English digits so an Arabic page locale cannot show ٠-٩. */
export const EnglishNumberInput: React.FC<Props> = ({
  value,
  onChange,
  allowNegative = false,
  max,
  className,
  ariaLabel,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '0');

  const commit = (raw: string) => {
    const cleaned = toEnglishDigits(raw).replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
      onChange(0);
      return;
    }
    let next = parseEnglishNumber(cleaned);
    if (!allowNegative && next < 0) next = 0;
    if (max != null && next > max) next = max;
    onChange(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      lang="en"
      dir="ltr"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      value={shown}
      onFocus={() => setDraft(Number.isFinite(value) ? String(value) : '')}
      onBlur={() => {
        commit(draft ?? shown);
        setDraft(null);
      }}
      onChange={(event) => {
        const cleaned = toEnglishDigits(event.target.value).replace(
          allowNegative ? /[^0-9.-]/g : /[^0-9.]/g,
          ''
        );
        setDraft(cleaned);
        if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return;
        commit(cleaned);
      }}
      className={className || 'w-full p-3 rounded-xl bg-gray-50 font-mono tabular-nums'}
    />
  );
};
