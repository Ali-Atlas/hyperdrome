/**
 * POST /api/marketplace/[listingId]/cancel: the MegaETH marketplace is gone. On NEAR this is the
 * contract's `cancel` with the player's key, behind POST /api/marketplace/cancel (SPEC.md 8, BUILD_PLAN T10).
 */
export function POST() {
  return Response.json({ error: 'Marketplace trading moved to NEAR in T10' }, { status: 501 });
}
