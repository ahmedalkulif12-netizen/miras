import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { FLEET_SERVICE_CATEGORIES } from '@/lib/fleetServiceCatalog';
import {
  INCLUDED_KM,
  defaultPricingForService,
  mergePricingConfig,
  type PricingConfig,
  type TierRate,
} from '@/lib/pricingDefaults';
import {
  DEFAULT_DRIVER_COMMISSION_TIERS,
  type DriverCommissionTier,
} from '@/domain/financials';
import { EnglishNumberInput } from '@/components/admin/EnglishNumberInput';
import { AdminTariffPanel } from '@/components/admin/AdminTariffPanel';

interface Props {
  isRtl: boolean;
}

function feeOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return Math.round(n * 1000) / 1000;
}

function copyTiers(config: PricingConfig): DriverCommissionTier[] {
  const source = config.driver_commission_tiers?.length
    ? config.driver_commission_tiers
    : DEFAULT_DRIVER_COMMISSION_TIERS;
  return source.map((tier) => ({ ...tier }));
}

export const AdminPricingPanel: React.FC<Props> = ({ isRtl }) => {
  const [configs, setConfigs] = useState<Record<string, PricingConfig>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string>(FLEET_SERVICE_CATEGORIES[0]?.id || 'furniture_moving');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, PricingConfig> = {};
      await Promise.all(
        FLEET_SERVICE_CATEGORIES.map(async (service) => {
          const snap = await getDoc(doc(db, 'pricing', service.id));
          next[service.id] = mergePricingConfig(
            service.id,
            snap.exists() ? snap.data() : null
          );
        })
      );
      if (cancelled) return;
      setConfigs(next);
      setLoading(false);
    })().catch((error) => {
      console.error('[admin] pricing load failed:', error);
      toast.error(isRtl ? 'تعذر تحميل التسعير' : 'Could not load pricing');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isRtl]);

  const patchTier = (serviceId: string, tierId: string, field: keyof TierRate, value: number) => {
    setConfigs((prev) => {
      const current = prev[serviceId];
      if (!current) return prev;
      const tiers = { ...(current.tier_prices || {}) };
      const row = tiers[tierId] || { base_price: 0, price_per_km: 0 };
      tiers[tierId] = {
        ...row,
        [field]: Number.isFinite(value) ? value : 0,
      };
      return { ...prev, [serviceId]: { ...current, tier_prices: tiers } };
    });
  };

  const saveService = async (serviceId: string) => {
    const config = configs[serviceId];
    if (!config) return;
    const category = FLEET_SERVICE_CATEGORIES.find((row) => row.id === serviceId);
    const tierPrices: Record<string, TierRate> = {};
    for (const option of category?.options || []) {
      const rate = config.tier_prices?.[option.id];
      tierPrices[option.id] = {
        base_price: Number(rate?.base_price) || 0,
        price_per_km: Number(rate?.price_per_km) || 0,
      };
    }
    setSavingId(serviceId);
    try {
      const seeded = defaultPricingForService(serviceId);
      const { flatbed_tariff: _keepTariff, ...seededWithoutTariff } = seeded;
      await setDoc(
        doc(db, 'pricing', serviceId),
        {
          ...seededWithoutTariff,
          tier_prices: tierPrices,
          included_km: Math.max(0, Number(config.included_km) || 0),
          delivery_fee: Number(config.delivery_fee) || 0,
          customer_service_fee_percentage: feeOrDefault(
            config.customer_service_fee_percentage,
            defaultPricingForService(serviceId).customer_service_fee_percentage ?? 5
          ),
          platform_commission_percentage: feeOrDefault(
            config.platform_commission_percentage,
            defaultPricingForService(serviceId).platform_commission_percentage
          ),
          driver_commission_tiers: copyTiers(config),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      toast.success(isRtl ? 'تم حفظ التسعير' : 'Pricing saved');
    } catch (error) {
      console.error('[admin] pricing save failed:', error);
      const code = (error as { code?: string })?.code || '';
      const message = error instanceof Error ? error.message : '';
      toast.error(`${isRtl ? 'تعذر حفظ التسعير' : 'Could not save pricing'}${code || message ? `: ${code} ${message}` : ''}`);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-400">{isRtl ? 'جاري تحميل التسعير...' : 'Loading pricing...'}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black">{isRtl ? 'التحكم في التسعير' : 'Pricing control'}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {isRtl
            ? 'كل خدمات التطبيق في صفحة واحدة. افتح المربع، عدّل السعر والكيلومترات والنسبة، ثم احفظ في Firebase.'
            : 'Every app service is on this page. Open a box, edit the price, kilometers, and percent, then save to Firebase.'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FLEET_SERVICE_CATEGORIES.map((service) => {
          const active = openId === service.id;
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => setOpenId(service.id)}
              className={`rounded-2xl border px-4 py-5 text-start font-black transition ${
                active ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-black hover:border-black'
              }`}
            >
              {isRtl ? service.ar : service.en}
            </button>
          );
        })}
      </div>
      {FLEET_SERVICE_CATEGORIES.map((service) => {
        const config = configs[service.id];
        if (!config || openId !== service.id) return null;
        const tiers = copyTiers(config);
        const includedKm = Number.isFinite(Number(config.included_km)) ? Number(config.included_km) : INCLUDED_KM;
        if (service.id === 'flatbed') {
          return (
            <section key={service.id} className="bg-white rounded-[32px] border-2 border-black p-6 md:p-8 space-y-4">
              <div>
                <h2 className="text-xl font-black">{isRtl ? service.ar : service.en}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {isRtl
                    ? 'جدولان مستقلان: داخل المدينة وخارجها. كل جدول فيه السعر الأساسي والكيلومتر لكل نوع سطحة.'
                    : 'Two separate tables: inside the city and outside it. Each table has a base price and a per-km rate for every flatbed type.'}
                </p>
              </div>
              <AdminTariffPanel isRtl={isRtl} embedded />
            </section>
          );
        }
        return (
          <section key={service.id} className="bg-white rounded-[32px] border-2 border-black p-6 md:p-8 space-y-5">
            <div>
              <h2 className="text-xl font-black">{isRtl ? service.ar : service.en}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {service.id === 'gas_delivery'
                  ? isRtl
                    ? 'السعر حسب عدد الأسطوانات ورسوم التوصيل. مسافة الطريق لا تدخل في أجرة الغاز.'
                    : 'Price is by cylinder count plus the delivery fee. Route distance is not part of the gas fare.'
                  : isRtl
                    ? 'الأجرة = السعر الأساسي + ما زاد عن الكيلومترات المشمولة × سعر الكيلومتر.'
                    : 'Fare = base price + kilometers beyond the included distance × the per-km rate.'}
              </p>
            </div>
            {service.id !== 'gas_delivery' && (
              <label className="block max-w-xs space-y-1 text-xs font-bold text-gray-500">
                {isRtl ? 'الكيلومترات المشمولة في السعر الأساسي' : 'Kilometers included in the base price'}
                <EnglishNumberInput
                  value={includedKm}
                  onChange={(next) =>
                    setConfigs((prev) => ({
                      ...prev,
                      [service.id]: { ...config, included_km: next },
                    }))
                  }
                  ariaLabel={isRtl ? 'الكيلومترات المشمولة' : 'Included kilometers'}
                />
              </label>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-gray-400">
                    <th className="py-2 text-start">{isRtl ? 'الخيار' : 'Option'}</th>
                    <th className="py-2 text-start">
                      {service.id === 'gas_delivery'
                        ? isRtl
                          ? 'أجرة الخدمة'
                          : 'Service fare'
                        : isRtl
                          ? 'السعر الأساسي'
                          : 'Base price'}
                    </th>
                    {service.id !== 'gas_delivery' && (
                      <th className="py-2 text-start">{isRtl ? 'لكل كم' : 'Per km'}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {service.options.map((option) => {
                    const rate = config.tier_prices?.[option.id] || { base_price: 0, price_per_km: 0 };
                    return (
                      <tr key={option.id} className="border-t border-gray-50">
                        <td className="py-3 font-bold">
                          <span className="block">{isRtl ? option.ar : option.en}</span>
                          {(isRtl ? option.hintAr : option.hintEn) && (
                            <span className="block text-[11px] font-medium text-gray-400">
                              {isRtl ? option.hintAr : option.hintEn}
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          <EnglishNumberInput
                            value={rate.base_price}
                            onChange={(next) => patchTier(service.id, option.id, 'base_price', next)}
                            className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                            ariaLabel={isRtl ? 'السعر الأساسي' : 'Base price'}
                          />
                        </td>
                        {service.id !== 'gas_delivery' && (
                          <td className="py-3">
                            <EnglishNumberInput
                              value={rate.price_per_km}
                              onChange={(next) => patchTier(service.id, option.id, 'price_per_km', next)}
                              className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                              ariaLabel={isRtl ? 'لكل كم' : 'Per km'}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {service.id === 'gas_delivery' && (
              <p className="text-xs font-bold text-amber-700">
                {isRtl
                  ? 'افتراضي الغاز: رسوم العميل 1% وعمولة السائق أو الأسطول 2%. الحفظ يكتب pricing/gas_delivery فوراً.'
                  : 'Gas default: 1% customer fee and 2% driver or fleet commission. Save writes pricing/gas_delivery immediately.'}
              </p>
            )}
            {service.id === 'gas_delivery' && (
              <label className="text-xs font-bold text-gray-400 space-y-1 block max-w-xs">
                {isRtl ? 'رسوم التوصيل' : 'Delivery fee'}
                <EnglishNumberInput
                  value={config.delivery_fee ?? 0}
                  onChange={(deliveryFee) =>
                    setConfigs((prev) => ({
                      ...prev,
                      [service.id]: {
                        ...config,
                        delivery_fee: deliveryFee,
                      },
                    }))
                  }
                  className="block w-full p-3 rounded-2xl bg-gray-50 font-mono text-black tabular-nums"
                  ariaLabel={isRtl ? 'رسوم التوصيل' : 'Delivery fee'}
                />
              </label>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-xs font-bold text-gray-400 space-y-1">
                {isRtl ? 'رسوم العميل %' : 'Customer fee %'}
                <EnglishNumberInput
                  max={100}
                  value={config.customer_service_fee_percentage ?? 5}
                  onChange={(next) =>
                    setConfigs((prev) => ({
                      ...prev,
                      [service.id]: {
                        ...config,
                        customer_service_fee_percentage: next,
                      },
                    }))
                  }
                  className="block w-full p-3 rounded-2xl bg-gray-50 font-mono text-black tabular-nums"
                  ariaLabel={isRtl ? 'رسوم العميل' : 'Customer fee'}
                />
              </label>
              <label className="text-xs font-bold text-gray-400 space-y-1">
                {isRtl ? 'عمولة البداية %' : 'Starting commission %'}
                <EnglishNumberInput
                  max={100}
                  value={config.platform_commission_percentage}
                  onChange={(nextRate) => {
                    setConfigs((prev) => {
                      const tiers = copyTiers(config).map((tier, index) =>
                        index === 0 && tier.min_completed_orders === 0
                          ? { ...tier, commission_percentage: Number.isFinite(nextRate) ? nextRate : 0 }
                          : tier
                      );
                      return {
                        ...prev,
                        [service.id]: {
                          ...config,
                          platform_commission_percentage: nextRate,
                          driver_commission_tiers: tiers,
                        },
                      };
                    });
                  }}
                  className="block w-full p-3 rounded-2xl bg-gray-50 font-mono text-black tabular-nums"
                  ariaLabel={isRtl ? 'عمولة البداية' : 'Starting commission'}
                />
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400">
                {isRtl ? 'شرائح عمولة السائق' : 'Driver commission bands'}
              </p>
              {tiers.map((tier, index) => (
                <div key={`${tier.min_completed_orders}-${index}`} className="flex gap-2">
                  <EnglishNumberInput
                    value={tier.min_completed_orders}
                    onChange={(nextValue) => {
                      const next = tiers.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, min_completed_orders: Math.floor(nextValue) }
                          : row
                      );
                      setConfigs((prev) => ({
                        ...prev,
                        [service.id]: { ...config, driver_commission_tiers: next },
                      }));
                    }}
                    className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                    ariaLabel={isRtl ? 'عدد الرحلات' : 'Completed trips'}
                  />
                  <EnglishNumberInput
                    max={100}
                    value={tier.commission_percentage}
                    onChange={(nextValue) => {
                      const next = tiers.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, commission_percentage: nextValue }
                          : row
                      );
                      setConfigs((prev) => ({
                        ...prev,
                        [service.id]: { ...config, driver_commission_tiers: next },
                      }));
                    }}
                    className="w-28 p-2 rounded-xl bg-gray-50 font-mono tabular-nums"
                    ariaLabel={isRtl ? 'نسبة العمولة' : 'Commission percent'}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={savingId === service.id}
              onClick={() => void saveService(service.id)}
              className="px-5 py-3 rounded-2xl bg-primary text-black text-sm font-black disabled:opacity-50"
            >
              {isRtl ? 'حفظ هذه الخدمة' : 'Save this service'}
            </button>
          </section>
        );
      })}
    </div>
  );
};
