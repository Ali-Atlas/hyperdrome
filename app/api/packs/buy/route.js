/**
 * POST /api/packs/buy: the MegaETH pack purchase is gone. On NEAR, packs are `open_pack` and
 * `reveal_pack` with the player's key, behind POST /api/packs/open (SPEC.md 8, BUILD_PLAN T10).
 */
export function POST() {
  return Response.json({ error: 'Pack buying moved to NEAR in T10' }, { status: 501 });
}
