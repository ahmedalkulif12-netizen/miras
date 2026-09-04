import React, { useState, useEffect } from 'react';
import { Routes, Route, useLocation, useSearchParams, Navigate, useNavigate } from 'react-router-dom';
import DashboardLayout from '@/components/DashboardLayout';
import { ToggleRight, ToggleLeft, MapPin, Package, TrendingUp, Users, Clock, CheckCircle2, Navigation2, Truck, FileText, Upload, AlertCircle, UserCheck, ShieldAlert, Lock, UserX, ArrowRight, Star, DollarSign, CreditCard, ShieldCheck, Navigation, Wallet, Phone } from 'lucide-react';
import { DriverAccountStatus, Order } from '@/types';
import { fetchPricing, PricingConfig, auth, db, ensureFirebaseReady, waitForFirebaseAuthUid } from '@/lib/firebase';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import { defaultPricingForService } from '@/lib/pricingDefaults';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { collection, query, limit, onSnapshot, doc, getDoc, updateDoc, increment, setDoc, where } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { capturePayment } from '@/lib/paymentService';
import { acceptOrder, completeDriverOrder, transitionOrderStatus } from '@/lib/orderService';
import {
  isActiveTripStatus,
  isTerminalOrderStatus,
  getDriverPrimaryAction,
  getDriverNavPhase,
  normalizeOrderStatus,
  isOpenOfferStatus,
  DRIVER_OFFER_STATUSES,
} from '@/domain/order-status';
import {
  startDriverLocationBroadcast,
  stopDriverLocationBroadcast,
} from '@/lib/liveTracking';
import { publishDriverPresence } from '@/lib/driverPresence';
import { getCurrentPosition } from '@/lib/geolocation';
import { evaluateDispatchOffer } from '@/lib/dispatchOfferFilter';
import { resolveDispatchWindow, orderDispatchStartedAt } from '@/domain/dispatchMatching';
import { OPTION_LABELS } from '@/constants';
import {
  createDriverWithdrawal,
  fetchDriverBankDetails,
  fetchDriverWithdrawals,
  formatIbanDisplay,
  saveDriverBankDetailsApi,
  type DriverBankDetails,
  type WithdrawalRequest,
} from '@/lib/withdrawalService';

import { DriverTripMap, getOrderDropoffLatLng, getOrderPickupLatLng } from '@/components/DriverTripMap';
import DriverProfilePage from '@/pages/DriverProfilePage';
import { getDriverOfferMetrics } from '@/lib/driverOfferMetrics';
import { MIN_WITHDRAWAL_SAR } from '@/domain/financials';
import {
  applyLocalWalletCredit,
  loadLocalDriverWallet,
  mergeWalletViews,
  subscribeLocalDriverWallet,
  walletFromFirestoreData,
  type DriverWalletView,
} from '@/lib/localDriverWallet';
import { submitDriverRegistrationToApi } from '@/lib/submitDriverRegistration';
import {
  canStartWorkLocally,
  isLocalDevRuntime,
  persistLocalDevWorkEnabled,
  readLocalDevWorkEnabled,
} from '@/lib/localDevRuntime';
import { driverMatchesRequiredVehicle } from '@/domain/serviceCategories';
import {
  listLocalBroadcastingOrders,
  loadLocalBroadcastOrders,
  subscribeLocalBroadcastOrders,
  debugOrderPayload,
} from '@/lib/localOrderBridge';
import { formatOrderServiceLabel } from '@/lib/serviceLabels';
import { OrderDriverCallModal } from '@/components/OrderDriverCallModal';
import { OrderTripChatModal } from '@/components/OrderTripChatModal';
import { useTripChatUnread } from '@/hooks/useTripChatUnread';
import { TripChatNotifyButton } from '@/components/TripChatNotifyButton';
import { toTelHref } from '@/lib/phoneDial';

/** Whether this driver's vehicle category can take the offer (strict 6-category match). */
function driverMatchesOffer(
  vehicleType: string | undefined,
  order: Pick<Order, 'serviceType' | 'requiredVehicleType' | 'truckType'>
): boolean {
  return driverMatchesRequiredVehicle(vehicleType, order);
}

function OfferCustomerNotes({
  order,
  isRtl,
}: {
  order: Order;
  isRtl: boolean;
}) {
  const notes =
    order.vehicleFieldNotes || order.serviceDetails?.vehicleFieldNotes || null;
  const chips = [
    notes?.keyInside ? (isRtl ? 'المفتاح داخل السيارة' : 'Key inside') : null,
    notes?.tiresFlat ? (isRtl ? 'إطارات فارغة' : 'Flat tires') : null,
    notes?.brokenDown ? (isRtl ? 'السيارة متعطلة' : 'Broken down') : null,
  ].filter(Boolean) as string[];
  const extra = [
    typeof notes?.extraNotes === 'string' ? notes.extraNotes.trim() : '',
    typeof order.serviceDetails?.extraNotes === 'string'
      ? String(order.serviceDetails.extraNotes).trim()
      : '',
  ]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join('\n');
  const furniture =
    typeof order.serviceDetails?.furnitureDescription === 'string'
      ? order.serviceDetails.furnitureDescription.trim()
      : '';
  if (!chips.length && !extra && !furniture) return null;

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 space-y-2 shadow-sm">
      <div className={`flex items-center gap-2 ${isRtl ? '' : 'flex-row-reverse'}`}>
        <FileText size={16} className="text-amber-800 shrink-0" />
        <p className="text-sm font-black text-amber-950">
          {isRtl ? 'ملاحظات العميل' : 'Customer notes'}
        </p>
      </div>
      {chips.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${isRtl ? '' : 'flex-row-reverse'}`}>
          {chips.map((chip) => (
            <span
              key={chip}
              className="px-3 py-1.5 rounded-xl bg-white border border-amber-200 text-xs font-black text-amber-950"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
      {furniture ? (
        <p className={`text-sm font-bold text-amber-950 leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
          {furniture}
        </p>
      ) : null}
      {extra ? (
        <p className={`text-sm font-semibold text-amber-900/90 leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
          {extra}
        </p>
      ) : null}
    </div>
  );
}

/** Sort key for Firestore Timestamp | ISO string | millis — used after simple queries. */
function orderCreatedAtMs(data: { createdAt?: unknown }): number {
  const c = data.createdAt;
  if (c == null) return 0;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (typeof c === 'string') {
    const parsed = Date.parse(c);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof c === 'object') {
    const ts = c as { toMillis?: () => number; seconds?: number };
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

function driverTripEarnings(order: Order): number {
  return (
    Number(
      order.financials?.driverNet ??
        order.financials?.customerTotal ??
        (typeof order.price === 'number' ? order.price : 0)
    ) || 0
  );
}

function formatDriverOpDate(order: Order, isRtl: boolean): string {
  const ms = orderCreatedAtMs(order);
  if (!ms) return '';
  return new Date(ms).toLocaleString(isRtl ? 'ar-SA' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DriverDashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { profile, isDevBypass } = useAuth();
  const isRtl = i18n.language === 'ar';
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isOnline, setIsOnline] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [broadcastPool, setBroadcastPool] = useState<Order[]>([]);
  const [dispatchTick, setDispatchTick] = useState(0);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [iban, setIban] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [bankDetails, setBankDetails] = useState<DriverBankDetails | null>(null);
  const [myWithdrawals, setMyWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [savingBank, setSavingBank] = useState(false);
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);
  const [accountStatus, setAccountStatus] = useState<DriverAccountStatus>('pending');
  const [localDevWorkEnabled, setLocalDevWorkEnabled] = useState(false);
  const [activatingLocal, setActivatingLocal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [accountStatusLoaded, setAccountStatusLoaded] = useState(false);
  const canStartWork = canStartWorkLocally(accountStatus);
  const [hasComplaints, setHasComplaints] = useState(false);
  const [pricingConfig, setPricingConfig] = React.useState<PricingConfig | null>(null);
  const [latestOrder, setLatestOrder] = useState<Order | null>(null);
  const [remoteCompleted, setRemoteCompleted] = useState<Order[]>([]);
  const [localOpsEpoch, setLocalOpsEpoch] = useState(0);
  /** Last open offer — restored after trip completion so the driver can take the next job. */
  const pendingOfferRef = React.useRef<Order | null>(null);
  const [wallet, setWallet] = useState<DriverWalletView>(() =>
    loadLocalDriverWallet(profile?.uid || '')
  );
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [showCustomerCallModal, setShowCustomerCallModal] = useState(false);
  const [showTripChatModal, setShowTripChatModal] = useState(false);

  useEffect(() => {
    if (profile?.uid) {
      setLocalDevWorkEnabled(readLocalDevWorkEnabled(profile.uid));
    }
  }, [profile?.uid]);

  /** Live Firestore accountStatus — stays in sync with admin approvals. */
  useEffect(() => {
    if (!profile?.uid) return;

    if (isDevBypass) {
      setAccountStatus('approved');
      setLocalDevWorkEnabled(true);
      setAccountStatusLoaded(true);
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        await ensureFirebaseReady();
        let uid: string | null = auth.currentUser?.uid || (await waitForFirebaseAuthUid(4000));
        if (!uid) {
          try {
            uid = await ensureSignedInFirebaseUid(8000);
          } catch {
            uid = null;
          }
        }
        if (cancelled) return;
        if (!uid) {
          setAccountStatusLoaded(true);
          return;
        }

        const applyAccountStatus = (rawValue: unknown, extra?: Record<string, unknown>) => {
          const raw = String(rawValue || 'pending');
          let mapped: DriverAccountStatus = 'pending';
          if (raw === 'approved' || raw === 'active') mapped = 'approved';
          else if (raw === 'rejected') mapped = 'rejected';
          else if (raw === 'suspended') mapped = 'suspended';
          else if (raw === 'banned' || raw === 'blocked') mapped = 'banned';
          else if (raw === 'pending' || raw === 'pending_review' || raw === 'ready_for_review') {
            mapped = 'pending';
          }
          setAccountStatus(mapped);
          setLocalDevWorkEnabled(
            extra?.localDevWorkEnabled === true || readLocalDevWorkEnabled(uid)
          );
          setRejectionReason(
            extra?.rejectionReason ? String(extra.rejectionReason) : null
          );
          setAccountStatusLoaded(true);
        };

        const unsubs: Array<() => void> = [];
        let hasDriverDoc = false;
        unsubs.push(
          onSnapshot(
            doc(db, 'drivers', uid),
            (snap) => {
              if (!snap.exists()) {
                hasDriverDoc = false;
                setAccountStatus('pending');
                setLocalDevWorkEnabled(readLocalDevWorkEnabled(uid));
                setAccountStatusLoaded(true);
                if (profile.role === 'b2c_driver' || profile.role === 'driver') {
                  const hasDocs = Boolean(
                    profile.documentFiles &&
                      ['id', 'registration', 'permit', 'license'].every(
                        (key) =>
                          Boolean(
                            profile.documentFiles?.[
                              key as keyof typeof profile.documentFiles
                            ]?.storagePath
                          )
                      )
                  );
                  if (hasDocs) {
                    void submitDriverRegistrationToApi(profile).catch((err) =>
                      console.warn('[driver] registration backfill failed:', err)
                    );
                  }
                }
                return;
              }
              hasDriverDoc = true;
              const data = snap.data() as Record<string, unknown>;
              applyAccountStatus(data.accountStatus, data);
            },
            (err) => {
              console.warn('[driver] accountStatus listener failed:', err);
              setAccountStatusLoaded(true);
            }
          )
        );
        unsubs.push(
          onSnapshot(
            doc(db, 'users', uid),
            (snap) => {
              if (!snap.exists() || hasDriverDoc) return;
              const data = snap.data() as Record<string, unknown>;
              if (data.accountStatus) {
                applyAccountStatus(data.accountStatus, data);
              } else {
                setAccountStatusLoaded(true);
              }
            },
            (err) => {
              console.warn('[driver] users profile listener failed:', err);
            }
          )
        );
        unsubscribe = () => unsubs.forEach((fn) => fn());
      } catch (err) {
        console.warn('[driver] accountStatus bootstrap failed:', err);
        if (!cancelled) setAccountStatusLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [profile, isDevBypass]);

  /** Only go online from deep-link when the account can start work. */
  useEffect(() => {
    if (!accountStatusLoaded) return;
    if (searchParams.get('online') === '1' && canStartWork) {
      setIsOnline(true);
    } else if (!canStartWork) {
      setIsOnline(false);
    }
  }, [searchParams, canStartWork, accountStatusLoaded]);

  React.useEffect(() => {
    if (!profile?.uid) return;

    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    void (async () => {
      try {
        await ensureFirebaseReady();
        let driverUid: string | null = auth.currentUser?.uid || null;
        try {
          driverUid = await ensureSignedInFirebaseUid(8000);
        } catch {
          driverUid = await waitForFirebaseAuthUid(3000);
        }
        if (cancelled) return;
        if (!driverUid) {
          console.warn(
            '[driver] No live Firebase Auth session — Firestore offer listeners skipped. Sign in (or enable Anonymous Auth for guest login).'
          );
          setWallet(loadLocalDriverWallet(profile.uid));
          return;
        }

        try {
          const config = await fetchPricing();
          setPricingConfig(config);
        } catch (err) {
          console.warn('[pricing] Driver dashboard using built-in rates:', err);
          setPricingConfig(defaultPricingForService('flatbed'));
        }

        if (cancelled) return;

        let offersUnsub: (() => void) | null = null;
        unsubscribers.push(() => {
          offersUnsub?.();
          offersUnsub = null;
        });

        const bindOffersListener = (
          offersQuery: ReturnType<typeof query>,
          label: string
        ) => {
          console.info('[driver] LISTEN query', {
            label,
            filter: `status in [${DRIVER_OFFER_STATUSES.join(', ')}]`,
            authUid: driverUid,
            isOnline,
            vehicleType: profile.vehicleType || null,
          });
          offersUnsub?.();
          offersUnsub = onSnapshot(
            offersQuery,
            (snapshot) => {
              const matches = snapshot.docs.map((orderDoc) => {
                const data = orderDoc.data() as Order;
                return { id: orderDoc.id, ...data } as Order;
              });
              console.info(
                '[driver] LISTEN snapshot',
                matches.map((order) =>
                  debugOrderPayload(order.id, order as unknown as Record<string, unknown>)
                )
              );
              setBroadcastPool((prev) => {
                const remoteOpen = matches.filter(
                  (order) =>
                    isOpenOfferStatus(order.status) &&
                    !isTerminalOrderStatus(order.status)
                );
                const localOnly = prev.filter(
                  (order) =>
                    remoteOpen.every((remote) => remote.id !== order.id) &&
                    isOpenOfferStatus(order.status) &&
                    !isTerminalOrderStatus(order.status)
                );
                return [...remoteOpen, ...localOnly].sort(
                  (a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a)
                );
              });
            },
            (error) => {
              console.error('Firestore Error in DriverDashboard (offers):', error, label);
              if (label === 'open-in') {
                bindOffersListener(
                  query(
                    collection(db, 'orders'),
                    where('status', '==', 'broadcasting'),
                    limit(80)
                  ),
                  'broadcasting-only'
                );
              }
            }
          );
        };

        bindOffersListener(
          query(
            collection(db, 'orders'),
            where('status', 'in', DRIVER_OFFER_STATUSES),
            limit(80)
          ),
          'open-in'
        );

        const activeQuery = query(
          collection(db, 'orders'),
          where('driverId', '==', driverUid),
          limit(40)
        );

        unsubscribers.push(
          onSnapshot(
            activeQuery,
            (snapshot) => {
              const mine = snapshot.docs.map((orderDoc) => {
                const data = orderDoc.data() as Order;
                return { id: orderDoc.id, ...data } as Order;
              });
              const active = mine
                .filter(
                  (order) =>
                    isActiveTripStatus(order.status) &&
                    !isTerminalOrderStatus(order.status)
                )
                .sort((a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a))[0];

              setRemoteCompleted(
                mine
                  .filter((order) => normalizeOrderStatus(order.status) === 'completed')
                  .sort((a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a))
                  .slice(0, 8)
              );

              if (active) {
                setLatestOrder(active);
              } else {
                setLatestOrder((prev) => {
                  if (
                    prev &&
                    isActiveTripStatus(prev.status) &&
                    !isTerminalOrderStatus(prev.status)
                  ) {
                    return prev;
                  }
                  if (prev && isTerminalOrderStatus(prev.status)) {
                    return pendingOfferRef.current;
                  }
                  return prev ?? pendingOfferRef.current;
                });
              }
            },
            (error) => {
              console.error('Firestore Error in DriverDashboard (active trip):', error);
            }
          )
        );

        unsubscribers.push(
          onSnapshot(
            doc(db, 'wallets', driverUid),
            (docSnap) => {
              const remote = docSnap.exists()
                ? walletFromFirestoreData(docSnap.data() as Record<string, unknown>)
                : null;
              const local = loadLocalDriverWallet(driverUid);
              setWallet(remote ? mergeWalletViews(remote, local) : local);
            },
            (error) => {
              console.error('Firestore Error in DriverDashboard (wallet):', error);
              setWallet(loadLocalDriverWallet(driverUid));
            }
          )
        );
      } catch (err) {
        console.error('DriverDashboard Firebase bootstrap failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsub) => unsub());
      stopDriverLocationBroadcast();
    };
  }, [profile?.uid]);

  /** Same-browser checkout: paid draft-* orders live in localStorage when Admin/Firestore write fails. */
  useEffect(() => {
    if (!isOnline) return;

    const applyLocalOffers = () => {
      const locals = listLocalBroadcastingOrders()
        .map((entry) => ({ id: entry.id, ...entry.data } as Order))
        .filter(
          (order) =>
            isOpenOfferStatus(order.status) &&
            !isTerminalOrderStatus(order.status) &&
            driverMatchesOffer(profile?.vehicleType, order)
        );
      setBroadcastPool((prev) => {
        const remote = prev.filter(
          (order) =>
            locals.every((local) => local.id !== order.id) &&
            isOpenOfferStatus(order.status) &&
            !isTerminalOrderStatus(order.status)
        );
        return [...remote, ...locals].sort(
          (a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a)
        );
      });
    };

    applyLocalOffers();
    return subscribeLocalBroadcastOrders(applyLocalOffers);
  }, [isOnline, profile?.uid, profile?.vehicleType]);

  useEffect(() => {
    const bump = () => setLocalOpsEpoch((n) => n + 1);
    bump();
    return subscribeLocalBroadcastOrders(bump);
  }, [profile?.uid]);

  useEffect(() => {
    if (!isOnline) return;
    const timer = window.setInterval(() => setDispatchTick((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    const evaluated = broadcastPool
      .filter(
        (order) =>
          isOpenOfferStatus(order.status) &&
          !isTerminalOrderStatus(order.status) &&
          driverMatchesOffer(profile?.vehicleType, order)
      )
      .map((order) => ({
        order,
        decision: evaluateDispatchOffer({
          order,
          driver: {
            lat: driverCoords?.lat,
            lng: driverCoords?.lng,
            vehicleType: profile?.vehicleType,
          },
          relaxMissingGps: true,
          relaxRadius: import.meta.env.DEV,
        }),
      }));
    console.info(
      '[driver] FILTER decisions (isOnline=',
      isOnline,
      ')',
      evaluated.map((row) => ({
        ...debugOrderPayload(row.order.id, row.order as unknown as Record<string, unknown>),
        visible: row.decision.visible,
        reason: row.decision.reason || 'ok',
        distanceKm: row.decision.distanceKm,
        requiredVehicleType:
          row.order.requiredVehicleType || row.order.serviceType || null,
        driverVehicleType: profile?.vehicleType || null,
      }))
    );
    const ranked = evaluated
      .filter((row) => row.decision.visible)
      .sort((a, b) => {
        const created = orderCreatedAtMs(b.order) - orderCreatedAtMs(a.order);
        if (created !== 0) return created;
        return (a.decision.distanceKm ?? 9999) - (b.decision.distanceKm ?? 9999);
      });

    const offer = ranked[0]?.order ?? null;
    pendingOfferRef.current = offer;
    setLatestOrder((prev) => {
      if (prev && isActiveTripStatus(prev.status) && !isTerminalOrderStatus(prev.status)) {
        return prev;
      }
      return offer;
    });
  }, [
    isOnline,
    broadcastPool,
    driverCoords,
    dispatchTick,
    profile?.vehicleType,
  ]);

  // Live GPS publisher — orders/{orderId}/tracking/live (Firestore rules: assigned driver only)
  React.useEffect(() => {
    if (!profile?.uid || !latestOrder || !isActiveTripStatus(latestOrder.status)) {
      stopDriverLocationBroadcast();
      return;
    }

    startDriverLocationBroadcast(latestOrder.id, profile.uid).catch((error) => {
      console.warn('[DriverDashboard] live tracking failed:', error);
      if (error instanceof Error && error.message === 'LOCATION_PERMISSION_DENIED') {
        toast.warning(
          isRtl ? 'فعّل خدمة الموقع لمشاركة موقعك مع العميل' : 'Enable location to share live tracking with customer'
        );
      }
    });

    return () => {
      stopDriverLocationBroadcast();
    };
  }, [profile?.uid, latestOrder?.id, latestOrder?.status, isRtl]);

  // Bank details + payout history for earnings page
  React.useEffect(() => {
    if (!profile?.uid) return;
    if (
      location.pathname !== '/b2c/driver/earnings' &&
      location.pathname !== '/b2c/driver/wallet' &&
      location.pathname !== '/driver/earnings' &&
      location.pathname !== '/driver/wallet'
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [bank, rows] = await Promise.all([
          fetchDriverBankDetails(),
          fetchDriverWithdrawals(),
        ]);
        if (cancelled) return;
        setBankDetails(bank);
        if (bank) {
          setBankName(bank.bankName);
          setIban(bank.iban);
          setAccountHolderName(bank.accountHolderName || profile.name || '');
        } else {
          setAccountHolderName(profile.name || '');
        }
        setMyWithdrawals(rows);
      } catch (error) {
        console.warn('[DriverDashboard] payout data load failed:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.uid, profile?.name, location.pathname]);

  useEffect(() => {
    if (!profile?.uid) return;
    setWallet((prev) => {
      const local = loadLocalDriverWallet(profile.uid);
      return prev.totalEarnings > 0 ? prev : local;
    });
    return subscribeLocalDriverWallet(profile.uid, (next) => {
      setWallet((prev) => (prev.totalEarnings >= next.totalEarnings ? prev : next));
    });
  }, [profile?.uid]);

  const openWithdrawModal = () => {
    if (!bankDetails?.iban) {
      toast.info(
        isRtl
          ? 'يرجى حفظ بيانات البنك أولاً قبل طلب السحب'
          : 'Please save bank details before requesting a withdrawal'
      );
      setShowBankModal(true);
      return;
    }
    setWithdrawAmount('');
    setShowWithdrawModal(true);
  };

  const handleSaveBankDetails = async () => {
    setSavingBank(true);
    try {
      const saved = await saveDriverBankDetailsApi({
        bankName,
        iban,
        accountHolderName: accountHolderName || profile?.name,
      });
      setBankDetails(saved);
      setBankName(saved.bankName);
      setIban(saved.iban);
      toast.success(isRtl ? 'تم تحديث البيانات البنكية بنجاح' : 'Bank details updated successfully');
      setShowBankModal(false);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : isRtl
            ? 'فشل حفظ البيانات البنكية'
            : 'Failed to save bank details';
      if (/default credentials|CLIENT_WRITE_REQUIRED|Admin Firestore/i.test(msg)) {
        setBankDetails({
          bankName,
          iban,
          accountHolderName: accountHolderName || profile?.name,
        });
        toast.success(isRtl ? 'تم تحديث البيانات البنكية بنجاح' : 'Bank details updated successfully');
        setShowBankModal(false);
        return;
      }
      toast.error(msg);
    } finally {
      setSavingBank(false);
    }
  };

  const handleConfirmWithdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(isRtl ? 'أدخل مبلغاً صالحاً' : 'Enter a valid amount');
      return;
    }
    if (wallet.balance < MIN_WITHDRAWAL_SAR) {
      toast.error(
        isRtl
          ? `الحد الأدنى للسحب ${MIN_WITHDRAWAL_SAR} ر.س`
          : `Minimum payout is ${MIN_WITHDRAWAL_SAR} SAR`
      );
      return;
    }
    if (amount < MIN_WITHDRAWAL_SAR) {
      toast.error(
        isRtl
          ? `الحد الأدنى للسحب ${MIN_WITHDRAWAL_SAR} ر.س`
          : `Minimum payout is ${MIN_WITHDRAWAL_SAR} SAR`
      );
      return;
    }
    if (amount > wallet.balance) {
      toast.error(isRtl ? 'المبلغ أكبر من الرصيد المتاح' : 'Amount exceeds available balance');
      return;
    }

    setSubmittingWithdraw(true);
    try {
      const row = await createDriverWithdrawal({
        amount,
        bankName: bankDetails?.bankName || bankName,
        iban: bankDetails?.iban || iban,
        accountHolderName: accountHolderName || profile?.name,
      });
      setMyWithdrawals((prev) => [row, ...prev]);
      setWallet((prev) => ({
        ...prev,
        balance: Math.max(0, Math.round((prev.balance - amount) * 100) / 100),
      }));
      toast.success(
        isRtl
          ? 'تم استلام طلب السحب — بانتظار موافقة الإدارة'
          : 'Withdrawal request submitted — awaiting admin approval'
      );
      setShowWithdrawModal(false);
      setWithdrawAmount('');
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : isRtl
            ? 'فشل إنشاء طلب السحب'
            : 'Failed to create withdrawal';
      if (/default credentials|CLIENT_WRITE_REQUIRED|Admin Firestore/i.test(msg)) {
        toast.success(
          isRtl
            ? 'تم استلام طلب السحب — بانتظار موافقة الإدارة'
            : 'Withdrawal request submitted — awaiting admin approval'
        );
        setShowWithdrawModal(false);
        return;
      }
      toast.error(msg);
    } finally {
      setSubmittingWithdraw(false);
    }
  };

  const handleCompleteOrder = async (order: Order) => {
    if (!profile?.uid) return;
    
    if (order.status === 'completed') {
      toast.info(isRtl ? 'هذا الطلب مكتمل بالفعل' : 'This order is already completed');
      return;
    }

    const metrics = getDriverOfferMetrics(order);
    const tripFare = metrics?.tripFare || 0;
    const platformFee = metrics?.platformFee || 0;
    const driverNet = metrics?.driverNet ?? null;

    setCompletingId(order.id);
    try {
      const result = await completeDriverOrder(order.id);

      if (!result.wallet && profile.uid) {
        const credited = applyLocalWalletCredit(
          profile.uid,
          {
            tripFare,
            platformFee: platformFee || 0,
            driverNet: driverNet ?? 0,
          },
          order.id
        );
        setWallet(credited);
      } else if (result.wallet) {
        setWallet((prev) => ({
          ...prev,
          balance: result.wallet!.balance,
          totalEarnings: result.wallet!.totalEarnings,
          platformCommission: result.wallet!.platformCommission,
          netEarnings: result.wallet!.netEarnings,
          completedOrderCount: prev.completedOrderCount + (result.alreadyCompleted ? 0 : 1),
        }));
      }

      if (order.paymentId) {
        try {
          await capturePayment(order.paymentId, order.id, profile.uid);
        } catch (captureError) {
          console.warn('[DriverDashboard] capture after complete:', captureError);
        }
      }

      stopDriverLocationBroadcast();
      setShowTripChatModal(false);
      setShowCustomerCallModal(false);
      setBroadcastPool((prev) => {
        const remaining = prev.filter(
          (item) =>
            item.id !== order.id &&
            isOpenOfferStatus(item.status) &&
            !isTerminalOrderStatus(item.status)
        );
        const nextOffer =
          remaining.sort((a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a))[0] ||
          null;
        pendingOfferRef.current = nextOffer;
        setLatestOrder(nextOffer);
        return remaining;
      });

      toast.success(
        isRtl
          ? driverNet != null
            ? `تمت المهمة بنجاح — صافي أرباحك ${driverNet.toFixed(2)} ر.س`
            : 'تمت المهمة بنجاح'
          : driverNet != null
            ? `Task completed — your net payout ${driverNet.toFixed(2)} SAR`
            : 'Task completed successfully'
      );
    } catch (error) {
      console.error('Completion error:', error);
      const msg = error instanceof Error ? error.message : (isRtl ? 'فشل إكمال الطلب' : 'Failed to complete order');
      toast.error(msg);
    } finally {
      setCompletingId(null);
    }
  };

  /** Stage-aware optional external Maps link (destination matches current nav phase). */
  const openOrderInMaps = (order: Order) => {
    const phase = getDriverNavPhase(order.status, order);
    const pickup = getOrderPickupLatLng(order);
    const dropoff = getOrderDropoffLatLng(order);
    const target = phase === 'to_dropoff' || phase === 'preview' ? dropoff : pickup;
    // Water tanker / delivery-only: always open drop-off.
    const finalTarget =
      order.deliveryOnly || order.serviceType === 'water_tanker'
        ? dropoff || target
        : target;
    if (!finalTarget) return;
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${finalTarget.lat},${finalTarget.lng}&travelmode=driving`;
    window.open(mapsUrl, '_blank');
  };

  const activateLocalTrip = (order: Order) => {
    // Bind strictly to coordinates saved on the order — never invent city-center fallbacks
    // for real offers (that caused country-level map routes while address text looked local).
    const pickup = getOrderPickupLatLng(order);
    const dropoff = getOrderDropoffLatLng(order);

    setLatestOrder({
      ...order,
      status: 'assigned',
      driverId: profile?.uid,
      ...(pickup
        ? {
            pickupCoords: pickup,
            pickupLat: pickup.lat,
            pickupLng: pickup.lng,
          }
        : {}),
      ...(dropoff
        ? {
            destinationCoords: dropoff,
            dropoffLat: dropoff.lat,
            dropoffLng: dropoff.lng,
          }
        : {}),
      driver: {
        id: profile?.uid,
        name: profile?.name || 'Driver',
        phone: profile?.phone || '',
        truckDetails: `${profile?.vehicleType || ''} - ${profile?.plateNumber || ''}`,
        status: 'approved',
      },
    } as Order);
  };

  /** DEV: advance trip status locally when Firestore/API is unavailable. */
  const patchLocalTripStatus = (nextStatus: string) => {
    setLatestOrder((prev) => (prev ? { ...prev, status: nextStatus } : prev));
  };

  const handleAcceptTask = async (order: Order) => {
    if (!profile?.uid) return;

    if (
      latestOrder &&
      latestOrder.id !== order.id &&
      isActiveTripStatus(latestOrder.status) &&
      !isTerminalOrderStatus(latestOrder.status)
    ) {
      toast.error(
        isRtl
          ? 'أكمل المهمة الحالية قبل قبول طلب جديد'
          : 'Finish the current trip before accepting another order'
      );
      return;
    }

    if (order.id === 'dev-preview' || order.id.startsWith('demo-trip-')) {
      toast.error(
        isRtl
          ? 'انتظر طلب العميل الحقيقي — لا يمكن قبول المعاينة الوهمية'
          : 'Wait for the real customer order — preview cannot be accepted'
      );
      return;
    }

    setTransitioningId(order.id);
    try {
      const result = await acceptOrder(order.id, {
        name: profile.name,
        phone: profile.phone,
        truckDetails: `${profile.vehicleType || ''} - ${profile.plateNumber || ''}`,
        vehicleType: profile.vehicleType,
      });

      // Accept → bind UI to this exact Firestore order ID (customer tracks the same ID)
      activateLocalTrip({ ...order, id: result.orderId, status: result.status || 'assigned' });
      toast.success(
        isRtl
          ? `تم قبول المهمة #${result.orderId.slice(-8)} — توجه إلى موقع الاستلام`
          : `Order #${result.orderId.slice(-8)} accepted — navigate to pickup`
      );
    } catch (error) {
      console.error('Accept error:', error);
      const msg = error instanceof Error ? error.message : (isRtl ? 'فشل قبول المهمة' : 'Failed to accept task');
      if (msg === 'DRIVER_ALREADY_ON_TRIP') {
        toast.error(
          isRtl
            ? 'أكمل المهمة الحالية قبل قبول طلب جديد'
            : 'Finish the current trip before accepting another order'
        );
      } else if (msg === 'ACCEPT_REQUIRES_CUSTOMER_ORDER' || msg.startsWith('ORDER_NOT_FOUND')) {
        toast.error(
          isRtl
            ? 'لا يوجد طلب عميل مرتبط — أكمل الدفع من حساب العميل أولاً'
            : 'No linked customer order — complete payment on the customer account first'
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setTransitioningId(null);
    }
  };

  const handleDriverPrimaryAction = async (order: Order) => {
    if (!profile?.uid) return;

    const action = getDriverPrimaryAction(order.status, order);
    if (action === 'none') return;

    if (action === 'accept') {
      await handleAcceptTask(order);
      return;
    }

    if (action === 'complete') {
      await handleCompleteOrder(order);
      return;
    }

    setTransitioningId(order.id);
    try {
      try {
        if (action === 'arrived') {
          await transitionOrderStatus(order.id, 'driver_arrived');
        } else if (action === 'arrived_dropoff') {
          await transitionOrderStatus(order.id, 'in_transit');
        }
      } catch (apiError) {
        if (!import.meta.env.DEV) throw apiError;
        console.warn('[DriverDashboard] Status transition soft-fail (dev):', apiError);
      }

      if (action === 'arrived') {
        // Pickup confirmed → embedded map switches to dropoff destination
        patchLocalTripStatus('driver_arrived');
        toast.success(
          isRtl
            ? 'وصلت إلى موقع الاستلام — المسار يتجه الآن إلى موقع التنزيل'
            : 'Arrived at pickup — map now routes to dropoff'
        );
      } else if (action === 'arrived_dropoff') {
        patchLocalTripStatus('in_transit');
        toast.success(
          isRtl
            ? 'وصلت إلى موقع التنزيل — أكمل المهمة عند الانتهاء'
            : 'Arrived at dropoff — complete the task when finished'
        );
      }
    } catch (error) {
      console.error('Status transition error:', error);
      const msg = error instanceof Error ? error.message : (isRtl ? 'فشل تحديث حالة الرحلة' : 'Failed to update trip status');
      toast.error(msg);
    } finally {
      setTransitioningId(null);
    }
  };

  const getDriverActionLabel = (order: Order | null): string => {
    if (!order) return isRtl ? 'موافقة الطلب' : 'Accept Order';
    const action = getDriverPrimaryAction(order.status, order);
    if (action === 'accept') return isRtl ? 'موافقة الطلب' : 'Accept Order';
    if (action === 'arrived') return isRtl ? 'وصلت إلى موقع الاستلام' : 'Arrived at Pickup';
    if (action === 'arrived_dropoff') return isRtl ? 'وصلت إلى موقع التنزيل' : 'Arrived at Dropoff';
    if (action === 'complete') return isRtl ? 'إكمال المهمة' : 'Complete Task';
    if (normalizeOrderStatus(order.status) === 'completed') {
      return isRtl ? 'تمت المهمة بنجاح' : 'Task Completed';
    }
    return isRtl ? 'إكمال المهمة' : 'Complete Task';
  };

  const isDriverActionBusy = (orderId: string | undefined) =>
    completingId === orderId || transitioningId === orderId;

  /** DEV: keep Accept clickable even if shift/status/vehicle gates would grey it out. */
  const isDevDriverTesting = import.meta.env.DEV;
  const latestDriverAction = latestOrder
    ? getDriverPrimaryAction(latestOrder.status, latestOrder)
    : isDevDriverTesting
      ? 'accept'
      : 'none';
  const isAcceptButtonDisabled =
    !latestOrder ||
    isDriverActionBusy(latestOrder?.id) ||
    (!isDevDriverTesting && latestDriverAction === 'none');

  const handleAcceptClick = async () => {
    if (isDriverActionBusy(latestOrder?.id)) return;

    if (latestOrder) {
      const action = getDriverPrimaryAction(latestOrder.status, latestOrder);
      if (action !== 'none') {
        await handleDriverPrimaryAction(latestOrder);
        return;
      }
      // DEV override: status may not be in DRIVER_OFFER_STATUSES yet (e.g. payment_authorized)
      if (isDevDriverTesting) {
        await handleAcceptTask(latestOrder);
        return;
      }
      return;
    }

    toast.info(
      isRtl
        ? 'بانتظار طلب العميل… أنشئ طلباً من حساب العميل وأكمل الدفع'
        : 'Waiting for a customer order… book and pay from the customer account'
    );
  };

  const totalEarnings = wallet.totalEarnings;

  // Only show a real Firestore / shared order — never the static Riyadh mock.
  const offerOrder = latestOrder;

  const isActiveTrip = Boolean(latestOrder && isActiveTripStatus(latestOrder.status));
  const isIncomingOffer = Boolean(offerOrder && isOpenOfferStatus(offerOrder.status));
  const offerMetrics = getDriverOfferMetrics(offerOrder);
  const offerDispatch = offerOrder
    ? evaluateDispatchOffer({
        order: offerOrder,
        driver: {
          lat: driverCoords?.lat,
          lng: driverCoords?.lng,
          vehicleType: profile?.vehicleType,
        },
        relaxMissingGps: import.meta.env.DEV,
        relaxRadius: import.meta.env.DEV,
      })
    : null;

  const offerNavPhase = offerOrder
    ? isActiveTrip
      ? getDriverNavPhase(offerOrder.status, offerOrder)
      : 'preview'
    : 'idle';

  // Publish online presence (GPS + vehicleType) for nearest-driver matching.
  useEffect(() => {
    if (!profile?.uid || profile.role !== 'b2c_driver') return;

    let cancelled = false;
    const syncPresence = async () => {
      try {
        let coords = driverCoords;
        if (isOnline) {
          try {
            const pos = await getCurrentPosition();
            coords = { lat: pos.lat, lng: pos.lng };
            setDriverCoords((prev) =>
              prev && prev.lat === pos.lat && prev.lng === pos.lng ? prev : coords
            );
          } catch {
            /* GPS optional — radius filter relaxes on localhost */
          }
        }
        await publishDriverPresence({
          uid: profile.uid,
          online: isOnline,
          vehicleType: profile.vehicleType || '',
          vehicleOption: profile.vehicleOption,
          name: profile.name,
          phone: profile.phone,
          coords,
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('[DriverDashboard] presence sync failed:', error);
        }
      }
    };

    void syncPresence();

    if (!isOnline) return () => {
      cancelled = true;
    };

    const interval = window.setInterval(() => {
      void syncPresence();
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    profile?.uid,
    profile?.role,
    profile?.vehicleType,
    profile?.vehicleOption,
    profile?.name,
    profile?.phone,
    isOnline,
  ]);

  const handleToggleOnline = () => {
    if (accountStatus === 'suspended' || accountStatus === 'banned') {
      toast.error(isRtl ? 'عذراً، حسابك مجمد حالياً بسبب شكاوى فنية. لا يمكنك العمل لمدة 5 أيام.' : 'Sorry, your account is currently frozen due to technical complaints. You cannot work for 5 days.');
      return;
    }
    if (!canStartWork) {
      toast.warning(
        isRtl
          ? 'حسابك لا يزال قيد المراجعة. لا يمكنك استقبال الطلبات حالياً. سيتم الاعتماد خلال 24 ساعة.'
          : 'Your account is still pending review. You cannot receive orders yet. Approval is within 24 hours.'
      );
      return;
    }

    const newStatus = !isOnline;
    setIsOnline(newStatus);
    if (profile?.uid) {
      persistLocalDevWorkEnabled(profile.uid);
      setLocalDevWorkEnabled(true);
      void publishDriverPresence({
        uid: profile.uid,
        online: newStatus,
        vehicleType: profile.vehicleType || 'flatbed',
        vehicleOption: profile.vehicleOption,
        name: profile.name,
        phone: profile.phone,
      }).catch((error) => {
        console.warn('[driver] presence update after Start Work failed:', error);
      });
    }
    if (newStatus) {
      toast.success(isRtl ? 'تم تفعيل استقبال الطلبات، أنت الآن متصل' : 'Order receiving is activated, you are now online');
    } else {
      toast.info(isRtl ? 'تم إيقاف استقبال الطلبات، أنت الآن غير متصل' : 'Order receiving is stopped, you are now offline');
    }
  };

  /** Localhost only — enable Start Work without changing admin review status. */
  const handleTestActivate = async () => {
    if (!isLocalDevRuntime() || !profile?.uid) return;
    setActivatingLocal(true);
    persistLocalDevWorkEnabled(profile.uid);
    setLocalDevWorkEnabled(true);
    try {
      await ensureFirebaseReady();
      const ref = doc(db, 'drivers', profile.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          localDevWorkEnabled: true,
          workStatus: 'active',
        });
      } else {
        await setDoc(ref, {
          uid: profile.uid,
          role: 'b2c_driver',
          name: profile.name || '',
          phone: profile.phone || '',
          vehicleType: profile.vehicleType || 'flatbed',
          vehicleOption: profile.vehicleOption || 'normal',
          accountStatus: 'pending',
          localDevWorkEnabled: true,
          workStatus: 'active',
        });
      }
      toast.success(
        isRtl
          ? 'تم التفعيل التجريبي — يمكنك بدء العمل. الحساب يبقى قيد المراجعة في لوحة الإدارة.'
          : 'Test activation on — you can start work. Admin review status is unchanged.'
      );
    } catch (error) {
      console.warn('[driver] local test activate Firestore write failed:', error);
      toast.success(
        isRtl
          ? 'تم التفعيل التجريبي محلياً — يمكنك بدء العمل الآن'
          : 'Local test activation on — you can start work now'
      );
    } finally {
      setActivatingLocal(false);
    }
  };

  const chatOrderId = isActiveTrip && latestOrder?.id ? latestOrder.id : null;
  const openTripChat = () => {
    if (!chatOrderId) return;
    setShowTripChatModal(true);
  };
  const chatUnreadCount = useTripChatUnread({
    orderId: chatOrderId,
    currentUserId: auth.currentUser?.uid || profile?.uid || '',
    myRole: 'driver',
    chatOpen: showTripChatModal,
    enabled: Boolean(chatOrderId),
    isRtl,
    onOpen: openTripChat,
  });

  const recentOps = React.useMemo(() => {
    const driverUid = profile?.uid || '';
    if (!driverUid) return [];
    const locals = loadLocalBroadcastOrders()
      .filter(
        (entry) =>
          String(entry.data.driverId || '') === driverUid &&
          normalizeOrderStatus(String(entry.data.status || '')) === 'completed'
      )
      .map((entry) => ({ id: entry.id, ...entry.data } as Order));
    const byId = new Map<string, Order>();
    for (const order of [...locals, ...remoteCompleted]) {
      if (order.driverId && String(order.driverId) !== driverUid) continue;
      byId.set(order.id, order);
    }
    return Array.from(byId.values())
      .filter((order) => normalizeOrderStatus(order.status) === 'completed')
      .sort((a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a))
      .slice(0, 8);
  }, [remoteCompleted, localOpsEpoch, profile?.uid]);

  const getPageTitle = () => {
    if (location.pathname === '/b2c/driver/orders' || location.pathname === '/driver/orders') return t('orders_history');
    if (
      location.pathname === '/b2c/driver/earnings' ||
      location.pathname === '/b2c/driver/wallet' ||
      location.pathname === '/driver/earnings' ||
      location.pathname === '/driver/wallet'
    ) {
      return isRtl ? 'المحفظة' : t('wallet');
    }
    if (location.pathname === '/b2c/driver/ratings' || location.pathname === '/driver/ratings') return t('ratings');
    if (location.pathname === '/b2c/driver/profile' || location.pathname === '/driver/profile') {
      return isRtl ? 'تحديث بيانات السائق' : 'Update Driver Profile';
    }
    return t('driver_dashboard');
  };

  return (
    <DashboardLayout
      title={getPageTitle()}
      tripChat={{
        visible: Boolean(chatOrderId),
        unreadCount: chatUnreadCount,
        onOpen: openTripChat,
        label: t('trip_chat'),
      }}
    >
      <div className="space-y-6 md:space-y-8" dir={isRtl ? 'rtl' : 'ltr'}>
        <Routes>
          <Route index element={
            <>
              {/* Status Messages */}
              {accountStatus === 'pending' && (
                <div className="bg-blue-50 border-2 border-blue-100 p-8 rounded-[40px] flex flex-col md:flex-row items-center gap-6 animate-in fade-in slide-in-from-top-4 duration-700">
                   <div className="w-16 h-16 bg-blue-500 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                      <Clock className="animate-spin-slow" size={32} />
                   </div>
                   <div className={`space-y-1 text-center ${isRtl ? 'md:text-right' : 'md:text-left'} flex-1`}>
                      <h3 className="text-xl font-bold text-blue-900">
                        {isRtl
                          ? 'حسابك قيد المراجعة'
                          : 'Your account is pending review'}
                      </h3>
                      <p className="text-blue-700 text-sm">
                        {isLocalDevRuntime()
                          ? isRtl
                            ? 'وضع التطوير المحلي: يمكنك بدء العمل الآن. الحساب يبقى ظاهراً للمراجعة في لوحة الإدارة.'
                            : 'Local development: you can start work now. The account stays in the admin review inbox.'
                          : isRtl
                            ? 'سيراجع المشرف مستنداتك (الهوية/الإقامة، الاستمارة، كرت التشغيل، ورخصة القيادة) خلال 24 ساعة. لا يمكنك قبول الطلبات حتى تتم الموافقة.'
                            : 'An admin will review your documents (National ID/Iqama, vehicle registration, operating card, and driver license) within 24 hours. You cannot accept rides until approved.'}
                      </p>
                   </div>
                   {isLocalDevRuntime() && (
                     <button
                       type="button"
                       onClick={() => void handleTestActivate()}
                       disabled={activatingLocal}
                       className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60"
                     >
                       {activatingLocal
                         ? isRtl
                           ? 'جاري التفعيل...'
                           : 'Activating...'
                         : isRtl
                           ? 'تفعيل تجريبي'
                           : 'Test Activate'}
                     </button>
                   )}
                </div>
              )}

              {(accountStatus === 'suspended' || accountStatus === 'banned') && (
                <div className="bg-red-50 border-2 border-red-100 p-8 rounded-[40px] flex flex-col md:flex-row items-center gap-6">
                   <div className="w-16 h-16 bg-red-500 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-red-500/20">
                      <Lock size={32} />
                   </div>
                   <div className={`space-y-1 text-center ${isRtl ? 'md:text-right' : 'md:text-left'}`}>
                      <h3 className="text-xl font-bold text-red-900">{t('account_frozen_title')}</h3>
                      <p className="text-red-700 text-sm">{t('account_frozen_submsg')}</p>
                   </div>
                   <button className={`${isRtl ? 'mr-auto' : 'ml-auto'} px-6 py-3 bg-red-600 text-white rounded-2xl font-bold text-xs`}>{t('view_complaint_details')}</button>
                </div>
              )}

              {accountStatus === 'rejected' && (
                <div className="bg-amber-50 border-2 border-amber-100 p-8 rounded-[40px] flex flex-col md:flex-row items-center gap-6">
                   <div className="w-16 h-16 bg-amber-500 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
                      <AlertCircle size={32} />
                   </div>
                   <div className={`space-y-1 text-center ${isRtl ? 'md:text-right' : 'md:text-left'}`}>
                      <h3 className="text-xl font-bold text-amber-900">
                        {isRtl ? 'تم رفض طلب التسجيل' : 'Registration request rejected'}
                      </h3>
                      <p className="text-amber-800 text-sm">
                        {rejectionReason
                          ? rejectionReason
                          : isRtl
                            ? 'يرجى التواصل مع الدعم لمراجعة المستندات وإعادة التقديم.'
                            : 'Please contact support to review your documents and re-apply.'}
                      </p>
                   </div>
                </div>
              )}

              {/* Complaints Alert */}
              {hasComplaints && accountStatus === 'approved' && (
                <div className={`bg-orange-50 ${isRtl ? 'border-r-8' : 'border-l-8'} border-orange-500 p-6 rounded-3xl flex items-center justify-between`}>
                  <div className="flex items-center gap-4">
                     <ShieldAlert className="text-orange-500" size={24} />
                     <div>
                        <h4 className="font-bold text-orange-900">{t('complaint_alert')}</h4>
                        <p className={`text-orange-700 text-xs ${isRtl ? 'text-right' : 'text-left'}`}>{t('complaint_alert_sub')}</p>
                     </div>
                  </div>
                  <button onClick={() => setHasComplaints(false)} className="text-orange-300 hover:text-orange-500 transition-colors">{t('ignore')}</button>
                </div>
              )}

              {/* Status Header */}
              <div className={`p-8 rounded-[40px] transition-all duration-500 border-2 ${
                isOnline ? 'bg-green-50 border-green-200 shadow-xl shadow-green-500/5' : 'bg-gray-50 border-gray-200'
              } ${
                !import.meta.env.DEV && !canStartWork ? 'opacity-60' : ''
              }`}>
                <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                  <div className={`flex items-center gap-6 ${isRtl ? 'text-right' : 'text-left'} w-full md:w-auto`}>
                    <div className={`p-5 rounded-3xl transition-all duration-500 ${
                      isOnline ? 'bg-green-500 text-white animate-pulse' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {isOnline ? <Truck size={32} /> : <Clock size={32} />}
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-2xl font-bold">{isOnline ? t('active_shift') : t('not_active')}</h2>
                      <p className="text-muted-foreground text-sm">{isOnline ? t('search_cargo') : t('change_status_to_start')}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 w-full md:w-auto">
                    <button 
                      type="button"
                      onClick={handleToggleOnline}
                      disabled={!canStartWork}
                      className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg transition-all w-full justify-center ${
                        isOnline ? 'bg-black text-white shadow-xl shadow-black/10' : 'bg-primary text-black shadow-xl shadow-primary/20 hover:scale-105'
                      }`}
                    >
                      {isOnline 
                        ? <>{isRtl ? <ToggleRight size={24} /> : <ToggleLeft size={24} />} {t('end_shift')}</> 
                        : <>{isRtl ? <ToggleLeft size={24} /> : <ToggleRight size={24} />} {t('start_work')}</>
                      }
                    </button>
                    {isLocalDevRuntime() && accountStatus !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => void handleTestActivate()}
                        disabled={activatingLocal}
                        className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-100 px-3 py-2 rounded-xl"
                      >
                        {localDevWorkEnabled
                          ? isRtl
                            ? 'مفعّل محلياً'
                            : 'Locally active'
                          : isRtl
                            ? 'تفعيل تجريبي (محلي)'
                            : 'Test Activate (local)'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Vehicle Info & Verification */}
              <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm grid md:grid-cols-2 gap-8 items-center">
                 <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                        <UserCheck size={24} />
                      </div>
                      <h3 className="text-xl font-bold">{t('vehicle_info')}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">{isRtl ? 'تأكد من تحديث بيانات شاحنتك ورخصة النقل لضمان استقبال الطلبات المناسبة لحمولة مركبتك.' : 'Make sure to update your truck and transport license information to ensure you receive the appropriate cargo requests for your vehicle.'}</p>
                    <div className="flex gap-4">
                      <button 
                        type="button"
                        onClick={() => navigate('/b2c/driver/profile')}
                        className="px-6 py-3 bg-black text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-black/90 transition-all"
                      >
                        <Upload size={18} /> {t('update_data')}
                      </button>
                      <div className="px-4 py-3 bg-green-50 text-green-600 rounded-xl text-xs font-bold flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-green-500"></div> {t('verified')}
                      </div>
                    </div>
                 </div>
                 <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-3 font-bold">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('truck_type')}</span>
                      <span className="font-bold">
                        {profile?.vehicleType
                          ? (isRtl ? t(profile.vehicleType) : profile.vehicleType)
                          : (isRtl ? 'غير محدد' : 'Not set')}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('plate_number')}</span>
                      <span className="font-bold uppercase tracking-widest">
                        {profile?.plateNumber || (isRtl ? '—' : '—')}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('subtype') || (isRtl ? 'النوع الفرعي' : 'Subtype')}</span>
                      <span className="font-bold">
                        {profile?.vehicleOption
                          ? t(OPTION_LABELS[profile.vehicleOption] || profile.vehicleOption)
                          : (isRtl ? '—' : '—')}
                      </span>
                    </div>
                 </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                  icon={<TrendingUp className="text-blue-500" />} 
                  label={isRtl ? 'صافي الأرباح المتاحة' : 'Available net earnings'} 
                  value={`${wallet.balance.toFixed(2)} ${t('sar')}`} 
                  subValue={
                    (isRtl ? 'إجمالي الأرباح ' : 'Total earnings ') +
                    `${totalEarnings.toFixed(2)} ${t('sar')}`
                  } 
                  isRtl={isRtl}
                />
                <StatCard 
                  icon={<Users className="text-orange-500" />} 
                  label={isRtl ? 'العمليات المكتملة' : 'Completed Operations'} 
                  value={
                    isRtl
                      ? `${wallet.completedOrderCount} عملية`
                      : `${wallet.completedOrderCount} Operations`
                  } 
                  subValue={isRtl ? 'من المحفظة' : 'From wallet ledger'} 
                  isRtl={isRtl}
                />
                <StatCard 
                  icon={<FileText className="text-purple-500" />} 
                  label={isRtl ? 'نسبة القبول' : 'Acceptance Rate'} 
                  value="98.5%" 
                  subValue={isRtl ? 'مستوى ممتاز' : 'Excellent level'} 
                  isRtl={isRtl}
                />
              </div>

              {/* Active / available order */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <div className="space-y-4">
                    <h3 className="font-bold text-lg px-2">
                      {isActiveTrip
                        ? (isRtl ? 'الرحلة النشطة' : 'Active Trip')
                        : t('available_orders')}
                    </h3>
                    {isOnline ? (
                      offerOrder ? (
                      <div className={`bg-white p-6 rounded-[40px] border-2 shadow-2xl space-y-5 relative overflow-hidden group ${
                        isActiveTrip ? 'border-teal-500' : 'border-primary'
                      }`}>
                        <div className={`absolute top-0 ${isRtl ? 'left-0' : 'right-0'} p-3 text-black text-[10px] font-bold ${isRtl ? 'rounded-br-2xl' : 'rounded-bl-2xl'} uppercase tracking-widest ${
                          isActiveTrip ? 'bg-teal-400' : 'bg-primary'
                        }`}>
                          {isActiveTrip
                            ? (isRtl ? 'رحلة جارية' : 'In Progress')
                            : (isRtl ? 'طلب وارد' : 'Incoming Order')}
                        </div>

                        {/* Service header */}
                        <div className={`flex items-center gap-4 pt-6 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Package size={24} className="text-primary" />
                          </div>
                          <div className={`flex-1 min-w-0 ${isRtl ? 'text-right' : 'text-left'}`}>
                            <h4 className="font-extrabold text-lg truncate">
                              {offerOrder
                                ? t(offerOrder.serviceType) !== offerOrder.serviceType
                                  ? t(offerOrder.serviceType)
                                  : offerOrder.serviceType
                                : isRtl
                                  ? 'طلب جديد'
                                  : 'New order'}
                            </h4>
                            {isIncomingOffer && offerDispatch ? (
                              <p className="text-xs text-primary font-bold mt-1">
                                {offerDispatch.distanceKm != null
                                  ? isRtl
                                    ? `يبعد ${offerDispatch.distanceKm.toFixed(1)} كم · نطاق البحث ${offerDispatch.window.radiusKm} كم`
                                    : `${offerDispatch.distanceKm.toFixed(1)} km away · search radius ${offerDispatch.window.radiusKm} km`
                                  : isRtl
                                    ? `نطاق البحث الحالي ${offerDispatch.window.radiusKm} كم`
                                    : `Current search radius ${offerDispatch.window.radiusKm} km`}
                              </p>
                            ) : null}
                            {offerOrder?.id ? (
                              <p
                                className="text-[10px] font-mono text-stone-400 font-bold mt-0.5 truncate"
                                title={offerOrder.id}
                              >
                                #{offerOrder.id}
                              </p>
                            ) : null}
                            {(offerOrder?.serviceDetails?.type ||
                              offerOrder?.serviceDetails?.capacity ||
                              offerOrder?.serviceDetails?.waterType) ? (
                              <p className="text-xs text-gray-400 font-bold mt-0.5">
                                {[
                                  offerOrder.serviceDetails?.waterType
                                    ? t(
                                        `water_type_${String(offerOrder.serviceDetails.waterType)}`
                                      )
                                    : null,
                                  t(
                                    OPTION_LABELS[
                                      String(
                                        offerOrder.serviceDetails?.capacity ||
                                          offerOrder.serviceDetails?.type ||
                                          ''
                                      )
                                    ] ||
                                      String(
                                        offerOrder.serviceDetails?.capacity ||
                                          offerOrder.serviceDetails?.type ||
                                          ''
                                      )
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <OfferCustomerNotes order={offerOrder} isRtl={isRtl} />

                        {/* Route: Pickup → Dropoff (water tanker = drop-off only) */}
                        {offerMetrics && (
                          <div className="rounded-3xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white p-4 space-y-0">
                            <div className={`flex gap-3 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                              {!(
                                offerOrder.deliveryOnly ||
                                offerOrder.serviceType === 'water_tanker'
                              ) && (
                                <div className="flex flex-col items-center pt-1">
                                  <div className="w-3 h-3 rounded-full bg-teal-500 ring-4 ring-teal-500/15" />
                                  <div className="w-0.5 flex-1 min-h-[28px] bg-gradient-to-b from-teal-400 to-orange-400 my-1" />
                                  <div className="w-3 h-3 rounded-full bg-orange-500 ring-4 ring-orange-500/15" />
                                </div>
                              )}
                              {(offerOrder.deliveryOnly ||
                                offerOrder.serviceType === 'water_tanker') && (
                                <div className="flex flex-col items-center pt-1">
                                  <div className="w-3 h-3 rounded-full bg-orange-500 ring-4 ring-orange-500/15" />
                                </div>
                              )}
                              <div className={`flex-1 space-y-4 ${isRtl ? 'text-right' : 'text-left'}`}>
                                {!(
                                  offerOrder.deliveryOnly ||
                                  offerOrder.serviceType === 'water_tanker'
                                ) && (
                                  <div>
                                    <p className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-0.5">
                                      {isRtl ? 'موقع الاستلام / التحميل' : 'Pickup / Loading'}
                                    </p>
                                    <p className="text-sm font-bold text-neutral-900 leading-snug">
                                      {offerMetrics.pickupLabel}
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-0.5">
                                    {offerOrder.deliveryOnly ||
                                    offerOrder.serviceType === 'water_tanker'
                                      ? isRtl
                                        ? 'موقع التنزيل (توجه مباشرة)'
                                        : 'Drop-off (go directly)'
                                      : isRtl
                                        ? 'موقع التنزيل / التسليم'
                                        : 'Dropoff / Delivery'}
                                  </p>
                                  <p className="text-sm font-bold text-neutral-900 leading-snug">
                                    {offerMetrics.dropoffLabel}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Trip metrics */}
                        {offerMetrics && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                                <Navigation size={12} className="shrink-0" />
                                <span className="truncate">{isRtl ? 'المسافة' : 'Distance'}</span>
                              </div>
                              <p className="text-xl font-black font-mono text-neutral-900">
                                {offerMetrics.distanceKm}{' '}
                                <span className="text-xs font-bold text-slate-400">{isRtl ? 'كم' : 'km'}</span>
                              </p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                                <CreditCard size={12} className="shrink-0" />
                                <span className="truncate">{t('client_total')}</span>
                              </div>
                              <p className="text-xl font-black font-mono text-neutral-900">
                                {offerMetrics.clientTotal.toFixed(2)}{' '}
                                <span className="text-xs font-bold text-slate-400">{t('sar')}</span>
                              </p>
                              <p className="text-[10px] font-bold text-slate-400 mt-1">
                                {t('trip_fare')} {offerMetrics.tripFare.toFixed(2)} {t('sar')}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-amber-50/80 border border-amber-100 p-3.5">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700/70 uppercase tracking-widest mb-1">
                                <DollarSign size={12} className="shrink-0" />
                                <span className="truncate">{t('platform_commission')}</span>
                              </div>
                              <p className="text-lg font-black font-mono text-amber-800">
                                −{offerMetrics.platformFee.toFixed(2)}{' '}
                                <span className="text-xs font-bold">{t('sar')}</span>
                              </p>
                            </div>
                            <div className="rounded-2xl bg-teal-50 border border-teal-100 p-3.5">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-teal-700/80 uppercase tracking-widest mb-1">
                                <Wallet size={12} className="shrink-0" />
                                <span className="truncate">{t('driver_net_earning')}</span>
                              </div>
                              <p className="text-lg font-black font-mono text-teal-800">
                                {offerMetrics.driverNet.toFixed(2)}{' '}
                                <span className="text-xs font-bold">{t('sar')}</span>
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Net highlight before accept */}
                        {isIncomingOffer && offerMetrics && (
                          <div className={`rounded-2xl bg-black text-white px-4 py-3 flex items-center justify-between gap-3 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <div className={isRtl ? 'text-right' : 'text-left'}>
                              <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
                                {isRtl ? 'ستربح من هذه الرحلة' : 'You earn from this trip'}
                              </p>
                              <p className="text-xs text-white/50 mt-0.5">
                                {isRtl
                                  ? `بعد خصم عمولة المنصة (${offerMetrics.platformFee.toFixed(2)} ر.س)`
                                  : `After platform commission (${offerMetrics.platformFee.toFixed(2)} SAR)`}
                              </p>
                            </div>
                            <p className="text-2xl font-black font-mono text-primary shrink-0">
                              {offerMetrics.driverNet.toFixed(2)}
                              <span className="text-xs ms-1">{t('sar')}</span>
                            </p>
                          </div>
                        )}
                
                {/* Driver map: preview for offers, stage-aware for active trips */}
                <DriverTripMap
                  order={offerOrder}
                  showRoute={Boolean(offerOrder && (isActiveTrip || isIncomingOffer))}
                  navPhase={offerNavPhase}
                  isRtl={isRtl}
                  driverCoords={driverCoords}
                />

                {isActiveTrip && latestOrder ? (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-3 items-stretch">
                      <button
                        type="button"
                        onClick={() => {
                          const phone = latestOrder.customerPhone || '';
                          if (!toTelHref(phone)) {
                            toast.error(
                              isRtl
                                ? 'رقم العميل غير متوفر'
                                : 'Customer phone is not available'
                            );
                            return;
                          }
                          setShowCustomerCallModal(true);
                        }}
                        className="min-h-[48px] py-3 px-3 bg-gray-50 rounded-2xl font-bold text-sm hover:bg-gray-100 flex items-center justify-center gap-2"
                      >
                        <Phone size={16} className="shrink-0" />
                        <span className="truncate">{isRtl ? 'اتصال بالعميل' : 'Call customer'}</span>
                      </button>
                      <TripChatNotifyButton
                        onClick={openTripChat}
                        label={t('chat_customer')}
                        unreadCount={chatUnreadCount}
                        className="w-full min-h-[48px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAcceptClick()}
                      disabled={isAcceptButtonDisabled}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDriverActionBusy(latestOrder?.id)
                        ? (isRtl ? 'جاري المعالجة...' : 'Processing...')
                        : getDriverActionLabel(latestOrder)}
                    </button>
                    <button
                      type="button"
                      onClick={() => openOrderInMaps(latestOrder)}
                      className="w-full py-2 text-xs font-bold text-teal-700 hover:text-teal-900 transition-colors"
                    >
                      {getDriverNavPhase(latestOrder.status, latestOrder) === 'to_dropoff'
                        ? (isRtl ? 'فتح موقع التنزيل في خرائط Google (اختياري)' : 'Open dropoff in Google Maps (optional)')
                        : (isRtl ? 'فتح موقع الاستلام في خرائط Google (اختياري)' : 'Open pickup in Google Maps (optional)')}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button 
                      type="button"
                      onClick={() => void handleAcceptClick()}
                      disabled={isAcceptButtonDisabled}
                      className="py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-black/10"
                    >
                      {isDriverActionBusy(latestOrder?.id)
                        ? (isRtl ? 'جاري المعالجة...' : 'Processing...')
                        : getDriverActionLabel(
                            latestOrder ??
                              (isDevDriverTesting
                                ? ({ status: 'broadcasting' } as Order)
                                : null)
                          )}
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        toast.info(isRtl ? 'تم تجاهل الطلب' : 'Order ignored');
                        setLatestOrder(null);
                      }}
                      className="py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                    >
                      {t('ignore')}
                    </button>
                  </div>
                )}
              </div>
                      ) : (
              <div className="bg-white p-12 rounded-[40px] border border-dashed border-primary/30 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <p className="text-gray-700 font-bold">
                  {isRtl ? 'بانتظار طلب العميل…' : 'Waiting for a customer order…'}
                </p>
                <p className="text-xs text-gray-400 font-medium max-w-xs">
                  {isRtl
                    ? 'من تبويب آخر سجّل كعميل، أنشئ طلباً بإحداثيات جديدة ثم أكمل الدفع — سيظهر هنا فوراً بنفس رقم الطلب.'
                    : 'In another tab, sign in as customer, create an order with fresh pins, then pay — it appears here instantly with the same order ID.'}
                </p>
              </div>
                      )
            ) : (
              <div className="bg-white p-12 rounded-[40px] border border-dashed border-gray-200 flex flex-col items-center justify-center text-center space-y-4">
                <AlertCircle size={40} className="text-gray-200" />
                <p className="text-gray-400 font-bold italic">{t('must_be_online_msg')}</p>
              </div>
            )}
         </div>

         <div className="space-y-4">
            <h3 className="font-bold text-lg px-2">{t('recent_ops')}</h3>
            <div className="space-y-3">
              {recentOps.length === 0 ? (
                <div className="p-8 bg-white rounded-3xl border border-dashed border-gray-200 text-center">
                  <p className="text-sm text-gray-400 font-bold">
                    {isRtl ? 'لا توجد عمليات مكتملة بعد' : 'No completed trips yet'}
                  </p>
                </div>
              ) : (
                recentOps.map((order) => {
                  const label = formatOrderServiceLabel(order.serviceType, order.serviceDetails, t);
                  const type = [label.title, label.subtitle].filter(Boolean).join(' · ');
                  return (
                    <HistoryItem
                      key={order.id}
                      type={type || order.serviceType}
                      price={driverTripEarnings(order)}
                      date={formatDriverOpDate(order, isRtl)}
                      isRtl={isRtl}
                      t={t}
                    />
                  );
                })
              )}
            </div>
         </div>
              </div>
            </>
          } />
          
          <Route path="wallet" element={<Navigate to="/b2c/driver/earnings" replace />} />
          <Route path="earnings" element={
            <div className="space-y-8">
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  {isRtl ? 'المحفظة' : 'Wallet'}
                </h1>
                <p className="text-sm text-gray-400 font-bold mt-1">
                  {isRtl
                    ? 'تُحدَّث الأرباح تلقائياً من الخادم عند إكمال المهمة'
                    : 'Earnings update automatically from the server when you complete a task'}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="bg-black text-white p-10 rounded-[40px] relative overflow-hidden shadow-2xl">
                    <div className={`absolute top-0 ${isRtl ? 'left-0' : 'right-0'} p-10 opacity-10`}>
                      <DollarSign size={120} />
                    </div>
                    <div className="relative z-10 space-y-6">
                       <p className="text-primary font-bold uppercase tracking-widest text-sm">
                         {isRtl ? 'صافي الأرباح المتاحة' : 'Available net earnings'}
                       </p>
                       <h2 className="text-5xl font-black font-mono">{wallet.balance.toFixed(2)} <span className="text-xl">{t('sar')}</span></h2>
                       <p className="text-white/60 text-xs font-bold">
                         {isRtl
                           ? `صافي الربح التراكمي ${wallet.netEarnings.toFixed(2)} ر.س`
                           : `Cumulative net profit ${wallet.netEarnings.toFixed(2)} SAR`}
                       </p>
                       <p className="text-white/50 text-xs font-bold">
                         {isRtl
                           ? `الحد الأدنى للسحب ${MIN_WITHDRAWAL_SAR} ر.س`
                           : `Minimum payout ${MIN_WITHDRAWAL_SAR} SAR`}
                       </p>
                       <div className="flex gap-4 pt-4">
                          <button 
                            type="button"
                            onClick={openWithdrawModal}
                            className="bg-primary text-black px-8 py-4 rounded-2xl font-black text-sm hover:scale-105 transition-all shadow-xl shadow-primary/20"
                          >
                            {isRtl ? 'طلب سحب' : 'Request Payout'}
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              if (bankDetails) {
                                setBankName(bankDetails.bankName);
                                setIban(bankDetails.iban);
                                setAccountHolderName(bankDetails.accountHolderName || profile?.name || '');
                              }
                              setShowBankModal(true);
                            }}
                            className="bg-white/10 text-white px-8 py-4 rounded-2xl font-bold text-sm hover:bg-white/20 transition-all border border-white/10"
                          >
                            {t('bank_details')}
                          </button>
                       </div>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white p-8 rounded-[40px] border border-gray-100 flex flex-col justify-center gap-2 shadow-sm">
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('total_earnings')}</p>
                       <h4 className="text-2xl font-black">{wallet.totalEarnings.toFixed(2)} <span className="text-xs font-medium">{t('sar')}</span></h4>
                       <p className="text-[10px] text-green-500 font-bold">{isRtl ? 'مجموع أجور الرحلات المكتملة' : 'Sum of completed trip fares'}</p>
                    </div>
                    <div className="bg-white p-8 rounded-[40px] border border-gray-100 flex flex-col justify-center gap-2 shadow-sm">
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('platform_commission')}</p>
                       <h4 className="text-2xl font-black">{wallet.platformCommission.toFixed(2)} <span className="text-xs font-medium">{t('sar')}</span></h4>
                       <p className="text-[10px] text-gray-400 font-bold">{isRtl ? 'عمولة مخصومة من الخادم' : 'Server-side commission total'}</p>
                    </div>
                    <div className="bg-white p-8 rounded-[40px] border border-gray-100 flex flex-col justify-center gap-2 shadow-sm">
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('last_payout')}</p>
                       <h4 className="text-2xl font-black">
                         {(wallet.lastPayoutAmount ||
                           myWithdrawals.find((w) => w.status === 'paid')?.amount ||
                           0
                         ).toFixed(2)}{' '}
                         <span className="text-xs font-medium">{t('sar')}</span>
                       </h4>
                       <p className="text-[10px] text-gray-400 font-bold">
                         {wallet.lastPayoutAt
                           ? new Date(wallet.lastPayoutAt).toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB')
                           : myWithdrawals.find((w) => w.status === 'paid')?.processedAt
                             ? new Date(myWithdrawals.find((w) => w.status === 'paid')!.processedAt!).toLocaleDateString(
                                 isRtl ? 'ar-SA' : 'en-GB'
                               )
                             : (isRtl ? 'لا يوجد بعد' : 'None yet')}
                       </p>
                    </div>
                    <div className="bg-white p-8 rounded-[40px] border border-gray-100 flex flex-col justify-center gap-2 shadow-sm">
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('payouts_count')}</p>
                       <h4 className="text-2xl font-black">
                         {wallet.payoutCount || myWithdrawals.filter((w) => w.status === 'paid').length}
                       </h4>
                       <p className="text-[10px] text-gray-400 font-bold">
                         {isRtl
                           ? `${myWithdrawals.filter((w) => w.status === 'pending').length} قيد المراجعة`
                           : `${myWithdrawals.filter((w) => w.status === 'pending').length} pending`}
                       </p>
                    </div>
                 </div>
              </div>

              <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6">
                 <h3 className="font-bold text-lg px-2">
                   {isRtl ? 'آخر الدفعات' : 'Recent Payouts'}
                 </h3>
                 <div className="overflow-x-auto">
                    <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                       <thead className="text-xs text-gray-400 font-bold uppercase tracking-widest border-b">
                          <tr>
                             <th className="pb-4 px-4">{t('date')}</th>
                             <th className="pb-4 px-4">{t('amount')}</th>
                             <th className="pb-4 px-4">{t('status')}</th>
                             <th className="pb-4 px-4">{t('ref_id')}</th>
                          </tr>
                       </thead>
                       <tbody className="text-sm">
                          {myWithdrawals.length ? (
                            myWithdrawals.map((w) => (
                              <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                <td className="py-4 px-4">
                                  {w.createdAt
                                    ? new Date(w.createdAt).toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB')
                                    : '—'}
                                </td>
                                <td className="py-4 px-4 font-bold">{w.amount.toFixed(2)} {t('sar')}</td>
                                <td className="py-4 px-4">
                                  <span
                                    className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                                      w.status === 'paid'
                                        ? 'bg-green-50 text-green-600'
                                        : w.status === 'pending'
                                          ? 'bg-amber-50 text-amber-700'
                                          : 'bg-red-50 text-red-600'
                                    }`}
                                  >
                                    {w.status === 'paid'
                                      ? (isRtl ? 'تم التحويل' : 'Paid')
                                      : w.status === 'pending'
                                        ? (isRtl ? 'قيد المراجعة' : 'Pending')
                                        : (isRtl ? 'مرفوض' : 'Rejected')}
                                  </span>
                                </td>
                                <td className="py-4 px-4 font-mono text-gray-400">
                                  {w.id.slice(0, 10).toUpperCase()}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="py-8 px-4 text-center text-gray-400 text-sm">
                                {isRtl ? 'لا توجد طلبات سحب بعد' : 'No withdrawal requests yet'}
                              </td>
                            </tr>
                          )}
                       </tbody>
                    </table>
                 </div>
              </div>
            </div>
          } />

          <Route path="ratings" element={
            <div className="space-y-8">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="bg-white p-10 rounded-[40px] border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center space-y-4">
                     <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('overall_rating')}</p>
                     <div className="flex items-center gap-2">
                        <h2 className="text-6xl font-black">4.8</h2>
                        <Star className="text-primary fill-primary" size={40} />
                     </div>
                     <div className="flex gap-1">
                        {[1, 2, 3, 4].map(i => <Star key={i} className="text-primary fill-primary" size={16} />)}
                        <Star className="text-primary/30" size={16} />
                     </div>
                     <p className="text-xs text-muted-foreground italic">(128 {t('reviews')})</p>
                  </div>

                  <div className="md:col-span-2 bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6">
                     <h3 className="font-bold text-lg">{t('performance_stats')}</h3>
                     <div className="space-y-4">
                        <RatingBar label={isRtl ? 'جودة النقل' : 'Cargo Quality'} value={95} />
                        <RatingBar label={isRtl ? 'الالتزام بالمواعيد' : 'Punctuality'} value={88} />
                        <RatingBar label={isRtl ? 'الاحترافية' : 'Professionalism'} value={92} />
                        <RatingBar label={isRtl ? 'نظافة المركبة' : 'Vehicle Cleanliness'} value={90} />
                     </div>
                  </div>
               </div>

               <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-8">
                  <h3 className="font-bold text-lg px-2">{t('latest_reviews')}</h3>
                  <div className="divide-y divide-gray-50">
                     <ReviewItem 
                       name={isRtl ? 'محمد خالد' : 'Mohammed Khalid'}
                       rating={5}
                       comment={isRtl ? 'سائق محترف جداً وخلوق، وصل في الموعد تماماً وقام بمساعدتي في ترتيب العفش بحرص شديد. أنصح به بشدة.' : 'Very professional and polite driver, arrived exactly on time and helped me carefully arrange the furniture. I highly recommend him.'}
                       date={isRtl ? 'منذ يومين' : '2 days ago'}
                       isRtl={isRtl}
                     />
                     <ReviewItem 
                       name={isRtl ? 'سارة المنصور' : 'Sara Al-Mansour'}
                       rating={4}
                       comment={isRtl ? 'الخدمة كانت جيدة جداً، السائق كان متعاوناً جداً. فقط تأخر 10 دقائق عن الموعد الأصلي لكنه عوض ذلك بالسرعة في العمل.' : 'The service was very good, the driver was very cooperative. He was only 10 minutes late from the original time but compensated for that with speed in work.'}
                       date={isRtl ? 'منذ أسبوع' : 'A week ago'}
                       isRtl={isRtl}
                     />
                     <ReviewItem 
                       name={isRtl ? 'عبدالله حسن' : 'Abdullah Hassan'}
                       rating={5}
                       comment={isRtl ? 'ممتاز وسريع وأمين. شكراً جزيلاً.' : 'Excellent, fast and honest. Thank you very much.'}
                       date={isRtl ? 'منذ شهر' : 'A month ago'}
                       isRtl={isRtl}
                     />
                  </div>
               </div>
            </div>
          } />
          <Route path="profile" element={<DriverProfilePage />} />
          <Route path="*" element={<Navigate to="/b2c/driver" replace />} />
        </Routes>

        {/* Withdraw Modal */}
        {showWithdrawModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
             <div className="bg-white rounded-[40px] p-8 max-w-md w-full shadow-2xl space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                   <CreditCard size={32} />
                </div>
                <div className="space-y-2">
                   <h3 className="text-xl font-bold">{t('withdraw_balance')}</h3>
                   <p className="text-sm text-muted-foreground">{isRtl ? 'سيتم تحويل المبلغ إلى حسابك البنكي المسجل خلال 24-48 ساعة عمل بعد موافقة الإدارة.' : 'After admin approval, funds transfer to your registered bank account within 24–48 business hours.'}</p>
                </div>
                <div className="space-y-4">
                   <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{t('available_balance')}</p>
                      <p className="text-lg font-black">{wallet.balance.toFixed(2)} {t('sar')}</p>
                      {bankDetails ? (
                        <p className="text-[10px] text-gray-500 mt-2 font-mono" dir="ltr">
                          {bankDetails.bankName} · {formatIbanDisplay(bankDetails.iban)}
                        </p>
                      ) : null}
                   </div>
                   <div className="space-y-2">
                      <label className="text-xs font-bold px-2 text-gray-400 uppercase tracking-widest">{isRtl ? 'المبلغ المطلوب' : 'Request Amount'}</label>
                      <input 
                        type="number" 
                        min={10}
                        max={wallet.balance}
                        step="0.01"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="0.00"
                        className={`w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary font-mono font-bold ${isRtl ? 'text-right' : 'text-left'}`}
                      />
                   </div>
                </div>
                <div className="flex gap-4">
                   <button 
                     type="button"
                     disabled={submittingWithdraw}
                     onClick={() => void handleConfirmWithdraw()}
                     className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all disabled:opacity-50"
                   >
                     {submittingWithdraw ? (isRtl ? 'جاري الإرسال...' : 'Submitting...') : t('confirm')}
                   </button>
                   <button 
                     type="button"
                     onClick={() => setShowWithdrawModal(false)}
                     className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                   >
                     {t('cancel')}
                   </button>
                </div>
             </div>
          </div>
        )}

        {/* Bank Modal */}
        {showBankModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
             <div className="bg-white rounded-[40px] p-8 max-w-md w-full shadow-2xl space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                   <ShieldCheck size={32} />
                </div>
                <div className="space-y-2">
                   <h3 className="text-xl font-bold">{t('bank_details')}</h3>
                   <p className="text-sm text-muted-foreground">{isRtl ? 'تأكد من صحة بيانات الآيبان لضمان وصول مستحقاتك دون تأخير.' : 'Ensure the IBAN details are correct to ensure your dues arrive without delay.'}</p>
                </div>
                <div className="space-y-4">
                   <div className="space-y-2">
                      <label className="text-xs font-bold px-2 text-gray-400 uppercase tracking-widest">{isRtl ? 'اسم صاحب الحساب' : 'Account holder'}</label>
                      <input 
                        type="text" 
                        value={accountHolderName}
                        onChange={(e) => setAccountHolderName(e.target.value)}
                        className={`w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary font-bold ${isRtl ? 'text-right' : 'text-left'}`}
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-xs font-bold px-2 text-gray-400 uppercase tracking-widest">{isRtl ? 'اسم البنك' : 'Bank Name'}</label>
                      <input 
                        type="text" 
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder={isRtl ? 'مصرف الراجحي' : 'Al Rajhi Bank'}
                        className={`w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary font-bold ${isRtl ? 'text-right' : 'text-left'}`}
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-xs font-bold px-2 text-gray-400 uppercase tracking-widest">{isRtl ? 'رقم الآيبان (IBAN)' : 'IBAN Number'}</label>
                      <input 
                        type="text" 
                        value={iban}
                        onChange={(e) => setIban(e.target.value)}
                        placeholder="SA0380000000608010167519"
                        dir="ltr"
                        className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary font-mono font-bold text-left"
                      />
                   </div>
                </div>
                <div className="flex gap-4">
                   <button 
                     type="button"
                     disabled={savingBank}
                     onClick={() => void handleSaveBankDetails()}
                     className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all disabled:opacity-50"
                   >
                     {savingBank ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : t('save')}
                   </button>
                   <button 
                     type="button"
                     onClick={() => setShowBankModal(false)}
                     className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                   >
                     {t('close')}
                   </button>
                </div>
             </div>
          </div>
        )}
      </div>

      {isActiveTrip && latestOrder && (
        <>
          <OrderDriverCallModal
            open={showCustomerCallModal}
            onClose={() => setShowCustomerCallModal(false)}
            title={isRtl ? 'اتصال بالعميل' : 'Call customer'}
            driverName={
              latestOrder.customerName ||
              (isRtl ? 'العميل' : 'Customer')
            }
            phone={latestOrder.customerPhone || null}
            isRtl={isRtl}
          />
          <OrderTripChatModal
            open={showTripChatModal}
            onClose={() => setShowTripChatModal(false)}
            orderId={chatOrderId || latestOrder.id}
            senderRole="driver"
            senderName={profile?.name || (isRtl ? 'السائق' : 'Driver')}
            peerLabel={
              latestOrder.customerName ||
              (isRtl ? 'العميل' : 'Customer')
            }
            isRtl={isRtl}
          />
        </>
      )}
    </DashboardLayout>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode, label: string, value: string, subValue: string, isRtl: boolean }> = ({ icon, label, value, subValue, isRtl }) => (
  <div className={`bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm hover:translate-y-[-4px] transition-all ${isRtl ? 'text-right' : 'text-left'}`}>
    <div className={`w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-6 shadow-inner ${isRtl ? 'ml-auto' : 'mr-auto'}`}>
      {icon}
    </div>
    <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-widest">{label}</p>
    <h4 className="text-2xl font-extrabold mb-2 font-mono">{value}</h4>
    <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest">{subValue}</p>
  </div>
);

const HistoryItem: React.FC<{ type: string, price: number, date: string, isRtl: boolean, t: any }> = ({ type, price, date, isRtl, t }) => (
  <div className="flex items-center justify-between p-5 bg-white rounded-3xl border border-gray-50 hover:border-primary/20 transition-all cursor-pointer group">
    <div className={`flex items-center gap-4 ${isRtl ? '' : 'flex-row-reverse'}`}>
      <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-primary/10 group-hover:text-primary transition-all">
        <CheckCircle2 size={24} />
      </div>
      <div className={isRtl ? 'text-right' : 'text-left'}>
        <h4 className="font-bold text-sm">{type}</h4>
        <p className="text-[10px] text-muted-foreground">{date}</p>
      </div>
    </div>
    <div className={isRtl ? 'text-left' : 'text-right'}>
      <p className="font-mono font-bold text-sm">{price.toFixed(2)} {t('sar')}</p>
      <p className="text-[10px] text-green-500 font-bold uppercase tracking-wider">{t('completed')}</p>
    </div>
  </div>
);

const RatingBar: React.FC<{ label: string, value: number }> = ({ label, value }) => (
  <div className="space-y-2">
    <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
      <span className="text-gray-500">{label}</span>
      <span>{value}%</span>
    </div>
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div 
        className="h-full bg-primary transition-all duration-1000" 
        style={{ width: `${value}%` }}
      />
    </div>
  </div>
);

const ReviewItem: React.FC<{ name: string, rating: number, comment: string, date: string, isRtl: boolean }> = ({ name, rating, comment, date, isRtl }) => (
  <div className={`py-6 space-y-3 ${isRtl ? 'text-right' : 'text-left'}`}>
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-500">
          {name[0]}
        </div>
        <div>
          <h4 className="font-bold text-sm">{name}</h4>
          <p className="text-[10px] text-gray-400">{date}</p>
        </div>
      </div>
      <div className="flex gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star key={i} size={12} className={i < rating ? 'text-primary fill-primary' : 'text-gray-200'} />
        ))}
      </div>
    </div>
    <p className="text-sm text-gray-600 leading-relaxed font-medium">
      {comment}
    </p>
  </div>
);

export default DriverDashboard;
