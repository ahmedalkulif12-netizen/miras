import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  countUnreadTripMessages,
  getTripChatLastRead,
  markTripChatRead,
  subscribeOrderChat,
  type TripChatSenderRole,
} from '@/lib/orderChat';

export function useTripChatUnread(input: {
  orderId: string | null | undefined;
  currentUserId: string;
  myRole: TripChatSenderRole;
  chatOpen: boolean;
  enabled?: boolean;
  isRtl: boolean;
  onOpen: () => void;
}): number {
  const [unreadCount, setUnreadCount] = useState(0);
  const chatOpenRef = useRef(input.chatOpen);
  const onOpenRef = useRef(input.onOpen);
  const toastedIdRef = useRef<string | null>(null);
  chatOpenRef.current = input.chatOpen;
  onOpenRef.current = input.onOpen;

  useEffect(() => {
    if (!input.chatOpen || !input.orderId || !input.currentUserId) return;
    markTripChatRead(input.orderId, input.currentUserId);
    setUnreadCount(0);
  }, [input.chatOpen, input.orderId, input.currentUserId]);

  useEffect(() => {
    const orderId = input.orderId;
    const uid = input.currentUserId;
    const enabled = input.enabled !== false;
    if (!enabled || !orderId || !uid) {
      setUnreadCount(0);
      return;
    }

    let hydrated = false;
    const unsub = subscribeOrderChat(orderId, (messages) => {
      if (chatOpenRef.current) {
        const last = messages[messages.length - 1];
        markTripChatRead(orderId, uid, last?.createdAt || Date.now());
        setUnreadCount(0);
        hydrated = true;
        return;
      }

      const incoming = countUnreadTripMessages(
        messages,
        uid,
        input.myRole,
        getTripChatLastRead(orderId, uid)
      );
      setUnreadCount(incoming.length);

      const latest = incoming[incoming.length - 1];
      if (!hydrated) {
        hydrated = true;
        if (latest) toastedIdRef.current = latest.id;
        return;
      }
      if (!latest || latest.id === toastedIdRef.current) return;
      toastedIdRef.current = latest.id;
      toast.info(input.isRtl ? 'رسالة جديدة في محادثة الرحلة' : 'New trip chat message', {
        id: `trip-chat-${orderId}`,
        description: latest.text.slice(0, 100),
        action: {
          label: input.isRtl ? 'فتح' : 'Open',
          onClick: () => onOpenRef.current(),
        },
      });
    });

    return () => unsub();
  }, [input.enabled, input.orderId, input.currentUserId, input.myRole, input.isRtl]);

  return unreadCount;
}
