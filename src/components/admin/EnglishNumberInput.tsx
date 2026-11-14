import React from 'react';
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
  return (
    <input
      type="text"
      inputMode="decimal"
      lang="en"
      dir="ltr"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      value={Number.isFinite(value) ? String(value) : '0'}
      onChange={(event) => {
        const cleaned = toEnglishDigits(event.target.value).replace(
          allowNegative ? /[^0-9.-]/g : /[^0-9.]/g,
          ''
        );
        let next = parseEnglishNumber(cleaned);
        if (!allowNegative && next < 0) next = 0;
        if (max != null && next > max) next = max;
        onChange(next);
      }}
      className={className || 'w-full p-3 rounded-xl bg-gray-50 font-mono tabular-nums'}
    />
  );
};
