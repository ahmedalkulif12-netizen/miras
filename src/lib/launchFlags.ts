/**
 * Launch surface flags.
 *
 * Company and fleet registration, portals, and B2B pricing are part of the
 * live partner tracks.
 */
export const B2B_MODULES_ENABLED = true;

export function isB2bSurfaceRole(role: string | null | undefined): boolean {
  return role === 'b2b_corporate' || role === 'b2b_operator';
}
