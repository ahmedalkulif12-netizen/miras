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
  /** Rendered inside the single pricing page, without a second page title. */
  embedded?: boolean;
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

export const AdminTariffPanel: React.FC<Props> = ({ isRtl, embedded = false }) => {
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

  const patchType = (
    kind: 'hydraulic' | 'normal' | 'box',
    scope: 'intra' | 'inter',
    patch: Partial<FlatbedTariff['types']['hydraulic']['intra']>
  ) => {
    setTariff((prev) => ({
      ...prev,
      types: {
        ...prev.types,
        [kind]: {
          ...prev.types[kind],
          [scope]: { ...prev.types[kind][scope], ...patch },
        },
      },
    }));
  };

  const setDriverRate = (scope: 'intra' | 'inter', value: number) => {
    setTariff((prev) => {
      const current = scope === 'intra' ? prev.intraDriverCommissionTiers : prev.intercityDriverCommissionTiers;
      const tiers = current.map((tier, index) =>
        index === 0 && tier.min_completed_orders === 0 ? { ...tier, commission_percentage: value } : tier
      );
      return scope === 'intra'
        ? { ...prev, intraDriverCommissionPercentage: value, intraDriverCommissionTiers: tiers }
        : { ...prev, intercityDriverCommissionPercentage: value, intercityDriverCommissionTiers: tiers };
    });
  };

  const setTierRow = (
    scope: 'intra' | 'inter',
    index: number,
    patch: Partial<{ min_completed_orders: number; commission_percentage: number }>
  ) => {
    setTariff((prev) => {
      const current = scope === 'intra' ? prev.intraDriverCommissionTiers : prev.intercityDriverCommissionTiers;
      const tiers = current.map((tier, rowIndex) => (rowIndex === index ? { ...tier, ...patch } : tier));
      const starting =
        tiers[0]?.min_completed_orders === 0 ? tiers[0].commission_percentage : undefined;
      return scope === 'intra'
        ? {
            ...prev,
            intraDriverCommissionTiers: tiers,
            intraDriverCommissionPercentage: starting ?? prev.intraDriverCommissionPercentage,
          }
        : {
            ...prev,
            intercityDriverCommissionTiers: tiers,
            intercityDriverCommissionPercentage: starting ?? prev.intercityDriverCommissionPercentage,
          };
    });
  };

  const setIncludedKm = (scope: 'intra' | 'inter', includedKm: number) => {
    setTariff((prev) => ({
      ...prev,
      types: {
        hydraulic: { ...prev.types.hydraulic, [scope]: { ...prev.types.hydraulic[scope], includedKm } },
        normal: { ...prev.types.normal, [scope]: { ...prev.types.normal[scope], includedKm } },
        box: { ...prev.types.box, [scope]: { ...prev.types.box[scope], includedKm } },
      },
    }));
  };

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

  const kinds = [
    ['hydraulic', isRtl ? 'سطحة هيدروليك فل داون' : 'Hydraulic full-down'],
    ['normal', isRtl ? 'سطحة عادية' : 'Standard flatbed'],
    ['box', isRtl ? 'سطحة مغلقة / بوكس' : 'Enclosed / box'],
  ] as const;

  const tables = [
    {
      scope: 'intra' as const,
      title: isRtl ? 'تسعير داخل المدينة' : 'Inside-city pricing',
      included: tariff.types.hydraulic.intra.includedKm,
      driver: tariff.intraDriverCommissionPercentage,
      customer: tariff.intraCustomerServiceFeePercentage,
      tiers: tariff.intraDriverCommissionTiers,
    },
    {
      scope: 'inter' as const,
      title: isRtl ? 'تسعير خارج المدينة' : 'Outside-city pricing',
      included: tariff.types.hydraulic.inter.includedKm,
      driver: tariff.intercityDriverCommissionPercentage,
      customer: tariff.intercityCustomerServiceFeePercentage,
      tiers: tariff.intercityDriverCommissionTiers,
    },
  ];

  return (
    <div className="space-y-8" lang="en">
      <div>
        {embedded ? null : (
          <h2 className="text-2xl font-black">{isRtl ? 'تسعير السطحات' : 'Flatbed pricing'}</h2>
        )}
        <p className="text-sm text-gray-500 mt-1">
          {isRtl
            ? 'قسمان مستقلان: داخل المدينة وخارجها. كل قسم فيه أنواع السطحات، السعر الأساسي، سعر الكيلومتر، الكيلومترات المشمولة، رسوم العميل، عمولة السائق، وشرائح العمولة. الحفظ يكتب مباشرة في Firebase.'
            : 'Two separate sections: inside the city and outside it. Each has the flatbed types, base price, per-km rate, included kilometers, customer fee, driver commission, and commission bands. Save writes straight to Firebase.'}
        </p>
      </div>

      {tables.map((table) => (
        <section key={table.scope} className="rounded-[28px] border border-gray-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="text-lg font-black">{table.title}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {isRtl
                ? 'الأجرة = السعر الأساسي + ما زاد عن الكيلومترات المشمولة × سعر الكيلومتر.'
                : 'Fare = base price + kilometers beyond the included distance × the per-km rate.'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-gray-400">
                  <th className="py-2 text-start">{isRtl ? 'نوع السطحة' : 'Flatbed type'}</th>
                  <th className="py-2 text-start">{isRtl ? 'السعر الأساسي' : 'Base price'}</th>
                  <th className="py-2 text-start">{isRtl ? 'لكل كم' : 'Per km'}</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map(([kind, label]) => {
                  const rate = tariff.types[kind][table.scope];
                  return (
                    <tr key={kind} className="border-t border-gray-50">
                      <td className="py-3 font-bold">{label}</td>
                      <td className="py-3">
                        <EnglishNumberInput
                          value={rate.basePrice}
                          onChange={(basePrice) => patchType(kind, table.scope, { basePrice })}
                          className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                          ariaLabel={isRtl ? 'السعر الأساسي' : 'Base price'}
                        />
                      </td>
                      <td className="py-3">
                        <EnglishNumberInput
                          value={rate.extraKmRate}
                          onChange={(extraKmRate) => patchType(kind, table.scope, { extraKmRate })}
                          className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                          ariaLabel={isRtl ? 'لكل كم' : 'Per km'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="block max-w-xs space-y-1 text-xs font-bold text-gray-500">
            {isRtl ? 'الكيلومترات المشمولة في السعر الأساسي' : 'Kilometers included in the base price'}
            <EnglishNumberInput
              value={table.included}
              onChange={(includedKm) => setIncludedKm(table.scope, includedKm)}
              ariaLabel={isRtl ? 'الكيلومترات المشمولة' : 'Included kilometers'}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={isRtl ? 'رسوم العميل %' : 'Customer fee %'}
              max={100}
              value={table.customer}
              onChange={(value) =>
                setTariff((prev) =>
                  table.scope === 'intra'
                    ? { ...prev, intraCustomerServiceFeePercentage: value }
                    : { ...prev, intercityCustomerServiceFeePercentage: value }
                )
              }
            />
            <Field
              label={isRtl ? 'عمولة السائق %' : 'Driver commission %'}
              max={100}
              value={table.driver}
              onChange={(value) => setDriverRate(table.scope, value)}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-400">
              {isRtl ? 'شرائح عمولة السائق' : 'Driver commission bands'}
            </p>
            <p className="text-[11px] text-gray-400">
              {isRtl
                ? 'من 0 إلى 150 طلب تنزل العمولة إلى 12%. بعد 300 طلب تنزل إلى 10%.'
                : 'From 0 to 150 orders the commission drops to 12%. After 300 orders it drops to 10%.'}
            </p>
            {table.tiers.map((tier, index) => (
              <div key={`${table.scope}-${tier.min_completed_orders}-${index}`} className="flex gap-2">
                <EnglishNumberInput
                  value={tier.min_completed_orders}
                  onChange={(nextValue) =>
                    setTierRow(table.scope, index, { min_completed_orders: Math.floor(nextValue) })
                  }
                  className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                  ariaLabel={isRtl ? 'عدد الطلبات' : 'Completed orders'}
                />
                <EnglishNumberInput
                  max={100}
                  value={tier.commission_percentage}
                  onChange={(nextValue) => setTierRow(table.scope, index, { commission_percentage: nextValue })}
                  className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                  ariaLabel={isRtl ? 'نسبة العمولة' : 'Commission percent'}
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      <div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-6 py-3 rounded-2xl bg-black text-white font-bold disabled:opacity-50"
        >
          {saving ? (isRtl ? 'جاري الحفظ في Firebase...' : 'Saving to Firebase...') : isRtl ? 'حفظ في Firebase' : 'Save to Firebase'}
        </button>
      </div>
    </div>
  );
};
