import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { DEFAULT_FLATBED_TARIFF, readFlatbedTariff, type FlatbedTariff } from '@/domain/flatbedTariff';

interface Props {
  isRtl: boolean;
}

function Field({
  label,
  value,
  onChange,
  allowNegative = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      <input
        type="number"
        step="0.01"
        min={allowNegative ? undefined : 0}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="w-full p-3 rounded-xl bg-gray-50 font-mono"
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
        { flatbed_tariff: next, updatedAt: new Date().toISOString() },
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
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black">
          {isRtl ? 'محرك التسعير والتعرفة' : 'Pricing Engine & Tariffs'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {isRtl
            ? 'سعر السطحة يُحسب من مسافة خرائط جوجل بين موقع التحميل وموقع التنزيل في أي مدينة. الأحساء ليست نقطة بداية ثابتة.'
            : 'Flatbed fares use the Google Maps distance between pickup and drop-off anywhere in Saudi Arabia. Al-Ahsa is not a fixed origin.'}
        </p>
      </div>

      <section className="bg-white rounded-[32px] border border-gray-100 p-8 space-y-5">
        <h3 className="text-lg font-black">{isRtl ? 'النقل بين المدن' : 'Inter-city'}</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label={isRtl ? 'رسوم بداية الرحلة (ر.س)' : 'Base pickup fee (SAR)'}
            value={tariff.intercityBaseFee}
            onChange={(intercityBaseFee) => setTariff((prev) => ({ ...prev, intercityBaseFee }))}
          />
          <Field
            label={isRtl ? 'سعر الكيلومتر (ر.س)' : 'Rate per km (SAR)'}
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
        </div>
      </section>

      <section className="bg-white rounded-[32px] border border-gray-100 p-8 space-y-5">
        <h3 className="text-lg font-black">{isRtl ? 'خدمات داخل المدينة' : 'Intra-city services'}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={isRtl ? 'ورشة إلى ورشة' : 'Workshop to workshop'}
            value={tariff.intraCity.workshop}
            onChange={(workshop) =>
              setTariff((prev) => ({ ...prev, intraCity: { ...prev.intraCity, workshop } }))
            }
          />
          <Field
            label={isRtl ? 'نقل داخلي عام' : 'General intra-city'}
            value={tariff.intraCity.general}
            onChange={(general) =>
              setTariff((prev) => ({ ...prev, intraCity: { ...prev.intraCity, general } }))
            }
          />
          <Field
            label={isRtl ? 'المنطقة الصناعية' : 'Industrial area'}
            value={tariff.intraCity.industrial}
            onChange={(industrial) =>
              setTariff((prev) => ({ ...prev, intraCity: { ...prev.intraCity, industrial } }))
            }
          />
          <Field
            label={isRtl ? 'تقدير / حادث' : 'Taqdeer / accident assessment'}
            value={tariff.intraCity.taqdeer}
            onChange={(taqdeer) =>
              setTariff((prev) => ({ ...prev, intraCity: { ...prev.intraCity, taqdeer } }))
            }
          />
        </div>
      </section>

      <section className="bg-white rounded-[32px] border border-gray-100 p-8 space-y-5">
        <h3 className="text-lg font-black">{isRtl ? 'فئات السطحات والكفرات' : 'Flatbed types and tires'}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={isRtl ? 'هيدروليك فل داون (إضافة)' : 'Hydraulic full-down (offset)'}
            value={tariff.offsets.hydraulic}
            allowNegative
            onChange={(hydraulic) =>
              setTariff((prev) => ({ ...prev, offsets: { ...prev.offsets, hydraulic } }))
            }
          />
          <Field
            label={isRtl ? 'سطحة عادية (إضافة)' : 'Standard flatbed (offset)'}
            value={tariff.offsets.normal}
            allowNegative
            onChange={(normal) => setTariff((prev) => ({ ...prev, offsets: { ...prev.offsets, normal } }))}
          />
          <Field
            label={isRtl ? 'سطحة مغلقة / بوكس (إضافة)' : 'Enclosed / box (offset)'}
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
            label={isRtl ? 'كفرات تالفة' : 'Damaged tires'}
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
