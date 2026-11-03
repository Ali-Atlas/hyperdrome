# Inventory Page Design Prompt

Create `app/inventory/page.jsx` and `app/inventory/page.module.css`. CSS Modules only, globals.css variables, no Tailwind.

## Page Structure

Full inventory management page showing everything the player owns.

### Tabs across the top:
- **Skins** (default)
- **Mods**
- **Unopened Packs** (shows count badge)

### Skins Tab
- Grid of all owned skins
- Each skin card shows: image (or prism placeholder), name, rarity badge with rarity background
- Status indicator per skin:
  - "Equipped on [DRONE_NAME]" — green dot, links to that drone
  - "Bound to [DRONE_NAME]" — yellow dot, can click to equip
  - "Unbound" — red dot, can click to bind to a drone (opens bind modal)
- Filter by: rarity, status (equipped/bound/unbound)
- Sort by: rarity, name, date acquired

### Mods Tab
- Same layout as skins
- Each mod card shows: name, rarity badge, stat bonus/penalty preview
- Same status indicators (equipped/bound/unbound)
- Same filters and sorts

### Unopened Packs Tab
- Shows any purchased but unopened packs
- Each pack shows the foil image, tier name, and "Open" button
- Clicking Open triggers the pack opening flow (same modal as marketplace)
- Option to sell unopened packs on marketplace (future feature — show disabled "List on Marketplace" button)

### Design Requirements
- Black page background
- Cards use rarity-appropriate backgrounds matching marketplace and pack preview cards
- Legendary items get the full animated border treatment
- Responsive: 4 columns desktop, 3 tablet, 2 mobile
- Empty states: "No skins yet. Open packs or buy from the marketplace." with link to marketplace
- Page accessible from NavShell sidebar
