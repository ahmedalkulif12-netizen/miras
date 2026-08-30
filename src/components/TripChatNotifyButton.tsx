import React from 'react';
import { MessageSquare } from 'lucide-react';

export function ChatUnreadBadge({
  count,
  className = '',
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="absolute inset-0 rounded-full bg-rose-400 animate-ping opacity-70" />
      <span className="relative min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
        {count > 9 ? '9+' : count}
      </span>
    </span>
  );
}

export function TripChatNotifyButton({
  onClick,
  label,
  unreadCount,
  disabled,
  className = '',
}: {
  onClick: () => void;
  label: string;
  unreadCount: number;
  disabled?: boolean;
  className?: string;
}) {
  const hasUnread = unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative py-3 px-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
        hasUnread
          ? 'bg-rose-50 text-rose-800 border-2 border-rose-200 hover:bg-rose-100'
          : 'bg-gray-50 hover:bg-gray-100'
      } ${className}`}
    >
      <span className="relative inline-flex shrink-0">
        <MessageSquare size={16} className={hasUnread ? 'animate-pulse' : ''} />
        <ChatUnreadBadge
          count={unreadCount}
          className="absolute -top-2 -end-2.5"
        />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
