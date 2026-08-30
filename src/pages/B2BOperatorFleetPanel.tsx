import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck,
  ClipboardList,
  Users,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Calendar,
  X,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import {
  StatCard,
  StatusBadge,
  SectionCard,
  TabBar,
  btnPrimary,
  btnSecondary,
} from '@/components/b2b/B2bUi';
import {
  applyToContract,
  getFleetForOperator,
  getOpenContracts,
  hasOperatorApplied,
  type FleetContract,
  type FleetVehicle,
} from '@/lib/b2bContractStore';
import {
  createOperatorVehicle,
  listOperatorVehicles,
} from '@/lib/fleetVehicleService';
import {
  FLEET_SERVICE_CATEGORIES,
  getFleetCategoryLabel,
  getFleetOptionLabel,
  getFleetOptions,
  type CoreServiceType,
} from '@/lib/fleetServiceCatalog';
import {
  isValidSaudiPlateNumber,
  normalizePlateNumber,
  inspectDriverDocumentFile,
  assertRequiredDriverDocumentFiles,
  getDriverValidationMessage,
} from '@/lib/driverDocumentValidation';
import { RequiredDriverDocumentsFields } from '@/components/RequiredDriverDocumentsFields';
import { uploadFleetVehicleDocumentFiles } from '@/lib/driverDocumentUpload';
import type { DriverDocumentKey } from '@/lib/userProfile';

function formatSar(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    style: 'currency',
    currency: 'SAR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const vehicleStatusStyle: Record<
  FleetVehicle['status'],
  { dot: string; labelEn: string; labelAr: string }
> = {
  available: { dot: 'bg-emerald-500', labelEn: 'Available', labelAr: 'متاح' },
  on_contract: { dot: 'bg-teal-500', labelEn: 'On Contract', labelAr: 'في عقد' },
  maintenance: { dot: 'bg-amber-500', labelEn: 'Maintenance', labelAr: 'صيانة' },
};

const emptyForm = () => ({
  category: 'furniture_moving' as CoreServiceType,
  subtype: 'small_truck',
  plateNumber: '',
  model: '',
  year: '',
  driverName: '',
  status: 'available' as FleetVehicle['status'],
});

const B2BOperatorFleetPanel: React.FC = () => {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  const [activeTab, setActiveTab] = useState<'marketplace' | 'fleet'>('marketplace');
  const [contracts, setContracts] = useState<FleetContract[]>(() => getOpenContracts());
  const [fleet, setFleet] = useState<FleetVehicle[]>(() =>
    profile?.uid ? getFleetForOperator(profile.uid) : []
  );
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [documentFiles, setDocumentFiles] = useState<
    Partial<Record<DriverDocumentKey, File>>
  >({});
  const [savingVehicle, setSavingVehicle] = useState(false);

  const subtypeOptions = useMemo(
    () => getFleetOptions(form.category),
    [form.category]
  );

  useEffect(() => {
    if (
      subtypeOptions.length &&
      !subtypeOptions.some((o) => o.id === form.subtype)
    ) {
      setForm((prev) => ({ ...prev, subtype: subtypeOptions[0].id }));
    }
  }, [subtypeOptions, form.subtype]);

  const refresh = useCallback(async () => {
    setContracts(getOpenContracts());
    if (!profile?.uid) return;

    const remote = await listOperatorVehicles(profile.uid);
    if (remote.length > 0) {
      setFleet(remote);
      return;
    }
    setFleet(getFleetForOperator(profile.uid));
  }, [profile?.uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(
    () => ({
      openContracts: contracts.length,
      fleetSize: fleet.length,
      available: fleet.filter((v) => v.status === 'available').length,
    }),
    [contracts, fleet]
  );

  const openAddVehicle = () => {
    setForm(emptyForm());
    setDocumentFiles({});
    setShowAddVehicle(true);
  };

  const handleSaveVehicle = async () => {
    if (!profile?.uid) {
      toast.error(isRtl ? 'يجب تسجيل الدخول أولاً' : 'Please sign in first');
      return;
    }

    const plate = normalizePlateNumber(form.plateNumber);
    if (!plate || plate.length < 3) {
      toast.error(isRtl ? 'يرجى إدخال رقم لوحة صالح' : 'Please enter a valid plate number');
      return;
    }
    if (!isValidSaudiPlateNumber(plate)) {
      toast.error(
        isRtl
          ? 'صيغة رقم اللوحة غير صحيحة (مثال: ب ص م 1234)'
          : 'Invalid plate format (e.g. ABC 1234)'
      );
      return;
    }

    if (!form.category || !form.subtype) {
      toast.error(
        isRtl ? 'يرجى اختيار فئة المركبة والنوع' : 'Please select category and subtype'
      );
      return;
    }

    if (!form.driverName.trim()) {
      toast.error(isRtl ? 'يرجى إدخال اسم السائق' : 'Please enter the driver name');
      return;
    }

    const locale = isRtl ? 'ar' : 'en';
    const docsCheck = await assertRequiredDriverDocumentFiles(documentFiles);
    if (!docsCheck.ok) {
      toast.error(getDriverValidationMessage(docsCheck, locale));
      return;
    }

    const catLabel = getFleetCategoryLabel(form.category, isRtl);
    const subtypeLabel = getFleetOptionLabel(form.category, form.subtype, isRtl);
    const typeLabel = form.model.trim()
      ? `${catLabel} — ${subtypeLabel} (${form.model.trim()})`
      : `${catLabel} — ${subtypeLabel}`;

    setSavingVehicle(true);
    try {
      const { vehicle, cloudSynced } = await createOperatorVehicle({
        operatorId: profile.uid,
        plateNumber: plate,
        type: typeLabel,
        category: form.category,
        subtype: form.subtype,
        serviceType: form.category,
        serviceOption: form.subtype,
        model: form.model.trim() || undefined,
        year: form.year.trim() || undefined,
        driverName: form.driverName.trim(),
        status: form.status,
        accountStatus: 'pending',
      });

      if (!cloudSynced) {
        toast.error(
          isRtl
            ? 'تعذر إرسال الطلب للمراجعة. تحقق من الاتصال ثم أعد المحاولة.'
            : 'Could not submit for review. Check your connection and try again.'
        );
        return;
      }

      try {
        await uploadFleetVehicleDocumentFiles(vehicle.id, documentFiles);
      } catch (uploadErr) {
        console.error('[B2BOperatorFleetPanel] document upload failed:', uploadErr);
        await refresh();
        setShowAddVehicle(false);
        setForm(emptyForm());
        setDocumentFiles({});
        toast.error(
          isRtl
            ? 'فشل رفع المستندات. أعد المحاولة بصور JPEG/PNG صالحة.'
            : 'Document upload failed. Retry with valid JPEG/PNG images.'
        );
        return;
      }

      await refresh();
      setShowAddVehicle(false);
      setForm(emptyForm());
      setDocumentFiles({});

      toast.success(
        isRtl
          ? 'تم إرسال سائق الأسطول — جاهز للمراجعة'
          : 'Fleet driver submitted — Ready for Review'
      );
    } catch (err) {
      console.error('[B2BOperatorFleetPanel] add vehicle failed:', err);
      toast.error(isRtl ? 'فشل إضافة المركبة' : 'Failed to add vehicle');
    } finally {
      setSavingVehicle(false);
    }
  };

  const handleApply = async (contract: FleetContract) => {
    if (!profile?.uid) return;
    if (hasOperatorApplied(contract.id, profile.uid)) {
      toast.info(isRtl ? 'لقد تقدمت لهذا العقد مسبقاً' : 'You already applied to this contract');
      return;
    }

    setApplyingId(contract.id);
    await new Promise((r) => setTimeout(r, 450));

    const result = applyToContract(
      contract.id,
      profile.uid,
      profile.companyName || profile.name
    );

    await refresh();
    setApplyingId(null);

    if (!result) {
      toast.error(
        isRtl
          ? 'تعذر قبول العقد — ربما لم يعد متاحاً'
          : 'Could not accept — contract may no longer be open'
      );
      return;
    }

    toast.success(isRtl ? 'تم قبول العقد بنجاح' : 'Contract accepted successfully');
  };

  const tabs = [
    {
      id: 'marketplace',
      label: isRtl ? 'سوق العقود' : 'Marketplace',
      icon: <ClipboardList size={16} />,
    },
    {
      id: 'fleet',
      label: isRtl ? 'إدارة الأسطول' : 'My Fleet',
      icon: <Truck size={16} />,
    },
  ];

  const inputClass =
    'w-full p-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-teal-500 outline-none font-bold text-sm';

  return (
    <DashboardLayout title={isRtl ? 'لوحة مشغل الأسطول' : 'Fleet Operator Panel'}>
      <div className="max-w-7xl mx-auto space-y-6 pb-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-700 via-teal-600 to-slate-800 p-6 md:p-10 text-white shadow-xl">
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-teal-100 text-xs font-bold">
                <Truck size={14} />
                B2B Fleet Operator
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {profile?.companyName || profile?.name}
              </h1>
              <p className="text-teal-100/90 text-sm font-medium max-w-lg">
                {isRtl
                  ? 'تصفح عقود الشركات المتاحة واقبل ما يناسب أسطولك.'
                  : 'Browse available corporate contracts and accept the ones that fit your fleet.'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label={isRtl ? 'عقود مفتوحة' : 'Open Contracts'}
            value={stats.openContracts}
            icon={<ClipboardList size={20} />}
          />
          <StatCard
            label={isRtl ? 'حجم الأسطول' : 'Fleet Size'}
            value={stats.fleetSize}
            icon={<Truck size={20} />}
          />
          <StatCard
            label={isRtl ? 'متاح الآن' : 'Available Now'}
            value={stats.available}
            icon={<CheckCircle2 size={20} />}
          />
        </div>

        <TabBar
          tabs={tabs}
          active={activeTab}
          onChange={(id) => setActiveTab(id as 'marketplace' | 'fleet')}
        />

        <AnimatePresence mode="wait">
          {activeTab === 'marketplace' ? (
            <motion.div
              key="marketplace"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              {contracts.length === 0 ? (
                <SectionCard
                  title={isRtl ? 'لا توجد عقود' : 'No open contracts'}
                  subtitle={
                    isRtl
                      ? 'ستظهر العقود الجديدة هنا عند نشرها من الشركات.'
                      : 'New contracts will appear here when corporates post them.'
                  }
                  icon={<ClipboardList size={20} />}
                >
                  <p className="text-sm text-slate-500">
                    {isRtl ? 'تحقق لاحقاً.' : 'Check back later.'}
                  </p>
                </SectionCard>
              ) : (
                contracts.map((contract) => {
                  const applied =
                    !!profile?.uid && hasOperatorApplied(contract.id, profile.uid);
                  return (
                    <SectionCard
                      key={contract.id}
                      title={contract.title}
                      subtitle={contract.corporateName}
                      icon={<ClipboardList size={20} />}
                    >
                      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                        <div className="space-y-2 text-sm text-slate-600">
                          <div className="flex flex-wrap gap-3">
                            <StatusBadge status={contract.status} isRtl={isRtl} />
                            <span className="inline-flex items-center gap-1.5 font-bold">
                              <Truck size={14} className="text-slate-400" />
                              {contract.transportType}
                            </span>
                            <span className="inline-flex items-center gap-1.5 font-bold">
                              <Calendar size={14} className="text-slate-400" />
                              {contract.duration}
                            </span>
                          </div>
                          <p className="font-black text-teal-700 text-lg">
                            {formatSar(contract.operatorVisibleBudget, i18n.language)}
                          </p>
                          {contract.hasDocument && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
                              {contract.documentKind === 'image' ? (
                                <ImageIcon size={14} />
                              ) : (
                                <FileText size={14} />
                              )}
                              {contract.documentName}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={applied || applyingId === contract.id}
                          className={`${btnPrimary} disabled:opacity-50`}
                          onClick={() => void handleApply(contract)}
                        >
                          {applied
                            ? isRtl
                              ? 'تم التقديم'
                              : 'Applied'
                            : applyingId === contract.id
                              ? isRtl
                                ? 'جاري...'
                                : 'Applying...'
                              : isRtl
                                ? 'قبول العقد'
                                : 'Accept Contract'}
                        </button>
                      </div>
                    </SectionCard>
                  );
                })
              )}
            </motion.div>
          ) : (
            <motion.div
              key="fleet"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <SectionCard
                title={isRtl ? 'أسطولي المسجل' : 'My Fleet Management'}
                subtitle={
                  isRtl
                    ? `${fleet.length} مركبة مسجلة`
                    : `${fleet.length} registered vehicle(s)`
                }
                icon={<Truck size={20} />}
              >
                <div className="space-y-3">
                  {fleet.map((vehicle) => {
                    const st = vehicleStatusStyle[vehicle.status];
                    return (
                      <div
                        key={vehicle.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-white hover:shadow-sm transition-all"
                      >
                        <div className="w-12 h-12 rounded-xl bg-teal-600/10 flex items-center justify-center shrink-0">
                          <Truck size={22} className="text-teal-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                            <span className="text-xs font-bold text-slate-500">
                              {isRtl ? st.labelAr : st.labelEn}
                            </span>
                            {(vehicle.accountStatus === 'pending_review' ||
                              vehicle.accountStatus === 'ready_for_review') && (
                              <span className="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                {isRtl ? 'جاهز للمراجعة' : 'Ready for Review'}
                              </span>
                            )}
                          </div>
                          <p className="font-black text-slate-800">{vehicle.plateNumber}</p>
                          <p className="text-sm text-slate-500">{vehicle.type}</p>
                          {(vehicle.serviceType || vehicle.category) && (
                            <p className="text-xs text-teal-700 font-bold mt-0.5">
                              {getFleetCategoryLabel(
                                vehicle.serviceType || vehicle.category || '',
                                isRtl
                              )}
                              {(vehicle.serviceOption || vehicle.subtype) &&
                                ` · ${getFleetOptionLabel(
                                  vehicle.serviceType || vehicle.category || '',
                                  vehicle.serviceOption || vehicle.subtype || '',
                                  isRtl
                                )}`}
                            </p>
                          )}
                          {vehicle.model && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {vehicle.model}
                              {vehicle.year ? ` · ${vehicle.year}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                          <Users size={16} className="text-slate-400" />
                          {vehicle.driverName}
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    className={`${btnSecondary} w-full mt-4 border-dashed`}
                    onClick={openAddVehicle}
                  >
                    <Plus size={16} />
                    {isRtl ? '+ إضافة مركبة / سائق' : '+ Add Truck / Driver'}
                  </button>
                </div>
              </SectionCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showAddVehicle && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
              aria-label="Close"
              onClick={() => !savingVehicle && setShowAddVehicle(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              className={`relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 space-y-5 ${
                isRtl ? 'text-right' : 'text-left'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    {isRtl ? 'إضافة مركبة' : 'Add Vehicle'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {isRtl
                      ? 'أدخل بيانات المركبة لإضافتها إلى أسطولك.'
                      : 'Enter vehicle details to add it to your fleet.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingVehicle}
                  onClick={() => setShowAddVehicle(false)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isRtl ? 'فئة الخدمة' : 'Service Category'}
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => {
                      const category = e.target.value as CoreServiceType;
                      const opts = getFleetOptions(category);
                      setForm((prev) => ({
                        ...prev,
                        category,
                        subtype: opts[0]?.id || '',
                      }));
                    }}
                    className={inputClass}
                  >
                    {FLEET_SERVICE_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {isRtl ? cat.ar : cat.en}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isRtl ? 'نوع / سعة المركبة' : 'Vehicle Type / Capacity'}
                  </label>
                  <select
                    value={form.subtype}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, subtype: e.target.value }))
                    }
                    className={inputClass}
                  >
                    {subtypeOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {isRtl ? opt.ar : opt.en}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const selected = subtypeOptions.find((o) => o.id === form.subtype);
                    const hint = isRtl ? selected?.hintAr : selected?.hintEn;
                    return hint ? (
                      <p className="text-xs text-slate-400 font-medium pt-1">{hint}</p>
                    ) : null;
                  })()}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  {isRtl ? 'رقم اللوحة' : 'Plate Number'}
                </label>
                <input
                  type="text"
                  value={form.plateNumber}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, plateNumber: e.target.value }))
                  }
                  className={`${inputClass} uppercase tracking-widest`}
                  placeholder={isRtl ? 'مثال: ب ص م 1234' : 'e.g. ABC 1234'}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isRtl ? 'الموديل' : 'Model'}
                  </label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, model: e.target.value }))
                    }
                    className={inputClass}
                    placeholder={isRtl ? 'مثال: Isuzu NPR' : 'e.g. Isuzu NPR'}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isRtl ? 'سنة الصنع' : 'Year'}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={form.year}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        year: e.target.value.replace(/\D/g, '').slice(0, 4),
                      }))
                    }
                    className={inputClass}
                    placeholder="2024"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isRtl ? 'اسم السائق' : 'Driver Name'}
                  </label>
                  <input
                    type="text"
                    value={form.driverName}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, driverName: e.target.value }))
                    }
                    className={inputClass}
                    placeholder={isRtl ? 'اسم السائق مطلوب' : 'Driver name required'}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isRtl ? 'الحالة' : 'Status'}
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        status: e.target.value as FleetVehicle['status'],
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="available">{isRtl ? 'متاح' : 'Available'}</option>
                    <option value="on_contract">{isRtl ? 'في عقد' : 'On Contract'}</option>
                    <option value="maintenance">{isRtl ? 'صيانة' : 'Maintenance'}</option>
                  </select>
                </div>
              </div>

              <RequiredDriverDocumentsFields
                isRtl={isRtl}
                files={documentFiles}
                onSelect={(key, file) => {
                  if (!file) {
                    setDocumentFiles((prev) => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                    });
                    return;
                  }
                  const locale = isRtl ? 'ar' : 'en';
                  void inspectDriverDocumentFile(file).then((fileCheck) => {
                    if (!fileCheck.ok) {
                      toast.error(
                        getDriverValidationMessage({ ...fileCheck, invalidDoc: key }, locale)
                      );
                      return;
                    }
                    setDocumentFiles((prev) => ({ ...prev, [key]: file }));
                  });
                }}
              />

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  disabled={savingVehicle}
                  className={`${btnSecondary} flex-1`}
                  onClick={() => setShowAddVehicle(false)}
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={savingVehicle}
                  className={`${btnPrimary} flex-1 disabled:opacity-50`}
                  onClick={() => void handleSaveVehicle()}
                >
                  <Truck size={16} />
                  {savingVehicle
                    ? isRtl
                      ? 'جاري الحفظ...'
                      : 'Saving...'
                    : isRtl
                      ? 'حفظ المركبة'
                      : 'Save Vehicle'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default B2BOperatorFleetPanel;
