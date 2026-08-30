/**
 * Canonical fleet / order service categories for Miras's 6 core services.
 * Used by Fleet Operator "Add Vehicle" and for matching orders to fleet capacity.
 */

import { driverVehicleMatchesOrder } from '@/domain/serviceCategories';

export type CoreServiceType =
  | 'furniture_moving'
  | 'flatbed'
  | 'water_tanker'
  | 'heavy_equipment'
  | 'refrigerated'
  | 'goods_transport';

export type FleetServiceOption = {
  id: string;
  ar: string;
  en: string;
  /** Short hint shown under the option (optional). */
  hintAr?: string;
  hintEn?: string;
};

export type FleetServiceCategory = {
  id: CoreServiceType;
  ar: string;
  en: string;
  options: FleetServiceOption[];
};

/** Six core services with operator-facing subtype labels. */
export const FLEET_SERVICE_CATEGORIES: FleetServiceCategory[] = [
  {
    id: 'furniture_moving',
    ar: 'نقل العفش',
    en: 'Moving',
    options: [
      { id: 'small_truck', ar: 'دباب (فان صغير)', en: 'Small Van (Dabbab)' },
      { id: 'medium_truck', ar: 'دينا', en: 'Medium Dyna' },
      { id: 'large_truck', ar: 'تريلا', en: 'Large Trailer' },
    ],
  },
  {
    id: 'flatbed',
    ar: 'السطحات',
    en: 'Towing & Flatbeds',
    options: [
      { id: 'normal', ar: 'سطحة عادية', en: 'Normal Flatbed' },
      { id: 'hydraulic', ar: 'سطحة هيدروليك', en: 'Hydraulic Flatbed' },
      { id: 'box', ar: 'سطحة بوكس', en: 'Box Flatbed' },
    ],
  },
  {
    id: 'water_tanker',
    ar: 'صهاريج المياه',
    en: 'Water Tankers',
    options: [
      { id: '1000L', ar: '1,000 لتر', en: '1,000L' },
      { id: '3000L', ar: '3,000 لتر', en: '3,000L' },
      { id: '5000L', ar: '5,000 لتر', en: '5,000L' },
      { id: '7000L', ar: '7,000 لتر', en: '7,000L' },
      { id: '10000L', ar: '10,000 لتر', en: '10,000L' },
      { id: '12000L', ar: '12,000 لتر', en: '12,000L' },
    ],
  },
  {
    id: 'heavy_equipment',
    ar: 'المعدات الثقيلة',
    en: 'Heavy & Equipment Transport',
    options: [
      {
        id: 'light_equip',
        ar: 'معدات خفيفة',
        en: 'Light Equipment',
        hintAr: 'مثل شياول صغيرة',
        hintEn: 'e.g. small loaders',
      },
      {
        id: 'medium_equip',
        ar: 'معدات متوسطة',
        en: 'Medium Equipment',
        hintAr: 'مثل قلابي متوسط',
        hintEn: 'e.g. medium dump trucks',
      },
      {
        id: 'heavy_equip',
        ar: 'معدات ثقيلة',
        en: 'Heavy Equipment',
        hintAr: 'شياول / قلابي ثقيل وغيرها',
        hintEn: 'loaders / dump trucks and similar',
      },
    ],
  },
  {
    id: 'refrigerated',
    ar: 'النقل المبرد',
    en: 'Refrigerated Transport',
    options: [
      { id: 'chilled', ar: 'تبريد خفيف', en: 'Light Cooling' },
      { id: 'cold_normal', ar: 'تبريد عادي', en: 'Normal Cooling' },
      {
        id: 'frozen',
        ar: 'تجميد عميق (ثلاجات تبريد)',
        en: 'Deep Frozen (Refrigerated Units)',
      },
    ],
  },
  {
    id: 'goods_transport',
    ar: 'نقل البضائع',
    en: 'Cargo & Goods Transport',
    options: [
      { id: 'van', ar: 'فان صغير', en: 'Small Van' },
      { id: 'dyna', ar: 'دينا', en: 'Medium Dyna' },
      { id: 'trailer', ar: 'تريلا', en: 'Large Trailer' },
      { id: 'cement_mixer', ar: 'خلاطات أسمنت', en: 'Cement Mixers' },
      { id: 'brick_transporter', ar: 'ناقلات طوب', en: 'Brick Transporters' },
    ],
  },
];

export function getFleetCategory(id: string): FleetServiceCategory | undefined {
  return FLEET_SERVICE_CATEGORIES.find((c) => c.id === id);
}

export function getFleetOptions(serviceType: string): FleetServiceOption[] {
  return getFleetCategory(serviceType)?.options ?? [];
}

export function getFleetOptionLabel(
  serviceType: string,
  optionId: string,
  isRtl: boolean
): string {
  const opt = getFleetOptions(serviceType).find((o) => o.id === optionId);
  if (!opt) return optionId;
  return isRtl ? opt.ar : opt.en;
}

export function getFleetCategoryLabel(serviceType: string, isRtl: boolean): string {
  const cat = getFleetCategory(serviceType);
  if (!cat) return serviceType;
  return isRtl ? cat.ar : cat.en;
}

/** True when a fleet vehicle can serve an order of the given type/tier. */
export function vehicleMatchesService(
  vehicle: { category?: string; subtype?: string; serviceType?: string; serviceOption?: string },
  serviceType: string,
  serviceOption?: string
): boolean {
  const vType = vehicle.serviceType || vehicle.category;
  if (!driverVehicleMatchesOrder(vType, serviceType)) return false;
  if (!serviceOption) return true;
  const vOpt = vehicle.serviceOption || vehicle.subtype;
  return !vOpt || vOpt === serviceOption;
}
