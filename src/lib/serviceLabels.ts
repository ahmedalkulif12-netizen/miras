/**
 * Consistent human-readable service labels for checkout, invoices, admin, and history.
 */
import type { TFunction } from 'i18next';
import { isWaterTankerService } from '@/domain/waterTanker';
import { OPTION_LABELS } from '@/constants';
import {
  normalizeWaterServiceType,
  type WaterServiceType,
} from '@/lib/waterTankerCatalog';
import { resolveTankCapacityLabel } from '@/lib/waterTankerDistance';

const WATER_TYPE_I18N: Record<WaterServiceType, string> = {
  fresh: 'water_type_fresh',
  normal: 'water_type_normal',
  sewage: 'water_type_sewage',
};

export function translateServiceType(
  serviceType: string | null | undefined,
  t: TFunction
): string {
  if (!serviceType) return '';
  const translated = t(serviceType);
  // i18n returns the key when missing — avoid showing raw keys.
  if (translated && translated !== serviceType) return translated;
  return serviceType;
}

export function translateWaterType(
  waterType: string | null | undefined,
  t: TFunction
): string {
  const normalized = normalizeWaterServiceType(waterType);
  return t(WATER_TYPE_I18N[normalized]);
}

export function translateCapacity(
  capacity: string | null | undefined,
  t: TFunction
): string {
  const key = resolveTankCapacityLabel(capacity);
  const translated = t(OPTION_LABELS[key] || key);
  return translated && translated !== key ? translated : key;
}

export function formatOrderServiceLabel(
  serviceType: string | null | undefined,
  details: {
    waterType?: string | null;
    capacity?: string | null;
    type?: string | null;
    option?: string | null;
  } | null | undefined,
  t: TFunction
): { title: string; subtitle?: string } {
  const title = translateServiceType(serviceType, t);
  if (!serviceType) return { title };

  if (isWaterTankerService(serviceType)) {
    const capacity =
      details?.capacity || details?.type || details?.option || undefined;
    const parts = [
      translateWaterType(details?.waterType || 'fresh', t),
      capacity ? translateCapacity(capacity, t) : '',
    ].filter(Boolean);
    return { title, subtitle: parts.join(' · ') };
  }

  const option = details?.type || details?.option || undefined;
  if (option) {
    const optKey = OPTION_LABELS[option] || option;
    const optLabel = t(optKey);
    return {
      title,
      subtitle: optLabel && optLabel !== optKey ? optLabel : option,
    };
  }

  return { title };
}
