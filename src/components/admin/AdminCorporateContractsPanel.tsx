import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ShieldOff,
  Loader2,
  Save,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import {
  listAllCorporateContracts,
  updateCorporateContractAdmin,
} from '@/lib/corporateContractService';
import type { CorporateContractRecord } from '@/domain/corporate-contract-schema';
import { getFleetCategoryLabel } from '@/lib/fleetServiceCatalog';

const STATUS_STYLE: Record<
  CorporateContractRecord['status'],
  { ar: string; en: string; className: string }
> = {
  pending: {
    ar: 'بانتظار الموافقة',
    en: 'Pending',
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

/**
 * Admin panel: approve / suspend corporate contract accounts and assign pricing.
 */
const AdminCorporateContractsPanel: React.FC = () => {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  const [rows, setRows] = useState<CorporateContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CorporateContractRecord | null>(null);
  const [discountRate, setDiscountRate] = useState('0');
  const [adminPricingRules, setAdminPricingRules] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAllCorporateContracts();
      setRows(list);
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'تعذر تحميل العقود' : 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [isRtl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = (row: CorporateContractRecord) => {
    setSelected(row);
    setDiscountRate(String(row.discountRate ?? 0));
    setAdminPricingRules(row.adminPricingRules || '');
    setAdminNotes(row.adminNotes || '');
  };

  const applyStatus = async (
    status: CorporateContractRecord['status']
  ) => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateCorporateContractAdmin(selected.id, selected.corporateId, {
        status,
        discountRate: Number(discountRate) || 0,
        adminPricingRules,
        adminNotes,
        reviewedBy: profile?.uid,
      });
      toast.success(
        status === 'active'
          ? isRtl
            ? 'تم تفعيل عقد الشركة'
            : 'Corporate contract activated'
          : status === 'suspended'
            ? isRtl
              ? 'تم إيقاف العقد'
              : 'Contract suspended'
            : status === 'rejected'
              ? isRtl
                ? 'تم رفض الطلب'
                : 'Registration rejected'
              : isRtl
                ? 'تم التحديث'
                : 'Updated'
      );
      setSelected(null);
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'فشل التحديث' : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const savePricingOnly = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateCorporateContractAdmin(selected.id, selected.corporateId, {
        status: selected.status,
        discountRate: Number(discountRate) || 0,
        adminPricingRules,
        adminNotes,
        reviewedBy: profile?.uid,
      });
      toast.success(isRtl ? 'تم حفظ قواعد التسعير' : 'Pricing rules saved');
      await refresh();
      const refreshed = (await listAllCorporateContracts()).find(
        (r) => r.id === selected.id
      );
      if (refreshed) openDetail(refreshed);
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'فشل الحفظ' : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-black">
              {isRtl ? 'عقود الشركات' : 'Corporate Contracts'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isRtl
                ? 'تفعيل أو إيقاف حسابات العقود وتعيين التسعير المخصص'
                : 'Activate or suspend contract accounts and assign custom pricing'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold hover:bg-gray-50"
          >
            {isRtl ? 'تحديث' : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
            <Loader2 className="animate-spin" size={20} />
            {isRtl ? 'جاري التحميل...' : 'Loading...'}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center py-16 text-gray-400 font-medium">
            {isRtl ? 'لا توجد طلبات عقود بعد' : 'No corporate contract registrations yet'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-gray-400 border-b">
                  <th className="py-3 px-2 font-bold">{isRtl ? 'الشركة' : 'Company'}</th>
                  <th className="py-3 px-2 font-bold">{isRtl ? 'النوع' : 'Type'}</th>
                  <th className="py-3 px-2 font-bold">{isRtl ? 'الخدمات' : 'Services'}</th>
                  <th className="py-3 px-2 font-bold">{isRtl ? 'الدفع' : 'Payment'}</th>
                  <th className="py-3 px-2 font-bold">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="py-3 px-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const st = STATUS_STYLE[row.status];
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-gray-50 hover:bg-gray-50/80"
                    >
                      <td className="py-4 px-2">
                        <p className="font-black text-gray-900">{row.companyName}</p>
                        <p className="text-xs text-gray-400">{row.commercialRegistration}</p>
                      </td>
                      <td className="py-4 px-2 font-medium text-gray-600">
                        {row.contractType}
                        <div className="text-[10px] text-gray-400">
                          {row.startDate} → {row.endDate}
                        </div>
                      </td>
                      <td className="py-4 px-2 text-xs text-gray-600 max-w-[200px]">
                        {row.services
                          .map((s) => getFleetCategoryLabel(s.serviceType, isRtl))
                          .join(', ')}
                      </td>
                      <td className="py-4 px-2 text-xs font-bold text-gray-600">
                        {row.paymentTerms === 'net30' ? 'Net-30' : 'Pre-paid'}
                        {row.discountRate > 0 ? ` · ${row.discountRate}%` : ''}
                      </td>
                      <td className="py-4 px-2">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full border ${st.className}`}
                        >
                          {isRtl ? st.ar : st.en}
                        </span>
                      </td>
                      <td className="py-4 px-2 text-end">
                        <button
                          type="button"
                          onClick={() => openDetail(row)}
                          className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-bold"
                        >
                          {isRtl ? 'إدارة' : 'Manage'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => !saving && setSelected(null)}
          />
          <div
            className={`relative w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto p-6 space-y-5 ${
              isRtl ? 'text-right' : 'text-left'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-teal-700 mb-1">
                  <Building2 size={18} />
                  <span className="text-xs font-bold uppercase tracking-widest">
                    {isRtl ? 'عقد شركة' : 'Corporate contract'}
                  </span>
                </div>
                <h3 className="text-xl font-black">{selected.companyName}</h3>
                <p className="text-sm text-gray-500">{selected.contactPerson}</p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setSelected(null)}
                className="p-2 rounded-xl hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4 space-y-2 text-sm">
              <p>
                <span className="text-gray-400 font-bold text-xs uppercase">
                  {isRtl ? 'السجل' : 'CR'}
                </span>
                <br />
                {selected.commercialRegistration}
              </p>
              <p>
                <span className="text-gray-400 font-bold text-xs uppercase">
                  {isRtl ? 'الرقم الضريبي' : 'VAT'}
                </span>
                <br />
                {selected.vatNumber}
              </p>
              <p>
                <span className="text-gray-400 font-bold text-xs uppercase">
                  {isRtl ? 'العنوان' : 'Billing'}
                </span>
                <br />
                {selected.billingAddress}
              </p>
              <p>
                <span className="text-gray-400 font-bold text-xs uppercase">
                  {isRtl ? 'الخدمات' : 'Services'}
                </span>
                <br />
                {selected.services.map((s) => (
                  <span key={s.serviceType} className="block text-xs mt-1">
                    • {getFleetCategoryLabel(s.serviceType, isRtl)}
                    {s.monthlyTrips != null
                      ? ` (${s.monthlyTrips} ${isRtl ? 'رحلة/شهر' : 'trips/mo'})`
                      : ''}
                    {s.capacityNote ? ` — ${s.capacityNote}` : ''}
                  </span>
                ))}
              </p>
              {selected.customPricingNotes && (
                <p className="text-xs text-amber-800 bg-amber-50 rounded-xl p-2">
                  {selected.customPricingNotes}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">
                {isRtl ? 'نسبة الخصم ٪' : 'Discount rate %'}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={discountRate}
                onChange={(e) => setDiscountRate(e.target.value)}
                className="w-full p-3 rounded-2xl bg-gray-50 border border-gray-100 font-bold"
              />
              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">
                {isRtl ? 'قواعد التسعير المخصصة' : 'Custom pricing rules'}
              </label>
              <textarea
                value={adminPricingRules}
                onChange={(e) => setAdminPricingRules(e.target.value)}
                className="w-full p-3 rounded-2xl bg-gray-50 border border-gray-100 font-medium text-sm min-h-[88px]"
                placeholder={
                  isRtl
                    ? 'مثال: سعر ثابت لسطحة هيدروليك 140 ر.س'
                    : 'e.g. Fixed hydraulic flatbed rate SAR 140'
                }
              />
              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">
                {isRtl ? 'ملاحظات إدارية' : 'Admin notes'}
              </label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="w-full p-3 rounded-2xl bg-gray-50 border border-gray-100 font-medium text-sm min-h-[64px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyStatus('active')}
                className="col-span-2 py-3 rounded-2xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                {isRtl ? 'تفعيل العقد' : 'Activate contract'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyStatus('suspended')}
                className="py-3 rounded-2xl bg-rose-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ShieldOff size={16} />
                {isRtl ? 'إيقاف' : 'Suspend'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyStatus('rejected')}
                className="py-3 rounded-2xl bg-gray-800 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <XCircle size={16} />
                {isRtl ? 'رفض' : 'Reject'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePricingOnly()}
                className="col-span-2 py-3 rounded-2xl border border-gray-200 font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save size={16} />
                {isRtl ? 'حفظ التسعير فقط' : 'Save pricing only'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCorporateContractsPanel;
