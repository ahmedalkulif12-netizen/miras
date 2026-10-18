/**
 * Service option catalogs for the 6 core B2C categories:
 * furniture_moving, flatbed, refrigerated, heavy_equipment, goods_transport, water_tanker.
 * Dual keys (cold/cargo) kept as aliases of refrigerated/goods_transport.
 */
export const SERVICE_OPTIONS = {
  furniture_moving: ['small_van', 'hilux', 'closed_van', 'open_dyna', 'box_dyna', 'large_truck'],
  flatbed: ['hydraulic', 'normal', 'box'],
  water_tanker: ['300L', '500L', '1000L', '3000L', '5000L', '7000L', '10000L', '12000L'],
  heavy_equipment: ['light_equip', 'medium_equip', 'heavy_equip'],
  cold: ['chilled', 'cold_normal', 'frozen'],
  // Small van, medium dyna, large trailer.
  cargo: ['small_van', 'hilux', 'closed_van', 'open_dyna', 'box_dyna', 'trailer'],
  goods_transport: ['small_van', 'hilux', 'closed_van', 'open_dyna', 'box_dyna', 'trailer'],
  refrigerated: ['refrigerated_van', 'chilled', 'cold_normal', 'frozen'],
  gas_delivery: ['cylinder_swap', 'new_cylinder'],
};

/** Kilometers included in every service base price. */
export const PRICING_INCLUDED_KM = 25;

export const OPTION_LABELS: Record<string, string> = {
  normal: 'normal',
  cold_normal: 'cold_normal',
  chilled: 'chilled',
  hydraulic: 'hydraulic',
  box: 'box',
  '300L': '300L',
  '500L': '500L',
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
  small_van: 'small_van',
  hilux: 'hilux',
  closed_van: 'closed_van',
  open_dyna: 'open_dyna',
  box_dyna: 'box_dyna',
  refrigerated_van: 'refrigerated_van',
  cylinder_swap: 'cylinder_swap',
  new_cylinder: 'new_cylinder',
  light_equip: 'light_equip',
  medium_equip: 'medium_equip',
  heavy_equip: 'heavy_equip',
};

export const SERVICE_KEY_MAP: Record<string, string> = {
  refrigerated: 'cold',
  goods_transport: 'cargo',
};
