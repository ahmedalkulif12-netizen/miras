import React, { useMemo, useState } from 'react';
import { Building2, Calendar, CreditCard, Package, Save } from 'lucide-react';
import { toast } from 'sonner';
import { FieldLabel, inputClass, btnPrimary, btnSecondary } from '@/components/b2b/B2bUi';
import { FLEET_SERVICE_CATEGORIES, type CoreServiceType } from '@/lib/fleetServiceCatalog';
import { createCorporateContract } from '@/lib/corporateContractService';
import type {
  CorporateContractServiceLine,
  CorporateContractType,
  CorporatePaymentTerms,
} from '@/domain/corporate-contract-schema';

type Props = {
  corporateId: string;
  defaults?: {
    companyName?: string;
    commercialRegistration?: string;
    contactPerson?: string;
    contactPhone?: string;
  };
  isRtl: boolean;
  onCreated?: () => void;
};

function emptyServices(): CorporateContractServiceLine[] {
  return FLEET_SERVICE_CATEGORIES.map((c) => ({
    serviceType: c.id,
    enabled: false,
    monthlyTrips: undefined,
    capacityNote: '',
  }));
}

const CorporateContractRegistrationForm: React.FC<Props> = ({
  corporateId,
  defaults,
  isRtl,
  onCreated,
}) => {
  const [companyName, setCompanyName] = useState(defaults?.companyName || '');
  const [commercialRegistration, setCommercialRegistration] = useState(
    defaults?.commercialRegistration || ''
  );
  const [vatNumber, setVatNumber] = useState('');
  const [contactPerson, setContactPerson] = useState(defaults?.contactPerson || '');
  const [contactPhone, setContactPhone] = useState(defaults?.contactPhone || '');
  const [billingAddress, setBillingAddress] = useState('');

  const [contractType, setContractType] = useState<CorporateContractType>('monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [services, setServices] = useState<CorporateContractServiceLine[]>(emptyServices);
  const [paymentTerms, setPaymentTerms] = useState<CorporatePaymentTerms>('net30');
  const [discountRate, setDiscountRate] = useState('');
  const [customPricingNotes, setCustomPricingNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedCount = useMemo(
    () => services.filter((s) => s.enabled).length,
    [services]
  );

  const toggleService = (serviceType: CoreServiceType, enabled: boolean) => {
    setServices((prev) =>
      prev.map((s) => (s.serviceType === serviceType ? { ...s, enabled } : s))
    );
  };

  const updateServiceField = (
    serviceType: CoreServiceType,
    patch: Partial<CorporateContractServiceLine>
  ) => {
    setServices((prev) =>
      prev.map((s) => (s.serviceType === serviceType ? { ...s, ...patch } : s))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !companyName.trim() ||
      !commercialRegistration.trim() ||
      !vatNumber.trim() ||
      !contactPerson.trim() ||
      !billingAddress.trim()
    ) {
      toast.error(
        isRtl ? 'يرجى تعبئة بيانات الشركة كاملة' : 'Please complete all company profile fields'
      );
      return;
    }
    if (!startDate || !endDate) {
      toast.error(isRtl ? 'يرجى تحديد مدة العقد' : 'Please set contract start and end dates');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      toast.error(
        isRtl ? 'تاريخ الانتهاء يجب أن يكون بعد البداية' : 'End date must be after start date'
      );
      return;
    }
    if (selectedCount === 0) {
      toast.error(
        isRtl ? 'اختر خدمة واحدة على الأقل من الخدمات الست' : 'Select at least one of the 6 core services'
      );
      return;
    }

    setSubmitting(true);
    try {
      await createCorporateContract({
        corporateId,
        companyName,
        commercialRegistration,
        vatNumber,
        contactPerson,
        contactPhone,
        billingAddress,
        contractType,
        startDate,
        endDate,
        services,
        paymentTerms,
        discountRate: discountRate ? Number(discountRate) : 0,
        customPricingNotes,
      });
      toast.success(
        isRtl
          ? 'تم إرسال طلب تسجيل العقد — بانتظار موافقة الإدارة'
          : 'Contract registration submitted — awaiting admin approval'
      );
      onCreated?.();
    } catch (err) {
      console.error('[CorporateContractRegistrationForm]', err);
      toast.error(
        isRtl ? 'فشل حفظ طلب العقد' : 'Failed to save contract registration'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const sectionTitle = (icon: React.ReactNode, title: string, subtitle: string) => (
    <div className="flex items-start gap-3 pb-3 border-b border-slate-100 mb-4">
      <div className="w-10 h-10 rounded-xl bg-teal-600/10 text-teal-700 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="font-black text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500 font-medium">{subtitle}</p>
      </div>
    </div>
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-8 max-w-4xl">
      {/* 1. Company profile */}
      <section>
        {sectionTitle(
          <Building2 size={18} />,
          isRtl ? 'بيانات الشركة' : 'Company Profile Details',
          isRtl
            ? 'الاسم، السجل التجاري، الرقم الضريبي، وعنوان الفوترة'
            : 'Name, CR, VAT, contact, and billing address'
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <FieldLabel required>{isRtl ? 'اسم الشركة' : 'Company Name'}</FieldLabel>
            <input
              className={inputClass}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel required>
              {isRtl ? 'السجل التجاري' : 'Commercial Registration'}
            </FieldLabel>
            <input
              className={inputClass}
              value={commercialRegistration}
              onChange={(e) => setCommercialRegistration(e.target.value)}
              placeholder="CR-…"
            />
          </div>
          <div>
            <FieldLabel required>{isRtl ? 'الرقم الضريبي' : 'VAT Number'}</FieldLabel>
            <input
              className={inputClass}
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              placeholder="3…"
            />
          </div>
          <div>
            <FieldLabel required>{isRtl ? 'الشخص المسؤول' : 'Contact Person'}</FieldLabel>
            <input
              className={inputClass}
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>{isRtl ? 'رقم الجوال' : 'Contact Phone'}</FieldLabel>
            <input
              className={inputClass}
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+9665…"
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel required>{isRtl ? 'عنوان الفوترة' : 'Billing Address'}</FieldLabel>
            <textarea
              className={`${inputClass} min-h-[88px] resize-y`}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* 2. Contract type & duration */}
      <section>
        {sectionTitle(
          <Calendar size={18} />,
          isRtl ? 'نوع العقد والمدة' : 'Contract Type & Duration',
          isRtl ? 'شهري، سنوي، أو حسب المشروع' : 'Monthly, annual, or project-based'
        )}
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3">
            <FieldLabel required>{isRtl ? 'نوع العقد' : 'Contract Type'}</FieldLabel>
            <div className="grid sm:grid-cols-3 gap-2">
              {(
                [
                  { id: 'monthly' as const, ar: 'شهري', en: 'Monthly' },
                  { id: 'annual' as const, ar: 'سنوي', en: 'Annual' },
                  { id: 'project' as const, ar: 'حسب المشروع', en: 'Custom Project-based' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setContractType(opt.id)}
                  className={`px-4 py-3 rounded-2xl border text-sm font-bold transition-all ${
                    contractType === opt.id
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-teal-400'
                  }`}
                >
                  {isRtl ? opt.ar : opt.en}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel required>{isRtl ? 'تاريخ البداية' : 'Start Date'}</FieldLabel>
            <input
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel required>{isRtl ? 'تاريخ الانتهاء' : 'End Date'}</FieldLabel>
            <input
              type="date"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* 3. Service selection */}
      <section>
        {sectionTitle(
          <Package size={18} />,
          isRtl ? 'اختيار الخدمات' : 'Service Selection',
          isRtl
            ? `الخدمات الست الأساسية — محدد ${selectedCount}`
            : `Core 6 services — ${selectedCount} selected`
        )}
        <div className="space-y-3">
          {FLEET_SERVICE_CATEGORIES.map((cat) => {
            const line = services.find((s) => s.serviceType === cat.id)!;
            return (
              <div
                key={cat.id}
                className={`rounded-2xl border p-4 transition-all ${
                  line.enabled
                    ? 'border-teal-300 bg-teal-50/40'
                    : 'border-slate-100 bg-slate-50/50'
                }`}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 accent-teal-600"
                    checked={line.enabled}
                    onChange={(e) => toggleService(cat.id, e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-800">
                      {isRtl ? cat.ar : cat.en}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {cat.options.map((o) => (isRtl ? o.ar : o.en)).join(' · ')}
                    </p>
                  </div>
                </label>
                {line.enabled && (
                  <div className="grid sm:grid-cols-2 gap-3 mt-3 ms-7">
                    <div>
                      <FieldLabel>
                        {isRtl ? 'رحلات شهرية تقديرية' : 'Est. monthly trips'}
                      </FieldLabel>
                      <input
                        type="number"
                        min={0}
                        className={inputClass}
                        value={line.monthlyTrips ?? ''}
                        onChange={(e) =>
                          updateServiceField(cat.id, {
                            monthlyTrips: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <FieldLabel>
                        {isRtl ? 'السعة / الكمية' : 'Capacity / quantity'}
                      </FieldLabel>
                      <input
                        className={inputClass}
                        value={line.capacityNote || ''}
                        onChange={(e) =>
                          updateServiceField(cat.id, {
                            capacityNote: e.target.value,
                          })
                        }
                        placeholder={
                          isRtl ? 'مثال: 4 سطحات' : 'e.g. 4 flatbeds'
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Payment & invoicing */}
      <section>
        {sectionTitle(
          <CreditCard size={18} />,
          isRtl ? 'شروط الدفع والفوترة' : 'Payment & Invoicing Terms',
          isRtl ? 'دفع آجل أو محفظة مسبقة الدفع' : 'Post-paid invoicing or pre-paid wallet'
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <FieldLabel required>{isRtl ? 'طريقة الدفع' : 'Payment Method'}</FieldLabel>
            <div className="grid sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentTerms('net30')}
                className={`px-4 py-3 rounded-2xl border text-sm font-bold text-start transition-all ${
                  paymentTerms === 'net30'
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {isRtl
                  ? 'دفع آجل — فواتير شهرية (Net-30)'
                  : 'Post-paid invoicing (Net-30)'}
              </button>
              <button
                type="button"
                onClick={() => setPaymentTerms('prepaid')}
                className={`px-4 py-3 rounded-2xl border text-sm font-bold text-start transition-all ${
                  paymentTerms === 'prepaid'
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {isRtl ? 'محفظة مسبقة الدفع' : 'Pre-paid wallet'}
              </button>
            </div>
          </div>
          <div>
            <FieldLabel>
              {isRtl ? 'نسبة خصم شركات (٪)' : 'Corporate discount (%)'}
            </FieldLabel>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              className={inputClass}
              value={discountRate}
              onChange={(e) => setDiscountRate(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>
              {isRtl ? 'تسعير متفق عليه / ملاحظات' : 'Agreed pricing / notes'}
            </FieldLabel>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              value={customPricingNotes}
              onChange={(e) => setCustomPricingNotes(e.target.value)}
              placeholder={
                isRtl
                  ? 'أي أسعار خاصة متفق عليها مع المنصة'
                  : 'Any special rates agreed with the platform'
              }
            />
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
        <button
          type="button"
          className={`${btnSecondary} flex-1`}
          disabled={submitting}
          onClick={() => {
            setServices(emptyServices());
            setDiscountRate('');
            setCustomPricingNotes('');
          }}
        >
          {isRtl ? 'مسح الخدمات' : 'Clear services'}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={`${btnPrimary} flex-1 disabled:opacity-50`}
        >
          <Save size={16} />
          {submitting
            ? isRtl
              ? 'جاري الإرسال...'
              : 'Submitting...'
            : isRtl
              ? 'إرسال طلب التسجيل'
              : 'Submit Registration'}
        </button>
      </div>
    </form>
  );
};

export default CorporateContractRegistrationForm;
