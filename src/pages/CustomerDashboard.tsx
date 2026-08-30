import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Link, useLocation, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import DashboardLayout from '@/components/DashboardLayout';
import { MapPin, Navigation, Clock, CreditCard, ChevronLeft, Truck, Package, Droplets, Container, ShieldCheck, CheckCircle2, Navigation2, Search, ArrowRight, Share2, Info, AlertCircle, History, Wallet } from 'lucide-react';
import { Order, LogisticsServiceType } from '@/types';
import { fetchPricing, PricingConfig, db, ensureFirebaseReady, auth, waitForFirebaseAuthUid } from '@/lib/firebase';
import { calculateOrderPrice } from '@/lib/pricing';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot, collection, query, where, limit, getDoc } from 'firebase/firestore';
import { loadDemoOrderFromSession } from '@/lib/orderService';
import { prepareCheckoutDraft, clearCheckoutDraft, loadCheckoutDraft } from '@/lib/checkoutDraft';
import {
  loadLocalBroadcastOrders,
  LOCAL_ORDERS_CHANGED_EVENT,
  subscribeLocalBroadcastOrders,
  upsertLocalBroadcastOrder,
} from '@/lib/localOrderBridge';
import { mapOrderStatusToTrackingUI, normalizeOrderStatus, isActiveTripStatus, clientTimelineStep, preferFresherOrderStatus } from '@/domain/order-status';
import { FREE_SERVICE_FEE_ORDERS } from '@/domain/financials';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import { countCustomerPaidOrders } from '@/lib/customerOrderCount';
import {
  creditLocalCustomerWallet,
  loadLocalCustomerWallet,
  mergeWalletTransactions,
  parseWalletTransactions,
  subscribeLocalCustomerWallet,
  type CustomerWalletTransaction,
} from '@/lib/localCustomerWallet';
import { isLocalDevRuntime } from '@/lib/localDevRuntime';
import { useTripChatUnread } from '@/hooks/useTripChatUnread';
import { TripChatNotifyButton } from '@/components/TripChatNotifyButton';
import { useAuth } from '@/hooks/useAuth';
import { allowsDemoCheckout } from '@/lib/checkoutGating';
import { createPaymentIntent, type CheckoutPaymentMethod } from '@/lib/paymentService';
import { subscribeToDriverLocation, type LiveDriverPosition } from '@/lib/liveTracking';
import { LiveTrackingMap } from '@/components/LiveTrackingMap';
import { getOrderTripCoordinates } from '@/lib/orderGeo';
import { OrderDriverCallModal } from '@/components/OrderDriverCallModal';
import { OrderTripChatModal } from '@/components/OrderTripChatModal';
import { resolveDriverPhoneFromOrder } from '@/lib/orderChat';

import { SERVICE_OPTIONS, OPTION_LABELS, SERVICE_KEY_MAP } from '@/constants';

import { LocationAutocomplete } from '@/components/LocationAutocomplete';
import { BookingLocationMap, type BookingPinTarget } from '@/components/BookingLocationMap';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { getCurrentPosition } from '@/lib/geolocation';
import {
  findNearestOnlineDriver,
  type NearestDriverMatch,
} from '@/lib/driverPresence';
import {
  INCLUDED_KM,
  defaultPricingForService,
} from '@/lib/pricingDefaults';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  resolveTankCapacityLabel,
  sanitizeWaterTankerDistanceKm,
  waterTankerExtraKm,
} from '@/lib/waterTankerDistance';
import {
  WATER_SERVICE_TYPES,
  WATER_TANKER_CAPACITIES,
  type WaterServiceType,
  normalizeWaterServiceType,
} from '@/lib/waterTankerCatalog';
import { formatOrderServiceLabel, translateWaterType, translateCapacity } from '@/lib/serviceLabels';
import { buildCheckoutFromQuote, calculateTotal } from '@/lib/checkoutTotal';
import { tripDistanceKm } from '@/lib/tripDistance';
import { canonicalizeServiceType } from '@/domain/serviceCategories';
import {
  orderDispatchStartedAt,
  resolveDispatchWindow,
} from '@/domain/dispatchMatching';
import { isWaterTankerService } from '@/domain/waterTanker';

/** Water tanker is delivery-only (GPS = dropoff). All other services use GPS as pickup. */
function isDeliveryOnlyService(service: LogisticsServiceType): boolean {
  return isWaterTankerService(service);
}

const services = (t: any) => [
  { 
    id: 'furniture_moving', 
    label: t('furniture_moving'), 
    icon: <Package size={20} />,
    details: {
      label: t('furniture_size') || 'Furniture Size'
    }
  },
  { 
    id: 'flatbed', 
    label: t('flatbed'), 
    icon: <Truck size={20} />, 
    details: { 
      label: t('choose_service') 
    } 
  },
  { 
    id: 'water_tanker', 
    label: t('water_tanker'), 
    icon: <Droplets size={20} />, 
    details: { 
      label: t('water_capacity') || 'Capacity'
    } 
  },
  { 
    id: 'heavy_equipment', 
    label: t('heavy_equipment'), 
    icon: <Container size={20} />, 
    details: { 
      label: t('equipment_class') || (t('choose_service'))
    } 
  },
  { 
    id: 'refrigerated', 
    label: t('refrigerated'), 
    icon: <ShieldCheck size={20} />,
    details: {
      label: t('cooling_type') || 'Cooling Type'
    }
  },
  { 
    id: 'goods_transport', 
    label: t('cargo') || 'Cargo Transport', 
    icon: <Package size={20} />, 
    details: { 
      label: t('cargo_type') || 'Cargo Type'
    } 
  },
];

const CustomerDashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const isRtl = i18n.language === 'ar';
  const location = useLocation();
  const navigate = useNavigate();
  const serviceList = services(t);
  const [step, setStep] = useState<'booking' | 'payment' | 'tracking' | 'rating'>('booking');
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [serviceType, setServiceType] = useState<LogisticsServiceType>('furniture_moving');
  const [serviceOption, setServiceOption] = useState<string>('');
  const [waterType, setWaterType] = useState<WaterServiceType | ''>('');
  const [goodsType, setGoodsType] = useState('');
  const [truckCount, setTruckCount] = useState(1);
  const [furnitureDescription, setFurnitureDescription] = useState('');
  const [vehicleFieldNotes, setVehicleFieldNotes] = useState({
    keyInside: false,
    tiresFlat: false,
    brokenDown: false,
    extraNotes: '',
  });
  // Now fixed to inside/outside based on calculation result only, or just hidden from direct manual toggle
  const [transportType, setTransportType] = useState<'inside' | 'outside'>('inside');
  const [pickup, setPickup] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [pickupCoords, setPickupCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [destination, setDestination] = useState('');
  const [dropoffCity, setDropoffCity] = useState('');
  const [destinationCoords, setDestinationCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [activeMapPin, setActiveMapPin] = useState<BookingPinTarget>('pickup');
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [nearestDriver, setNearestDriver] = useState<NearestDriverMatch | null>(null);
  const [includedKm, setIncludedKm] = useState(INCLUDED_KM);
  const [extraDistanceKm, setExtraDistanceKm] = useState(0);
  /** Geographic kilometers only (driver→client or pickup→dropoff). Never tank liters. */
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);
  /** Water tanker volume label only ("1000L" | "3000L" | "5000L") — display/pricing base, never km. */
  const [tankCapacityLabel, setTankCapacityLabel] = useState('');
  const [truckType, setTruckType] = useState<'normal' | 'hydraulic' | 'box'>('normal');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const activeOrderRef = useRef<Order | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<Order['status']>('searching_driver');
  const [isCalculated, setIsCalculated] = useState(false);
  const [isPriceCapApplied, setIsPriceCapApplied] = useState(false);
  const [tripTypeState, setTripTypeState] = useState<'inside_city' | 'outside_city'>('inside_city');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  /** Unpaid checkout draft — never written to `orders` until payment succeeds. */
  const [checkoutDraftId, setCheckoutDraftId] = useState<string | null>(null);
  const [checkoutMethod, setCheckoutMethod] = useState<CheckoutPaymentMethod>('mada');
  const [driverLocation, setDriverLocation] = useState<LiveDriverPosition | null>(null);
  const [dispatchTick, setDispatchTick] = useState(0);
  const [routeData, setRouteData] = useState<any>(null);
  const [showDriverCallModal, setShowDriverCallModal] = useState(false);
  const [showDriverChatModal, setShowDriverChatModal] = useState(false);

  // Wallet — Firestore when a server-owned wallets/{uid} exists; otherwise 0.
  const [walletBalance, setWalletBalance] = useState(0);
  const [transactions, setTransactions] = useState<CustomerWalletTransaction[]>([]);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);

  const scrollToHistory = () => {
    historyRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const [pricing, setPricing] = useState({ 
    total: 0, 
    base: 0, 
    extraKm: 0, 
    serviceFee: 0, 
    commission_amount: 0,
    driver_earning: 0, 
    rate: 0, 
    transport: transportType, 
    isServiceFeeFree: false, 
    truckCount: 1, 
    surgeApplied: false,
    pricingSnapshot: null as null | {
      base_price: number;
      price_per_km: number;
      surge_multiplier: number;
      minimum_price: number;
      platform_commission_percentage: number;
      hydraulic_multiplier: number;
      max_price_outside: number;
    },
    financials: null as null | Record<string, unknown>,
  });

  /** Final checkout total — always base + extra distance + platform fee (no legacy totals). */
  const checkoutBreakdown = calculateTotal({
    basePrice: pricing.base,
    extraDistanceFee: pricing.extraKm,
    platformFee: pricing.serviceFee,
  });
  const checkoutTotal = checkoutBreakdown.total;

  const [previousOrdersCount, setPreviousOrdersCount] = useState(0);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const [isLoadingPricing, setIsLoadingPricing] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [isMapVisible, setIsMapVisible] = useState(false);

  const routesLib = useMapsLibrary('routes');
  const geocodingLib = useMapsLibrary('geocoding');
  const map = useMap();
  const deliveryOnly = isDeliveryOnlyService(serviceType);

  const reverseGeocodeCoords = async (
    coords: google.maps.LatLngLiteral
  ): Promise<string> => {
    if (!geocodingLib) {
      return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    }
    try {
      const geocoder = new geocodingLib.Geocoder();
      const { results } = await geocoder.geocode({ location: coords });
      return results?.[0]?.formatted_address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    } catch {
      return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    }
  };

  /** Apply live GPS: water tanker → delivery; transport → pickup start. */
  const applyUserGpsLocation = async (
    coords: google.maps.LatLngLiteral,
    options?: { force?: boolean }
  ) => {
    const address = await reverseGeocodeCoords(coords);
    setUserLocation(coords);
    setGpsError(null);

    if (isDeliveryOnlyService(serviceType)) {
      // Delivery-only: customer sets drop-off only — never require a pickup pin.
      if (options?.force || !destinationCoords) {
        setDestinationCoords(coords);
        setDestination(address);
      }
      setPickupCoords(null);
      setPickup('');
      setActiveMapPin('destination');
    } else {
      if (options?.force || !pickupCoords) {
        setPickupCoords(coords);
        setPickup(address);
      }
      setActiveMapPin('destination');
    }
    setIsCalculated(false);
  };

  const locateUser = async (force = false) => {
    setLocatingGps(true);
    setGpsError(null);
    try {
      const pos = await getCurrentPosition();
      const coords = { lat: pos.lat, lng: pos.lng };
      await applyUserGpsLocation(coords, { force });
      toast.success(
        isRtl ? 'تم تحديد موقعك الحالي على الخريطة' : 'Map centered on your current location'
      );
    } catch (err) {
      console.warn('[booking] geolocation failed:', err);
      const code = (err as { code?: string })?.code;
      const msg =
        code === 'LOCATION_PERMISSION_DENIED'
          ? isRtl
            ? 'يرجى السماح بالوصول إلى الموقع لاستخدام الخريطة'
            : 'Please allow location access to use the map'
          : isRtl
            ? 'تعذر الحصول على موقعك الحالي'
            : 'Could not get your current location';
      setGpsError(msg);
      toast.error(msg);
    } finally {
      setLocatingGps(false);
    }
  };

  // Request device GPS when entering booking; remap when service type changes.
  useEffect(() => {
    if (step !== 'booking') return;

    let cancelled = false;

    const seedGps = async () => {
      setLocatingGps(true);
      setGpsError(null);
      try {
        let coords = userLocation;
        if (!coords) {
          const pos = await getCurrentPosition();
          coords = { lat: pos.lat, lng: pos.lng };
        }
        if (cancelled || !coords) return;
        await applyUserGpsLocation(coords, { force: true });
      } catch (err) {
        if (cancelled) return;
        console.warn('[booking] geolocation failed:', err);
        const code = (err as { code?: string })?.code;
        const msg =
          code === 'LOCATION_PERMISSION_DENIED'
            ? isRtl
              ? 'يرجى السماح بالوصول إلى الموقع لاستخدام الخريطة'
              : 'Please allow location access to use the map'
            : isRtl
              ? 'تعذر الحصول على موقعك الحالي'
              : 'Could not get your current location';
        setGpsError(msg);
      } finally {
        if (!cancelled) setLocatingGps(false);
      }
    };

    void seedGps();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on booking entry / service switch
  }, [step, serviceType]);

  // Keep pin mode in sync with service (delivery-only always edits destination).
  useEffect(() => {
    if (deliveryOnly) {
      setActiveMapPin('destination');
      // Clear any leftover pickup from a previous transport booking.
      setPickupCoords(null);
      setPickup('');
    } else if (!pickupCoords) {
      setActiveMapPin('pickup');
    }
  }, [deliveryOnly]); // eslint-disable-line react-hooks/exhaustive-deps -- only on mode switch

  useEffect(() => {
    const loadPricingConfig = async () => {
      setPricingConfig(defaultPricingForService(serviceType));
      try {
        setIsLoadingPricing(true);
        const config = await fetchPricing(serviceType);
        setPricingConfig(config);
        setPricingError(null);
      } catch (err) {
        console.warn('[pricing] Using built-in rates after fetch failure:', err);
        setPricingConfig(defaultPricingForService(serviceType));
        setPricingError(null);
      } finally {
        setIsLoadingPricing(false);
      }
    };
    loadPricingConfig();
  }, [serviceType]);

  /** Live paid-order count for the first-3-orders service-fee promo. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const uid = await ensureSignedInFirebaseUid(8000);
        if (cancelled || !uid) return;
        const count = await countCustomerPaidOrders(uid);
        if (!cancelled) setPreviousOrdersCount(count);
      } catch {
        const uid = auth.currentUser?.uid;
        if (!uid || cancelled) return;
        try {
          const count = await countCustomerPaidOrders(uid);
          if (!cancelled) setPreviousOrdersCount(count);
        } catch {
          /* keep current count */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.uid, pendingOrderId, step]);

  /** Dummy / Firestore customer wallet — deducts when an order is placed. */
  useEffect(() => {
    let cancelled = false;
    let unsubFs: (() => void) | undefined;
    let unsubLocal: (() => void) | undefined;

    void (async () => {
      let uid = auth.currentUser?.uid || profile?.uid || '';
      try {
        uid = await ensureSignedInFirebaseUid(8000);
      } catch {
        uid = auth.currentUser?.uid || profile?.uid || '';
      }
      if (cancelled || !uid) return;

      const applyLocal = () => {
        if (cancelled) return;
        const local = loadLocalCustomerWallet(uid);
        setWalletBalance(local.balance);
        setTransactions((prev) => mergeWalletTransactions(local.transactions, prev));
      };
      applyLocal();
      unsubLocal = subscribeLocalCustomerWallet(uid, applyLocal);

      try {
        await ensureFirebaseReady();
        unsubFs = onSnapshot(
          doc(db, 'wallets', uid),
          (snap) => {
            if (cancelled) return;
            const local = loadLocalCustomerWallet(uid);
            if (snap.exists()) {
              const data = snap.data() as Record<string, unknown>;
              const remote = Number(data.balance);
              if (Number.isFinite(remote)) {
                setWalletBalance(remote);
              } else {
                setWalletBalance(local.balance);
              }
              setTransactions(
                mergeWalletTransactions(
                  parseWalletTransactions(data.transactions),
                  local.transactions
                )
              );
              return;
            }
            applyLocal();
          },
          () => applyLocal()
        );
      } catch {
        applyLocal();
      }
    })();

    return () => {
      cancelled = true;
      unsubFs?.();
      unsubLocal?.();
    };
  }, [profile?.uid]);

  // After payment: never bounce back to the services grid.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const onOrders = /\/orders\/?$/.test(location.pathname);

    if (params.get('payment') === 'failed') {
      toast.error(isRtl ? 'فشل الدفع. يمكنك المحاولة مرة أخرى.' : 'Payment failed. You can try again.');
      if (!onOrders) setStep('payment');
      return;
    }

    if (params.get('payment') === 'success' || params.get('placed')) {
      toast.success(isRtl ? 'تم إنشاء الطلب بنجاح' : 'Order placed successfully');
      return;
    }

    const trackOrderId = params.get('track');
    if (!trackOrderId || onOrders) return;

    setCheckoutDraftId(null);
    clearCheckoutDraft();
    setPendingOrderId(trackOrderId);
    setTrackingStatus('searching_driver');
    setStep('tracking');
    sessionStorage.removeItem('pending_order_id');
    sessionStorage.removeItem('pending_checkout_draft_id');
  }, [location.search, location.pathname, isRtl]);

  // Authenticated entry to client home (e.g. "Order a Shipment Now") opens the 6-service grid.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('track') || params.get('payment') || params.get('placed')) {
      return;
    }
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/b2c/client' || path === '/customer') {
      setStep('booking');
    }
  }, [location.pathname, location.search]);

  // Live order status — Firestore + local broadcast, never rewind a later trip step.
  React.useEffect(() => {
    if (step !== 'tracking' || !pendingOrderId) return;

    let unsub: (() => void) | undefined;
    let cancelled = false;
    let ratingTimer: number | undefined;

    const applyLiveOrder = (incoming: Order) => {
      if (cancelled) return;
      const prev = activeOrderRef.current;
      const merged: Order = prev
        ? {
            ...prev,
            ...incoming,
            status: preferFresherOrderStatus(prev.status, incoming.status),
            driver: incoming.driver || prev.driver,
          }
        : incoming;
      activeOrderRef.current = merged;
      setActiveOrder(merged);
      const uiStatus = mapOrderStatusToTrackingUI(merged.status);
      setTrackingStatus(uiStatus);
      const trip = getOrderTripCoordinates(merged);
      if (trip.pickup) setPickupCoords(trip.pickup);
      if (trip.dropoff) setDestinationCoords(trip.dropoff);
      if (uiStatus === 'completed' && !ratingTimer) {
        ratingTimer = window.setTimeout(() => {
          if (!cancelled) setStep('rating');
        }, 2000);
      }
    };

    const hydrateFromDemoSession = () => {
      const demo = loadDemoOrderFromSession(pendingOrderId);
      if (!demo) return false;
      const pickupPt =
        Number.isFinite(demo.pickupLat) && Number.isFinite(demo.pickupLng)
          ? { lat: demo.pickupLat, lng: demo.pickupLng }
          : null;
      const dropoffPt =
        Number.isFinite(demo.dropoffLat) && Number.isFinite(demo.dropoffLng)
          ? { lat: demo.dropoffLat, lng: demo.dropoffLng }
          : null;

      if (pickupPt) setPickupCoords(pickupPt);
      if (dropoffPt) setDestinationCoords(dropoffPt);
      if (demo.pickupAddress) setPickup(demo.pickupAddress);
      if (demo.dropoffAddress) setDestination(demo.dropoffAddress);

      applyLiveOrder({
        id: pendingOrderId,
        userId: String(demo.quote?.uid || profile?.uid || 'demo'),
        serviceType: demo.serviceType as LogisticsServiceType,
        pickup: demo.pickupAddress,
        destination: demo.dropoffAddress,
        pickupAddress: demo.pickupAddress,
        dropoffAddress: demo.dropoffAddress,
        pickupLat: demo.pickupLat,
        pickupLng: demo.pickupLng,
        dropoffLat: demo.dropoffLat,
        dropoffLng: demo.dropoffLng,
        pickupCoords: pickupPt || undefined,
        destinationCoords: dropoffPt || undefined,
        distance: demo.distanceKm,
        distanceKm: demo.distanceKm,
        status: 'broadcasting',
        serviceDetails: demo.serviceDetails || {},
      } as Order);
      return true;
    };

    const applyLocalOrder = () => {
      const local = loadLocalBroadcastOrders().find((entry) => entry.id === pendingOrderId);
      if (!local) return false;
      applyLiveOrder({
        id: pendingOrderId,
        ...(local.data as object),
      } as Order);
      return true;
    };

    if (!applyLocalOrder()) {
      if (
        allowsDemoCheckout() &&
        (pendingOrderId.startsWith('demo-') || pendingOrderId.startsWith('draft-'))
      ) {
        hydrateFromDemoSession();
      }
    }
    const unsubLocal = subscribeLocalBroadcastOrders(applyLocalOrder);

    void ensureFirebaseReady().then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db, 'orders', pendingOrderId),
        (snap) => {
          if (!snap.exists()) {
            if (!applyLocalOrder()) {
              if (
                allowsDemoCheckout() &&
                (pendingOrderId.startsWith('demo-') ||
                  pendingOrderId.startsWith('draft-'))
              ) {
                hydrateFromDemoSession();
              }
            }
            return;
          }
          const data = snap.data() as Record<string, unknown>;
          applyLiveOrder({
            id: pendingOrderId,
            ...(data as object),
          } as Order);
        },
        (error) => {
          console.warn('[CustomerDashboard] order tracking listen failed:', error);
          applyLocalOrder();
        }
      );
    });

    return () => {
      cancelled = true;
      unsub?.();
      unsubLocal();
      if (ratingTimer) window.clearTimeout(ratingTimer);
    };
  }, [step, pendingOrderId, profile?.uid]);

  // Live driver GPS — orders/{orderId}/tracking/live
  useEffect(() => {
    if (step !== 'tracking' || !pendingOrderId) return;
    return subscribeToDriverLocation(pendingOrderId, setDriverLocation);
  }, [step, pendingOrderId]);

  useEffect(() => {
    if (step !== 'tracking' || trackingStatus !== 'searching_driver') return;
    const timer = window.setInterval(() => setDispatchTick((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, [step, trackingStatus]);

  const handleCalculate = async () => {
    if (serviceType === 'water_tanker' && !waterType) {
      toast.error(
        isRtl ? 'يرجى اختيار نوع خدمة المياه' : 'Please select a water service type'
      );
      return;
    }
    if (!serviceOption) {
      toast.error(
        deliveryOnly
          ? isRtl
            ? 'يرجى اختيار سعة الصهريج'
            : 'Please select a tank capacity'
          : isRtl
            ? 'يرجى اختيار نوع المركبة / الفئة'
            : 'Please select a vehicle / service tier'
      );
      return;
    }

    // Drop stale match / distance from a previous pin set before recomputing.
    setNearestDriver(null);
    setRouteDistanceKm(0);

    if (deliveryOnly) {
      if (!destinationCoords) {
        toast.error(
          isRtl
            ? 'يرجى السماح بالموقع أو تعيين موقع التنزيل'
            : 'Allow location access or set a drop-off point'
        );
        return;
      }
    } else if (!pickupCoords || !destinationCoords) {
      toast.error(t('booking_error_location'));
      return;
    }

    setIsLoadingPricing(true);
    setPricingError(null);
    try {
      let distKm = 0;
      let matched: NearestDriverMatch | null = null;

      // Capacity is a TEXT LABEL only — never assigned to distance/km variables.
      const capacityLabel =
        serviceType === 'water_tanker'
          ? resolveTankCapacityLabel(serviceOption)
          : '';
      if (serviceType === 'water_tanker') {
        setTankCapacityLabel(capacityLabel);
      } else {
        setTankCapacityLabel('');
      }

      if (deliveryOnly) {
        // Water tanker: billable distance = nearest matching tanker → drop-off.
        matched = await findNearestOnlineDriver(destinationCoords!, 'water_tanker');
        distKm = sanitizeWaterTankerDistanceKm(
          matched.distanceKm,
          WATER_TANKER_MOCK_DISTANCE_KM
        );
        setNearestDriver({ ...matched, distanceKm: distKm });
        setRouteData(null);

        // Origin for dispatch = nearest tanker position (not a customer "from" pin).
        if (matched.driver && Number.isFinite(matched.driver.lat) && Number.isFinite(matched.driver.lng)) {
          const origin = { lat: matched.driver.lat, lng: matched.driver.lng };
          setPickupCoords(origin);
          setPickup(
            matched.driver.name
              ? isRtl
                ? `أقرب صهريج — ${matched.driver.name}`
                : `Nearest tanker — ${matched.driver.name}`
              : isRtl
                ? 'موقع أقرب صهريج متاح'
                : 'Nearest available tanker'
          );
        } else {
          setPickupCoords(null);
          setPickup('');
        }

        if (matched.estimated) {
          toast.info(
            isRtl
              ? `تم استخدام مسافة تقديرية ${distKm} كم لأقرب صهريج (السعة ${capacityLabel} ليست مسافة)`
              : `Using estimated ${distKm} km to nearest tanker (capacity ${capacityLabel} is not distance)`
          );
        }
      } else {
        setNearestDriver(null);
        if (!routesLib) throw new Error('Maps Routes library not loaded');

        const { routes } = await routesLib.Route.computeRoutes({
          origin: pickupCoords!,
          destination: destinationCoords!,
          travelMode: 'DRIVING',
          fields: ['distanceMeters', 'durationMillis', 'viewport', 'path'],
        });

        if (!routes?.[0]) throw new Error(isRtl ? 'لم يتم العثور على مسار صالح' : 'No valid route found');

        const route = routes[0];
        setRouteData(route);
        // Exact pickup→dropoff: prefer road meters, else haversine on the same coords.
        distKm = tripDistanceKm({
          pickup: pickupCoords!,
          dropoff: destinationCoords!,
          roadDistanceMeters: route.distanceMeters,
          minimumKm: 0.1,
        });

        if (map && route.viewport) {
          map.fitBounds(route.viewport, { top: 50, right: 50, bottom: 50, left: 50 });
        }
      }

      setRouteDistanceKm(distKm);

      const mockPickupCity = 'Riyadh';
      const mockDropoffCity = !deliveryOnly && distKm > 100 ? 'Jeddah' : 'Riyadh';

      setPickupCity(mockPickupCity);
      setDropoffCity(mockDropoffCity);
      setTransportType(!deliveryOnly && distKm > 100 ? 'outside' : 'inside');

      const calcResult = await calculateOrderPrice(
        distKm,
        serviceType,
        mockPickupCity,
        mockDropoffCity,
        serviceType === 'flatbed'
          ? (serviceOption === 'hydraulic' ? 'hydraulic' : serviceOption === 'box' ? 'box' : 'normal')
          : truckType,
        truckCount,
        previousOrdersCount,
        capacityLabel || undefined,
        serviceOption,
        serviceType === 'water_tanker' ? waterType || undefined : undefined
      );

      const calc = calcResult as any;
      const nextIncluded =
        typeof calc.includedKm === 'number' ? calc.includedKm : INCLUDED_KM;
      const nextExtra =
        typeof calc.extraDistanceKm === 'number'
          ? calc.extraDistanceKm
          : Math.max(0, distKm - nextIncluded);

      setIncludedKm(nextIncluded);
      setExtraDistanceKm(nextExtra);

      const checkout = buildCheckoutFromQuote({
        base: calc.base,
        extraKm: calc.extraKm,
        serviceFee: calc.financials?.serviceFee ?? calc.serviceFee,
        isServiceFeeFree: Boolean(calc.isServiceFeeFree),
        financials: calc.financials ?? null,
      });

      setPricing({
        total: checkout.total,
        base: checkout.basePrice,
        extraKm: checkout.extraDistanceFee,
        serviceFee: checkout.platformFee,
        commission_amount: calc.financials?.platformFee ?? calc.commission_amount,
        driver_earning: calc.financials?.driverNet ?? calc.driver_earning,
        rate: calc.rate,
        transport: !deliveryOnly && distKm > 100 ? 'outside' : 'inside',
        isServiceFeeFree: Boolean(calc.isServiceFeeFree),
        truckCount,
        surgeApplied: calc.surgeApplied,
        pricingSnapshot: calc.pricingSnapshot || null,
        financials: {
          ...(calc.financials ?? {}),
          tripFare: checkout.basePrice + checkout.extraDistanceFee,
          serviceFee: checkout.platformFee,
          customerTotal: checkout.total,
        },
      });

      setTripTypeState(calc.tripType);
      setIsPriceCapApplied(calc.isPriceCapApplied);
      setIsCalculated(true);
      setIsMapVisible(true);
    } catch (err) {
      console.error('Calculation error:', err);
      const msg = err instanceof Error ? err.message : (isRtl ? 'فشل حساب السعر' : 'Calculation failed');
      toast.error(msg);
      setPricingError(msg);
    } finally {
      setIsLoadingPricing(false);
    }
  };

  const handleBooking = async () => {
    if (!destination || !destinationCoords || !isCalculated) {
      toast.error(isRtl ? 'يرجى حساب السعر أولاً' : 'Please calculate price first');
      return;
    }

    if (!deliveryOnly && (!pickup || !pickupCoords)) {
      toast.error(isRtl ? 'يرجى تحديد نقطتي التحميل والتنزيل' : 'Please set pickup and drop-off');
      return;
    }

    // Water tanker: origin is nearest tanker (from matching), not a customer "from" pin.
    const tankerOrigin = nearestDriver?.driver
      ? { lat: nearestDriver.driver.lat, lng: nearestDriver.driver.lng }
      : pickupCoords;
    const effectivePickupCoords = deliveryOnly
      ? tankerOrigin || destinationCoords
      : pickupCoords;
    const effectivePickup = deliveryOnly
      ? pickup ||
        (isRtl
          ? 'صهريج مملوء — يتوجه لموقع التنزيل'
          : 'Pre-filled tanker — en route to drop-off')
      : pickup;

    setIsProcessing(true);
    toast.loading(isRtl ? 'جاري تجهيز الدفع...' : 'Preparing checkout...', { id: 'booking-toast' });

    try {
      await ensureSignedInFirebaseUid(8000);
      if (!profile?.uid || !effectivePickupCoords || !destinationCoords) {
        throw new Error(isRtl ? 'بيانات الحجز غير مكتملة' : 'Incomplete booking data');
      }

      // Unpaid checkout only — clear any previous paid trip; stay on payment screen.
      setDriverLocation(null);
      setPendingOrderId(null);
      setCheckoutDraftId(null);
      sessionStorage.removeItem('pending_order_id');
      sessionStorage.removeItem('pending_checkout_draft_id');
      clearCheckoutDraft();

      const canonicalService =
        canonicalizeServiceType(serviceType) || serviceType;
      const deliveryOnlyOrder = isWaterTankerService(canonicalService);

      // Draft only — NO Firestore `orders` write and NO driver broadcast.
      const draft = await prepareCheckoutDraft({
        serviceType: canonicalService,
        truckType,
        tripType: tripTypeState,
        serviceDetails: {
          type: serviceOption,
          ...(canonicalService === 'water_tanker'
            ? {
                capacity: tankCapacityLabel || resolveTankCapacityLabel(serviceOption),
                waterType: normalizeWaterServiceType(waterType || 'fresh'),
              }
            : {}),
          goodsType,
          truckCount,
          furnitureDescription,
          vehicleFieldNotes,
        },
        vehicleFieldNotes,
        pickupAddress: effectivePickup,
        dropoffAddress: destination,
        pickupLat: effectivePickupCoords.lat,
        pickupLng: effectivePickupCoords.lng,
        dropoffLat: destinationCoords.lat,
        dropoffLng: destinationCoords.lng,
        distanceKm: routeDistanceKm,
        pickupCity,
        dropoffCity,
        truckCount,
        deliveryOnly: deliveryOnlyOrder,
        locationMode: deliveryOnlyOrder ? 'delivery_only' : 'pickup_destination',
        ...(nearestDriver?.driverId ? { matchedDriverId: nearestDriver.driverId } : {}),
      });

      setCheckoutDraftId(draft.draftId);
      // Keep activeOrder for checkout summary UI only — status is unpaid draft.
      setActiveOrder({
        id: draft.draftId,
        userId: profile.uid,
        serviceType: canonicalService,
        truckType,
        tripType: tripTypeState,
        pickup: effectivePickup,
        destination,
        pickupAddress: effectivePickup,
        dropoffAddress: destination,
        pickupCity,
        dropoffCity,
        pickupLat: effectivePickupCoords.lat,
        pickupLng: effectivePickupCoords.lng,
        dropoffLat: destinationCoords.lat,
        dropoffLng: destinationCoords.lng,
        pickupCoords: { ...effectivePickupCoords },
        destinationCoords: { ...destinationCoords },
        distance: routeDistanceKm,
        distanceKm: routeDistanceKm,
        price: draft.financials.customerTotal,
        createdAt: draft.createdAt,
        status: 'awaiting_payment',
        deliveryOnly: deliveryOnlyOrder,
        locationMode: deliveryOnlyOrder ? 'delivery_only' : 'pickup_destination',
        ...(nearestDriver?.driverId ? { matchedDriverId: nearestDriver.driverId } : {}),
        serviceDetails: {
          type: serviceOption,
          ...(canonicalService === 'water_tanker'
            ? {
                capacity: tankCapacityLabel || resolveTankCapacityLabel(serviceOption),
                waterType: normalizeWaterServiceType(waterType || 'fresh'),
              }
            : {}),
          goodsType,
          truckCount,
          furnitureDescription,
          vehicleFieldNotes,
        },
      } as Order);

      setPricing((prev) => {
        const checkout = calculateTotal({
          basePrice: prev.base,
          extraDistanceFee: prev.extraKm,
          serviceFee: prev.serviceFee,
        });
        return {
          ...prev,
          total: checkout.total,
          commission_amount:
            draft.financials?.platformFee ?? prev.commission_amount,
          driver_earning: draft.financials?.driverNet ?? prev.driver_earning,
          financials: {
            ...(prev.financials ?? {}),
            ...draft.financials,
            tripFare: checkout.basePrice + checkout.extraDistanceFee,
            serviceFee: checkout.serviceFee,
            customerTotal: checkout.total,
          },
        };
      });

      toast.success(isRtl ? 'أكمل الدفع لتأكيد الطلب' : 'Complete payment to confirm your order', {
        id: 'booking-toast',
      });
      // Strip any leftover ?track= so we never auto-open searching on this navigation.
      if (location.search) {
        navigate({ pathname: location.pathname, search: '' }, { replace: true });
      }
      // Stay on in-app payment method selection — do NOT open tracking yet.
      setStep('payment');
    } catch (error) {
      console.error('Error preparing checkout:', error);
      const missingAuth =
        error instanceof Error && error.message === 'NOT_AUTHENTICATED';
      toast.error(
        missingAuth
          ? isRtl
            ? 'جلسة الدخول غير نشطة. سجّل الدخول ثم أعد المحاولة.'
            : 'No active sign-in. Please log in and try again.'
          : isRtl
            ? 'فشل تجهيز الدفع'
            : 'Failed to prepare checkout',
        { id: 'booking-toast' }
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePayment = async () => {
    if (!pricing || checkoutTotal <= 0) {
      toast.error(isRtl ? 'يرجى حساب السعر أولاً' : 'Please calculate price first');
      return;
    }

    if (!checkoutDraftId) {
      toast.error(isRtl ? 'لم يتم العثور على مسودة الدفع' : 'No checkout draft found');
      return;
    }

    // Never open tracking from this click — only leave for the payment gateway/checkout.
    if (step === 'tracking') {
      setStep('payment');
    }

    setIsProcessing(true);
    toast.loading(isRtl ? 'جاري فتح بوابة الدفع...' : 'Opening payment gateway...', {
      id: 'payment-toast',
    });

    try {
      const intent = await createPaymentIntent(checkoutDraftId, checkoutMethod);

      sessionStorage.setItem('pending_checkout_draft_id', checkoutDraftId);
      // Keep UI on payment until the gateway page loads; order/searching only after success callback.
      toast.success(isRtl ? 'جاري توجيهك لصفحة الدفع...' : 'Redirecting to payment page...', {
        id: 'payment-toast',
      });

      // Hard navigation to checkout/gateway — do not call promote / setStep('tracking') here.
      window.location.assign(intent.paymentUrl);
    } catch (error) {
      console.error('Error in payment flow:', error);
      toast.error(isRtl ? 'فشل فتح بوابة الدفع. يرجى المحاولة مرة أخرى.' : 'Could not open payment gateway. Please try again.', {
        id: 'payment-toast',
      });
      setIsProcessing(false);
    }
  };

  const simulateTracking = () => {
    setTimeout(() => {
      setTrackingStatus('on_the_way');
      setActiveOrder(prev => prev ? { 
        ...prev, 
        driver: { name: isRtl ? 'فهد العتيبي' : 'Fahad Al-Otaibi', phone: '0555555555', truckDetails: isRtl ? 'إيسوزو - ب ص م 1234' : 'Isuzu - BSN 1234' } 
      } : null);
      toast.success(t('searching_nearby_driver'));
    }, 5000);

    setTimeout(() => setTrackingStatus('arrived'), 20000);
    setTimeout(() => {
      setTrackingStatus('completed');
      toast.success(t('tracking_completed_msg') || (isRtl ? 'وصلت الشحنة بسلام! شكراً لاستخدامكم Miras' : 'Shipment arrived safely! Thank you for using Miras'));
      setTimeout(() => setStep('rating'), 2000);
    }, 40000);
  };

  const submitRating = () => {
    toast.success(isRtl ? 'شكراً لتقييمك! يساعدنا هذا في تحسين جودة الخدمة' : 'Thank you for your rating! This helps us improve our service');
    setStep('booking');
    setActiveOrder(null);
    setRating(0);
    setFeedback('');
    const uid = auth.currentUser?.uid;
    if (uid) {
      void countCustomerPaidOrders(uid).then(setPreviousOrdersCount);
    } else {
      setPreviousOrdersCount((prev) => prev + 1);
    }
  };

  const chatOrderId =
    activeOrder?.id &&
    (activeOrder.driver ||
      activeOrder.driverId ||
      isActiveTripStatus(activeOrder.status))
      ? activeOrder.id
      : null;
  const openTripChat = () => {
    if (!chatOrderId) return;
    setShowDriverChatModal(true);
  };
  const chatUnreadCount = useTripChatUnread({
    orderId: chatOrderId,
    currentUserId: auth.currentUser?.uid || profile?.uid || '',
    myRole: 'customer',
    chatOpen: showDriverChatModal,
    enabled: Boolean(chatOrderId),
    isRtl,
    onOpen: openTripChat,
  });

  const getPageTitle = () => {
    if (location.pathname === '/b2c/client/orders' || location.pathname === '/customer/orders') return t('my_orders');
    if (location.pathname === '/b2c/client/wallet' || location.pathname === '/customer/wallet') return t('wallet');
    return t('inside_city') + ' & ' + t('outside_city');
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
      <Routes>
        <Route index element={
          <AnimatePresence mode="wait">
            {step === 'booking' && (
              <motion.div 
                key="booking-step"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-8"
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                <div className="lg:col-span-2 space-y-8">
                  <div className={`bg-white p-5 md:p-8 rounded-[32px] md:rounded-[40px] border border-gray-100 shadow-sm space-y-6 md:space-y-8 ${isRtl ? 'text-right' : 'text-left'}`}>
                    <h2 className="text-2xl font-bold">{t('new_booking')}</h2>
                    
                    {/* Service Selection */}
                    <div className="space-y-4">
                      <p className="text-sm font-bold text-gray-500">{t('choose_service')}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {serviceList.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setServiceType(s.id);
                              setServiceOption('');
                              setWaterType('');
                              setTankCapacityLabel('');
                              setRouteDistanceKm(0);
                              setExtraDistanceKm(0);
                              setNearestDriver(null);
                              setIsCalculated(false);
                            }}
                            className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all ${
                              serviceType === s.id ? 'border-primary bg-primary/5 text-black font-bold shadow-lg shadow-primary/5' : 'border-gray-100 hover:border-gray-300 text-gray-500'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${serviceType === s.id ? 'bg-primary text-black' : 'bg-gray-50'}`}>
                              {s.icon}
                            </div>
                            <span className="text-xs">{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Service Options (Dynamic) */}
                    {serviceType === 'water_tanker' ? (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-5">
                        <div className="space-y-3">
                          <p className="text-sm font-bold text-gray-500">{t('water_service_type')}</p>
                          <div className={`flex flex-wrap gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            {WATER_SERVICE_TYPES.map((wt) => (
                              <button
                                key={wt}
                                type="button"
                                onClick={() => {
                                  setWaterType(wt);
                                  setIsCalculated(false);
                                }}
                                className={`px-4 py-2 rounded-xl border text-sm transition-all ${
                                  waterType === wt
                                    ? 'bg-black text-white border-black font-bold'
                                    : 'border-gray-200 hover:border-black font-medium'
                                }`}
                              >
                                {translateWaterType(wt, t)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-3">
                          <p className="text-sm font-bold text-gray-500">{t('water_capacity')}</p>
                          <div className={`flex flex-wrap gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            {WATER_TANKER_CAPACITIES.map((cap) => (
                              <button
                                key={cap}
                                type="button"
                                onClick={() => {
                                  setServiceOption(cap);
                                  setTankCapacityLabel(resolveTankCapacityLabel(cap));
                                  setRouteDistanceKm(0);
                                  setExtraDistanceKm(0);
                                  setIsCalculated(false);
                                }}
                                className={`px-4 py-2 rounded-xl border text-sm transition-all ${
                                  serviceOption === cap
                                    ? 'bg-black text-white border-black font-bold'
                                    : 'border-gray-200 hover:border-black font-medium'
                                }`}
                              >
                                {translateCapacity(cap, t)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      (serviceList.find(s => s.id === serviceType && 'details' in s) || (SERVICE_OPTIONS as any)[SERVICE_KEY_MAP[serviceType] || serviceType]) && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4">
                        <p className="text-sm font-bold text-gray-500">{(serviceList.find(s => s.id === serviceType) as any)?.details?.label}</p>
                        
                        <div className={`flex flex-wrap gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          {((SERVICE_OPTIONS as any)[SERVICE_KEY_MAP[serviceType] || serviceType] || (serviceList.find(s => s.id === serviceType) as any)?.details?.options)?.map((opt: string) => (
                            <button
                              key={opt}
                              onClick={() => {
                                setServiceOption(opt);
                                setIsCalculated(false);
                                if (serviceType === 'flatbed') {
                                  setTruckType(
                                    opt === 'hydraulic' ? 'hydraulic' : opt === 'box' ? 'box' : 'normal'
                                  );
                                }
                              }}
                              className={`px-4 py-2 rounded-xl border text-sm transition-all ${serviceOption === opt ? 'bg-black text-white border-black font-bold' : 'border-gray-200 hover:border-black font-medium'}`}
                            >
                              {t(OPTION_LABELS[opt] || opt)}
                            </button>
                          ))}
                        </div>
                        {serviceType === 'furniture_moving' && (
                          <div className={`p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2 text-[10px] text-blue-700 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <Info size={14} />
                            <span>{isRtl ? 'التسعير يشمل العمال المساعدين' : 'Pricing includes helper workers'}</span>
                          </div>
                        )}
                      </motion.div>
                    )
                    )}

                    {serviceType === 'furniture_moving' && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4">
                        <p className="text-sm font-bold text-gray-500">{t('furniture_moving_desc')}</p>
                        <div className="space-y-2">
                          <textarea 
                            value={furnitureDescription}
                            onChange={(e) => setFurnitureDescription(e.target.value)}
                            placeholder={t('furniture_placeholder')}
                            className={`w-full p-4 rounded-xl border border-gray-100 bg-gray-50 outline-none focus:border-primary text-sm min-h-[100px] resize-none ${isRtl ? 'text-right' : 'text-left'}`}
                          />
                        </div>
                      </motion.div>
                    )}

                    {(serviceType === 'flatbed' || serviceType === 'heavy_equipment') && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-3 p-4 rounded-2xl border border-amber-100 bg-amber-50/60"
                      >
                        <p className="text-sm font-bold text-amber-900">
                          {isRtl ? 'ملاحظات مهمة للسطحة / السائق' : 'Important notes for tow truck / driver'}
                        </p>
                        <div className="grid gap-2">
                          {(
                            [
                              { key: 'keyInside' as const, ar: 'المفتاح داخل السيارة', en: 'Car key is inside' },
                              { key: 'tiresFlat' as const, ar: 'الإطارات فارغة / بنشر', en: 'Tires are flat' },
                              { key: 'brokenDown' as const, ar: 'السيارة متعطلة / لا تعمل', en: 'Car is broken down' },
                            ] as const
                          ).map((item) => (
                            <label
                              key={item.key}
                              className="flex items-center gap-3 p-3 rounded-xl bg-white border border-amber-100 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={vehicleFieldNotes[item.key]}
                                onChange={(e) =>
                                  setVehicleFieldNotes((prev) => ({
                                    ...prev,
                                    [item.key]: e.target.checked,
                                  }))
                                }
                                className="w-4 h-4 accent-amber-500"
                              />
                              <span className="text-xs font-bold text-neutral-800">
                                {isRtl ? item.ar : item.en}
                              </span>
                            </label>
                          ))}
                        </div>
                        <textarea
                          value={vehicleFieldNotes.extraNotes}
                          onChange={(e) =>
                            setVehicleFieldNotes((prev) => ({
                              ...prev,
                              extraNotes: e.target.value.slice(0, 500),
                            }))
                          }
                          placeholder={
                            isRtl
                              ? 'ملاحظات إضافية للسائق (اختياري)'
                              : 'Extra notes for the driver (optional)'
                          }
                          className={`w-full p-3 rounded-xl border border-amber-100 bg-white outline-none focus:border-amber-400 text-sm min-h-[72px] resize-none ${isRtl ? 'text-right' : 'text-left'}`}
                        />
                      </motion.div>
                    )}

                    {/* Transport Type Toggle (Hidden for now as requested) */}
                    {false && (
                    <div className="space-y-4">
                      <p className="text-sm font-bold text-gray-500">{t('transport_area')}</p>
                      <div className="flex p-1 bg-gray-100 rounded-2xl border border-gray-200">
                        <button
                          onClick={() => setTransportType('inside')}
                          className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl transition-all font-bold text-sm ${
                            transportType === 'inside'
                              ? 'bg-white shadow-sm text-black'
                              : 'text-gray-500 hover:text-black'
                          }`}
                        >
                          <MapPin size={16} />
                          {t('inside_city')}
                        </button>
                        <button
                          onClick={() => {
                            setTransportType('outside');
                            if (routeDistanceKm < 350) setRouteDistanceKm(350);
                          }}
                          className={`flex-1 flex flex-col items-center justify-center gap-0.5 p-3 rounded-xl transition-all font-bold text-sm ${
                            transportType === 'outside'
                              ? 'bg-white shadow-sm text-black'
                              : 'text-gray-500 hover:text-black'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Share2 size={16} />
                            {t('outside_city')}
                          </div>
                        </button>
                      </div>
                    </div>
                    )}


                    {/* Route Selection — GPS-seeded pickup/delivery by service */}
                    <div className="space-y-6">
                       <div className={`flex flex-wrap items-center justify-between gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
                         <p className="text-sm font-bold text-gray-500">{t('route_plan')}</p>
                         {gpsError && (
                           <p className="text-[11px] font-bold text-amber-600">{gpsError}</p>
                         )}
                       </div>
                       <div className="space-y-4 relative">
                          {!deliveryOnly && (
                            <div className={`absolute ${isRtl ? 'right-7' : 'left-7'} top-10 bottom-10 w-0.5 border-r-2 border-dashed border-gray-100`}></div>
                          )}

                          {!deliveryOnly && (
                          <div className={`flex items-center gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 relative z-10 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white shrink-0">
                              <MapPin size={16} />
                            </div>
                            <div className="flex-1 space-y-1">
                              <p className={`text-[10px] font-bold text-blue-600 ${isRtl ? 'text-right' : 'text-left'}`}>
                                {isRtl ? 'نقطة التحميل (موقعك الحالي)' : 'Pickup (your current location)'}
                              </p>
                              <LocationAutocomplete
                                placeholder={
                                  locatingGps
                                    ? isRtl
                                      ? 'جاري تحديد موقعك...'
                                      : 'Detecting your location...'
                                    : t('pickup_placeholder')
                                }
                                isRtl={isRtl}
                                value={pickup}
                                onPlaceSelect={(place) => {
                                  setPickupCoords(place.location);
                                  setPickup(place.formattedAddress || place.displayName || '');
                                  setActiveMapPin('destination');
                                  setIsCalculated(false);
                                }}
                                className={`flex-1 ${isRtl ? 'text-right' : 'text-left'}`}
                              />
                            </div>
                          </div>
                          )}

                          <div className={`flex items-center gap-4 p-4 bg-primary/5 rounded-2xl border border-primary/10 relative z-10 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-black shrink-0">
                              <Navigation2 size={16} />
                            </div>
                            <div className="flex-1 space-y-1">
                              <p className={`text-[10px] font-bold text-amber-700 ${isRtl ? 'text-right' : 'text-left'}`}>
                                {deliveryOnly
                                  ? isRtl
                                    ? 'موقع التنزيل (نقطة التوصيل الوحيدة)'
                                    : 'Drop-off location (only point required)'
                                  : isRtl
                                    ? 'الوجهة (اختر على الخريطة أو ابحث)'
                                    : 'Destination (search or pick on map)'}
                              </p>
                              <LocationAutocomplete
                                placeholder={
                                  deliveryOnly
                                    ? locatingGps
                                      ? isRtl
                                        ? 'جاري تحديد موقع التنزيل...'
                                        : 'Detecting drop-off location...'
                                      : isRtl
                                        ? 'موقع التنزيل'
                                        : 'Drop-off location'
                                    : t('destination_placeholder')
                                }
                                isRtl={isRtl}
                                value={destination}
                                onPlaceSelect={(place) => {
                                  setDestinationCoords(place.location);
                                  setDestination(place.formattedAddress || place.displayName || '');
                                  // Water tanker: never invent a customer pickup from drop-off.
                                  if (deliveryOnly) {
                                    setPickupCoords(null);
                                    setPickup('');
                                    setNearestDriver(null);
                                  }
                                  setIsCalculated(false);
                                }}
                                className={`flex-1 ${isRtl ? 'text-right' : 'text-left'}`}
                              />
                            </div>
                          </div>

                          {/* Interactive Google Map — GPS-centered */}
                          <BookingLocationMap
                            pickupCoords={deliveryOnly ? null : pickupCoords}
                            destinationCoords={destinationCoords}
                            activePin={activeMapPin}
                            onActivePinChange={setActiveMapPin}
                            isRtl={isRtl}
                            mode={deliveryOnly ? 'delivery_only' : 'pickup_destination'}
                            userLocation={userLocation}
                            locating={locatingGps}
                            onRequestUserLocation={() => void locateUser(true)}
                            showRoute={
                              !deliveryOnly &&
                              isCalculated &&
                              Boolean(pickupCoords && destinationCoords)
                            }
                            onLocationPicked={(target, coords, address) => {
                              if (deliveryOnly || target === 'destination') {
                                setDestinationCoords(coords);
                                setDestination(address);
                                if (deliveryOnly) {
                                  setPickupCoords(null);
                                  setPickup('');
                                  setNearestDriver(null);
                                }
                              } else {
                                setPickupCoords(coords);
                                setPickup(address);
                                setActiveMapPin('destination');
                              }
                              setUserLocation((prev) => prev || coords);
                              setIsCalculated(false);
                            }}
                          />

                          {/* Automatic Distance Display */}
                          <div className="space-y-4 pt-4 border-t border-gray-50 relative z-10">
                            <div className={`flex justify-between items-center bg-gray-50 p-4 rounded-2xl border border-gray-100 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                               <div className={`flex items-center gap-3 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                                 <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                   <Navigation size={20} />
                                 </div>
                                 <div className={isRtl ? 'text-right' : 'text-left'}>
                                   <p className="text-[10px] text-gray-500 font-bold mb-0.5">
                                     {serviceType === 'water_tanker'
                                       ? (isRtl ? 'المسافة لأقرب صهريج' : 'Distance to nearest tanker')
                                       : t('estimated_distance')}
                                     {isCalculated && (
                                       <span className="mr-2 text-primary">
                                         ({tripTypeState === 'inside_city' ? (isRtl ? 'داخل المدينة' : 'Inside City') : (isRtl ? 'خارج المدينة' : 'Outside City')})
                                       </span>
                                     )}
                                   </p>
                                   <p className="text-lg font-black text-black leading-none">
                                     {isCalculated ? (
                                       <>
                                         {routeDistanceKm} {t('km')}
                                       </>
                                     ) : t('waiting_calc')}
                                   </p>
                                   {isCalculated && (
                                     <p className="text-[10px] text-gray-500 font-bold mt-1">
                                       {serviceType === 'water_tanker'
                                         ? (isRtl
                                             ? `السعة: ${tankCapacityLabel || resolveTankCapacityLabel(serviceOption)} · مشمول ${includedKm} كم`
                                             : `Capacity: ${tankCapacityLabel || resolveTankCapacityLabel(serviceOption)} · ${includedKm} km included`)
                                         : (isRtl
                                             ? `الفئة: ${t(OPTION_LABELS[serviceOption] || serviceOption)} · مشمول ${includedKm} كم`
                                             : `Tier: ${t(OPTION_LABELS[serviceOption] || serviceOption)} · ${includedKm} km included`)}
                                     </p>
                                   )}
                                 </div>
                               </div>
                               {isCalculated && (
                                 <div className="flex flex-col items-end gap-1">
                                   <div className={`flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-black ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                      {deliveryOnly ? 'GPS' : 'Google Maps'}
                                   </div>
                                   {isPriceCapApplied && (
                                     <span className="text-[9px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">
                                       {isRtl ? 'تم تطبيق حد أقصى للسعر' : 'Price cap applied'}
                                     </span>
                                   )}
                                 </div>
                               )}
                            </div>
                          </div>

                          {!isCalculated && (
                            <button
                              onClick={handleCalculate}
                              disabled={isLoadingPricing || locatingGps}
                              className={`w-full py-4 bg-primary text-black rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-all relative z-10 border-2 border-primary shadow-lg shadow-primary/10 ${
                                isLoadingPricing || locatingGps ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                            >
                              <Navigation size={18} className={isLoadingPricing ? 'animate-spin' : ''} />
                              {isLoadingPricing ? t('waiting_calc') : t('calculate_price')}
                            </button>
                          )}
                       </div>
                    </div>

                    {/* Price Summary Before Button - Only visible after calculation */}
                    <AnimatePresence>
                      {isCalculated && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0, marginTop: 0 }}
                          animate={{ opacity: 1, height: 'auto', marginTop: 32 }}
                          exit={{ opacity: 0, height: 0, marginTop: 0 }}
                          className="space-y-6 overflow-hidden"
                        >
                          <div className={`p-6 bg-primary/5 rounded-[32px] border border-primary/10 space-y-4 ${isRtl ? 'text-right' : 'text-left'}`}>
                            <div className={`flex justify-between items-center ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                              <span className="text-sm font-bold text-gray-500">{t('approx_cost')}</span>
                              <div className={isRtl ? 'text-left' : 'text-right'}>
                                <p className="text-2xl font-black text-black">{checkoutTotal.toFixed(2)} <span className="text-xs font-medium">{t('sar')}</span></p>
                                <p className="text-[10px] text-gray-400 font-bold">{t('tax_included')}</p>
                              </div>
                            </div>
                          </div>

                          <button 
                            onClick={handleBooking}
                            disabled={!isCalculated || !!pricingError || isLoadingPricing || isProcessing}
                            className={`w-full py-5 bg-black text-white rounded-3xl font-bold shadow-xl shadow-black/10 hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2 text-lg ${
                              !isCalculated || !!pricingError || isLoadingPricing || isProcessing ? 'opacity-50 cursor-not-allowed' : ''
                            } ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}
                          >
                            {isProcessing ? t('waiting_calc') : t('continue_payment')}
                            <ArrowRight size={20} className={isRtl ? 'rotate-180' : ''} />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Pricing breakdown */}
                  <AnimatePresence>
                    {isCalculated && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className={`bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6 ${isRtl ? 'text-right' : 'text-left'}`}
                      >
                        <div className={`p-2 mb-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2 text-[10px] text-blue-700 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          <Info size={14} className="flex-shrink-0" />
                          <span className="font-bold">{isRtl ? 'التسعير يعتمد على نوع الخدمة المختارة' : 'Pricing depends on the selected service type'}</span>
                        </div>
                        <h3 className={`font-bold flex items-center gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}><CreditCard size={20} /> {t('price_details')}</h3>
                        <div className="space-y-3 text-sm">
                          {serviceType === 'water_tanker' ? (
                            <>
                              <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                                <span className="text-gray-500">{t('choose_service')}</span>
                                <span className="font-bold text-primary">{t('water_tanker')}</span>
                              </div>
                              <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                                <span className="text-gray-500">{t('water_service_type')}</span>
                                <span className="font-bold">
                                  {translateWaterType(waterType || 'fresh', t)}
                                </span>
                              </div>
                              <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                                <span className="text-gray-500">
                                  {isRtl ? 'سعة الصهريج' : 'Tank capacity'}
                                </span>
                                <span className="font-bold">
                                  {translateCapacity(
                                    tankCapacityLabel || resolveTankCapacityLabel(serviceOption),
                                    t
                                  )}
                                </span>
                              </div>
                            </>
                          ) : serviceOption ? (
                            <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                              <span className="text-gray-500">
                                {isRtl ? 'فئة المركبة' : 'Vehicle tier'}
                              </span>
                              <span className="font-bold">
                                {t(OPTION_LABELS[serviceOption] || serviceOption)}
                              </span>
                            </div>
                          ) : null}
                          <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <span className="text-gray-500">{t('trip_type') || (isRtl ? 'نوع الرحلة' : 'Trip Type')}</span>
                            <span className="font-bold text-primary">
                              {tripTypeState === 'inside_city' ? (isRtl ? 'داخل المدينة' : 'Inside City') : (isRtl ? 'خارج المدينة' : 'Outside City')}
                            </span>
                          </div>
                          <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <span className="text-gray-500">
                              {isRtl
                                ? `السعر الأساسي (يشمل ${includedKm} كم)`
                                : `Base price (includes ${includedKm} km)`}
                            </span>
                            <span>{pricing.base} {t('sar')}</span>
                          </div>
                          {serviceType === 'water_tanker' && (
                            <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                              <span className="text-gray-500">
                                {isRtl ? 'المسافة لأقرب سائق' : 'Distance to nearest driver'}
                              </span>
                              <span className="font-bold">
                                {routeDistanceKm.toFixed(1)} {t('km')}
                                {nearestDriver?.estimated ? (
                                  <span className="text-[10px] text-amber-600 font-bold ms-1">
                                    ({isRtl ? 'تقديري' : 'est.'})
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          )}
                          <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <span className="text-gray-500">
                              {isRtl
                                ? `رسوم المسافة الإضافية (فوق ${includedKm} كم)`
                                : `Extra distance fee (beyond ${includedKm} km)`}
                              {' '}
                              ({extraDistanceKm.toFixed(1)} {t('km')})
                            </span>
                            <span>
                              {pricing.extraKm} {t('sar')}
                            </span>
                          </div>
                          <div className={`flex justify-between ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <span className="text-gray-500">{t('service_fee')}</span>
                            <div className={`flex flex-col ${isRtl ? 'items-end' : 'items-start'}`}>
                              <span className={pricing.isServiceFeeFree ? "line-through text-gray-300" : ""}>{pricing.serviceFee.toFixed(2)} {t('sar')}</span>
                              {pricing.isServiceFeeFree && <span className="text-[10px] text-green-500 font-bold">{t('free')} ({t('first_3_orders')})</span>}
                            </div>
                          </div>
                          {serviceType === 'goods_transport' && truckCount > 1 && (
                            <div className={`flex justify-between text-blue-600 font-bold ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                              <span>{t('truck_count')}</span>
                              <span>{truckCount} {t('trucks')}</span>
                            </div>
                          )}
                          <div className={`pt-3 border-t border-dashed flex justify-between font-bold text-lg ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <span>{t('total')}</span>
                            <span className="text-primary">{checkoutTotal.toFixed(2)} {t('sar')}</span>
                          </div>
                        </div>
                        <div className={`p-4 bg-primary/5 rounded-2xl border border-primary/10 flex items-start gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          <Info size={16} className={`text-primary mt-0.5 shrink-0 ${isRtl ? '' : 'rotate-180'}`} />
                          <div className={`text-[10px] text-gray-600 space-y-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                            {isLoadingPricing ? (
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                                <span>{t('loading_pricing') || 'Loading dynamic pricing...'}</span>
                              </div>
                            ) : pricingError ? (
                              <p className="text-red-500 font-bold">{pricingError}</p>
                            ) : (
                              <>
                                <p className="font-bold text-black border-b border-primary/10 pb-1 mb-1">{t('dynamic_pricing_active') || 'Dynamic Pricing (Real-time)'}</p>
                                <p>{t('base_price')}: {pricing.base} {t('sar')}</p>
                                <p>
                                  {isRtl ? 'سعر الكيلومتر الإضافي' : 'Extra km rate'}:{' '}
                                  {pricing.rate} {t('sar')}/{t('km')}
                                </p>
                                <p>
                                  {isRtl ? 'المشمول في السعر الأساسي' : 'Included in base'}:{' '}
                                  {includedKm} {t('km')}
                                </p>
                              </>
                            )}
                            <p className="border-t border-primary/10 pt-1 mt-1 text-black font-bold italic">{t('pricing_maps_note')}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="bg-black text-white p-8 rounded-[40px] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-32 h-32 bg-primary/20 blur-[60px]"></div>
                    <div className={`relative z-10 space-y-2 ${isRtl ? 'text-right' : 'text-left'}`}>
                       <h3 className="text-xl font-bold">{t('free_service_fee_title')}</h3>
                       <p className="text-xs text-gray-400 leading-relaxed">{t('free_service_fee_desc')}</p>
                       <p className="text-[10px] text-primary font-bold">{t('remaining_orders')} {Math.max(0, FREE_SERVICE_FEE_ORDERS - previousOrdersCount)}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 'payment' && (
              <motion.div 
                key="payment-step"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8"
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                 {/* Payment Options */}
                 <div className={`bg-white p-8 md:p-10 rounded-[40px] shadow-sm border border-gray-100 space-y-8 ${isRtl ? 'text-right' : 'text-left'}`}>
                   <div className={`flex items-center gap-3 mb-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                     <div className="p-2 bg-primary/10 rounded-xl text-primary">
                       <CreditCard size={24} />
                     </div>
                     <h2 className="text-2xl font-bold">{t('payment_method')}</h2>
                   </div>

                   <div className="grid grid-cols-3 gap-3">
                     <PaymentMethod
                       active={checkoutMethod === 'mada'}
                       onClick={() => setCheckoutMethod('mada')}
                       icon={<CreditCard size={20} />}
                       label={t('mada')}
                     />
                     <PaymentMethod
                       active={checkoutMethod === 'creditcard'}
                       onClick={() => setCheckoutMethod('creditcard')}
                       icon={<CreditCard size={20} />}
                       label={t('visa_master')}
                     />
                     <PaymentMethod
                       active={checkoutMethod === 'applepay'}
                       onClick={() => setCheckoutMethod('applepay')}
                       icon={<Navigation size={20} />}
                       label={t('apple_pay')}
                     />
                   </div>

                   <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                     <p className="text-sm font-bold text-slate-800">
                       {checkoutMethod === 'applepay'
                         ? isRtl
                           ? 'ستُفتح صفحة Moyasar الآمنة — اختر Apple Pay إن كان متاحاً على جهازك.'
                           : 'You will open Moyasar’s secure page — choose Apple Pay if available on your device.'
                         : checkoutMethod === 'mada'
                           ? isRtl
                             ? 'ستُفتح صفحة Moyasar الآمنة لإتمام الدفع ببطاقة مدى.'
                             : 'You will open Moyasar’s secure page to pay with your Mada card.'
                           : isRtl
                             ? 'ستُفتح صفحة Moyasar الآمنة لإتمام الدفع بفيزا / ماستركارد.'
                             : 'You will open Moyasar’s secure page to pay with Visa / Mastercard.'}
                     </p>
                     <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                       {isRtl
                         ? 'لا نجمع بيانات البطاقة داخل Miras — المعالجة تتم عبر بوابة الدفع.'
                         : 'Card details are never entered in Miras — processing happens on the payment gateway.'}
                     </p>
                   </div>

                   <div className={`p-4 bg-green-50 rounded-2xl border border-green-100 flex items-center gap-2 text-green-700 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                      <ShieldCheck size={18} />
                      <p className="text-[10px] font-bold">{t('secure_payment_note')}</p>
                   </div>
                 </div>

                 {/* Order Summary */}
                 <div className="space-y-6">
                    <div className={`bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 space-y-6 relative overflow-hidden ${isRtl ? 'text-right' : 'text-left'}`}>
                      <div className={`absolute top-0 ${isRtl ? 'left-0' : 'right-0'} w-24 h-24 bg-primary/10 rounded-br-[60px] -translate-x-6 -translate-y-6`}></div>
                      <h3 className="font-bold text-xl border-b pb-4">{t('order_summary')}</h3>
                      
                      <div className="space-y-4">
                        <div className={`flex justify-between items-center ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-primary">
                              {serviceList.find(s => s.id === (activeOrder?.serviceType || serviceType))?.icon
                                || (isWaterTankerService(activeOrder?.serviceType || serviceType)
                                  ? <Droplets size={20} />
                                  : <Package size={20} />)}
                            </div>
                            <div>
                              {(() => {
                                const label = formatOrderServiceLabel(
                                  activeOrder?.serviceType || serviceType,
                                  {
                                    waterType:
                                      (activeOrder?.serviceDetails as { waterType?: string } | undefined)
                                        ?.waterType || waterType || undefined,
                                    capacity:
                                      (activeOrder?.serviceDetails as { capacity?: string } | undefined)
                                        ?.capacity ||
                                      tankCapacityLabel ||
                                      serviceOption ||
                                      undefined,
                                    type:
                                      (activeOrder?.serviceDetails as { type?: string } | undefined)
                                        ?.type || serviceOption || undefined,
                                  },
                                  t
                                );
                                return (
                                  <>
                                    <p className="font-bold text-sm">{label.title}</p>
                                    {label.subtitle ? (
                                      <p className="text-[10px] text-gray-500">{label.subtitle}</p>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          <span className="font-bold">{pricing.base} {t('sar')}</span>
                        </div>

                        {(activeOrder?.serviceType || serviceType) === 'water_tanker' ? (
                          <>
                            <div className="flex justify-between text-sm text-gray-500">
                              <span>{t('water_service_type')}</span>
                              <span className="font-bold text-neutral-800">
                                {translateWaterType(
                                  (activeOrder?.serviceDetails as { waterType?: string } | undefined)
                                    ?.waterType || waterType || 'fresh',
                                  t
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-500">
                              <span>
                                {isRtl ? 'سعة الصهريج' : 'Tank capacity'}
                              </span>
                              <span className="font-bold text-neutral-800">
                                {translateCapacity(
                                  (activeOrder?.serviceDetails as { capacity?: string } | undefined)
                                    ?.capacity ||
                                    tankCapacityLabel ||
                                    resolveTankCapacityLabel(serviceOption),
                                  t
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-500">
                              <span>
                                {isRtl ? 'المسافة لأقرب سائق' : 'Distance to nearest driver'}
                              </span>
                              <span>
                                {routeDistanceKm.toFixed(1)} {t('km')}
                                {routeDistanceKm <= includedKm
                                  ? ` · ${isRtl ? 'ضمن الحد المشمول' : 'within included radius'}`
                                  : ` · ${extraDistanceKm.toFixed(1)} ${t('km')} extra`}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-500">
                              <span>
                                {isRtl
                                  ? `رسوم ما فوق ${includedKm} كم`
                                  : `Fee beyond ${includedKm} km`}
                              </span>
                              <span>{pricing.extraKm} {t('sar')}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            {serviceOption ? (
                              <div className="flex justify-between text-sm text-gray-500">
                                <span>{isRtl ? 'فئة المركبة' : 'Vehicle tier'}</span>
                                <span className="font-bold text-neutral-800">
                                  {t(OPTION_LABELS[serviceOption] || serviceOption)}
                                </span>
                              </div>
                            ) : null}
                            <div className="flex justify-between text-sm text-gray-500 hover:text-black transition-colors group cursor-help">
                              <span className={`flex items-center gap-1 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                                {t('distance')} ({routeDistanceKm} {t('km')}
                                {extraDistanceKm > 0
                                  ? ` · +${extraDistanceKm.toFixed(1)} ${t('km')}`
                                  : ` · ≤${includedKm} ${t('km')}`}
                                ){' '}
                                <Info size={12} className="group-hover:text-primary" />
                              </span>
                              <span>{pricing.extraKm} {t('sar')}</span>
                            </div>
                          </>
                        )}

                        <div className="flex justify-between text-sm text-gray-500">
                          <span>{t('service_fee')}</span>
                          <span>{pricing.serviceFee.toFixed(2)} {t('sar')}</span>
                        </div>

                        <div className="pt-6 border-t border-dashed flex justify-between items-end">
                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('total_final')}</p>
                            <p className="text-3xl font-black text-black">{checkoutTotal.toFixed(2)} <span className="text-xs font-medium">{t('sar')}</span></p>
                          </div>
                          <CheckCircle2 size={32} className="text-primary mb-1" />
                        </div>
                      </div>

                      <button 
                       onClick={handlePayment}
                       disabled={isProcessing}
                       className={`w-full py-5 bg-black text-white rounded-3xl font-extrabold text-xl shadow-2xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                       {isProcessing ? (isRtl ? 'جاري المعالجة...' : 'Processing...') : t('confirm_payment_btn')}
                      </button>
                     
                     <button 
                      onClick={() => setStep('booking')} 
                      className="w-full py-3 text-gray-400 font-bold text-sm hover:text-black transition-colors flex items-center justify-center gap-2"
                     >
                       <ChevronLeft size={16} className={isRtl ? '' : 'rotate-180'} /> {t('edit_order')}
                     </button>
                    </div>

                    <div className="bg-primary/5 p-6 rounded-[32px] border border-primary/20">
                       <p className={`text-[10px] text-gray-600 leading-relaxed font-medium ${isRtl ? 'text-right' : 'text-left'}`}>
                         {t('low_cost_note')}
                       </p>
                    </div>
                 </div>
              </motion.div>
            )}

            {step === 'tracking' && activeOrder && (
              <motion.div 
                key="tracking-step"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
                <div className="lg:col-span-2 space-y-6">
                  {/* Live tracking map — centers on pickup / Saudi Arabia, follows driver GPS */}
                  <div className="h-[500px] bg-slate-200 rounded-[40px] relative overflow-hidden border-8 border-white shadow-xl">
                    {(() => {
                      const trip = getOrderTripCoordinates(activeOrder);
                      const mapPickup = trip.pickup ?? pickupCoords;
                      const mapDropoff = trip.dropoff ?? destinationCoords;
                      const hasTripPins = Boolean(mapPickup || mapDropoff);
                      const followDriver =
                        Boolean(driverLocation) &&
                        trackingStatus !== 'searching_driver';
                      return (
                        <>
                    <LiveTrackingMap
                      pickup={
                        isWaterTankerService(activeOrder.serviceType)
                          ? null
                          : mapPickup
                      }
                      dropoff={mapDropoff}
                      driver={driverLocation}
                      pickupLabel={t('pickup_point')}
                      dropoffLabel={
                        isWaterTankerService(activeOrder.serviceType)
                          ? isRtl
                            ? 'موقع التنزيل'
                            : 'Drop-off'
                          : t('your_location')
                      }
                      driverLabel={activeOrder.driver?.name || t('driver')}
                      followDriver={followDriver}
                    />

                    {/* Searching badge — real map pins already mark pickup/dropoff */}
                    {!driverLocation && trackingStatus === 'searching_driver' && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                        <div className="bg-white/95 backdrop-blur px-4 py-2 rounded-full text-xs font-bold shadow-lg border border-stone-100 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                          {(() => {
                            const window = resolveDispatchWindow(
                              orderDispatchStartedAt(activeOrder || {}),
                              Date.now()
                            );
                            void dispatchTick;
                            return window.atMax
                              ? isRtl
                                ? `جاري البحث في نطاق ${window.radiusKm} كم داخل مدينتك`
                                : `Searching within ${window.radiusKm} km in your city`
                              : isRtl
                                ? `البحث عن سائق قريب · نطاق ${window.radiusKm} كم`
                                : `Searching nearby drivers · ${window.radiusKm} km radius`;
                          })()}
                        </div>
                      </div>
                    )}

                    {followDriver && driverLocation && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                        <div className="bg-black/90 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2">
                          <Truck size={14} />
                          {isRtl ? 'تتبع مباشر للسائق' : 'Live driver tracking'}
                        </div>
                      </div>
                    )}

                    {/* Fallback animated truck only when we lack coords and live GPS */}
                    {trackingStatus !== 'searching_driver' && !driverLocation && !hasTripPins && (
                      <motion.div
                        animate={{
                          x: trackingStatus === 'arrived' ? -100 : [0, -50, -100],
                          y: trackingStatus === 'arrived' ? 100 : [0, 50, 100],
                        }}
                        transition={{ duration: 30, repeat: Infinity }}
                        className="absolute top-1/2 left-1/2 z-20 pointer-events-none"
                      >
                        <div className="bg-black text-white p-3 rounded-2xl shadow-2xl flex flex-col items-center">
                          <Truck size={24} />
                          <div className="w-1 h-3 bg-white/20 mt-1 rounded-full"></div>
                        </div>
                      </motion.div>
                    )}
                        </>
                      );
                    })()}
                  </div>

                  {/* Status Timeline */}
                  <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex justify-between gap-1">
                    {(() => {
                      const timeline = clientTimelineStep(activeOrder.status);
                      return (
                        <>
                    <TrackingStep 
                      active={timeline === 'waiting'} 
                      completed={timeline !== 'waiting'} 
                      label={t('tracking_waiting')}
                    />
                    <div className="flex-1 border-t-2 border-dashed border-gray-100 self-center mx-2"></div>
                    <TrackingStep 
                      active={timeline === 'accepted'} 
                      completed={timeline === 'on_the_way' || timeline === 'completed'} 
                      label={t('tracking_accepted')}
                    />
                    <div className="flex-1 border-t-2 border-dashed border-gray-100 self-center mx-2"></div>
                    <TrackingStep 
                      active={timeline === 'on_the_way'} 
                      completed={timeline === 'completed'} 
                      label={t('tracking_on_way')} 
                    />
                    <div className="flex-1 border-t-2 border-dashed border-gray-100 self-center mx-2"></div>
                    <TrackingStep 
                      active={timeline === 'completed'} 
                      completed={timeline === 'completed'} 
                      label={t('tracking_completed')} 
                    />
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Driver Card */}
                  <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl space-y-6">
                     {activeOrder?.driver ? (
                       <>
                         <div className="flex items-center gap-4">
                           <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center font-bold text-xl">
                             {activeOrder.driver?.name?.[0] ?? '?'}
                           </div>
                           <div>
                             <h4 className="font-bold text-lg">{activeOrder.driver?.name}</h4>
                             <p className="text-sm text-primary font-bold">{activeOrder.driver?.truckDetails}</p>
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                           <button
                             type="button"
                             className="py-3 bg-gray-50 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-gray-100"
                             onClick={() => {
                               const phone = resolveDriverPhoneFromOrder(activeOrder);
                               if (!phone) {
                                 toast.error(
                                   isRtl
                                     ? 'رقم السائق غير متوفر بعد'
                                     : 'Driver phone is not available yet'
                                 );
                                 return;
                               }
                               setShowDriverCallModal(true);
                             }}
                           >
                             {t('call_driver')}
                           </button>
                           <TripChatNotifyButton
                             onClick={openTripChat}
                             label={t('chat_driver')}
                             unreadCount={chatUnreadCount}
                           />
                         </div>
                       </>
                     ) : (
                       <div className="flex flex-col items-center gap-4 py-8">
                         <div className="w-16 h-16 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
                         <p className="text-sm font-bold animate-pulse">{t('searching_nearby_driver')}</p>
                       </div>
                     )}
                  </div>

                  {/* Order Info Card */}
                  <div className={`bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-4 ${isRtl ? 'text-right' : 'text-left'}`}>
                     <h3 className="font-bold text-sm border-b pb-3">{t('order_details')}</h3>
                     <div className="space-y-4">
                        {!isWaterTankerService(activeOrder.serviceType) && (
                          <div className={`flex gap-3 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                            <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
                            <p className={`text-xs font-medium text-gray-600 leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>{pickup || activeOrder.pickupAddress}</p>
                          </div>
                        )}
                        <div className={`flex gap-3 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0"></div>
                          <div className={`min-w-0 ${isRtl ? 'text-right' : 'text-left'}`}>
                            {isWaterTankerService(activeOrder.serviceType) && (
                              <p className="text-[10px] font-bold text-amber-700 mb-0.5">
                                {isRtl ? 'موقع التنزيل' : 'Drop-off'}
                              </p>
                            )}
                            <p className="text-xs font-bold leading-relaxed">
                              {destination || activeOrder.dropoffAddress}
                            </p>
                          </div>
                        </div>
                        {activeOrder?.serviceDetails?.furnitureDescription && (
                          <div className={`p-3 bg-stone-50 rounded-xl border border-stone-100 mt-2 ${isRtl ? 'text-right' : 'text-left'}`}>
                            <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">{t('furniture_moving_desc')}</p>
                             <p className="text-xs font-medium text-gray-600 leading-relaxed italic">
                               {activeOrder?.serviceDetails?.furnitureDescription}
                             </p>
                          </div>
                        )}
                     </div>
                     <div className={`pt-4 border-t flex justify-between items-center ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('order_number')}: {activeOrder.id}</span>
                        <button onClick={() => setStep('booking')} className="text-primary font-bold text-xs">{t('cancel_order')}</button>
                     </div>
                  </div>

                  <button className="w-full py-4 bg-gray-50 text-gray-400 rounded-3xl font-bold text-sm border border-gray-100 flex items-center justify-center gap-2">
                    <Share2 size={16} /> {t('share_tracking')}
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'rating' && activeOrder && (
              <motion.div
                key="rating-step"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-xl mx-auto py-10"
              >
                <div className="bg-white p-12 rounded-[60px] border border-stone-200 shadow-2xl text-center space-y-8">
                  <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto text-green-500">
                    <CheckCircle2 size={48} />
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-3xl font-black text-neutral-900">{t('delivery_success')}</h2>
                    <p className="text-stone-500 font-bold">{t('rate_experience')} {activeOrder.driver?.name}</p>
                  </div>

                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        className={`text-4xl transition-all ${rating >= star ? 'text-primary scale-110' : 'text-stone-200 hover:text-primary/40'}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <textarea
                      placeholder={t('feedback_placeholder')}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      className={`w-full p-6 rounded-[32px] bg-stone-50 border border-stone-100 focus:border-primary outline-none min-h-[120px] font-medium resize-none ${isRtl ? 'text-right' : 'text-left'}`}
                    />

                    <button
                      onClick={submitRating}
                      disabled={rating === 0}
                      className="w-full py-5 bg-neutral-900 text-white rounded-[32px] font-black text-xl shadow-xl shadow-neutral-900/10 hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('submit_rating')}
                    </button>

                    <button
                      onClick={() => {
                        setStep('booking');
                        setActiveOrder(null);
                      }}
                      className="text-stone-400 font-bold text-sm hover:text-neutral-900 transition-colors"
                    >
                      {t('skip_rating')}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        } />

        <Route path="orders" element={
          <CustomerOrderHistory isRtl={isRtl} t={t} />
        } />

        <Route path="wallet" element={
          <div className="space-y-8" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="grid md:grid-cols-2 gap-8">
               <div className="bg-neutral-900 text-white p-10 rounded-[50px] shadow-2xl shadow-neutral-900/20 relative overflow-hidden flex flex-col justify-between min-h-[300px]">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-primary/10 blur-[100px]"></div>
                  <div className="flex justify-between items-start relative z-10">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('available_balance')}</p>
                      <h2 className="text-5xl font-black font-mono">{walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs text-primary font-sans">{t('sar')}</span></h2>
                    </div>
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md">
                      <Wallet size={24} className="text-primary" />
                    </div>
                  </div>
                  
                  <div className="flex gap-4 relative z-10">
                    <button 
                      onClick={() => setIsTopUpModalOpen(true)}
                      className="flex-1 py-4 bg-primary text-black rounded-2xl font-black text-sm hover:scale-105 transition-all outline-none"
                    >
                      {t('add_balance')}
                    </button>
                    <button 
                      onClick={scrollToHistory}
                      className="flex-1 py-4 bg-white/10 text-white rounded-2xl font-black text-sm hover:bg-white/20 transition-all border border-white/10 outline-none"
                    >
                      {t('payment_history')}
                    </button>
                  </div>
               </div>

               <div className="bg-white p-8 rounded-[50px] border border-stone-100 shadow-sm space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <CreditCard size={22} />
                    </div>
                    <h3 className="text-xl font-black">{t('registered_cards')}</h3>
                  </div>
                  <p className="text-sm font-medium text-stone-500 leading-relaxed">
                    {t('moyasar_cards_notice')}
                  </p>
               </div>
            </div>

            <div ref={historyRef} className="bg-white p-8 rounded-[40px] border border-stone-100 shadow-sm space-y-6">
               <h3 className={`text-xl font-black ${isRtl ? 'text-right' : 'text-left'}`}>{t('recent_transactions')}</h3>
               <div className="divide-y divide-stone-50">
                  {transactions.length > 0 ? (
                    transactions.map((tx) => (
                    <div key={tx.id} className={`py-4 flex justify-between items-center ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                      <div className={`flex items-center gap-4 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tx.isDebit ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'}`}>
                          <ArrowRight size={18} className={tx.isDebit ? 'rotate-45' : '-rotate-135'} />
                        </div>
                        <div className={isRtl ? 'text-right' : 'text-left'}>
                          <p className="font-bold text-sm">
                            {tx.type === 'payment'
                              ? `${t('payment_for_order_hash')}${shortOrderRef(tx.orderId)}`
                              : t('wallet_top_up')}
                          </p>
                          <p className="text-[10px] text-stone-400">
                            {formatWalletTxDate(tx.createdAt, isRtl)}
                          </p>
                        </div>
                      </div>
                      <span className={`font-black ${tx.isDebit ? 'text-red-500' : 'text-green-500'}`}>
                        {tx.isDebit ? '-' : '+'}{tx.amount.toFixed(2)} {t('sar')}
                      </span>
                    </div>
                    ))
                  ) : (
                    <p className="py-8 text-center text-sm font-bold text-stone-400">
                      {isRtl ? 'لا توجد حركات مالية بعد' : 'No transactions yet'}
                    </p>
                  )}
               </div>
            </div>

            {/* Top Up Modal */}
            <AnimatePresence>
              {isTopUpModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white rounded-[40px] p-8 max-w-md w-full shadow-2xl space-y-6"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                      <Wallet size={32} />
                    </div>
                    <div className="space-y-2">
                       <h3 className="text-xl font-bold">{t('add_balance')}</h3>
                       <p className="text-sm text-stone-500">{t('wallet_top_up_subtitle')}</p>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-3">
                      {[50, 100, 500].map(amt => (
                        <button 
                          key={amt}
                          onClick={() => setTopUpAmount(amt.toString())}
                          className={`py-3 rounded-xl border-2 font-bold transition-all ${topUpAmount === amt.toString() ? 'border-primary bg-primary/5 text-black' : 'border-stone-100 text-stone-400'}`}
                        >
                          {amt}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <input 
                        type="number"
                        placeholder={t('enter_custom_amount')}
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(e.target.value)}
                        className={`w-full p-4 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-primary font-bold ${isRtl ? 'text-right' : 'text-left'}`}
                      />
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          if (!isLocalDevRuntime()) {
                            toast.info(t('topup_moyasar_only'));
                            setIsTopUpModalOpen(false);
                            setTopUpAmount('');
                            return;
                          }
                          const amt = parseFloat(topUpAmount);
                          if (isNaN(amt) || amt <= 0) {
                            toast.error(t('invalid_amount_msg'));
                            return;
                          }
                          const uid = auth.currentUser?.uid || profile?.uid || '';
                          const next = uid
                            ? creditLocalCustomerWallet(uid, amt)
                            : { balance: walletBalance + amt, transactions };
                          setWalletBalance(next.balance);
                          if ('transactions' in next && next.transactions) {
                            setTransactions(next.transactions);
                          }
                          toast.success(t('topup_success_msg'));
                          setIsTopUpModalOpen(false);
                          setTopUpAmount('');
                        }}
                        className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-black/90 transition-all font-black"
                      >
                        {t('confirm')}
                      </button>
                      <button 
                        onClick={() => setIsTopUpModalOpen(false)}
                        className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold hover:bg-stone-200 transition-all"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        } />
        <Route path="*" element={<Navigate to="/b2c/client" replace />} />
      </Routes>

      <AnimatePresence>
        {/* The duplicate steps at the end of the file were removed to fix the redundancy issue */}
      </AnimatePresence>

      {activeOrder?.driver && (
        <OrderDriverCallModal
          open={showDriverCallModal}
          onClose={() => setShowDriverCallModal(false)}
          driverName={activeOrder.driver.name}
          phone={resolveDriverPhoneFromOrder(activeOrder)}
          isRtl={isRtl}
        />
      )}

      {chatOrderId && (
        <OrderTripChatModal
          open={showDriverChatModal}
          onClose={() => setShowDriverChatModal(false)}
          orderId={chatOrderId}
          senderRole="customer"
          senderName={profile?.name || (isRtl ? 'العميل' : 'Customer')}
          peerLabel={
            activeOrder?.driver?.name || (isRtl ? 'السائق' : 'Driver')
          }
          isRtl={isRtl}
        />
      )}
    </DashboardLayout>
  );
};

const TrackingStep: React.FC<{ active: boolean, completed: boolean, label: string }> = ({ active, completed, label }) => (
  <div className="flex flex-col items-center gap-2 min-w-0 px-1">
    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
      completed ? 'bg-green-500 text-white' : 
      active ? 'bg-primary text-black' : 
      'bg-gray-100 text-gray-300'
    }`}>
      {completed ? <CheckCircle2 size={20} /> : <div className={`w-3 h-3 rounded-full ${active ? 'bg-black animate-pulse' : 'bg-gray-300'}`}></div>}
    </div>
    <span className={`text-[10px] font-bold text-center leading-tight ${active ? 'text-black' : completed ? 'text-green-700' : 'text-gray-400'}`}>{label}</span>
  </div>
);

const PaymentMethod: React.FC<{
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all cursor-pointer ${
      active ? 'border-primary bg-primary/5 text-black' : 'border-gray-50 bg-gray-50 text-gray-400 hover:border-gray-200'
    }`}
  >
    {icon}
    <span className="text-[10px] font-bold">{label}</span>
  </button>
);

function formatClientOrderStatus(status: string, isRtl: boolean): string {
  const normalized = normalizeOrderStatus(status);
  switch (normalized) {
    case 'broadcasting':
    case 'payment_authorized':
    case 'awaiting_payment':
      return isRtl ? 'بانتظار السائق' : 'Waiting for driver';
    case 'assigned':
      return isRtl ? 'تم قبول الطلب' : 'Accepted';
    case 'driver_arrived':
    case 'in_transit':
      return isRtl ? 'في الطريق' : 'On the way';
    case 'completed':
      return isRtl ? 'مكتمل' : 'Completed';
    case 'cancelled':
      return isRtl ? 'ملغي' : 'Cancelled';
    default:
      return status || (isRtl ? 'بانتظار السائق' : 'Waiting for driver');
  }
}

function shortOrderRef(orderId: string | undefined): string {
  if (!orderId) return '—';
  const clean = String(orderId).replace(/^#/, '');
  return clean.length > 10 ? clean.slice(-8) : clean;
}

function formatWalletTxDate(iso: string, isRtl: boolean): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso || '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return isRtl ? 'الآن' : 'Just now';
  if (delta < 3_600_000) {
    const mins = Math.max(1, Math.round(delta / 60_000));
    return isRtl ? `منذ ${mins} د` : `${mins} min ago`;
  }
  if (delta < 86_400_000) {
    const hours = Math.max(1, Math.round(delta / 3_600_000));
    return isRtl ? `منذ ${hours} س` : `${hours}h ago`;
  }
  return new Date(ms).toLocaleString(isRtl ? 'ar-SA' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createdAtMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  return 0;
}

type HistoryRow = {
  id: string;
  serviceType: string;
  amount: number;
  status: string;
  createdAt?: string;
  sortMs: number;
  waterType?: string;
  capacity?: string;
  type?: string;
  pickupAddress?: string;
  dropoffAddress?: string;
  driverName?: string;
  paymentStatus?: string;
};

function formatCreatedAtLabel(created: unknown): string {
  if (typeof created === 'string') {
    const parsed = Date.parse(created);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
    return created.slice(0, 10);
  }
  if (created && typeof (created as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (created as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  return '';
}

function mapOrderHistoryRow(id: string, data: Record<string, unknown>): HistoryRow {
  const details = (data.serviceDetails || {}) as Record<string, unknown>;
  const financials = (data.financials || {}) as Record<string, unknown>;
  const created = data.createdAt ?? data.promotedAt ?? data.updatedAt;
  const pickup = data.pickup as { address?: string } | undefined;
  const destination = data.destination as { address?: string } | undefined;
  const driver = data.driver as { name?: string } | undefined;
  return {
    id,
    serviceType: String(data.serviceType || data.service || 'unknown'),
    amount:
      Number(
        financials.customerTotal ??
          financials.total ??
          data.totalPrice ??
          data.price ??
          data.customerTotal ??
          0
      ) || 0,
    status: String(data.status || data.orderStatus || 'broadcasting'),
    createdAt: formatCreatedAtLabel(created),
    sortMs: createdAtMs(created) || 0,
    waterType: details.waterType != null ? String(details.waterType) : undefined,
    capacity: details.capacity != null ? String(details.capacity) : undefined,
    type: details.type != null ? String(details.type) : undefined,
    pickupAddress: String(data.pickupAddress || pickup?.address || ''),
    dropoffAddress: String(data.dropoffAddress || destination?.address || ''),
    driverName: String(driver?.name || data.driverName || data.driverPhone || ''),
    paymentStatus: String(data.paymentStatus || ''),
  };
}

function historyStatusTone(status: string): string {
  const normalized = normalizeOrderStatus(status);
  if (normalized === 'completed') return 'text-emerald-700';
  if (normalized === 'cancelled') return 'text-rose-600';
  if (
    normalized === 'assigned' ||
    normalized === 'driver_arrived' ||
    normalized === 'in_transit'
  ) {
    return 'text-teal-700';
  }
  return 'text-amber-600';
}

function isLiveTrackingStatus(status: string): boolean {
  const normalized = normalizeOrderStatus(status);
  return (
    normalized === 'assigned' ||
    normalized === 'driver_arrived' ||
    normalized === 'in_transit'
  );
}

function ownerMatches(data: Record<string, unknown>, uid: string): boolean {
  if (!uid) return true;
  return [data.userId, data.clientId, data.customerId].some((value) => String(value || '') === uid);
}

function mergeHistoryRows(rows: HistoryRow[]): HistoryRow[] {
  const byId = new Map<string, HistoryRow>();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      serviceType: row.serviceType || prev.serviceType,
      amount: row.amount || prev.amount,
      status: preferFresherOrderStatus(prev.status, row.status),
      createdAt: prev.createdAt || row.createdAt,
      sortMs: Math.max(prev.sortMs, row.sortMs),
      waterType: row.waterType || prev.waterType,
      capacity: row.capacity || prev.capacity,
      type: row.type || prev.type,
      pickupAddress: row.pickupAddress || prev.pickupAddress,
      dropoffAddress: row.dropoffAddress || prev.dropoffAddress,
      driverName: row.driverName || prev.driverName,
      paymentStatus: row.paymentStatus || prev.paymentStatus,
    });
  }
  return Array.from(byId.values()).sort((a, b) => b.sortMs - a.sortMs);
}

function sessionFallbackRow(orderId: string): HistoryRow | null {
  const demo = loadDemoOrderFromSession(orderId);
  if (!demo) return null;
  const draftCreatedAt = loadCheckoutDraft(orderId)?.createdAt;
  return mapOrderHistoryRow(orderId, {
    serviceType: demo.serviceType,
    financials: demo.financials,
    status: 'broadcasting',
    createdAt: draftCreatedAt,
    serviceDetails: demo.serviceDetails || {},
    totalPrice: demo.financials?.customerTotal,
    price: demo.financials?.customerTotal,
  });
}

/** Real order history — live Firestore feed so new paid orders appear immediately. */
const CustomerOrderHistory: React.FC<{
  isRtl: boolean;
  t: (key: string) => string;
}> = ({ isRtl, t }) => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const placedId = searchParams.get('placed') || '';
  const customerUid = auth.currentUser?.uid || user?.uid || profile?.uid || '';
  const [orders, setOrders] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryRow | null>(null);

  useEffect(() => {
    if (!selected) return;
    const live = orders.find((row) => row.id === selected.id);
    if (!live) return;
    const mergedStatus = preferFresherOrderStatus(selected.status, live.status);
    if (
      mergedStatus !== selected.status ||
      live.driverName !== selected.driverName ||
      live.amount !== selected.amount
    ) {
      setSelected({
        ...live,
        status: mergedStatus,
        driverName: live.driverName || selected.driverName,
      });
    }
  }, [orders, selected]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const firestoreRows = new Map<string, HistoryRow>();
    const listenedIds = new Set<string>();
    let matchUid = customerUid;

    const publish = () => {
      if (cancelled) return;
      const localRows = loadLocalBroadcastOrders()
        .filter((entry) => ownerMatches(entry.data, matchUid))
        .map((entry) => mapOrderHistoryRow(entry.id, entry.data));
      const placedRow = placedId ? sessionFallbackRow(placedId) : null;
      setOrders(
        mergeHistoryRows([
          ...firestoreRows.values(),
          ...localRows,
          ...(placedRow ? [placedRow] : []),
        ])
      );
      setLoading(false);
    };

    let listenDoc = (_id: string) => {
      /* assigned after Firebase is ready */
    };

    const remember = (id: string, data: Record<string, unknown>) => {
      if (matchUid && !ownerMatches(data, matchUid)) return;
      firestoreRows.set(id, mapOrderHistoryRow(id, data));
      const prevLocal = loadLocalBroadcastOrders().find((entry) => entry.id === id)?.data;
      const incomingStatus = String(data.status || '');
      if (
        !prevLocal ||
        preferFresherOrderStatus(String(prevLocal.status || ''), incomingStatus) !==
          String(prevLocal.status || '') ||
        (data.driverId && String(data.driverId) !== String(prevLocal.driverId || ''))
      ) {
        upsertLocalBroadcastOrder(id, data);
      }
    };

    publish();

    const onLocalChange = () => publish();
    window.addEventListener(LOCAL_ORDERS_CHANGED_EVENT, onLocalChange);
    window.addEventListener('storage', onLocalChange);

    void (async () => {
      await ensureFirebaseReady();
      let ownerUid = auth.currentUser?.uid || '';
      try {
        ownerUid = await ensureSignedInFirebaseUid(8000);
      } catch {
        ownerUid = (await waitForFirebaseAuthUid(3000)) || auth.currentUser?.uid || '';
      }
      if (cancelled) return;

      listenDoc = (id: string) => {
        if (!id || listenedIds.has(id) || cancelled) return;
        listenedIds.add(id);
        unsubs.push(
          onSnapshot(
            doc(db, 'orders', id),
            (snap) => {
              if (snap.exists()) {
                remember(snap.id, snap.data() as Record<string, unknown>);
              }
              publish();
            },
            (error) => {
              console.warn('[CustomerOrderHistory] order doc listen failed:', id, error);
              publish();
            }
          )
        );
      };

      const refreshKnown = async () => {
        if (cancelled) return;
        const ids = new Set(
          [
            ...loadLocalBroadcastOrders().map((entry) => entry.id),
            ...firestoreRows.keys(),
            placedId,
          ].filter(Boolean)
        );
        await Promise.all(
          [...ids].map(async (id) => {
            try {
              const snap = await getDoc(doc(db, 'orders', id));
              if (snap.exists()) {
                remember(snap.id, snap.data() as Record<string, unknown>);
              }
            } catch {
              /* ignore per-doc refetch errors */
            }
          })
        );
        publish();
      };

      const onVisible = () => {
        if (document.visibilityState === 'visible') void refreshKnown();
      };
      document.addEventListener('visibilitychange', onVisible);
      unsubs.push(() => document.removeEventListener('visibilitychange', onVisible));

      if (!ownerUid) {
        [...loadLocalBroadcastOrders().map((entry) => entry.id), placedId]
          .filter(Boolean)
          .forEach((id) => listenDoc(id));
        publish();
        return;
      }
      matchUid = ownerUid;

      const q = query(
        collection(db, 'orders'),
        where('userId', '==', ownerUid),
        limit(50)
      );
      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            snap.docs.forEach((d) => remember(d.id, d.data() as Record<string, unknown>));
            publish();
          },
          (error) => {
            console.warn('[CustomerOrderHistory] userId query failed:', error);
            publish();
          }
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'orders'), where('clientId', '==', ownerUid), limit(50)),
          (snap) => {
            snap.docs.forEach((d) => remember(d.id, d.data() as Record<string, unknown>));
            publish();
          },
          (error) => {
            console.warn('[CustomerOrderHistory] clientId query failed:', error);
            publish();
          }
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'orders'), where('customerId', '==', ownerUid), limit(50)),
          (snap) => {
            snap.docs.forEach((d) => remember(d.id, d.data() as Record<string, unknown>));
            publish();
          },
          (error) => {
            console.warn('[CustomerOrderHistory] customerId query failed:', error);
            publish();
          }
        )
      );

      [...loadLocalBroadcastOrders().map((entry) => entry.id), placedId]
        .filter(Boolean)
        .forEach((id) => listenDoc(id));

      void refreshKnown();
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
      window.removeEventListener(LOCAL_ORDERS_CHANGED_EVENT, onLocalChange);
      window.removeEventListener('storage', onLocalChange);
    };
  }, [customerUid, placedId, user?.uid, profile?.uid]);

  useEffect(() => {
    if (!selected?.id) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void ensureFirebaseReady().then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db, 'orders', selected.id),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data() as Record<string, unknown>;
          upsertLocalBroadcastOrder(snap.id, data);
          setSelected((prev) => {
            const next = mapOrderHistoryRow(snap.id, data);
            if (prev && prev.id === next.id) {
              return {
                ...next,
                status: preferFresherOrderStatus(prev.status, next.status),
                driverName: next.driverName || prev.driverName,
              };
            }
            return next;
          });
        },
        (error) => {
          console.warn('[CustomerOrderHistory] selected order listen failed:', error);
        }
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [selected?.id]);

  return (
    <div className="space-y-8">
      <div className="bg-white p-8 rounded-[40px] border border-stone-100 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
            <History size={24} />
          </div>
          <h2 className="text-2xl font-black">{t('order_history_title')}</h2>
        </div>
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-stone-400 font-bold text-center py-8">
              {isRtl ? 'جاري التحميل...' : 'Loading...'}
            </p>
          ) : orders.length ? (
            orders.map((order) => {
              const label = formatOrderServiceLabel(
                order.serviceType,
                {
                  waterType: order.waterType,
                  capacity: order.capacity,
                  type: order.type,
                },
                t as never
              );
              const highlighted = placedId && order.id === placedId;
              return (
                <button
                  type="button"
                  key={order.id}
                  onClick={() => setSelected(order)}
                  className={`w-full text-inherit p-6 rounded-3xl border flex flex-col md:flex-row justify-between items-center gap-4 transition-all hover:shadow-md hover:border-primary/40 ${
                    highlighted
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-stone-50 border-stone-100'
                  }`}
                >
                  <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-primary font-bold">
                      {isWaterTankerService(order.serviceType) ? (
                        <Droplets size={24} />
                      ) : (
                        <Package size={24} />
                      )}
                    </div>
                    <div className={isRtl ? 'text-right' : 'text-left'}>
                      <p className="font-bold">{label.title}</p>
                      {label.subtitle ? (
                        <p className="text-xs text-stone-500 font-bold mt-0.5">{label.subtitle}</p>
                      ) : null}
                      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-1">
                        {order.createdAt || '—'} • #{order.id.slice(0, 8).toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between w-full md:w-auto md:gap-12">
                    <div className="text-center md:text-right">
                      <p className="text-lg font-black">
                        {order.amount.toFixed(2)} {t('sar')}
                      </p>
                      <p className={`text-[10px] font-bold ${historyStatusTone(order.status)}`}>
                        {formatClientOrderStatus(order.status, isRtl)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="p-12 border-2 border-dashed border-stone-100 rounded-[40px] flex flex-col items-center gap-4 text-stone-400">
              <History size={48} />
              <p className="font-bold">{t('no_more_orders')}</p>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-[32px] p-6 space-y-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                  #{selected.id.slice(0, 8).toUpperCase()}
                </p>
                <h3 className="text-xl font-black">
                  {formatOrderServiceLabel(
                    selected.serviceType,
                    {
                      waterType: selected.waterType,
                      capacity: selected.capacity,
                      type: selected.type,
                    },
                    t as never
                  ).title}
                </h3>
                <p className={`text-sm font-bold mt-1 ${historyStatusTone(selected.status)}`}>
                  {formatClientOrderStatus(selected.status, isRtl)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-stone-400 font-bold text-sm"
              >
                {isRtl ? 'إغلاق' : 'Close'}
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {selected.pickupAddress ? (
                <p>
                  <span className="text-stone-400 font-bold">{isRtl ? 'من' : 'From'}: </span>
                  {selected.pickupAddress}
                </p>
              ) : null}
              {selected.dropoffAddress ? (
                <p>
                  <span className="text-stone-400 font-bold">{isRtl ? 'إلى' : 'To'}: </span>
                  {selected.dropoffAddress}
                </p>
              ) : null}
              {selected.driverName ? (
                <p>
                  <span className="text-stone-400 font-bold">{isRtl ? 'السائق' : 'Driver'}: </span>
                  {selected.driverName}
                </p>
              ) : null}
              <p className="font-black">
                {selected.amount.toFixed(2)} {t('sar')}
              </p>
            </div>

            <ol className="space-y-2">
              {(() => {
                const timeline = clientTimelineStep(selected.status);
                return [
                {
                  key: 'waiting',
                  label: isRtl ? 'بانتظار السائق' : 'Waiting for driver',
                  done: true,
                  active: timeline === 'waiting',
                },
                {
                  key: 'accepted',
                  label: isRtl ? 'تم قبول الطلب' : 'Accepted',
                  done: timeline === 'accepted' || timeline === 'on_the_way' || timeline === 'completed',
                  active: timeline === 'accepted',
                },
                {
                  key: 'on_the_way',
                  label: isRtl ? 'في الطريق' : 'On the way',
                  done: timeline === 'on_the_way' || timeline === 'completed',
                  active: timeline === 'on_the_way',
                },
                {
                  key: 'completed',
                  label: isRtl ? 'مكتمل' : 'Completed',
                  done: timeline === 'completed',
                  active: timeline === 'completed',
                },
              ];
              })().map((step) => (
                <li key={step.key} className="flex items-center gap-3 text-sm font-bold">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      step.active
                        ? 'bg-primary animate-pulse'
                        : step.done
                          ? 'bg-emerald-500'
                          : 'bg-stone-200'
                    }`}
                  />
                  <span className={step.active || step.done ? 'text-neutral-900' : 'text-stone-400'}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>

            {isLiveTrackingStatus(selected.status) ||
            normalizeOrderStatus(selected.status) === 'broadcasting' ? (
              <button
                type="button"
                onClick={() => {
                  navigate(`/b2c/client?track=${encodeURIComponent(selected.id)}`);
                }}
                className="w-full py-4 bg-neutral-900 text-white rounded-2xl font-black"
              >
                {isRtl ? 'تتبع الطلب' : 'Track order'}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerDashboard;
