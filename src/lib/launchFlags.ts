/**
 * Launch surface flags.
 *
 * B2B corporate / fleet modules stay in the repo but are isolated from
 * navigation and routing until this is flipped back to true.
 */
export const B2B_MODULES_ENABLED = false;

export function isB2bSurfaceRole(role: string | null | undefined): boolean {
  return role === 'b2b_corporate' || role === 'b2b_operator';
}
