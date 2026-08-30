import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Routes, Route, useLocation, Navigate, Link } from 'react-router-dom';
import DashboardLayout from '@/components/DashboardLayout';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Users, Truck, Package, DollarSign, Search, Filter, Download, MoreHorizontal, ShieldAlert, UserX, UserCheck, AlertTriangle, TrendingUp, PieChart as PieChartIcon, X, Eye, FileText, CheckCircle2, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { DriverAccountStatus } from '@/types';
import { normalizeOrderStatus } from '@/domain/order-status';
import {
  fetchAdminOverview,
  fetchAdminDrivers,
  fetchAdminDriverDocumentUrl,
  updateAdminDriverStatusApi,
  fetchAdminCustomers,
  updateAdminCustomerStatusApi,
  fetchAdminFinancials,
  type AdminOverviewResponse,
  type AdminCustomerApiRow,
  type AdminFinancialLedgerResponse,
  type AdminDriverDocumentMeta,
  type CustomerAccountStatus,
} from '@/lib/adminService';
import {
  fetchAdminWithdrawals,
  approveAdminWithdrawal,
  rejectAdminWithdrawal,
  formatIbanDisplay,
  type WithdrawalRequest,
  type WithdrawalStatus,
} from '@/lib/withdrawalService';
import AdminCorporateContractsPanel from '@/components/admin/AdminCorporateContractsPanel';
import { B2B_MODULES_ENABLED } from '@/lib/launchFlags';
import { AdminDirectoryPanel } from '@/components/admin/AdminDirectoryPanel';
import { formatOrderServiceLabel } from '@/lib/serviceLabels';

interface Driver {
  id: string;
  kind?: 'b2c_driver' | 'fleet_driver';
  name: string;
  phone: string;
  truck: string;
  serviceType: string;
  subtype: string;
  plateNumber: string;
  nationalId?: string;
  registrationSerial?: string;
  companyName?: string;
  operatorId?: string;
  vehicleId?: string;
  status: DriverAccountStatus;
  docsComplete?: boolean;
  rejectionReason?: string | null;
  complaints: number;
  documents: {
    id: AdminDriverDocumentMeta;
    license: AdminDriverDocumentMeta;
    registration: AdminDriverDocumentMeta;
    permit: AdminDriverDocumentMeta;
  };
}

const EMPTY_DOC: AdminDriverDocumentMeta = { status: 'not_uploaded', expiresAt: null };

function mapOrderRowStatus(
  status: string,
  kind?: 'order' | 'driver_registration'
): 'completed' | 'active' | 'pending' | 'cancelled' {
  if (kind === 'driver_registration') return 'pending';
  const normalized = normalizeOrderStatus(status);
  if (normalized === 'completed') return 'completed';
  if (normalized === 'cancelled') return 'cancelled';
  if (['assigned', 'driver_arrived', 'in_transit', 'broadcasting', 'payment_authorized'].includes(normalized)) {
    return 'active';
  }
  return 'pending';
}

const DRIVER_REVIEW_STATUSES = new Set(['ready_for_review', 'pending']);

interface Complaint {
  id: string;
  driverName: string;
  customerName: string;
  text: string;
  date: string;
  status: 'pending' | 'resolved' | 'ignored';
}

const AdminDashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const location = useLocation();

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [customers, setCustomers] = useState<AdminCustomerApiRow[]>([]);
  const [financials, setFinancials] = useState<AdminFinancialLedgerResponse | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [withdrawalFilter, setWithdrawalFilter] = useState<WithdrawalStatus | 'all'>('pending');
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [processingWithdrawalId, setProcessingWithdrawalId] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Driver | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingFinancials, setLoadingFinancials] = useState(false);
  const [updatingDriverId, setUpdatingDriverId] = useState<string | null>(null);
  const [updatingCustomerId, setUpdatingCustomerId] = useState<string | null>(null);
  const [driverStatusFilter, setDriverStatusFilter] = useState<
    'all' | 'ready_for_review' | 'approved' | 'rejected' | 'suspended' | 'banned'
  >('ready_for_review');

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const data = await fetchAdminOverview();
      setOverview(data);
    } catch (error) {
      console.error('Admin overview load failed:', error);
      toast.error(isRtl ? 'تعذر تحميل ملخص لوحة التحكم' : 'Failed to load admin overview');
    } finally {
      setLoadingOverview(false);
    }
  }, [isRtl]);

  const loadDrivers = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoadingDrivers(true);
    try {
      const rows = await fetchAdminDrivers();
      setDrivers((prev) => {
        const prevPendingIds = new Set(
          prev.filter((d) => DRIVER_REVIEW_STATUSES.has(d.status)).map((d) => d.id)
        );
        const nextPending = rows.filter((d) => DRIVER_REVIEW_STATUSES.has(d.status));
        const newlyPending = nextPending.filter((d) => !prevPendingIds.has(d.id));
        if (prev.length > 0 && newlyPending.length > 0) {
          const names = newlyPending.map((d) => d.name).join(', ');
          toast.info(
            isRtl
              ? `طلب تسجيل سائق جديد: ${names}`
              : `New driver registration: ${names}`,
            { duration: 7000 }
          );
        }
        return rows.map((row) => ({
          ...row,
          documents: {
            id: row.documents?.id || EMPTY_DOC,
            license: row.documents?.license || EMPTY_DOC,
            registration: row.documents?.registration || EMPTY_DOC,
            permit: row.documents?.permit || EMPTY_DOC,
          },
        }));
      });
    } catch (error) {
      console.error('Admin drivers load failed:', error);
      if (!opts?.quiet) {
        toast.error(isRtl ? 'تعذر تحميل قائمة السائقين' : 'Failed to load drivers');
      }
    } finally {
      if (!opts?.quiet) setLoadingDrivers(false);
    }
  }, [isRtl]);

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      setCustomers(await fetchAdminCustomers());
    } catch (error) {
      console.error('Admin customers load failed:', error);
      toast.error(isRtl ? 'تعذر تحميل قائمة العملاء' : 'Failed to load clients');
    } finally {
      setLoadingCustomers(false);
    }
  }, [isRtl]);

  const loadFinancials = useCallback(async () => {
    setLoadingFinancials(true);
    try {
      setFinancials(await fetchAdminFinancials());
    } catch (error) {
      console.error('Admin financials load failed:', error);
      toast.error(isRtl ? 'تعذر تحميل السجل المالي' : 'Failed to load financial ledger');
    } finally {
      setLoadingFinancials(false);
    }
  }, [isRtl]);

  const loadWithdrawals = useCallback(async () => {
    setLoadingWithdrawals(true);
    try {
      setWithdrawals(await fetchAdminWithdrawals(withdrawalFilter));
    } catch (error) {
      console.error('Admin withdrawals load failed:', error);
      toast.error(isRtl ? 'تعذر تحميل طلبات السحب' : 'Failed to load payout requests');
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [isRtl, withdrawalFilter]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (location.pathname.startsWith('/admin/drivers')) {
      loadDrivers();
    }
    if (location.pathname.startsWith('/admin/clients')) {
      loadCustomers();
    }
    if (location.pathname.startsWith('/admin/finance')) {
      loadFinancials();
    }
    if (location.pathname.startsWith('/admin/withdrawals')) {
      loadWithdrawals();
    }
  }, [location.pathname, loadDrivers, loadCustomers, loadFinancials, loadWithdrawals]);

  /** Keep pending-driver queue live while admin is in the console. */
  const pendingDriversBaselineRef = useRef<number | null>(null);
  useEffect(() => {
    // Always hydrate drivers once so overview + drivers page share actionable data.
    void loadDrivers({ quiet: true });

    const intervalMs = 5_000;
    const interval = window.setInterval(() => {
      void loadOverview();
      void loadDrivers({ quiet: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [loadOverview, loadDrivers, location.pathname]);

  useEffect(() => {
    const count = overview?.stats.pendingDrivers;
    if (typeof count !== 'number') return;
    const baseline = pendingDriversBaselineRef.current;
    if (baseline !== null && count > baseline) {
      toast.info(
        isRtl
          ? `تنبيه: يوجد ${count} طلب تسجيل سائق قيد المراجعة`
          : `Alert: ${count} driver registration(s) pending review`,
        { duration: 6000 }
      );
    }
    pendingDriversBaselineRef.current = count;
  }, [overview?.stats.pendingDrivers, isRtl]);

  const handleApproveWithdrawal = async (id: string) => {
    setProcessingWithdrawalId(id);
    try {
      await approveAdminWithdrawal(id);
      toast.success(isRtl ? 'تم تأكيد التحويل بنجاح' : 'Transfer marked as completed');
      await loadWithdrawals();
    } catch (error) {
      console.error('Approve withdrawal failed:', error);
      const msg = error instanceof Error ? error.message : (isRtl ? 'فشل الاعتماد' : 'Approve failed');
      toast.error(msg);
    } finally {
      setProcessingWithdrawalId(null);
    }
  };

  const handleRejectWithdrawal = async (id: string) => {
    const reason = window.prompt(
      isRtl ? 'سبب الرفض (اختياري):' : 'Rejection reason (optional):'
    );
    if (reason === null) return; // cancelled prompt
    setProcessingWithdrawalId(id);
    try {
      await rejectAdminWithdrawal(id, reason || undefined);
      toast.success(
        isRtl
          ? 'تم رفض الطلب وإرجاع المبلغ لمحفظة السائق'
          : 'Request rejected — amount refunded to driver wallet'
      );
      await loadWithdrawals();
    } catch (error) {
      console.error('Reject withdrawal failed:', error);
      const msg = error instanceof Error ? error.message : (isRtl ? 'فشل الرفض' : 'Reject failed');
      toast.error(msg);
    } finally {
      setProcessingWithdrawalId(null);
    }
  };

  const pendingDrivers = drivers.filter((d) => DRIVER_REVIEW_STATUSES.has(d.status));
  const filteredDrivers =
    driverStatusFilter === 'all'
      ? drivers
      : driverStatusFilter === 'ready_for_review'
        ? pendingDrivers
        : drivers.filter((d) => d.status === driverStatusFilter);

  const updateDriverStatus = async (
    driver: Driver,
    newStatus: DriverAccountStatus,
    reason?: string
  ) => {
    if (newStatus === 'rejected' && String(reason || '').trim().length < 3) {
      setRejectTarget(driver);
      setRejectReason('');
      return;
    }

    const id = driver.id;
    const previousStatus = drivers.find((d) => d.id === id)?.status;
    setUpdatingDriverId(id);
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, status: newStatus } : d)));

    try {
      await updateAdminDriverStatusApi(driver, newStatus, reason);

      if (newStatus === 'approved') toast.success(t('approve_success_msg'));
      if (newStatus === 'rejected') toast.error(t('reject_success_msg'));
      if (newStatus === 'suspended' || newStatus === 'banned') {
        toast.warning(
          newStatus === 'banned'
            ? isRtl
              ? 'تم حظر السائق فوراً'
              : 'Driver banned immediately'
            : t('suspend_success_msg')
        );
      }
      if (newStatus === 'approved' && (previousStatus === 'suspended' || previousStatus === 'banned')) {
        toast.success(t('activate_success_msg'));
      }

      setSelectedDriver(null);
      setRejectTarget(null);
      setRejectReason('');
      await Promise.all([loadDrivers(), loadOverview()]);
    } catch (error) {
      console.error('Driver status update failed:', error);
      setDrivers((prev) =>
        prev.map((d) => (d.id === id && previousStatus ? { ...d, status: previousStatus } : d))
      );
      toast.error(
        error instanceof Error
          ? error.message
          : isRtl
            ? 'فشل تحديث حالة السائق'
            : 'Failed to update driver status'
      );
    } finally {
      setUpdatingDriverId(null);
    }
  };

  const updateCustomerStatus = async (id: string, newStatus: CustomerAccountStatus) => {
    const previous = customers.find((c) => c.id === id)?.status;
    setUpdatingCustomerId(id);
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c)));
    try {
      await updateAdminCustomerStatusApi(id, newStatus);
      toast.success(
        newStatus === 'active'
          ? isRtl
            ? 'تم تفعيل حساب العميل'
            : 'Client account activated'
          : isRtl
            ? 'تم حظر/إيقاف حساب العميل'
            : 'Client account blocked'
      );
      await loadCustomers();
    } catch (error) {
      console.error('Customer status update failed:', error);
      setCustomers((prev) =>
        prev.map((c) => (c.id === id && previous ? { ...c, status: previous } : c))
      );
      toast.error(isRtl ? 'فشل تحديث حالة العميل' : 'Failed to update client status');
    } finally {
      setUpdatingCustomerId(null);
    }
  };

  const handleResolveComplaint = (id: string) => {
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, status: 'resolved' } : c));
    toast.success(t('complaint_resolved_msg'));
  };

  const handleIgnoreComplaint = (id: string) => {
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, status: 'ignored' } : c));
    toast.info(t('complaint_ignored_msg'));
  };

  const chartData = useMemo(() => {
    const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNamesAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      return {
        key: d.toISOString().slice(0, 10),
        name: isRtl ? dayNamesAr[d.getDay()] : dayNamesEn[d.getDay()],
        revenue: 0,
        orders: 0,
      };
    });
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    const transportOrders = (overview?.recentOrders || []).filter(
      (order) => order.kind !== 'driver_registration'
    );
    (transportOrders).forEach((order) => {
      if (!order.createdAt) return;
      const key = new Date(order.createdAt).toISOString().slice(0, 10);
      const bucket = byKey.get(key);
      if (!bucket) return;
      bucket.revenue += Number(order.amount) || 0;
      bucket.orders += 1;
    });
    return buckets;
  }, [isRtl, overview?.recentOrders]);

  const serviceDistribution = useMemo(() => {
    const orders = (overview?.recentOrders || []).filter(
      (order) => order.kind !== 'driver_registration'
    );
    const counts = new Map<string, number>();
    orders.forEach((order) => {
      const key = order.serviceType || 'other';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const total = orders.length || 1;
    const palette = ['bg-blue-500', 'bg-orange-500', 'bg-cyan-500', 'bg-purple-500', 'bg-gray-300'];
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count], index) => ({
        label: formatOrderServiceLabel(type, null, t).title,
        percentage: Math.round((count / total) * 100),
        color: palette[index] || 'bg-gray-300',
      }));
  }, [isRtl, overview?.recentOrders, t]);

  const reportMetrics = useMemo(() => {
    const completed = overview?.stats.completedOrders ?? 0;
    const payments = overview?.stats.clientPaymentsSar ?? 0;
    const cancelled = (overview?.recentOrders || []).filter(
      (order) =>
        order.kind !== 'driver_registration' && mapOrderRowStatus(order.status, order.kind) === 'cancelled'
    ).length;
    const recentCount =
      (overview?.recentOrders || []).filter((order) => order.kind !== 'driver_registration').length || 0;
    return {
      averageOrder: completed > 0 ? (payments / completed).toFixed(2) : '0.00',
      totalLoads: completed,
      cancellationRate: recentCount > 0 ? ((cancelled / recentCount) * 100).toFixed(1) : '0.0',
    };
  }, [overview]);

  const getPageTitle = () => {
    if (location.pathname === '/admin/drivers') return t('manage_drivers');
    if (location.pathname === '/admin/directory') {
      return isRtl ? 'دليل المستخدمين والسائقين' : 'Users & drivers directory';
    }
    if (location.pathname === '/admin/clients') return isRtl ? 'إدارة العملاء' : 'Manage clients';
    if (location.pathname === '/admin/finance') return isRtl ? 'المحاسبة المالية' : 'Financial ledger';
    if (location.pathname === '/admin/withdrawals') {
      return isRtl ? 'طلبات سحب أرباح السائقين' : 'Driver payout requests';
    }
    if (location.pathname === '/admin/corporate-contracts') {
      return isRtl ? 'عقود الشركات' : 'Corporate contracts';
    }
    if (location.pathname === '/admin/reports') return t('reports_analytics');
    return t('admin_dashboard');
  };

  return (
    <DashboardLayout title={getPageTitle()}>
      <div className="space-y-8" dir={isRtl ? 'rtl' : 'ltr'}>
        <AnimatePresence>
          {selectedDriver && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedDriver(null)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white w-full max-w-5xl rounded-[40px] shadow-2xl overflow-hidden overflow-y-auto max-h-[90vh]"
              >
                {/* Modal Header */}
                <div className="p-8 border-b flex justify-between items-center sticky top-0 bg-white z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                      <Truck size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">{t('driver_details')}</h3>
                      <p className="text-xs text-gray-400 font-mono tracking-wider">{selectedDriver.id}</p>
                      <p className="text-[10px] font-black text-amber-700 mt-1">
                        {selectedDriver.kind === 'fleet_driver'
                          ? isRtl
                            ? 'سائق أسطول'
                            : 'Fleet driver'
                          : isRtl
                            ? 'سائق فردي'
                            : 'Individual driver'}
                        {selectedDriver.status === 'ready_for_review'
                          ? ` · ${isRtl ? 'جاهز للمراجعة' : 'Ready for Review'}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedDriver(null)} className="p-3 hover:bg-gray-50 rounded-2xl transition-colors">
                    <X size={20} />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-8 space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('full_name')}</p>
                      <p className="font-bold">{selectedDriver.name}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('phone_number')}</p>
                      <p className="font-bold font-mono">{selectedDriver.phone}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('truck_type')}</p>
                      <p className="font-bold">{selectedDriver.truck}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('vehicle_plate')}</p>
                      <p className="font-bold">{selectedDriver.plateNumber}</p>
                    </div>
                    {selectedDriver.nationalId && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {isRtl ? 'هوية / إقامة' : 'ID / Iqama'}
                        </p>
                        <p className="font-bold font-mono">{selectedDriver.nationalId}</p>
                      </div>
                    )}
                    {selectedDriver.registrationSerial && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {isRtl ? 'رقم الاستمارة' : 'Istimara serial'}
                        </p>
                        <p className="font-bold font-mono">{selectedDriver.registrationSerial}</p>
                      </div>
                    )}
                    {selectedDriver.companyName && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {isRtl ? 'الشركة / المشغل' : 'Company / operator'}
                        </p>
                        <p className="font-bold">{selectedDriver.companyName}</p>
                      </div>
                    )}
                    {selectedDriver.rejectionReason && (
                      <div className="space-y-1 col-span-2">
                        <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest">
                          {isRtl ? 'سبب الرفض' : 'Rejection reason'}
                        </p>
                        <p className="font-bold text-red-600">{selectedDriver.rejectionReason}</p>
                      </div>
                    )}
                  </div>

                  {/* Documents Section */}
                  <div className="space-y-4">
                    <h4 className="font-bold flex items-center gap-2">
                      <FileText size={18} className="text-gray-400" />
                      {t('documents')}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <DocumentPreview
                        label={t('id_card')}
                        driver={selectedDriver}
                        docKey="id"
                        meta={selectedDriver.documents.id}
                        isRtl={isRtl}
                      />
                      <DocumentPreview
                        label={t('driving_license')}
                        driver={selectedDriver}
                        docKey="license"
                        meta={selectedDriver.documents.license}
                        isRtl={isRtl}
                      />
                      <DocumentPreview
                        label={t('vehicle_registration')}
                        driver={selectedDriver}
                        docKey="registration"
                        meta={selectedDriver.documents.registration}
                        isRtl={isRtl}
                      />
                      <DocumentPreview
                        label={t('operation_card')}
                        driver={selectedDriver}
                        docKey="permit"
                        meta={selectedDriver.documents.permit}
                        isRtl={isRtl}
                      />
                    </div>
                  </div>

                  {/* Account Actions — admin retains 100% final authority (no auto-approval). */}
                  <div className="pt-8 border-t flex flex-wrap gap-3">
                    {(selectedDriver.status === 'ready_for_review' ||
                      selectedDriver.status === 'pending' ||
                      selectedDriver.status === 'rejected' ||
                      selectedDriver.status === 'suspended' ||
                      selectedDriver.status === 'banned') && (
                      <button 
                        onClick={() => void updateDriverStatus(selectedDriver, 'approved')}
                        disabled={updatingDriverId === selectedDriver.id}
                        className="flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-green-500 text-white py-4 rounded-2xl font-bold hover:bg-green-600 transition-colors shadow-lg shadow-green-200 disabled:opacity-50"
                      >
                        <CheckCircle2 size={18} />
                        {selectedDriver.status === 'suspended' || selectedDriver.status === 'banned'
                          ? t('activate')
                          : t('approve')}
                      </button>
                    )}
                    
                    {(selectedDriver.status === 'ready_for_review' ||
                      selectedDriver.status === 'pending') && (
                      <button 
                        onClick={() => {
                          setRejectTarget(selectedDriver);
                          setRejectReason('');
                        }}
                        className="flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-red-50 text-red-500 py-4 rounded-2xl font-bold hover:bg-red-500 hover:text-white transition-colors"
                      >
                        <X size={18} />
                        {isRtl ? 'رفض مع ذكر السبب' : 'Reject with reason'}
                      </button>
                    )}

                    {(selectedDriver.status === 'approved' ||
                      selectedDriver.status === 'ready_for_review' ||
                      selectedDriver.status === 'pending') && (
                      <button 
                        onClick={() => void updateDriverStatus(selectedDriver, 'suspended')}
                        className="flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-orange-50 text-orange-600 py-4 rounded-2xl font-bold hover:bg-orange-500 hover:text-white transition-colors"
                      >
                        <ShieldOff size={18} />
                        {t('suspend')}
                      </button>
                    )}

                    {selectedDriver.status !== 'banned' && (
                      <button 
                        onClick={() => void updateDriverStatus(selectedDriver, 'banned')}
                        disabled={updatingDriverId === selectedDriver.id}
                        className="flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
                      >
                        <UserX size={18} />
                        {isRtl ? 'حظر فوري' : 'Ban now'}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {rejectTarget && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/50"
                onClick={() => setRejectTarget(null)}
                aria-label="Close"
              />
              <div className="relative bg-white w-full max-w-md rounded-[32px] p-8 space-y-5 shadow-2xl">
                <h3 className="text-xl font-black">
                  {isRtl ? 'رفض مع ذكر السبب' : 'Reject with reason'}
                </h3>
                <p className="text-sm text-gray-500">
                  {rejectTarget.name} · {rejectTarget.plateNumber}
                </p>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder={
                    isRtl
                      ? 'اكتب سبب الرفض (مطلوب) — مثال: صورة الرخصة غير واضحة'
                      : 'Enter the rejection reason (required) — e.g. license photo is unreadable'
                  }
                  className="w-full rounded-2xl border border-stone-200 p-4 text-sm outline-none focus:border-red-400"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setRejectTarget(null)}
                    className="flex-1 py-3 rounded-2xl bg-gray-50 font-bold text-sm"
                  >
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    disabled={updatingDriverId === rejectTarget.id}
                    onClick={() => {
                      if (rejectReason.trim().length < 3) {
                        toast.error(
                          isRtl ? 'يرجى ذكر سبب الرفض' : 'Please enter a rejection reason'
                        );
                        return;
                      }
                      void updateDriverStatus(rejectTarget, 'rejected', rejectReason.trim());
                    }}
                    className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold text-sm disabled:opacity-50"
                  >
                    {isRtl ? 'تأكيد الرفض' : 'Confirm reject'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>

        <Routes>
          <Route index element={
            <>
              {(overview?.stats.pendingDrivers ?? 0) > 0 && (
                <div className="bg-orange-50 border-2 border-orange-200 p-6 rounded-[28px] flex flex-col sm:flex-row items-center gap-4 justify-between">
                  <div className={`flex items-center gap-4 ${isRtl ? 'text-right' : 'text-left'}`}>
                    <div className="w-12 h-12 rounded-2xl bg-orange-500 text-white flex items-center justify-center">
                      <AlertTriangle size={22} />
                    </div>
                    <div>
                      <h3 className="font-bold text-orange-900">
                        {isRtl
                          ? `${overview?.stats.pendingDrivers} طلب جاهز للمراجعة`
                          : `${overview?.stats.pendingDrivers} application(s) Ready for Review`}
                      </h3>
                      <p className="text-sm text-orange-700">
                        {isRtl
                          ? 'راجع الصور الأربع ثم اعتمد أو ارفض مع ذكر السبب. لا يتم التفعيل تلقائياً.'
                          : 'Review all four images, then approve or reject with a reason. Nothing is auto-approved.'}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/admin/drivers"
                    className="px-5 py-3 rounded-2xl bg-orange-600 text-white text-sm font-bold whitespace-nowrap"
                  >
                    {isRtl ? 'عرض الطلبات' : 'Review applications'}
                  </Link>
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <AdminStatCard
                  icon={<Users className="text-neutral-800" />}
                  label={isRtl ? 'إجمالي المستخدمين' : 'Total users'}
                  value={loadingOverview ? '…' : String(overview?.stats.totalUsers ?? 0)}
                  isRtl={isRtl}
                  to="/admin/directory"
                />
                <AdminStatCard
                  icon={<Truck className="text-blue-500" />}
                  label={isRtl ? 'إجمالي السائقين' : 'Total drivers'}
                  value={loadingOverview ? '…' : String(overview?.stats.totalDrivers ?? overview?.stats.activeDrivers ?? 0)}
                  isRtl={isRtl}
                  to="/admin/directory?kind=drivers"
                />
                <AdminStatCard
                  icon={<Users className="text-orange-500" />}
                  label={t('pending_review')}
                  value={loadingOverview ? '…' : String(overview?.stats.pendingDrivers ?? 0)}
                  isRtl={isRtl}
                  to="/admin/drivers"
                />
                <AdminStatCard
                  icon={<DollarSign className="text-green-500" />}
                  label={isRtl ? 'عمولة المنصة' : 'Platform commission'}
                  value={loadingOverview ? '…' : `${overview?.stats.platformCommissionSar ?? overview?.stats.netRevenueSar ?? 0} ${t('sar')}`}
                  isRtl={isRtl}
                />
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                 <div className="lg:col-span-2 bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6 text-right">
                    <div className={`flex justify-between items-center ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                       <h3 className="text-xl font-bold">{isRtl ? 'تحليل الإيرادات والأوامر' : 'Revenue & Orders Analysis'}</h3>
                       <select className="bg-gray-50 border-none outline-none text-xs font-bold p-2 rounded-xl">
                          <option>{isRtl ? 'آخر 7 أيام' : 'Last 7 Days'}</option>
                          <option>{isRtl ? 'آخر شهر' : 'Last Month'}</option>
                       </select>
                    </div>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} orientation={isRtl ? 'right' : 'left'} />
                          <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                          <Bar dataKey="revenue" fill="#FFB800" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                 </div>

                 <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6 text-right">
                    <h3 className="text-xl font-bold">{isRtl ? 'توزيع الخدمات' : 'Service Distribution'}</h3>
                    <div className="space-y-4">
                       {serviceDistribution.length === 0 ? (
                         <p className="text-sm text-gray-400">
                           {isRtl ? 'لا توجد طلبات حقيقية لعرض التوزيع' : 'No production orders to chart yet'}
                         </p>
                       ) : (
                         serviceDistribution.map((row) => (
                           <ServiceQuota
                             key={row.label}
                             label={row.label}
                             percentage={row.percentage}
                             color={row.color}
                           />
                         ))
                       )}
                    </div>
                 </div>
              </div>

              {/* Orders Table */}
              <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
                 <div className={`p-8 border-b flex flex-col md:flex-row justify-between items-center gap-4 ${isRtl ? 'text-right' : 'text-left'}`}>
                    <h3 className="text-xl font-bold">
                      {isRtl ? 'أحدث الطلبات وطلبات التسجيل' : 'Recent orders & applications'}
                    </h3>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                       <div className={`flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl border border-gray-100 flex-1 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                          <Search size={16} className="text-gray-400" />
                          <input type="text" placeholder={isRtl ? 'البحث برقم الطلب...' : 'Search by order number...'} className={`bg-transparent border-none outline-none text-xs w-full ${isRtl ? 'text-right' : 'text-left'}`} />
                       </div>
                    </div>
                 </div>
                 
                 <div className="overflow-x-auto">
                    <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                       <thead>
                          <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                             <th className="px-8 py-4">{isRtl ? 'رقم الطلب' : 'Order ID'}</th>
                             <th className="px-8 py-4">{isRtl ? 'العميل' : 'Customer'}</th>
                             <th className="px-8 py-4">{isRtl ? 'الخدمة' : 'Service'}</th>
                             <th className="px-8 py-4">{isRtl ? 'ملاحظات المركبة' : 'Vehicle notes'}</th>
                             <th className="px-8 py-4">{isRtl ? 'المبلغ' : 'Amount'}</th>
                             <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                             <th className={`px-8 py-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجراءات' : 'Actions'}</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-50">
                          {loadingOverview ? (
                            <tr>
                              <td colSpan={7} className="px-8 py-10 text-center text-sm text-gray-400">
                                {isRtl ? 'جاري تحميل الطلبات...' : 'Loading orders...'}
                              </td>
                            </tr>
                          ) : overview?.recentOrders?.length ? (
                            overview.recentOrders.map((order) => {
                              const isDriverApp = order.kind === 'driver_registration';
                              const label = isDriverApp
                                ? {
                                    title: isRtl ? 'تسجيل سائق' : 'Driver registration',
                                    subtitle: undefined as string | undefined,
                                  }
                                : formatOrderServiceLabel(
                                    order.serviceType,
                                    {
                                      waterType: order.waterType,
                                      capacity: order.capacity,
                                      type: order.serviceOption || order.capacity,
                                    },
                                    t
                                  );
                              return (
                              <OrderRow
                                key={order.id}
                                id={`#${order.id.replace(/^driver:/, '').slice(0, 8).toUpperCase()}`}
                                user={
                                  order.customerName ||
                                  order.userId.slice(0, 8) ||
                                  '—'
                                }
                                service={
                                  label.subtitle
                                    ? `${label.title} — ${label.subtitle}`
                                    : label.title
                                }
                                amount={
                                  isDriverApp ? '—' : `${order.amount} ${t('sar')}`
                                }
                                status={mapOrderRowStatus(order.status, order.kind)}
                                fieldNotes={
                                  isDriverApp
                                    ? isRtl
                                      ? 'طلب تسجيل سائق'
                                      : 'Driver application'
                                    : formatVehicleFieldNotes(order.vehicleFieldNotes, isRtl)
                                }
                                href={isDriverApp ? '/admin/drivers' : undefined}
                                isRtl={isRtl}
                              />
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={7} className="px-8 py-10 text-center text-sm text-gray-400">
                                {isRtl ? 'لا توجد طلبات أو طلبات تسجيل حديثة' : 'No recent orders or applications'}
                              </td>
                            </tr>
                          )}
                       </tbody>
                    </table>
                 </div>
              </div>
            </>
          } />

          <Route path="drivers" element={
            <div className="space-y-8">
              {/* Drivers Table */}
              <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b flex flex-col gap-4 md:flex-row md:justify-between md:items-center">
                  <div className={`${isRtl ? 'text-right' : 'text-left'}`}>
                    <h3 className={`text-xl font-bold flex items-center gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                      <Users size={24} className="text-primary" />
                      {isRtl ? 'إدارة السائقين' : 'Manage Drivers'}
                    </h3>
                    <p className="text-xs text-orange-600 font-bold mt-1">
                      {isRtl
                        ? `${pendingDrivers.length} جاهز للمراجعة`
                        : `${pendingDrivers.length} Ready for Review`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: 'ready_for_review' as const, ar: 'جاهز للمراجعة', en: 'Ready for Review' },
                        { id: 'approved' as const, ar: 'معتمد', en: 'Approved' },
                        { id: 'all' as const, ar: 'الكل', en: 'All' },
                        { id: 'rejected' as const, ar: 'مرفوض', en: 'Rejected' },
                        { id: 'suspended' as const, ar: 'موقوف', en: 'Suspended' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setDriverStatusFilter(tab.id)}
                        className={`px-3 py-2 rounded-xl text-[10px] font-bold transition-all ${
                          driverStatusFilter === tab.id
                            ? 'bg-black text-white'
                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {isRtl ? tab.ar : tab.en}
                        {tab.id === 'ready_for_review' ? ` (${pendingDrivers.length})` : ''}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void loadDrivers()}
                      disabled={loadingDrivers}
                      className="px-4 py-2 rounded-xl bg-primary text-black text-[10px] font-bold disabled:opacity-50"
                    >
                      {loadingDrivers
                        ? isRtl
                          ? 'جاري التحديث...'
                          : 'Refreshing...'
                        : isRtl
                          ? 'تحديث الآن'
                          : 'Refresh now'}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                        <th className="px-8 py-4">{isRtl ? 'السائق' : 'Driver'}</th>
                        <th className="px-8 py-4">{isRtl ? 'المركبة' : 'Vehicle'}</th>
                        <th className="px-8 py-4">{isRtl ? 'الشكاوى' : 'Complaints'}</th>
                        <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                        <th className={`px-8 py-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {loadingDrivers ? (
                        <tr>
                          <td colSpan={5} className="px-8 py-10 text-center text-sm text-gray-400">
                            {isRtl ? 'جاري تحميل السائقين...' : 'Loading drivers...'}
                          </td>
                        </tr>
                      ) : filteredDrivers.length ? (
                      filteredDrivers.map((driver) => (
                        <tr key={driver.id} className="hover:bg-gray-50/50 transition-colors group">
                          <td className="px-8 py-5">
                            <div className={`flex flex-col ${isRtl ? 'items-start' : 'items-start'}`}>
                              <span className="font-bold text-sm">{driver.name}</span>
                              <span className="text-[10px] text-gray-400">{driver.phone}</span>
                              <span className="text-[10px] font-bold text-stone-400 mt-0.5">
                                {driver.kind === 'fleet_driver'
                                  ? isRtl
                                    ? 'أسطول'
                                    : 'Fleet'
                                  : isRtl
                                    ? 'فردي'
                                    : 'Individual'}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-sm">{driver.truck}</td>
                          <td className="px-8 py-5 text-sm">
                            {driver.complaints > 0 ? (
                              <span className="flex items-center gap-1 text-red-500 font-bold">
                                <AlertTriangle size={14} /> {driver.complaints} {isRtl ? 'شكاوى' : 'Complaints'}
                              </span>
                            ) : (
                              <span className="text-green-500">{isRtl ? 'لا يوجد' : 'None'}</span>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            {driver.status === 'approved' && <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold">{t('approved_status')}</span>}
                            {(driver.status === 'ready_for_review' || driver.status === 'pending') && (
                              <span className="px-3 py-1 bg-orange-50 text-orange-600 rounded-full text-[10px] font-bold">
                                {isRtl ? 'جاهز للمراجعة' : 'Ready for Review'}
                              </span>
                            )}
                            {driver.status === 'rejected' && <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full text-[10px] font-bold">{t('rejected_status')}</span>}
                            {driver.status === 'suspended' && (
                              <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full text-[10px] font-bold">{t('suspended_status')}</span>
                            )}
                            {driver.status === 'banned' && (
                              <span className="px-3 py-1 bg-black text-white rounded-full text-[10px] font-bold">
                                {isRtl ? 'محظور' : 'Banned'}
                              </span>
                            )}
                          </td>
                          <td className="px-8 py-5 text-left">
                            <div className={`flex items-center gap-2 ${isRtl ? 'justify-end' : 'justify-end'}`}>
                              <button 
                                onClick={() => setSelectedDriver(driver)}
                                className="p-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-black hover:text-white transition-all shadow-sm"
                                title={isRtl ? 'عرض التفاصيل' : 'View Details'}
                              >
                                <Eye size={18} />
                              </button>
                              {driver.status !== 'approved' && (
                                <button
                                  disabled={updatingDriverId === driver.id}
                                  onClick={() => void updateDriverStatus(driver, 'approved')}
                                  className="px-3 py-2 rounded-lg bg-green-500 text-white text-[10px] font-bold hover:bg-green-600 disabled:opacity-50"
                                  title={isRtl ? 'اعتماد السائق' : 'Approve driver'}
                                >
                                  {isRtl ? 'اعتماد' : 'Approve'}
                                </button>
                              )}
                              {(driver.status === 'ready_for_review' || driver.status === 'pending') && (
                                <button
                                  disabled={updatingDriverId === driver.id}
                                  onClick={() => {
                                    setRejectTarget(driver);
                                    setRejectReason('');
                                  }}
                                  className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-[10px] font-bold hover:bg-red-500 hover:text-white disabled:opacity-50"
                                  title={isRtl ? 'رفض مع ذكر السبب' : 'Reject with reason'}
                                >
                                  {isRtl ? 'رفض' : 'Reject'}
                                </button>
                              )}
                              {driver.status === 'approved' && (
                                <button
                                  disabled={updatingDriverId === driver.id}
                                  onClick={() => void updateDriverStatus(driver, 'suspended')}
                                  className="px-3 py-2 rounded-lg bg-orange-50 text-orange-600 text-[10px] font-bold hover:bg-orange-500 hover:text-white disabled:opacity-50"
                                  title={isRtl ? 'إيقاف' : 'Suspend'}
                                >
                                  {isRtl ? 'إيقاف' : 'Suspend'}
                                </button>
                              )}
                              {driver.status !== 'banned' && (
                                <button
                                  disabled={updatingDriverId === driver.id}
                                  onClick={() => void updateDriverStatus(driver, 'banned')}
                                  className="px-3 py-2 rounded-lg bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 disabled:opacity-50"
                                  title={isRtl ? 'حظر فوري' : 'Ban now'}
                                >
                                  {isRtl ? 'حظر' : 'Ban'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="px-8 py-10 text-center text-sm text-gray-400">
                            {driverStatusFilter === 'ready_for_review' || driverStatusFilter === 'pending'
                              ? isRtl
                                ? 'لا توجد طلبات تسجيل قيد المراجعة حالياً'
                                : 'No pending registration applications right now'
                              : isRtl
                                ? 'لا يوجد سائقون في هذا التصنيف'
                                : 'No drivers in this filter'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Complaints Table */}
              <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b flex justify-between items-center">
                  <h3 className={`text-xl font-bold flex items-center gap-2 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                    <ShieldAlert size={24} className="text-red-500" />
                    {t('complaints_management')}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                        <th className="px-8 py-4">{isRtl ? 'السائق' : 'Driver'}</th>
                        <th className="px-8 py-4">{isRtl ? 'العميل' : 'Customer'}</th>
                        <th className="px-8 py-4">{isRtl ? 'الشكوى' : 'Complaint'}</th>
                        <th className="px-8 py-4">{isRtl ? 'التاريخ' : 'Date'}</th>
                        <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                        <th className={`px-8 py-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {complaints.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-8 py-10 text-center text-sm text-gray-400">
                            {isRtl ? 'لا توجد شكاوى مسجّلة' : 'No complaints on record'}
                          </td>
                        </tr>
                      ) : (
                      complaints.map((complaint) => (
                        <tr key={complaint.id} className="hover:bg-gray-50/50 transition-colors group">
                          <td className="px-8 py-5 font-bold text-sm">{complaint.driverName}</td>
                          <td className="px-8 py-5 text-sm">{complaint.customerName}</td>
                          <td className="px-8 py-5 text-[10px] text-gray-500 max-w-xs">{complaint.text}</td>
                          <td className="px-8 py-5 text-xs font-mono">{complaint.date}</td>
                          <td className="px-8 py-5">
                            {complaint.status === 'pending' && <span className="px-3 py-1 bg-orange-50 text-orange-600 rounded-full text-[10px] font-bold">{isRtl ? 'معلق' : 'Pending'}</span>}
                            {complaint.status === 'resolved' && <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold">{isRtl ? 'تم الحل' : 'Resolved'}</span>}
                            {complaint.status === 'ignored' && <span className="px-3 py-1 bg-gray-50 text-gray-400 rounded-full text-[10px] font-bold">{isRtl ? 'تجاهل' : 'Ignored'}</span>}
                          </td>
                          <td className="px-8 py-5 text-left">
                            <div className="flex items-center gap-2 justify-end">
                              {complaint.status === 'pending' && (
                                <>
                                  <button 
                                    onClick={() => handleResolveComplaint(complaint.id)}
                                    className="p-2 bg-green-50 text-green-500 rounded-lg hover:bg-green-500 hover:text-white transition-all"
                                    title={t('resolve')}
                                  >
                                    <CheckCircle2 size={16} />
                                  </button>
                                  <button 
                                    onClick={() => handleIgnoreComplaint(complaint.id)}
                                    className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-200 transition-all"
                                    title={t('ignore')}
                                  >
                                    <X size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          } />

          <Route path="clients" element={
            <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-8 border-b">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Users size={24} className="text-primary" />
                  {isRtl ? 'إدارة العملاء' : 'Client management'}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                  <thead>
                    <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                      <th className="px-8 py-4">{isRtl ? 'العميل' : 'Client'}</th>
                      <th className="px-8 py-4">{isRtl ? 'الطلبات' : 'Orders'}</th>
                      <th className="px-8 py-4">{isRtl ? 'إجمالي المدفوع' : 'Total paid'}</th>
                      <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                      <th className="px-8 py-4">{isRtl ? 'الإجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {loadingCustomers ? (
                      <tr>
                        <td colSpan={5} className="px-8 py-10 text-center text-sm text-gray-400">
                          {isRtl ? 'جاري التحميل...' : 'Loading...'}
                        </td>
                      </tr>
                    ) : customers.length ? (
                      customers.map((customer) => (
                        <tr key={customer.id} className="hover:bg-gray-50/50">
                          <td className="px-8 py-5">
                            <div className="flex flex-col">
                              <span className="font-bold text-sm">{customer.name}</span>
                              <span className="text-[10px] text-gray-400 font-mono">{customer.phone}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-sm font-bold">{customer.ordersCount}</td>
                          <td className="px-8 py-5 text-sm font-mono font-bold">
                            {customer.totalSpentSar} {t('sar')}
                          </td>
                          <td className="px-8 py-5">
                            <span
                              className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                                customer.status === 'active'
                                  ? 'bg-green-50 text-green-600'
                                  : 'bg-red-50 text-red-600'
                              }`}
                            >
                              {customer.status}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex gap-2 justify-end">
                              {(customer.status === 'blocked' ||
                                customer.status === 'banned' ||
                                customer.status === 'suspended') && (
                                <button
                                  disabled={updatingCustomerId === customer.id}
                                  onClick={() => updateCustomerStatus(customer.id, 'active')}
                                  className="px-3 py-2 rounded-xl bg-green-500 text-white text-xs font-bold disabled:opacity-50"
                                >
                                  {isRtl ? 'تفعيل' : 'Unblock'}
                                </button>
                              )}
                              {customer.status === 'active' && (
                                <>
                                  <button
                                    disabled={updatingCustomerId === customer.id}
                                    onClick={() => updateCustomerStatus(customer.id, 'blocked')}
                                    className="px-3 py-2 rounded-xl bg-orange-50 text-orange-600 text-xs font-bold disabled:opacity-50"
                                  >
                                    {isRtl ? 'إيقاف' : 'Block'}
                                  </button>
                                  <button
                                    disabled={updatingCustomerId === customer.id}
                                    onClick={() => updateCustomerStatus(customer.id, 'banned')}
                                    className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-bold disabled:opacity-50"
                                  >
                                    {isRtl ? 'حظر' : 'Ban'}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-8 py-10 text-center text-sm text-gray-400">
                          {isRtl ? 'لا يوجد عملاء' : 'No clients found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          } />

          <Route path="finance" element={
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <AdminStatCard
                  icon={<DollarSign className="text-green-500" />}
                  label={isRtl ? 'مدفوعات العملاء' : 'Client payments'}
                  value={loadingFinancials ? '…' : `${financials?.summary.clientPaymentsTotal ?? 0} ${t('sar')}`}
                  isRtl={isRtl}
                />
                <AdminStatCard
                  icon={<Truck className="text-blue-500" />}
                  label={isRtl ? 'أرباح السائقين' : 'Driver earnings'}
                  value={loadingFinancials ? '…' : `${financials?.summary.driverEarningsTotal ?? 0} ${t('sar')}`}
                  isRtl={isRtl}
                />
                <AdminStatCard
                  icon={<TrendingUp className="text-primary" />}
                  label={isRtl ? 'عمولة المنصة (15%)' : 'Platform commission (15%)'}
                  value={loadingFinancials ? '…' : `${financials?.summary.platformCommissionTotal ?? 0} ${t('sar')}`}
                  isRtl={isRtl}
                />
                <AdminStatCard
                  icon={<Package className="text-purple-500" />}
                  label={isRtl ? 'رسوم الخدمة (5%)' : 'Service fees (5%)'}
                  value={loadingFinancials ? '…' : `${financials?.summary.serviceFeesTotal ?? 0} ${t('sar')}`}
                  isRtl={isRtl}
                />
              </div>

              <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold">
                      {isRtl ? 'سجل القيود المالية' : 'Financial ledger entries'}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {isRtl
                        ? `طلبات مكتملة: ${financials?.summary.completedOrders ?? 0}`
                        : `Completed orders: ${financials?.summary.completedOrders ?? 0}`}
                    </p>
                  </div>
                  <Link
                    to="/admin/withdrawals"
                    className="inline-flex items-center justify-center px-5 py-3 rounded-2xl bg-black text-white text-xs font-bold hover:bg-black/90 transition-all"
                  >
                    {isRtl ? 'طلبات سحب السائقين' : 'Driver payout requests'}
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                        <th className="px-6 py-4">{isRtl ? 'الطلب' : 'Order'}</th>
                        <th className="px-6 py-4">{isRtl ? 'دفع العميل' : 'Client paid'}</th>
                        <th className="px-6 py-4">{isRtl ? 'صافي السائق' : 'Driver net'}</th>
                        <th className="px-6 py-4">{isRtl ? 'عمولة' : 'Commission'}</th>
                        <th className="px-6 py-4">{isRtl ? 'رسوم خدمة' : 'Service fee'}</th>
                        <th className="px-6 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {loadingFinancials ? (
                        <tr>
                          <td colSpan={6} className="px-8 py-10 text-center text-sm text-gray-400">
                            {isRtl ? 'جاري التحميل...' : 'Loading...'}
                          </td>
                        </tr>
                      ) : financials?.recentEntries?.length ? (
                        financials.recentEntries.map((entry) => (
                          <tr key={entry.orderId} className="hover:bg-gray-50/50 text-sm">
                            <td className="px-6 py-4 font-mono font-bold">
                              #{entry.orderId.slice(0, 8).toUpperCase()}
                            </td>
                            <td className="px-6 py-4 font-bold">{entry.clientPayment} {t('sar')}</td>
                            <td className="px-6 py-4 font-bold text-blue-600">{entry.driverNet} {t('sar')}</td>
                            <td className="px-6 py-4 font-bold text-primary">{entry.platformFee} {t('sar')}</td>
                            <td className="px-6 py-4">{entry.serviceFee} {t('sar')}</td>
                            <td className="px-6 py-4 text-xs font-bold">{entry.status}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-8 py-10 text-center text-sm text-gray-400">
                            {isRtl ? 'لا توجد قيود مالية بعد' : 'No ledger entries yet'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          } />

          <Route path="withdrawals" element={
            <div className="space-y-8">
              <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold">
                      {isRtl ? 'طلبات السحب' : 'Payout requests'}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {isRtl
                        ? 'مراجعة طلبات تحويل أرصدة السائقين إلى الحساب البنكي / الصراف'
                        : 'Review driver wallet withdrawals to bank / ATM accounts'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'pending' as const, ar: 'قيد المراجعة', en: 'Pending' },
                      { id: 'paid' as const, ar: 'تم التحويل', en: 'Paid' },
                      { id: 'rejected' as const, ar: 'مرفوض', en: 'Rejected' },
                      { id: 'all' as const, ar: 'الكل', en: 'All' },
                    ]).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setWithdrawalFilter(f.id)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                          withdrawalFilter === f.id
                            ? 'bg-black text-white border-black'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-black'
                        }`}
                      >
                        {isRtl ? f.ar : f.en}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void loadWithdrawals()}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-50 text-gray-700 border border-gray-100 hover:bg-gray-100"
                    >
                      {isRtl ? 'تحديث' : 'Refresh'}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead>
                      <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                        <th className="px-6 py-4">{isRtl ? 'السائق' : 'Driver'}</th>
                        <th className="px-6 py-4">{isRtl ? 'المبلغ' : 'Amount'}</th>
                        <th className="px-6 py-4">{isRtl ? 'البنك / الآيبان' : 'Bank / IBAN'}</th>
                        <th className="px-6 py-4">{isRtl ? 'تاريخ الطلب' : 'Requested'}</th>
                        <th className="px-6 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                        <th className="px-6 py-4">{isRtl ? 'إجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {loadingWithdrawals ? (
                        <tr>
                          <td colSpan={6} className="px-8 py-10 text-center text-sm text-gray-400">
                            {isRtl ? 'جاري التحميل...' : 'Loading...'}
                          </td>
                        </tr>
                      ) : withdrawals.length ? (
                        withdrawals.map((w) => (
                          <tr key={w.id} className="hover:bg-gray-50/50 text-sm align-top">
                            <td className="px-6 py-4">
                              <p className="font-bold">{w.driverName || '—'}</p>
                              <p className="text-xs text-gray-400 font-mono mt-0.5" dir="ltr">
                                {w.driverPhone || w.driverId.slice(0, 10)}
                              </p>
                            </td>
                            <td className="px-6 py-4 font-black text-primary whitespace-nowrap">
                              {w.amount.toFixed(2)} {t('sar')}
                            </td>
                            <td className="px-6 py-4">
                              <p className="font-bold">{w.bankName || '—'}</p>
                              <p className="text-[11px] font-mono text-gray-500 mt-1" dir="ltr">
                                {formatIbanDisplay(w.iban)}
                              </p>
                              {w.accountHolderName ? (
                                <p className="text-[10px] text-gray-400 mt-1">{w.accountHolderName}</p>
                              ) : null}
                            </td>
                            <td className="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">
                              {w.createdAt
                                ? new Date(w.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-GB')
                                : '—'}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black ${
                                  w.status === 'pending'
                                    ? 'bg-amber-50 text-amber-700'
                                    : w.status === 'paid'
                                      ? 'bg-green-50 text-green-700'
                                      : 'bg-red-50 text-red-600'
                                }`}
                              >
                                {w.status === 'pending'
                                  ? (isRtl ? 'قيد المراجعة' : 'Pending')
                                  : w.status === 'paid'
                                    ? (isRtl ? 'تم التحويل' : 'Paid')
                                    : (isRtl ? 'مرفوض' : 'Rejected')}
                              </span>
                              {w.rejectionReason ? (
                                <p className="text-[10px] text-red-500 mt-1 max-w-[160px]">
                                  {w.rejectionReason}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-6 py-4">
                              {w.status === 'pending' ? (
                                <div className="flex flex-col gap-2 min-w-[140px]">
                                  <button
                                    type="button"
                                    disabled={processingWithdrawalId === w.id}
                                    onClick={() => void handleApproveWithdrawal(w.id)}
                                    className="px-3 py-2 rounded-xl bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50"
                                  >
                                    {processingWithdrawalId === w.id
                                      ? '…'
                                      : (isRtl ? 'تم التحويل' : 'Mark transferred')}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={processingWithdrawalId === w.id}
                                    onClick={() => void handleRejectWithdrawal(w.id)}
                                    className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-[11px] font-bold hover:bg-red-100 disabled:opacity-50"
                                  >
                                    {isRtl ? 'رفض' : 'Reject'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-gray-400 font-bold">
                                  {w.processedAt
                                    ? new Date(w.processedAt).toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB')
                                    : '—'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-8 py-12 text-center text-sm text-gray-400">
                            {isRtl ? 'لا توجد طلبات سحب في هذا التصنيف' : 'No payout requests in this filter'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          } />

          <Route path="directory" element={<AdminDirectoryPanel isRtl={isRtl} />} />

          <Route
            path="corporate-contracts"
            element={
              B2B_MODULES_ENABLED ? (
                <AdminCorporateContractsPanel />
              ) : (
                <Navigate to="/admin" replace />
              )
            }
          />

          <Route path="reports" element={
            <div className="space-y-8">
               <div className="grid md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm text-right">
                     <TrendingUp className="text-primary mb-4" size={32} />
                     <h4 className="text-sm font-bold text-gray-400 mb-1">{isRtl ? 'متوسط قيمة الطلب' : 'Average Order Value'}</h4>
                     <p className="text-2xl font-black">{reportMetrics.averageOrder} {isRtl ? 'ر.س' : 'SAR'}</p>
                  </div>
                  <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm text-right">
                     <Package className="text-blue-500 mb-4" size={32} />
                     <h4 className="text-sm font-bold text-gray-400 mb-1">{isRtl ? 'إجمالي الحمولات' : 'Total Loads'}</h4>
                     <p className="text-2xl font-black">{reportMetrics.totalLoads} {isRtl ? 'حمولة' : 'Loads'}</p>
                  </div>
                  <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm text-right">
                     <PieChartIcon className="text-orange-500 mb-4" size={32} />
                     <h4 className="text-sm font-bold text-gray-400 mb-1">{isRtl ? 'معدل الإلغاء' : 'Cancellation Rate'}</h4>
                     <p className="text-2xl font-black">{reportMetrics.cancellationRate}%</p>
                  </div>
               </div>

               <div className="grid md:grid-cols-2 gap-8">
                  <div className="bg-white p-10 rounded-[50px] border border-gray-100 shadow-sm space-y-8 text-right">
                     <div className={`flex justify-between items-center ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
                        <h3 className="text-2xl font-black">{isRtl ? 'نمو الإيرادات الشهري' : 'Monthly Revenue Growth'}</h3>
                        <button className="p-3 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors">
                           <Download size={20} />
                        </button>
                     </div>
                     <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                           <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} />
                              <YAxis axisLine={false} tickLine={false} orientation={isRtl ? 'right' : 'left'} />
                              <Tooltip contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }} />
                              <Line type="monotone" dataKey="revenue" stroke="#FFB800" strokeWidth={4} dot={{ r: 6, fill: '#FFB800', strokeWidth: 3, stroke: '#fff' }} activeDot={{ r: 8 }} />
                           </LineChart>
                        </ResponsiveContainer>
                     </div>
                  </div>

                  <div className="bg-white p-10 rounded-[50px] border border-gray-100 shadow-sm space-y-6 text-right">
                    <h3 className="text-2xl font-black">{isRtl ? 'آخر البلاغات' : 'Recent Reports'}</h3>
                    <div className="space-y-4">
                      <p className="text-sm text-gray-400">
                        {isRtl ? 'لا توجد بلاغات مسجّلة من بيانات الإنتاج.' : 'No production incident reports on record.'}
                      </p>
                    </div>
                  </div>
               </div>
            </div>
          } />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </DashboardLayout>
  );
};

const DocumentPreview: React.FC<{
  label: string;
  driver: Driver;
  docKey: 'license' | 'id' | 'registration' | 'permit';
  meta: AdminDriverDocumentMeta;
  isRtl: boolean;
}> = ({ label, driver, docKey, meta, isRtl }) => {
  const [opening, setOpening] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const uploaded = meta.status === 'uploaded';
  const viewable = Boolean(meta.viewable || meta.storagePath);
  const expiresAt = meta.expiresAt;
  const expired =
    expiresAt && !Number.isNaN(Date.parse(expiresAt))
      ? Date.parse(expiresAt) < Date.now()
      : false;

  useEffect(() => {
    if (!viewable) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    const source = {
      id: driver.id,
      kind: driver.kind,
      operatorId: driver.operatorId,
      vehicleId: driver.vehicleId,
    };
    void fetchAdminDriverDocumentUrl(source, docKey)
      .then((data) => {
        if (!cancelled) setImageUrl(data.url);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [driver.id, driver.kind, driver.operatorId, driver.vehicleId, docKey, viewable]);

  const openDocument = async () => {
    if (!viewable && !imageUrl) {
      toast.error(
        isRtl
          ? 'لا يوجد ملف قابل للعرض — اطلب إعادة رفع المستند'
          : 'No viewable file — ask the applicant to re-upload this document'
      );
      return;
    }
    setOpening(true);
    try {
      const url = imageUrl || (await fetchAdminDriverDocumentUrl(driver, docKey)).url;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Open driver document failed:', error);
      toast.error(
        error instanceof Error
          ? error.message
          : isRtl
            ? 'تعذر فتح المستند'
            : 'Failed to open document'
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      <div className="rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden">
        {imageUrl ? (
          <button type="button" onClick={() => void openDocument()} className="block w-full">
            <img
              src={imageUrl}
              alt={label}
              className="w-full h-48 object-cover bg-white"
            />
          </button>
        ) : (
          <div className="h-36 flex items-center justify-center text-xs font-bold text-gray-400 px-4 text-center">
            {loadError
              ? isRtl
                ? 'تعذر تحميل الصورة'
                : 'Could not load image'
              : uploaded
                ? isRtl
                  ? 'جاري تحميل الصورة...'
                  : 'Loading image...'
                : isRtl
                  ? 'غير مرفق'
                  : 'Missing'}
          </div>
        )}
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs font-bold ${uploaded ? 'text-green-600' : 'text-orange-500'}`}>
              {uploaded ? (isRtl ? 'مرفق' : 'Uploaded') : isRtl ? 'غير مرفق' : 'Missing'}
            </span>
            {expiresAt && (
              <span className={`text-[10px] font-mono ${expired ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                {expiresAt}
              </span>
            )}
          </div>
          {meta.fileName && (
            <p className="text-[10px] text-gray-400 truncate" title={meta.fileName}>
              {meta.fileName}
            </p>
          )}
          <button
            type="button"
            onClick={() => void openDocument()}
            disabled={!uploaded || opening}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-black text-white text-[11px] font-bold disabled:opacity-40 hover:bg-neutral-800 transition-colors"
          >
            <Eye size={14} />
            {opening
              ? isRtl
                ? 'جاري الفتح...'
                : 'Opening...'
              : isRtl
                ? 'فتح بالحجم الكامل'
                : 'Open full size'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminStatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: string;
  isRtl: boolean;
  to?: string;
}> = ({ icon, label, value, trend, isRtl, to }) => {
  const card = (
    <div
      className={`bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm hover:translate-y-[-4px] transition-all ${
        to ? 'cursor-pointer hover:border-primary/40' : ''
      } ${isRtl ? 'text-right' : 'text-left'}`}
    >
      <div className={`flex justify-between items-start mb-6 ${isRtl ? 'flex-row' : 'flex-row-reverse'}`}>
        <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center">{icon}</div>
        {trend ? (
          <div className="px-2 py-1 bg-green-50 text-green-600 rounded-lg text-[10px] font-bold">
            {trend}% &uarr;
          </div>
        ) : to ? (
          <div className="px-2 py-1 bg-stone-50 text-stone-500 rounded-lg text-[10px] font-bold">
            {isRtl ? 'عرض القائمة' : 'View list'}
          </div>
        ) : (
          <div />
        )}
      </div>
      <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-widest">{label}</p>
      <h4 className={`text-2xl font-extrabold font-mono leading-none underline-offset-4 ${to ? 'underline decoration-stone-300' : ''}`}>{value}</h4>
    </div>
  );
  return to ? <Link to={to}>{card}</Link> : card;
};

const ServiceQuota: React.FC<{ label: string, percentage: number, color: string }> = ({ label, percentage, color }) => (
  <div className="space-y-2">
     <div className="flex justify-between text-xs font-bold">
        <span>{label}</span>
        <span>{percentage}%</span>
     </div>
     <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${percentage}%` }}></div>
     </div>
  </div>
);

function formatVehicleFieldNotes(
  notes: Record<string, unknown> | null | undefined,
  isRtl: boolean
): string {
  if (!notes || typeof notes !== 'object') return '—';
  const parts: string[] = [];
  if (notes.keyInside) parts.push(isRtl ? 'المفتاح داخل' : 'Key inside');
  if (notes.tiresFlat) parts.push(isRtl ? 'إطارات فارغة' : 'Flat tires');
  if (notes.brokenDown) parts.push(isRtl ? 'متعطلة' : 'Broken down');
  const extra = typeof notes.extraNotes === 'string' ? notes.extraNotes.trim() : '';
  if (extra) parts.push(extra.slice(0, 60));
  return parts.length ? parts.join(' · ') : '—';
}

const OrderRow: React.FC<{
  id: string;
  user: string;
  service: string;
  amount: string;
  status: 'completed' | 'active' | 'pending' | 'cancelled';
  fieldNotes?: string;
  href?: string;
  isRtl: boolean;
}> = ({ id, user, service, amount, status, fieldNotes, href, isRtl }) => {
  const statusStyles = {
    completed: 'bg-green-50 text-green-600',
    active: 'bg-blue-50 text-blue-600',
    pending: 'bg-orange-50 text-orange-600',
    cancelled: 'bg-red-50 text-red-600',
  };

  const statusLabels = {
    completed: isRtl ? 'مكتمل' : 'Completed',
    active: isRtl ? 'نشط' : 'Active',
    pending: isRtl ? 'قيد الانتظار' : 'Pending',
    cancelled: isRtl ? 'ملغي' : 'Cancelled',
  };

  const actions = href ? (
    <Link
      to={href}
      className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-black transition-colors inline-flex"
    >
      <Eye size={20} />
    </Link>
  ) : (
    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 group-hover:text-black transition-colors">
      <MoreHorizontal size={20} />
    </button>
  );

  return (
    <tr className="hover:bg-gray-50/50 transition-colors group">
       <td className="px-8 py-5 text-sm font-bold">{id}</td>
       <td className="px-8 py-5 text-sm">{user}</td>
       <td className="px-8 py-5 text-sm font-medium">{service}</td>
       <td className="px-8 py-5 text-xs text-amber-800 max-w-[180px]">{fieldNotes || '—'}</td>
       <td className="px-8 py-5 text-sm font-mono font-bold tracking-tight">{amount}</td>
       <td className="px-8 py-5">
          <span className={`px-4 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${statusStyles[status]}`}>
            {statusLabels[status]}
          </span>
       </td>
       <td className={`px-8 py-5 ${isRtl ? 'text-left' : 'text-right'}`}>
          {actions}
       </td>
    </tr>
  );
};

export default AdminDashboard;
