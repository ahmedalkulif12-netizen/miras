import React from 'react';
/** Industrial yellow mark — generated from app_icon.png, or jz-logo.svg until that file is present. */
import badgeUrl from '@/components/jz-badge.png';

export const BRAND_NAME = 'JZ Logistics';
/** @deprecated Use BRAND_NAME. Kept so older imports keep resolving. */
export const MIRAS_ARABIC_NAME = BRAND_NAME;
/** @deprecated Use BRAND_NAME. Kept so older imports keep resolving. */
export const MIRAS_ENGLISH_NAME = BRAND_NAME;

type BrandLogoProps = {
  /** Display size in pixels (width & height of the circular mark). */
  size?: number;
  className?: string;
  /** Soft circular frame behind the badge (headers / loading). */
  withChip?: boolean;
  /** Show the JZ Logistics wordmark beside or below the mark. */
  withWordmark?: boolean;
  /** Stack wordmark under the icon (marketing/loading). Default: beside. */
  wordmarkBelow?: boolean;
  /** White wordmark for pitch-black headers. */
  onDark?: boolean;
  alt?: string;
};

/**
 * JZ Logistics lockup — industrial yellow mark + wordmark.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 32,
  className = '',
  withChip = false,
  withWordmark = false,
  wordmarkBelow = false,
  onDark = false,
  alt = BRAND_NAME,
}) => {
  const image = (
    <img
      src={badgeUrl}
      alt={alt}
      width={size}
      height={size}
      className={`object-contain select-none rounded-full ${className}`}
      draggable={false}
    />
  );

  const mark = withChip ? (
    <div
      className="rounded-full bg-white/90 p-1 shadow-lg shadow-primary/15 border border-stone-100/80 flex items-center justify-center shrink-0"
      style={{ width: size + 10, height: size + 10 }}
    >
      {image}
    </div>
  ) : (
    image
  );

  if (!withWordmark) {
    return mark;
  }

  const wordmark = (
    <span
      className={`font-brand-en font-black leading-none tracking-tight whitespace-nowrap ${
        onDark ? 'text-white' : 'text-black'
      } ${wordmarkBelow ? 'text-center mt-2' : ''}`}
      style={{ fontSize: Math.max(13, size * 0.42) }}
      dir="ltr"
      lang="en"
    >
      {BRAND_NAME}
    </span>
  );

  return (
    <div
      className={`inline-flex min-w-0 ${
        wordmarkBelow ? 'flex-col items-center' : 'flex-row items-center gap-2.5'
      }`}
    >
      {mark}
      {wordmark}
    </div>
  );
};

export default BrandLogo;
