import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { FLEET_SERVICE_CATEGORIES } from '@/lib/fleetServiceCatalog';
import {
  defaultPricingForService,
  mergePricingConfig,
  type PricingConfig,
  type TierRate,
} from '@/lib/pricingDefaults';
import {
  DEFAULT_DRIVER_COMMISSION_TIERS,
  type DriverCommissionTier,
} from '@/domain/financials';

interface Props {
  isRtl: boolean;
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

  const patchTier = (serviceId: string, tierId: string, field: keyof TierRate, raw: string) => {
    const value = Number(raw);
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
      await setDoc(
        doc(db, 'pricing', serviceId),
        {
          ...defaultPricingForService(serviceId),
          tier_prices: tierPrices,
          customer_service_fee_percentage: Number(config.customer_service_fee_percentage) || 5,
          platform_commission_percentage: Number(config.platform_commission_percentage) || 15,
          driver_commission_tiers: copyTiers(config),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      toast.success(isRtl ? 'تم حفظ التسعير' : 'Pricing saved');
    } catch (error) {
      console.error('[admin] pricing save failed:', error);
      toast.error(isRtl ? 'تعذر حفظ التسعير' : 'Could not save pricing');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-400">{isRtl ? 'جاري تحميل التسعير...' : 'Loading pricing...'}</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black">{isRtl ? 'تسعير الخدمات' : 'Service Pricing'}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {isRtl
            ? 'أسعار الخدمات والعمولة فقط. جدول سحب الأرباح موجود في طلبات السحب.'
            : 'Service rates and commission only. The earnings withdrawal schedule is under Withdrawal Requests.'}
        </p>
      </div>
      {FLEET_SERVICE_CATEGORIES.map((service) => {
        const config = configs[service.id];
        if (!config) return null;
        const tiers = copyTiers(config);
        return (
          <section key={service.id} className="bg-white rounded-[32px] border border-gray-100 p-8 space-y-5">
            <div>
              <h2 className="text-xl font-black">{isRtl ? service.ar : service.en}</h2>
              <p className="text-xs font-mono text-gray-400">{service.id}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-gray-400">
                    <th className="py-2 text-start">{isRtl ? 'الخيار' : 'Option'}</th>
                    <th className="py-2 text-start">{isRtl ? 'السعر الأساسي' : 'Base price'}</th>
                    <th className="py-2 text-start">{isRtl ? 'لكل كم' : 'Per km'}</th>
                  </tr>
                </thead>
                <tbody>
                  {service.options.map((option) => {
                    const rate = config.tier_prices?.[option.id] || { base_price: 0, price_per_km: 0 };
                    return (
                      <tr key={option.id} className="border-t border-gray-50">
                        <td className="py-3 font-bold">{isRtl ? option.ar : option.en}</td>
                        <td className="py-3">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={rate.base_price}
                            onChange={(event) => patchTier(service.id, option.id, 'base_price', event.target.value)}
                            className="w-28 p-2 rounded-xl bg-gray-50 font-mono"
                          />
                        </td>
                        <td className="py-3">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={rate.price_per_km}
                            onChange={(event) => patchTier(service.id, option.id, 'price_per_km', event.target.value)}
                            className="w-28 p-2 rounded-xl bg-gray-50 font-mono"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-xs font-bold text-gray-400 space-y-1">
                {isRtl ? 'رسوم العميل %' : 'Customer fee %'}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={config.customer_service_fee_percentage ?? 5}
                  onChange={(event) =>
                    setConfigs((prev) => ({
                      ...prev,
                      [service.id]: {
                        ...config,
                        customer_service_fee_percentage: Number(event.target.value),
                      },
                    }))
                  }
                  className="block w-full p-3 rounded-2xl bg-gray-50 font-mono text-black"
                />
              </label>
              <label className="text-xs font-bold text-gray-400 space-y-1">
                {isRtl ? 'عمولة البداية %' : 'Starting commission %'}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={config.platform_commission_percentage}
                  onChange={(event) =>
                    setConfigs((prev) => ({
                      ...prev,
                      [service.id]: {
                        ...config,
                        platform_commission_percentage: Number(event.target.value),
                      },
                    }))
                  }
                  className="block w-full p-3 rounded-2xl bg-gray-50 font-mono text-black"
                />
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400">
                {isRtl ? 'شرائح عمولة السائق' : 'Driver commission bands'}
              </p>
              {tiers.map((tier, index) => (
                <div key={`${tier.min_completed_orders}-${index}`} className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    value={tier.min_completed_orders}
                    onChange={(event) => {
                      const next = tiers.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, min_completed_orders: Number(event.target.value) || 0 }
                          : row
                      );
                      setConfigs((prev) => ({
                        ...prev,
                        [service.id]: { ...config, driver_commission_tiers: next },
                      }));
                    }}
                    className="w-28 p-2 rounded-xl bg-gray-50 font-mono"
                    aria-label={isRtl ? 'عدد الرحلات' : 'Completed trips'}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tier.commission_percentage}
                    onChange={(event) => {
                      const next = tiers.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, commission_percentage: Number(event.target.value) || 0 }
                          : row
                      );
                      setConfigs((prev) => ({
                        ...prev,
                        [service.id]: { ...config, driver_commission_tiers: next },
                      }));
                    }}
                    className="w-28 p-2 rounded-xl bg-gray-50 font-mono"
                    aria-label={isRtl ? 'نسبة العمولة' : 'Commission percent'}
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
