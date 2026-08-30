import React from 'react';
/** Raster badge matches approved artwork exactly (yellow circle, M, white diagonal road). */
import badgeUrl from '@/components/miras-badge.png';

export const MIRAS_ARABIC_NAME = 'مَرَاس';
export const MIRAS_ENGLISH_NAME = 'Miras';

type BrandLogoProps = {
  /** Display size in pixels (width & height of the circular mark). */
  size?: number;
  className?: string;
  /** Soft circular frame behind the badge (headers / loading). */
  withChip?: boolean;
  /**
   * Show brand wordmark: Arabic مَرَاس (Ruq'ah) above English Miras (bold sans).
   * Stacked below/beside the icon per brand lockup.
   */
  withWordmark?: boolean;
  /** Stack wordmark under the icon (marketing/loading). Default: beside. */
  wordmarkBelow?: boolean;
  alt?: string;
};

/**
 * Miras brand lockup — circular yellow badge + مَرَاس / Miras wordmark.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 32,
  className = '',
  withChip = false,
  withWordmark = false,
  wordmarkBelow = false,
  alt = `${MIRAS_ARABIC_NAME} ${MIRAS_ENGLISH_NAME}`,
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
      className={`flex flex-col min-w-0 ${wordmarkBelow ? 'items-center text-center mt-2' : 'items-start'}`}
      style={{ fontSize: size * 0.52 }}
    >
      <span
        className="font-brand-ar text-[1.35em] leading-none text-neutral-950"
        dir="rtl"
        lang="ar"
      >
        {MIRAS_ARABIC_NAME}
      </span>
      <span
        className="font-brand-en text-[0.72em] font-bold leading-none text-neutral-950 mt-1.5 tracking-wide"
        dir="ltr"
        lang="en"
      >
        {MIRAS_ENGLISH_NAME}
      </span>
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
