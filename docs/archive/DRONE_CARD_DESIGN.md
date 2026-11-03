# Drone & Skin Card Visual Design Rules

## Drone Images
- 4 base tier images: tier-1.png (propellers, L1-5), tier-2.png (shrouds, L6-10), tier-3.png (boosters, L11-15), tier-4.png (supersonic, L16-20)
- Image selected by drone level via getDroneImageByLevel(level) in lib/utils.js
- When a skin is equipped, the skin's image_url completely REPLACES the tier image. The skin image is a full drone render in the skin's style, not an overlay.
- All drone images use transparent backgrounds so the card's level tint shows through

## Drone Card Backgrounds (Level Tint)
- ALWAYS determined by the drone's level, never by skin rarity
- Level 1-5 (steel): linear-gradient(180deg, rgba(138, 155, 168, 0.08) 0%, transparent 60%), var(--bg-card)
- Level 6-10 (orange): linear-gradient(180deg, rgba(255, 140, 66, 0.08) 0%, transparent 60%), var(--bg-card)
- Level 11-15 (purple): linear-gradient(180deg, rgba(187, 134, 252, 0.08) 0%, transparent 60%), var(--bg-card)
- Level 16-20 (gold): linear-gradient(180deg, rgba(255, 215, 0, 0.08) 0%, transparent 60%), var(--bg-card)
- Border: 1px solid level color at 20% opacity

## Skin Rarity Indicator on Drone Cards
- When a drone has a skin equipped, the card gets an ADDITIONAL border treatment showing skin rarity
- The level background tint stays unchanged
- Skin rarity shows through border color + glow:
  - Common skin: no additional border treatment (stays default)
  - Rare skin: border-color rgba(74, 158, 255, 0.4), box-shadow 0 0 12px rgba(74, 158, 255, 0.1)
  - Epic skin: border-color rgba(187, 134, 252, 0.4), box-shadow 0 0 12px rgba(187, 134, 252, 0.1)
  - Legendary skin: border-color rgba(255, 215, 0, 0.4), box-shadow 0 0 16px rgba(255, 215, 0, 0.15), plus the legendaryShimmer animation on the card

## Skin Card Backgrounds (Marketplace Skins Tab Only)
- When browsing skins as standalone items, the card background is tinted by RARITY, not level
- Common: neutral gray border, no bg tint
- Rare: blue tinted gradient
- Epic: purple tinted gradient
- Legendary: gold tinted gradient + shimmer animation

## Two Layers of Information
- Level = background tint (power/progression)
- Skin rarity = border glow (cosmetic prestige)
- A Level 15 drone with a Legendary skin shows: purple level tint + gold rarity border glow
- A Level 5 drone with no skin shows: steel level tint + default border

## Skin Images
- Each skin is ONE image (not one per tier)
- Skin image is a complete drone render in the skin's visual style
- When equipped, it replaces the tier image entirely
- Skins do not need to match any specific tier silhouette

## Skin Progression System

Skins (Common, Rare, Epic) progress WITH the drone through tier changes. When a drone levels from Tier 1 (L1-5) to Tier 2 (L6-10), any applied skin automatically renders in its Tier 2 variant. The skin's color scheme, material, and neon treatment stay identical — only the drone silhouette changes to match the new propulsion tier.

Rules:
- Skin is permanently bound to the drone on application. Cannot be removed or transferred.
- Skin visual automatically updates when drone crosses a tier boundary (L5→6, L10→11, L15→16).
- Each non-legendary skin has 4 image variants: skin-name-tier-1.png, skin-name-tier-2.png, skin-name-tier-3.png, skin-name-tier-4.png.
- Legendary skins have ONE image that never changes regardless of drone level.
- getDroneImage logic: if skin is legendary, return skin.image_url. If skin is common/rare/epic, return /skins/{skin-slug}-tier-{getTierNumber(drone.level)}.png. If no skin, return /drones/tier-{N}.png.
- Skin transfers with drone on marketplace sale. Buyer gets drone + bound skin.
- Player cannot sell a bound skin separately.
- Skin binding requires a confirmation dialog: "This skin will be permanently applied to [DRONE-NAME] and will evolve with it through all tier upgrades. This cannot be undone."

This is a core design principle — do not deviate from it.
