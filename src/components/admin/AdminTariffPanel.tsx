import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import {
  DEFAULT_FLATBED_TARIFF,
  flatbedConfigNodes,
  readFlatbedTariff,
  type FlatbedTariff,
} from '@/domain/flatbedTariff';
import { EnglishNumberInput } from '@/components/admin/EnglishNumberInput';

interface Props {
  isRtl: boolean;
}

function Field({
  label,
  hint,
  value,
  onChange,
  allowNegative = false,
  max,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
  max?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      {hint ? <span className="block text-[11px] text-gray-400">{hint}</span> : null}
      <EnglishNumberInput
        value={value}
        allowNegative={allowNegative}
        max={max}
        onChange={onChange}
        ariaLabel={label}
      />
    </label>
  );
}

export const AdminTariffPanel: React.FC<Props> = ({ isRtl }) => {
  const [tariff, setTariff] = useState<FlatbedTariff>(DEFAULT_FLATBED_TARIFF);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getDoc(doc(db, 'pricing', 'flatbed'))
      .then((snap) => {
        if (cancelled) return;
        setTariff(readFlatbedTariff(snap.exists() ? snap.data() : DEFAULT_FLATBED_TARIFF));
      })
      .catch((error) => {
        console.error('[admin] tariff load failed:', error);
        toast.error(isRtl ? 'تعذر تحميل التعرفة' : 'Could not load the tariff');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isRtl]);

  const save = async () => {
    setSaving(true);
    try {
      const next = readFlatbedTariff(tariff);
      await setDoc(
        doc(db, 'pricing', 'flatbed'),
        { ...flatbedConfigNodes(next), updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setTariff(next);
      toast.success(isRtl ? 'تم حفظ التعرفة' : 'Tariff saved');
    } catch (error) {
      console.error('[admin] tariff save failed:', error);
      const code = (error as { code?: string })?.code || '';
      const message = error instanceof Error ? error.message : '';
      toast.error(`${isRtl ? 'تعذر حفظ التعرفة' : 'Could not save the tariff'}${code || message ? `: ${code} ${message}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-400">{isRtl ? 'جاري تحميل التعرفة...' : 'Loading tariff...'}</p>;
  }

  return (
    <div className="space-y-8" lang="en">
      <div>
        <h2 className="text-2xl font-black">
          {isRtl ? 'محرك التسعير والتعرفة' : 'Pricing Engine & Tariffs'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {isRtl
            ? 'داخل المدينة وخارجها إعدادان منفصلان. التطبيق يقرأ intra_city أو inter_city من pricing/flatbed حسب نوع الرحلة. الأرقام تُعرض بالإنجليزية.'
            : 'Intra-city and inter-city are separate settings. The app reads intra_city or inter_city on pricing/flatbed for the trip. Numbers stay in English digits.'}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="bg-white rounded-[32px] border border-emerald-100 p-8 space-y-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Intra-City</p>
            <h3 className="text-lg font-black">{isRtl ? 'تسعير داخل المدينة' : 'Intra-city pricing'}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {isRtl
                ? 'السعر الأساسي يغطي الكيلومترات المشمولة. ما زاد عنها يُحسب بسعر الكيلومتر الإضافي.'
                : 'The base price covers the included kilometers. Distance beyond that uses the extra per-km rate.'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={isRtl ? 'السعر الأساسي (ر.س)' : 'Base price (SAR)'}
              value={tariff.intraBasePrice}
              onChange={(intraBasePrice) => setTariff((prev) => ({ ...prev, intraBasePrice }))}
            />
            <Field
              label={isRtl ? 'حد الكيلومترات المشمولة' : 'Included km threshold'}
              hint={isRtl ? 'افتراضي 25 كم' : 'Default 25 km'}
              value={tariff.intraIncludedKm}
              onChange={(intraIncludedKm) => setTariff((prev) => ({ ...prev, intraIncludedKm }))}
            />
            <Field
              label={isRtl ? 'سعر الكيلومتر الإضافي' : 'Extra price per km'}
              value={tariff.intraExtraKmRate}
              onChange={(intraExtraKmRate) => setTariff((prev) => ({ ...prev, intraExtraKmRate }))}
            />
            <Field
              label={isRtl ? 'عمولة السائق %' : 'Driver commission %'}
              hint={isRtl ? 'مثال 10%' : 'Example 10%'}
              max={100}
              value={tariff.intraDriverCommissionPercentage}
              onChange={(intraDriverCommissionPercentage) =>
                setTariff((prev) => ({ ...prev, intraDriverCommissionPercentage }))
              }
            />
            <Field
              label={isRtl ? 'رسوم خدمة العميل %' : 'Customer service fee %'}
              hint={isRtl ? 'مثال 5%' : 'Example 5%'}
              max={100}
              value={tariff.intraCustomerServiceFeePercentage}
              onChange={(intraCustomerServiceFeePercentage) =>
                setTariff((prev) => ({ ...prev, intraCustomerServiceFeePercentage }))
              }
            />
            <Field
              label={isRtl ? 'تقدير / حادث (ر.س)' : 'Taqdeer / accident (SAR)'}
              value={tariff.intraCity.taqdeer}
              onChange={(taqdeer) =>
                setTariff((prev) => ({ ...prev, intraCity: { ...prev.intraCity, taqdeer } }))
              }
            />
          </div>
        </section>

        <section className="bg-white rounded-[32px] border border-sky-100 p-8 space-y-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-sky-700">Inter-City</p>
            <h3 className="text-lg font-black">
              {isRtl ? 'تسعير خارج المدينة' : 'Inter-city / long-distance pricing'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {isRtl
                ? 'يبدأ من سعر الانطلاق ثم سعر الكيلومتر لمسافة خرائط جوجل بين المدن.'
                : 'Starts from the long-distance base, then the per-km rate on the Google Maps distance.'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={isRtl ? 'سعر بداية المسافة الطويلة (ر.س)' : 'Long-distance starting price (SAR)'}
              value={tariff.intercityBaseFee}
              onChange={(intercityBaseFee) => setTariff((prev) => ({ ...prev, intercityBaseFee }))}
            />
            <Field
              label={isRtl ? 'سعر الكيلومتر للمسافة الطويلة' : 'Long-distance rate per km'}
              value={tariff.intercityRatePerKm}
              onChange={(intercityRatePerKm) => setTariff((prev) => ({ ...prev, intercityRatePerKm }))}
            />
            <Field
              label={isRtl ? 'الحد الأدنى بين المدن (ر.س)' : 'Inter-city minimum (SAR)'}
              value={tariff.intercityMinimumFare}
              onChange={(intercityMinimumFare) => setTariff((prev) => ({ ...prev, intercityMinimumFare }))}
            />
            <Field
              label={isRtl ? 'نطاق نفس المدينة (كم)' : 'Same-city radius (km)'}
              value={tariff.sameCityRadiusKm}
              onChange={(sameCityRadiusKm) => setTariff((prev) => ({ ...prev, sameCityRadiusKm }))}
            />
            <Field
              label={isRtl ? 'عمولة السائق %' : 'Driver commission %'}
              hint={isRtl ? 'مثال 15%' : 'Example 15%'}
              max={100}
              value={tariff.intercityDriverCommissionPercentage}
              onChange={(intercityDriverCommissionPercentage) =>
                setTariff((prev) => ({ ...prev, intercityDriverCommissionPercentage }))
              }
            />
            <Field
              label={isRtl ? 'رسوم خدمة العميل %' : 'Customer service fee %'}
              hint={isRtl ? 'مثال 5%' : 'Example 5%'}
              max={100}
              value={tariff.intercityCustomerServiceFeePercentage}
              onChange={(intercityCustomerServiceFeePercentage) =>
                setTariff((prev) => ({ ...prev, intercityCustomerServiceFeePercentage }))
              }
            />
          </div>
        </section>
      </div>

      <section className="bg-white rounded-[32px] border border-gray-100 p-8 space-y-5">
        <h3 className="text-lg font-black">{isRtl ? 'فئات السطحات والكفرات' : 'Flatbed types and tires'}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={isRtl ? 'هيدروليك فل داون (إضافة 0)' : 'Hydraulic full-down (offset 0)'}
            value={tariff.offsets.hydraulic}
            allowNegative
            onChange={(hydraulic) =>
              setTariff((prev) => ({ ...prev, offsets: { ...prev.offsets, hydraulic } }))
            }
          />
          <Field
            label={isRtl ? 'سطحة عادية (إضافة -100)' : 'Standard flatbed (offset -100)'}
            value={tariff.offsets.normal}
            allowNegative
            onChange={(normal) => setTariff((prev) => ({ ...prev, offsets: { ...prev.offsets, normal } }))}
          />
          <Field
            label={isRtl ? 'سطحة مغلقة / بوكس (إضافة +250)' : 'Enclosed / box (offset +250)'}
            value={tariff.offsets.box}
            allowNegative
            onChange={(box) => setTariff((prev) => ({ ...prev, offsets: { ...prev.offsets, box } }))}
          />
          <Field
            label={isRtl ? 'الحد الأدنى بعد الخصم' : 'Floor after a discount'}
            value={tariff.offsetFloor}
            onChange={(offsetFloor) => setTariff((prev) => ({ ...prev, offsetFloor }))}
          />
          <Field
            label={isRtl ? 'كفرات تالفة (+100)' : 'Damaged tires (+100)'}
            value={tariff.tireDamageSurcharge}
            onChange={(tireDamageSurcharge) => setTariff((prev) => ({ ...prev, tireDamageSurcharge }))}
          />
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-6 py-3 rounded-2xl bg-black text-white font-bold disabled:opacity-50"
        >
          {saving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : isRtl ? 'حفظ التعرفة' : 'Save tariff'}
        </button>
      </section>
    </div>
  );
};
