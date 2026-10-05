import React from 'react';

/** Small circular portrait for admin lists. Falls back to the first letter of the name. */
export const AdminUserAvatar: React.FC<{
  name: string;
  photoURL?: string | null;
  size?: number;
}> = ({ name, photoURL, size = 36 }) => {
  const initial = (name || '?').trim().charAt(0) || '?';
  const url = typeof photoURL === 'string' && photoURL.startsWith('https://') ? photoURL : '';

  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0 bg-stone-100 border border-stone-200"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      className="rounded-full bg-[#FFCC00] text-black font-black flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.4)) }}
      aria-hidden
    >
      {initial}
    </span>
  );
};
