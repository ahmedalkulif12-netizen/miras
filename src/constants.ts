/**
 * Service option catalogs for the 6 core B2C categories:
 * furniture_moving, flatbed, refrigerated, heavy_equipment, goods_transport, water_tanker.
 * Dual keys (cold/cargo) kept as aliases of refrigerated/goods_transport.
 */
export const SERVICE_OPTIONS = {
  furniture_moving: ['small_truck', 'medium_truck', 'large_truck'],
  flatbed: ['normal', 'hydraulic', 'box'],
  water_tanker: ['1000L', '3000L', '5000L', '7000L', '10000L', '12000L'],
  heavy_equipment: ['light_equip', 'medium_equip', 'heavy_equip'],
  cold: ['chilled', 'cold_normal', 'frozen'],
  // Small van → medium dyna → large trailer + specialty cargo
  cargo: ['van', 'dyna', 'trailer', 'cement_mixer', 'brick_transporter'],
  // Canonical alias (same options as cargo)
  goods_transport: ['van', 'dyna', 'trailer', 'cement_mixer', 'brick_transporter'],
  refrigerated: ['chilled', 'cold_normal', 'frozen'],
};

/** Kilometers included in every service base price. */
export const PRICING_INCLUDED_KM = 25;

export const OPTION_LABELS: Record<string, string> = {
  normal: 'normal',
  cold_normal: 'cold_normal',
  chilled: 'chilled',
  hydraulic: 'hydraulic',
  box: 'box',
  '1000L': '1000L',
  '3000L': '3000L',
  '5000L': '5000L',
  '7000L': '7000L',
  '10000L': '10000L',
  '12000L': '12000L',
  fresh: 'water_type_fresh',
  sewage: 'water_type_sewage',
  frozen: 'frozen',
  trailer: 'trailer',
  dyna: 'dyna',
  van: 'van',
  cement_mixer: 'cement_mixer',
  brick_transporter: 'brick_transporter',
  small_truck: 'small_truck',
  medium_truck: 'medium_truck',
  large_truck: 'large_truck',
  light_equip: 'light_equip',
  medium_equip: 'medium_equip',
  heavy_equip: 'heavy_equip',
};

export const SERVICE_KEY_MAP: Record<string, string> = {
  refrigerated: 'cold',
  goods_transport: 'cargo',
};
