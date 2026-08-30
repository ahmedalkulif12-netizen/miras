import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  sendOrderChatMessage,
  subscribeOrderChat,
  type TripChatMessage,
  type TripChatSenderRole,
} from '@/lib/orderChat';

interface OrderTripChatModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  senderRole: TripChatSenderRole;
  senderName: string;
  peerLabel: string;
  isRtl: boolean;
}

/**
 * In-app real-time chat for an assigned order (customer ↔ driver).
 */
export const OrderTripChatModal: React.FC<OrderTripChatModalProps> = ({
  open,
  onClose,
  orderId,
  senderRole,
  senderName,
  peerLabel,
  isRtl,
}) => {
  const [messages, setMessages] = useState<TripChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !orderId) return;
    setLoading(true);
    const unsub = subscribeOrderChat(
      orderId,
      (next) => {
        setMessages(next);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [open, orderId, isRtl]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  if (!open) return null;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendOrderChatMessage({
        orderId,
        text,
        senderRole,
        senderName,
      });
      setDraft('');
    } catch (err) {
      console.error('[orderChat] send failed:', err);
      const msg =
        err instanceof Error && err.message === 'CHAT_REQUIRES_FIREBASE_AUTH'
          ? isRtl
            ? 'سجّل الدخول بحساب حقيقي لإرسال الرسائل'
            : 'Sign in with a real account to send messages'
          : isRtl
            ? 'فشل إرسال الرسالة'
            : 'Failed to send message';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-chat-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md h-[min(85vh,640px)] sm:h-[min(80vh,600px)] bg-white sm:rounded-[28px] rounded-t-[28px] shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
        dir={isRtl ? 'rtl' : 'ltr'}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <MessageSquare size={18} />
            </div>
            <div className="min-w-0">
              <h2 id="trip-chat-title" className="font-bold text-sm truncate">
                {isRtl ? 'محادثة الرحلة' : 'Trip chat'}
              </h2>
              <p className="text-[11px] text-white/60 truncate">{peerLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-white/80"
            aria-label={isRtl ? 'إغلاق' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#f4f5f7]">
          {loading && (
            <p className="text-center text-xs text-gray-400 font-medium py-8">
              {isRtl ? 'جاري التحميل...' : 'Loading…'}
            </p>
          )}
          {!loading && messages.length === 0 && (
            <p className="text-center text-xs text-gray-400 font-medium py-8 px-6 leading-relaxed">
              {isRtl
                ? 'لا توجد رسائل بعد. اكتب رسالة للتنسيق حول الاستلام أو التسليم.'
                : 'No messages yet. Send a note to coordinate pickup or delivery.'}
            </p>
          )}
          {messages.map((m) => {
            const mine = m.senderRole === senderRole;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                    mine
                      ? 'bg-black text-white rounded-br-md'
                      : 'bg-white text-gray-800 border border-gray-100 rounded-bl-md'
                  }`}
                >
                  {!mine && m.senderName ? (
                    <p className="text-[10px] font-bold opacity-60 mb-0.5">
                      {m.senderName}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.createdAt > 0 ? (
                    <p
                      className={`text-[10px] mt-1 ${
                        mine ? 'text-white/50' : 'text-gray-400'
                      }`}
                    >
                      {new Date(m.createdAt).toLocaleTimeString(
                        isRtl ? 'ar-SA' : 'en-GB',
                        { hour: '2-digit', minute: '2-digit' }
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => void submit(e)}
          className="shrink-0 border-t border-gray-100 p-3 flex gap-2 bg-white"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder={isRtl ? 'اكتب رسالة...' : 'Type a message…'}
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium outline-none focus:border-gray-400"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="shrink-0 w-11 h-11 rounded-xl bg-black text-white flex items-center justify-center disabled:opacity-40"
            aria-label={isRtl ? 'إرسال' : 'Send'}
          >
            <Send size={18} className={isRtl ? 'rotate-180' : ''} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default OrderTripChatModal;
