import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  FileText,
  Plus,
  Upload,
  Calendar,
  Truck,
  Image as ImageIcon,
  ClipboardCheck,
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
  FieldLabel,
  TabBar,
  inputClass,
  btnPrimary,
} from '@/components/b2b/B2bUi';
import {
  createContract,
  getContractsForCorporate,
  SAMPLE_CONTRACTS,
  type FleetContract,
} from '@/lib/b2bContractStore';
import { listCorporateContractsForUser } from '@/lib/corporateContractService';
import type { CorporateContractRecord } from '@/domain/corporate-contract-schema';
import CorporateContractRegistrationForm from '@/components/b2b/CorporateContractRegistrationForm';
import { getFleetCategoryLabel } from '@/lib/fleetServiceCatalog';

const TRANSPORT_TYPES_EN = [
  'General Cargo',
  'Refrigerated',
  'Bulk Cargo',
  'Fresh Produce',
  'Heavy Equipment',
  'Petrochemicals',
  'Furniture & Retail',
];

const TRANSPORT_TYPES_AR = [
  'بضائع عامة',
  'مبرد',
  'بضائع سائبة',
  'منتجات زراعية',
  'معدات ثقيلة',
  'مواد بترولية',
  'أثاث وتجزئة',
];

const DURATION_OPTIONS = ['3 months', '6 months', '12 months', '24 months'];
const DURATION_OPTIONS_AR = ['3 أشهر', '6 أشهر', '12 شهراً', '24 شهراً'];

function formatSar(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    style: 'currency',
    currency: 'SAR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function detectDocumentKind(file: File): 'pdf' | 'image' | null {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  if (file.type.startsWith('image/')) {
    return 'image';
  }
  return null;
}

const REG_STATUS: Record<
  CorporateContractRecord['status'],
  { ar: string; en: string; className: string }
> = {
  pending: {
    ar: 'بانتظار الموافقة',
    en: 'Pending approval',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  active: {
    ar: 'مفعّل',
    en: 'Active',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  suspended: {
    ar: 'موقوف',
    en: 'Suspended',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  rejected: {
    ar: 'مرفوض',
    en: 'Rejected',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

const B2BCorporatePortal: React.FC = () => {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  const [activeTab, setActiveTab] = useState<'registration' | 'marketplace'>(
    'registration'
  );
  const [contracts, setContracts] = useState<FleetContract[]>(() =>
    profile?.uid ? getContractsForCorporate(profile.uid) : []
  );
  const [registrations, setRegistrations] = useState<CorporateContractRecord[]>([]);

  const [title, setTitle] = useState('');
  const [transportType, setTransportType] = useState('');
  const [duration, setDuration] = useState('');
  const [originalBudget, setOriginalBudget] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [documentKind, setDocumentKind] = useState<'pdf' | 'image' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refreshMarketplace = useCallback(() => {
    if (profile?.uid) {
      setContracts(getContractsForCorporate(profile.uid));
    }
  }, [profile?.uid]);

  const refreshRegistrations = useCallback(async () => {
    if (!profile?.uid) return;
    const rows = await listCorporateContractsForUser(profile.uid);
    setRegistrations(rows);
  }, [profile?.uid]);

  useEffect(() => {
    refreshMarketplace();
    void refreshRegistrations();
  }, [refreshMarketplace, refreshRegistrations]);

  const transportOptions = isRtl ? TRANSPORT_TYPES_AR : TRANSPORT_TYPES_EN;
  const durationOptions = isRtl ? DURATION_OPTIONS_AR : DURATION_OPTIONS;

  const displayContracts = contracts.length > 0 ? contracts : SAMPLE_CONTRACTS;
  const showingSamples = contracts.length === 0;

  const stats = useMemo(() => {
    const open = displayContracts.filter((c) => c.status === 'open').length;
    const accepted = displayContracts.filter((c) => c.status === 'accepted').length;
    const totalBudget = displayContracts.reduce((sum, c) => sum + c.originalBudget, 0);
    const activeRegs = registrations.filter((r) => r.status === 'active').length;
    return { open, accepted, totalBudget, activeRegs, pendingRegs: registrations.filter((r) => r.status === 'pending').length };
  }, [displayContracts, registrations]);

  const resetForm = () => {
    setTitle('');
    setTransportType('');
    setDuration('');
    setOriginalBudget('');
    setDocumentName('');
    setDocumentKind(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;

    const budget = Number(originalBudget.replace(/,/g, ''));
    if (!title.trim() || !transportType || !duration || !budget || budget <= 0) {
      toast.error(isRtl ? 'يرجى تعبئة جميع الحقول المطلوبة' : 'Please fill all required fields');
      return;
    }

    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 500));

    createContract({
      corporateId: profile.uid,
      corporateName: profile.companyName || profile.name,
      title: title.trim(),
      transportType,
      duration,
      originalBudget: budget,
      hasDocument: Boolean(documentName),
      documentName: documentName || undefined,
      documentKind: documentKind || undefined,
    });

    refreshMarketplace();
    resetForm();
    setSubmitting(false);
    toast.success(
      isRtl ? 'تم نشر العقد في سوق النقل' : 'Contract posted to the marketplace'
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const kind = detectDocumentKind(file);
    if (!kind) {
      toast.error(
        isRtl ? 'يُسمح بملفات PDF أو الصور فقط' : 'Only PDF or image files are allowed'
      );
      e.target.value = '';
      return;
    }

    setDocumentName(file.name);
    setDocumentKind(kind);
    toast.success(isRtl ? 'تم إرفاق مستند العقد' : 'Contract document attached');
  };

  const tabs = [
    {
      id: 'registration',
      label: isRtl ? 'تسجيل العقد' : 'Contract Registration',
      icon: <ClipboardCheck size={16} />,
    },
    {
      id: 'marketplace',
      label: isRtl ? 'نشر في السوق' : 'Marketplace Posts',
      icon: <Plus size={16} />,
    },
  ];

  return (
    <DashboardLayout title={isRtl ? 'بوابة الشركات' : 'Corporate Portal'}>
      <div className="max-w-7xl mx-auto space-y-8 pb-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800 via-slate-700 to-teal-800 p-6 md:p-10 text-white shadow-xl">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48cGF0aCBkPSJNMzYgMzRoLTJ2LTRoMnY0em0wLTZoLTJ2LTRoMnY0em0wLTZoLTJ2LTRoMnY0em0tNiA2aC00di0yaDR2MnptMCA0aC00di0yaDR2MnptMCA0aC00di0yaDR2MnoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjAzIi8+PC9nPjwvc3ZnPg==')] opacity-40" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-100 text-xs font-bold">
                <Building2 size={14} />
                B2B Corporate
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {profile?.companyName || profile?.name}
              </h1>
              <p className="text-slate-300 text-sm font-medium max-w-lg">
                {isRtl
                  ? 'سجّل عقد شركتك واختر الخدمات، أو انشر طلبات النقل في السوق.'
                  : 'Register your corporate contract and services, or post transport jobs to the marketplace.'}
              </p>
            </div>
            <Truck size={32} className="text-teal-200 opacity-80 shrink-0" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <StatCard
            label={isRtl ? 'عقود مفعّلة' : 'Active Contracts'}
            value={stats.activeRegs}
            icon={<ClipboardCheck size={20} className="text-teal-600" />}
          />
          <StatCard
            label={isRtl ? 'بانتظار الموافقة' : 'Pending Review'}
            value={stats.pendingRegs}
            accent="amber"
            icon={<Calendar size={20} className="text-amber-600" />}
          />
          <StatCard
            label={isRtl ? 'منشورات مفتوحة' : 'Open Posts'}
            value={stats.open}
            icon={<FileText size={20} className="text-teal-600" />}
          />
          <StatCard
            label={isRtl ? 'إجمالي الميزانية' : 'Total Budget'}
            value={formatSar(stats.totalBudget, i18n.language)}
            accent="slate"
            icon={<Building2 size={20} className="text-slate-600" />}
          />
        </div>

        <TabBar
          tabs={tabs}
          active={activeTab}
          onChange={(id) => setActiveTab(id as 'registration' | 'marketplace')}
        />

        <AnimatePresence mode="wait">
          {activeTab === 'registration' ? (
            <motion.div
              key="registration"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              <SectionCard
                title={
                  isRtl
                    ? 'نموذج تسجيل الشركات ذات العقود واختيار الخدمات'
                    : 'Corporate Contract Registration & Service Selection'
                }
                subtitle={
                  isRtl
                    ? 'يُراجع الطلب من لوحة الإدارة قبل التفعيل'
                    : 'Submitted for admin review before activation'
                }
                icon={<ClipboardCheck size={20} />}
              >
                {profile?.uid ? (
                  <CorporateContractRegistrationForm
                    corporateId={profile.uid}
                    defaults={{
                      companyName: profile.companyName || profile.name,
                      commercialRegistration: profile.commercialRegistration,
                      contactPerson: profile.name,
                      contactPhone: profile.phone,
                    }}
                    isRtl={isRtl}
                    onCreated={() => void refreshRegistrations()}
                  />
                ) : (
                  <p className="text-sm text-slate-500">
                    {isRtl ? 'يرجى تسجيل الدخول' : 'Please sign in'}
                  </p>
                )}
              </SectionCard>

              <SectionCard
                title={isRtl ? 'طلبات التسجيل' : 'My Registrations'}
                subtitle={
                  isRtl
                    ? `${registrations.length} طلب`
                    : `${registrations.length} registration(s)`
                }
                icon={<FileText size={20} />}
              >
                {registrations.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {isRtl
                      ? 'لم تُرسل طلبات بعد — أكمل النموذج أعلاه.'
                      : 'No registrations yet — complete the form above.'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {registrations.map((reg) => {
                      const st = REG_STATUS[reg.status];
                      return (
                        <div
                          key={reg.id}
                          className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${st.className}`}
                            >
                              {isRtl ? st.ar : st.en}
                            </span>
                            <span className="text-xs font-bold text-slate-500">
                              {reg.contractType === 'monthly'
                                ? isRtl
                                  ? 'شهري'
                                  : 'Monthly'
                                : reg.contractType === 'annual'
                                  ? isRtl
                                    ? 'سنوي'
                                    : 'Annual'
                                  : isRtl
                                    ? 'حسب المشروع'
                                    : 'Project'}
                            </span>
                            <span className="text-xs text-slate-400">
                              {reg.startDate} → {reg.endDate}
                            </span>
                          </div>
                          <p className="font-black text-slate-800">{reg.companyName}</p>
                          <p className="text-sm text-slate-500">
                            {reg.services
                              .map((s) =>
                                getFleetCategoryLabel(s.serviceType, isRtl)
                              )
                              .join(' · ')}
                          </p>
                          <p className="text-xs text-slate-400">
                            {reg.paymentTerms === 'net30'
                              ? isRtl
                                ? 'دفع آجل Net-30'
                                : 'Post-paid Net-30'
                              : isRtl
                                ? 'محفظة مسبقة'
                                : 'Pre-paid wallet'}
                            {reg.discountRate > 0
                              ? ` · ${reg.discountRate}% ${isRtl ? 'خصم' : 'discount'}`
                              : ''}
                          </p>
                          {reg.adminPricingRules && (
                            <p className="text-xs text-teal-700 font-medium">
                              {isRtl ? 'تسعير إداري:' : 'Admin pricing:'}{' '}
                              {reg.adminPricingRules}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </motion.div>
          ) : (
            <motion.div
              key="marketplace"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              <SectionCard
                title={isRtl ? 'نشر عقد جديد' : 'Post New Contract'}
                subtitle={
                  isRtl
                    ? 'سيظهر العقد فوراً لشركات النقل في السوق'
                    : 'Visible immediately to transport companies in the marketplace'
                }
                icon={<Plus size={20} />}
              >
                <form onSubmit={handleSubmit} className="space-y-5 max-w-3xl">
                  <div>
                    <FieldLabel required>
                      {isRtl ? 'عنوان العقد' : 'Contract Title'}
                    </FieldLabel>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <FieldLabel required>
                        {isRtl ? 'نوع النقل' : 'Transport Type'}
                      </FieldLabel>
                      <select
                        value={transportType}
                        onChange={(e) => setTransportType(e.target.value)}
                        className={inputClass}
                        required
                      >
                        <option value="">
                          {isRtl ? 'اختر النوع' : 'Select type'}
                        </option>
                        {transportOptions.map((opt, i) => (
                          <option key={opt} value={TRANSPORT_TYPES_EN[i]}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel required>{isRtl ? 'المدة' : 'Duration'}</FieldLabel>
                      <select
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className={inputClass}
                        required
                      >
                        <option value="">
                          {isRtl ? 'اختر المدة' : 'Select duration'}
                        </option>
                        {durationOptions.map((opt, i) => (
                          <option key={opt} value={DURATION_OPTIONS[i]}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <FieldLabel required>
                      {isRtl ? 'الميزانية الأصلية' : 'Original Budget'}
                    </FieldLabel>
                    <div className="relative">
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 ${
                          isRtl ? 'right-4' : 'left-4'
                        }`}
                      >
                        SAR
                      </span>
                      <input
                        type="number"
                        min={1}
                        step={1000}
                        value={originalBudget}
                        onChange={(e) => setOriginalBudget(e.target.value)}
                        placeholder={isRtl ? 'مثال: 250000' : 'e.g. 250000'}
                        className={`${inputClass} ${isRtl ? 'pr-14' : 'pl-14'}`}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel>
                      {isRtl
                        ? 'مستند العقد (PDF / صورة)'
                        : 'Contract Document (PDF / Image)'}
                    </FieldLabel>
                    <label
                      className={`flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                        documentName
                          ? 'border-teal-400 bg-teal-50/50'
                          : 'border-slate-200 bg-slate-50/50 hover:border-teal-300'
                      }`}
                    >
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      {documentKind === 'image' ? (
                        <ImageIcon size={28} className="text-teal-600" />
                      ) : (
                        <Upload
                          size={28}
                          className={documentName ? 'text-teal-600' : 'text-slate-400'}
                        />
                      )}
                      <span className="text-sm font-bold text-slate-600 text-center">
                        {documentName ||
                          (isRtl
                            ? 'اسحب ملف PDF أو صورة أو انقر للرفع'
                            : 'Drag PDF/image or click to upload')}
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className={`${btnPrimary} w-full md:w-auto`}
                  >
                    <Plus size={18} />
                    {submitting
                      ? isRtl
                        ? 'جاري النشر...'
                        : 'Posting...'
                      : isRtl
                        ? 'نشر العقد'
                        : 'Post Contract'}
                  </button>
                </form>
              </SectionCard>

              <SectionCard
                title={isRtl ? 'عقودي المنشورة' : 'My Posted Contracts'}
                subtitle={
                  showingSamples
                    ? isRtl
                      ? 'عينات توضيحية'
                      : 'Sample data shown'
                    : isRtl
                      ? `${contracts.length} عقد منشور`
                      : `${contracts.length} contract(s) posted`
                }
                icon={<FileText size={20} />}
              >
                <div className="space-y-3">
                  {displayContracts.map((contract, index) => (
                    <motion.div
                      key={contract.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 md:p-5 rounded-2xl border border-slate-100 bg-slate-50/50"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <StatusBadge status={contract.status} isRtl={isRtl} />
                        <p className="font-black text-slate-800">{contract.title}</p>
                        <p className="text-sm text-slate-500 font-medium">
                          {contract.transportType} • {contract.duration}
                        </p>
                      </div>
                      <div className={`shrink-0 ${isRtl ? 'text-left' : 'text-right'}`}>
                        <p className="text-lg font-black text-slate-900">
                          {formatSar(contract.originalBudget, i18n.language)}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </SectionCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  );
};

export default B2BCorporatePortal;
