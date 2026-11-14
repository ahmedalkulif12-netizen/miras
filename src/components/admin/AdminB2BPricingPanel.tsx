import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { FLEET_SERVICE_CATEGORIES } from '@/lib/fleetServiceCatalog';

interface Props {
  isRtl: boolean;
}

interface B2BContractRow {
  id: string;
  companyName: string;
  commercialRegistration: string;
  serviceType: string;
  basePrice: number;
  pricePerKm: number;
  includedKm: number;
  platformCommissionPercentage: number;
}

const EMPTY: B2BContractRow = {
  id: '',
  companyName: '',
  commercialRegistration: '',
  serviceType: 'flatbed',
  basePrice: 0,
  pricePerKm: 0,
  includedKm: 0,
  platformCommissionPercentage: 10,
};

export const AdminB2BPricingPanel: React.FC<Props> = ({ isRtl }) => {
  const [defaultCommission, setDefaultCommission] = useState(10);
  const [rows, setRows] = useState<B2BContractRow[]>([]);
  const [draft, setDraft] = useState<B2BContractRow>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getDoc(doc(db, 'pricing', 'b2b')).then((snap) => {
      const data = snap.data() || {};
      const commission = Number(data.defaultPlatformCommissionPercentage);
      if (Number.isFinite(commission)) setDefaultCommission(commission);
      const contracts = Array.isArray(data.contracts) ? data.contracts : [];
      setRows(
        contracts
          .filter((row) => row && typeof row === 'object')
          .map((row) => ({
            id: String(row.id || crypto.randomUUID()),
            companyName: String(row.companyName || ''),
            commercialRegistration: String(row.commercialRegistration || ''),
            serviceType: String(row.serviceType || 'flatbed'),
            basePrice: Number(row.basePrice) || 0,
            pricePerKm: Number(row.pricePerKm) || 0,
            includedKm: Number(row.includedKm) || 0,
            platformCommissionPercentage: Number(row.platformCommissionPercentage) || 0,
          }))
      );
    }).catch((error) => console.warn('[admin] b2b pricing read failed:', error));
  }, []);

  const save = async (nextRows: B2BContractRow[], commission = defaultCommission) => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'pricing', 'b2b'),
        {
          defaultPlatformCommissionPercentage: commission,
          contracts: nextRows,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setRows(nextRows);
      toast.success(isRtl ? 'حُفظ تسعير قطاع الأعمال' : 'B2B pricing saved');
    } catch (error) {
      console.error('[admin] b2b pricing save failed:', error);
      toast.error(isRtl ? 'تعذر الحفظ في Firebase' : 'Could not save to Firebase');
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    if (draft.companyName.trim().length < 2 || !/^\d{10}$/.test(draft.commercialRegistration)) {
      toast.error(isRtl ? 'أدخل اسم الشركة ورقم سجل من 10 أرقام' : 'Enter the company name and a 10-digit CR');
      return;
    }
    const next = [...rows, { ...draft, id: crypto.randomUUID() }];
    setDraft(EMPTY);
    void save(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black">{isRtl ? 'تسعير قطاع الأعمال' : 'B2B pricing'}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {isRtl
            ? 'عقود الشركات منفصلة عن تسعير الأفراد. كل عقد يحدد السعر الأساسي والكيلومتر ونسبة عمولة المنصة.'
            : 'Company contracts are separate from consumer pricing. Each contract sets the base fare, per kilometre, and platform commission.'}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-[28px] border border-gray-100 bg-white p-5">
        <label className="text-sm font-bold">
          {isRtl ? 'عمولة المنصة الافتراضية %' : 'Default platform commission %'}
          <input
            type="number"
            min={0}
            max={100}
            value={defaultCommission}
            onChange={(e) => setDefaultCommission(Number(e.target.value))}
            className="mt-1 block w-40 rounded-xl border px-3 py-2"
          />
        </label>
        <button type="button" disabled={saving} onClick={() => void save(rows)} className="rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white">
          {isRtl ? 'حفظ الافتراضي' : 'Save default'}
        </button>
      </div>
      <div className="grid gap-3 rounded-[28px] border border-gray-100 bg-white p-5 md:grid-cols-3">
        <input value={draft.companyName} onChange={(e) => setDraft({ ...draft, companyName: e.target.value })} placeholder={isRtl ? 'اسم الشركة' : 'Company name'} className="rounded-xl border px-3 py-3" />
        <input value={draft.commercialRegistration} onChange={(e) => setDraft({ ...draft, commercialRegistration: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder={isRtl ? 'السجل التجاري' : 'CR'} className="rounded-xl border px-3 py-3" />
        <select value={draft.serviceType} onChange={(e) => setDraft({ ...draft, serviceType: e.target.value })} className="rounded-xl border px-3 py-3">
          {FLEET_SERVICE_CATEGORIES.map((service) => (
            <option key={service.id} value={service.id}>{isRtl ? service.ar : service.en}</option>
          ))}
        </select>
        <input type="number" value={draft.basePrice} onChange={(e) => setDraft({ ...draft, basePrice: Number(e.target.value) })} placeholder={isRtl ? 'السعر الأساسي' : 'Base'} className="rounded-xl border px-3 py-3" />
        <input type="number" value={draft.pricePerKm} onChange={(e) => setDraft({ ...draft, pricePerKm: Number(e.target.value) })} placeholder={isRtl ? 'لكل كم' : 'Per km'} className="rounded-xl border px-3 py-3" />
        <input type="number" value={draft.includedKm} onChange={(e) => setDraft({ ...draft, includedKm: Number(e.target.value) })} placeholder={isRtl ? 'كم مشمولة' : 'Included km'} className="rounded-xl border px-3 py-3" />
        <input type="number" value={draft.platformCommissionPercentage} onChange={(e) => setDraft({ ...draft, platformCommissionPercentage: Number(e.target.value) })} placeholder={isRtl ? 'عمولة %' : 'Commission %'} className="rounded-xl border px-3 py-3" />
        <button type="button" disabled={saving} onClick={add} className="rounded-xl bg-[#FFB800] px-4 py-3 text-sm font-black">
          {isRtl ? 'إضافة عقد' : 'Add contract'}
        </button>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-gray-100 bg-white p-4">
            <div>
              <p className="font-black">{row.companyName}</p>
              <p className="text-sm text-gray-500">{row.commercialRegistration} · {row.serviceType}</p>
              <p className="font-mono text-sm" dir="ltr">{row.basePrice} + {row.pricePerKm}/km · {row.includedKm} km · {row.platformCommissionPercentage}%</p>
            </div>
            <button
              type="button"
              onClick={() => void save(rows.filter((item) => item.id !== row.id))}
              className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
            >
              {isRtl ? 'حذف' : 'Remove'}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
};
