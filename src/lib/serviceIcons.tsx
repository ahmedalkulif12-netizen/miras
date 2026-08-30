import type { LucideIcon } from 'lucide-react';
import {
  Armchair,
  Boxes,
  CarFront,
  Construction,
  Container,
  Droplets,
  Snowflake,
  Truck,
  Warehouse,
} from 'lucide-react';

/**
 * Shared service → icon map so booking, landing, and driver views stay glanceable
 * and consistent (AR/EN labels still come from i18n keys).
 */
export const SERVICE_ICON_MAP: Record<string, LucideIcon> = {
  furniture_moving: Armchair,
  flatbed: Truck,
  water_tanker: Droplets,
  heavy_equipment: Construction,
  refrigerated: Snowflake,
  goods_transport: Boxes,
  cargo: Boxes,
  trailer: Container,
  dyna: Truck,
  van: CarFront,
  distribution: Warehouse,
};

export function getServiceIcon(serviceType: string | undefined | null): LucideIcon {
  if (!serviceType) return Boxes;
  return SERVICE_ICON_MAP[serviceType] ?? Truck;
}

export function ServiceTypeIcon({
  serviceType,
  size = 20,
  className,
}: {
  serviceType: string;
  size?: number;
  className?: string;
}) {
  const Icon = getServiceIcon(serviceType);
  return <Icon size={size} className={className} />;
}
