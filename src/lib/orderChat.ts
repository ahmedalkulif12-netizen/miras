/**
 * Real-time order trip chat — messages live under orders/{orderId}/messages.
 * Only the order customer and assigned driver may read/write (see firestore.rules).
 * Same-browser / local orders also sync via localStorage + BroadcastChannel.
 */

import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, ensureFirebaseReady } from '@/lib/firebase';
import { isDevBypassAuthSession } from '@/lib/authApi';

export type TripChatSenderRole = 'customer' | 'driver';

export interface TripChatMessage {
  id: string;
  orderId: string;
  text: string;
  senderId: string;
  senderRole: TripChatSenderRole;
  senderName: string;
  createdAt: number;
}

const MAX_TEXT = 1000;
const LOCAL_CHAT_PREFIX = 'miras_order_chat_';
const CHAT_READ_PREFIX = 'miras_chat_read_';
const CHAT_CHANNEL = 'miras-order-chat';
const CHAT_EVENT = 'miras-order-chat-changed';

export function resolveDriverPhoneFromOrder(order: {
  driver?: { phone?: string; id?: string } | null;
  driverPhone?: string | null;
  driverId?: string | null;
}): string | null {
  const nested = order.driver?.phone?.trim();
  if (nested) return nested;
  const top = typeof order.driverPhone === 'string' ? order.driverPhone.trim() : '';
  if (top) return top;
  return null;
}

function localChatKey(orderId: string): string {
  return `${LOCAL_CHAT_PREFIX}${orderId}`;
}

function loadLocalMessages(orderId: string): TripChatMessage[] {
  try {
    const raw = localStorage.getItem(localChatKey(orderId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TripChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalMessages(orderId: string, messages: TripChatMessage[]): void {
  try {
    localStorage.setItem(localChatKey(orderId), JSON.stringify(messages.slice(-150)));
    window.dispatchEvent(new CustomEvent(CHAT_EVENT, { detail: { orderId } }));
    try {
      const channel = new BroadcastChannel(CHAT_CHANNEL);
      channel.postMessage({ type: 'chat', orderId, messages });
      channel.close();
    } catch {
      /* BroadcastChannel unavailable */
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function persistLocalMessage(message: TripChatMessage): TripChatMessage[] {
  const next = mergeChatMessages(loadLocalMessages(message.orderId), [message]);
  saveLocalMessages(message.orderId, next);
  return next;
}

function messageDedupeKey(message: TripChatMessage): string {
  const bucket = Math.floor((message.createdAt || 0) / 15_000);
  return `${message.senderId}|${message.senderRole}|${message.text}|${bucket}`;
}

function mergeChatMessages(
  ...lists: TripChatMessage[][]
): TripChatMessage[] {
  const byId = new Map<string, TripChatMessage>();
  const bySoft = new Map<string, TripChatMessage>();
  for (const list of lists) {
    for (const message of list) {
      if (!message?.id || !message.text) continue;
      byId.set(message.id, message);
      const soft = messageDedupeKey(message);
      const existing = bySoft.get(soft);
      if (!existing || existing.id.startsWith('local-')) {
        bySoft.set(soft, message);
      }
    }
  }
  const preferred = new Map<string, TripChatMessage>();
  for (const message of bySoft.values()) {
    preferred.set(message.id, message);
  }
  for (const message of byId.values()) {
    if (!preferred.has(message.id) && !message.id.startsWith('local-')) {
      preferred.set(message.id, message);
    }
  }
  return [...preferred.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function parseCreatedAt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value && typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === 'function') {
      try {
        return ts.toMillis();
      } catch {
        /* ignore */
      }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  }
  return 0;
}

function subscribeLocalChat(
  orderId: string,
  onMessages: (messages: TripChatMessage[]) => void
): Unsubscribe {
  const emit = () => onMessages(loadLocalMessages(orderId));
  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<{ orderId?: string }>).detail;
    if (!detail?.orderId || detail.orderId === orderId) emit();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === localChatKey(orderId)) emit();
  };
  window.addEventListener(CHAT_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHAT_CHANNEL);
    channel.onmessage = (event) => {
      const data = event.data as { orderId?: string; messages?: TripChatMessage[] };
      if (data?.orderId !== orderId) return;
      if (Array.isArray(data.messages)) {
        onMessages(mergeChatMessages(loadLocalMessages(orderId), data.messages));
        return;
      }
      emit();
    };
  } catch {
    channel = null;
  }
  emit();
  return () => {
    window.removeEventListener(CHAT_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

export function subscribeOrderChat(
  orderId: string,
  onMessages: (messages: TripChatMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  let cancelled = false;
  let firestoreUnsub: Unsubscribe = () => undefined;
  let remote: TripChatMessage[] = [];
  let local: TripChatMessage[] = loadLocalMessages(orderId);

  const emit = () => {
    onMessages(mergeChatMessages(local, remote));
  };

  const localUnsub = subscribeLocalChat(orderId, (next) => {
    local = next;
    emit();
  });

  void (async () => {
    try {
      await ensureFirebaseReady();
      if (cancelled) return;
      const q = query(
        collection(db, 'orders', orderId, 'messages'),
        orderBy('createdAt', 'asc'),
        limit(150)
      );
      firestoreUnsub = onSnapshot(
        q,
        (snap) => {
          remote = snap.docs.map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            return {
              id: docSnap.id,
              orderId,
              text: String(data.text || ''),
              senderId: String(data.senderId || ''),
              senderRole: (data.senderRole === 'driver' ? 'driver' : 'customer') as TripChatSenderRole,
              senderName: String(data.senderName || ''),
              createdAt: parseCreatedAt(data.createdAt),
            };
          });
          emit();
        },
        (err) => {
          console.warn('[orderChat] Firestore listen failed — using local sync:', err);
          emit();
          if (local.length === 0) {
            onError?.(err);
          }
        }
      );
    } catch (err) {
      emit();
      if (local.length === 0) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => {
    cancelled = true;
    firestoreUnsub();
    localUnsub();
  };
}

function chatReadKey(orderId: string, readerId: string): string {
  return `${CHAT_READ_PREFIX}${orderId}_${readerId}`;
}

export function getTripChatLastRead(orderId: string, readerId: string): number {
  if (!orderId || !readerId) return 0;
  try {
    const raw = localStorage.getItem(chatReadKey(orderId, readerId));
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function markTripChatRead(
  orderId: string,
  readerId: string,
  at: number = Date.now()
): void {
  if (!orderId || !readerId) return;
  try {
    localStorage.setItem(chatReadKey(orderId, readerId), String(at));
  } catch {
    /* ignore */
  }
}

export function isOwnTripChatMessage(
  message: TripChatMessage,
  currentUserId: string,
  myRole: TripChatSenderRole
): boolean {
  if (currentUserId && message.senderId === currentUserId) return true;
  if (message.senderId === `local-${myRole}`) return true;
  return false;
}

export function countUnreadTripMessages(
  messages: TripChatMessage[],
  currentUserId: string,
  myRole: TripChatSenderRole,
  lastReadAt: number
): TripChatMessage[] {
  return messages.filter(
    (message) =>
      !isOwnTripChatMessage(message, currentUserId, myRole) &&
      message.createdAt > lastReadAt
  );
}

export async function sendOrderChatMessage(input: {
  orderId: string;
  text: string;
  senderRole: TripChatSenderRole;
  senderName: string;
}): Promise<void> {
  const text = input.text.trim().slice(0, MAX_TEXT);
  if (!text) {
    throw new Error('EMPTY_MESSAGE');
  }

  const uid = auth.currentUser?.uid || `local-${input.senderRole}`;
  const localMessage: TripChatMessage = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderId: input.orderId,
    text,
    senderId: uid,
    senderRole: input.senderRole,
    senderName:
      input.senderName.trim().slice(0, 80) ||
      (input.senderRole === 'driver' ? 'Driver' : 'Customer'),
    createdAt: Date.now(),
  };
  persistLocalMessage(localMessage);

  if (isDevBypassAuthSession() && !auth.currentUser) {
    return;
  }

  await ensureFirebaseReady();
  const firebaseUid = auth.currentUser?.uid;
  if (!firebaseUid) {
    return;
  }

  try {
    await addDoc(collection(db, 'orders', input.orderId, 'messages'), {
      orderId: input.orderId,
      text,
      senderId: firebaseUid,
      senderRole: input.senderRole,
      senderName: localMessage.senderName,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('[orderChat] Firestore send failed — kept local message:', error);
  }
}
