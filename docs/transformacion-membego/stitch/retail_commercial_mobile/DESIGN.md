---
name: Retail Commercial Mobile
colors:
  surface: '#f9f9ff'
  surface-dim: '#d3daef'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8fd'
  surface-container-highest: '#dce2f7'
  on-surface: '#141b2b'
  on-surface-variant: '#3f4850'
  inverse-surface: '#293040'
  inverse-on-surface: '#edf0ff'
  outline: '#707881'
  outline-variant: '#bfc7d2'
  surface-tint: '#006398'
  primary: '#006194'
  on-primary: '#ffffff'
  primary-container: '#007bb9'
  on-primary-container: '#fdfcff'
  inverse-primary: '#93ccff'
  secondary: '#00687a'
  on-secondary: '#ffffff'
  secondary-container: '#57dffe'
  on-secondary-container: '#006172'
  tertiary: '#006195'
  on-tertiary: '#ffffff'
  tertiary-container: '#287ab3'
  on-tertiary-container: '#fdfcff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#93ccff'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#cde5ff'
  tertiary-fixed-dim: '#94ccff'
  on-tertiary-fixed: '#001d32'
  on-tertiary-fixed-variant: '#004b74'
  background: '#f9f9ff'
  on-background: '#141b2b'
  surface-variant: '#dce2f7'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  price-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
  price-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-base: 1rem
  space-lg: 1.25rem
  space-xl: 1.5rem
  space-2xl: 2rem
  gutter-compact: 0.5rem
  gutter-card: 0.75rem
  screen-edge-padding: 1rem
  header-search-height: 2.75rem
  header-location-height: 2.25rem
  bottom-nav-height: 3.5rem
---

## Brand & Style

This design system translates high-velocity retail commerce and membership utilities into a focused mobile experience. The visual language mirrors the operational efficiency, immediate discoverability, and high-density information architecture of top-tier global retail applications while anchoring into a clean, modern corporate identity.

The target audience requires friction-free commerce, quick barcode/QR access for memberships and in-store redemption, clear transactional history, and effortless product browsing. The interface prioritizes clarity, pragmatic utility, and visual structure over decorative excess.

Key styling principles:
- **Commercial Density:** Compact vertical hierarchy, clear catalog grids, and prominent call-to-actions that drive immediate decision-making.
- **Utilitarian Navigation:** Direct access via a dual-tier navigation system: a prominent top header with contextual utility sub-bars (search + geo-location) and a persistent 4-slot bottom navigation dock.
- **Clean Flatness with Structural Boundaries:** Crisp 1px division lines with soft neutral backings replace heavy drop shadows to keep viewport rendering light and fast.

## Colors

The color palette is anchored in energetic blues and electric cyans, balanced against sterile white canvases and cool gray borders.

### Palette Roles
- **Brand Primary (`#0284C7`):** Primary action buttons, prominent badges, and active state indicators across navigation and lists.
- **Brand Primary Dark (`#0369A1`):** Pressed, active, and focused states for buttons and interactive controls.
- **Brand Accent / Cyan (`#06B6D4`):** Secondary gradient stops, member highlights, and dynamic visual indicators.
- **Header Gradient:** A horizontal linear gradient transitioning from `#0284C7` at 0% to `#06B6D4` at 100%, applied to the uppermost status and search frame.
- **Location Sub-Header Tint:** A light, tinted neutral surface (`#E0F2FE` or `#F0F9FF`) directly beneath the primary header to clearly display the contextual location strip.
- **Neutral Dark (`#111827`):** High-contrast text for primary headlines, product names, and pricing numerals.
- **Neutral Muted (`#4B5563` & `#6B7280`):** Secondary subtitles, microcopy, SKU codes, and rating counts.
- **Borders & Dividers (`#E5E7EB`):** Container borders, card outlines, and horizontal content separators.
- **Surface Backgrounds:** Clean `#FFFFFF` for screen backdrops and card bodies, with `#F3F4F6` and `#F8FAFC` for grouped section backings.
- **Utility Yellow / Star Rating (`#F59E0B` / `#D97706`):** Dedicated to customer review stars and special deal highlights.

## Typography

The type scale relies entirely on `Inter` (or clean `system-ui` fallbacks), configured for high-density retail clarity and high legibility at micro sizes.

- **Headlines:** Section headers use compact sizing (`18px` to `22px`) with bold weights (`700`) to maximize vertical space for product imagery and actionable cards.
- **Body & Product Descriptors:** Catalog listings and titles use `14px` (`body-md`) with clamped line heights (`20px`) and 2-line truncation to ensure grid balance.
- **Microcopy & Metadata:** Review counters, stock statuses, location tags, and secondary hints stay strictly between `11px` and `13px` with medium (`500`) weights.
- **Price Treatment:** Numeric price values feature strong weights (`700`), with currency symbols and decimals rendered in aligned subscript/superscript positions or alongside compact labels.

## Layout & Spacing

The layout philosophy follows an adaptive mobile-first fixed grid engineered for dense product feeds and rapid finger tapping.

- **Horizontal Bleed & Margins:** Edge screens maintain a strict `16px` (`screen-edge-padding`) gutter for general layout wrappers, while horizontal product carousels bleed edge-to-edge with `12px` snap-padding between elements.
- **Catalog Grids:** Standard 2-column or 3-column retail grids use an `8px` (`gutter-compact`) to `12px` (`gutter-card`) spacing gap.
- **Header Stack:**
  - Layer 1 (Search Banner): Fixed height of `44px` to `48px` centered on the primary cyan-blue gradient background.
  - Layer 2 (Contextual Delivery / Location Bar): `36px` height directly below the search banner with soft background tinting (`#F0F9FF`), housing pin icon, current delivery location, and downward chevron.
- **Persistent Bottom Bar:** `56px` height baseline (plus safe area insets), distributing 4 equal action items: Inicio, Cuenta, Mi QR, and Menú.

## Elevation & Depth

Visual hierarchy uses crisp flat architectural divisions instead of diffused, blurry drop shadows. This preserves high-density performance and emulates the structural look of Amazon's mobile interface.

- **Level 0 (Base Canvas):** Background color `#FFFFFF` with alternating `#F3F4F6` section bands.
- **Level 1 (Cards & Catalog Modules):** Pure `#FFFFFF` surface enclosed by a clean `1px solid #E5E7EB` outline. Shadows are minimal: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`.
- **Level 2 (Active Touch & Pill Filters):** Tactile chips and floating quick-reorder buttons use `0 1px 3px 0 rgba(0, 0, 0, 0.08)`.
- **Level 3 (Search Bar Floating Surface):** The search input container sits embedded within the gradient bar, elevated with an inner high-contrast white `#FFFFFF` surface and subtle inner/outer separation `0 2px 4px rgba(0, 0, 0, 0.06)`.
- **Level 4 (Bottom Navigation Bar):** Fixed to screen bottom, capped with a top stroke border of `1px solid #E5E7EB` and no upwards diffusion shadow.

## Shapes

The interface balances soft rectangular containment for cards with pill-shaped active controls for swift mobile touch targeting.

- **Standard Cards & Modules:** `8px` (`0.5rem`) corner radius for catalog item cards, promo announcement banners, and section groups.
- **Buttons (Pill vs. Structural):**
  - Primary conversion and quick-add actions ("Agregar al carrito", "Acepta tu prueba"): Full rounded pill shape (`20px` to `9999px` radius).
  - Secondary utility and account navigation buttons ("Visita Buy Again", "Cambiar de cuenta"): `8px` corner radius with `1px` border stroke.
- **Search Field:** Rounded rectangular frame with `8px` corner radius to maximize internal typing area while holding leading magnifying glass and trailing camera/scanner icons.
- **Interactive Chips:** Fully rounded pills (`9999px`) with `1px solid #D1D5DB` borders.

## Components

### Top Search & Header Block
- **Container:** Wrapped in the horizontal gradient (`#0284C7` to `#06B6D4`) with `8px` vertical padding and `12px` horizontal padding.
- **Search Bar:** Full-width `#FFFFFF` box, `8px` border radius, `1px solid #CBD5E1`. Left icon: search lens (`#4B5563`). Right icon: camera/QR scanner trigger (`#1E293B`). Placeholder text: "Buscar en Membego".
- **Location Bar:** Sits beneath the search bar. Background `#F0F9FF`, text color `#0369A1` / `#1F2937`. Leading pin icon (`#0284C7`), text snippet: "Explorar cerca de Higüey 23000 · Actualizar ubicación", trailing mini chevron.

### Buttons
- **Primary Retail Pill:** Background `#0284C7`, text `#FFFFFF`, bold `14px`, height `36px` to `40px`, pill radius (`20px`). Active state `#0369A1`.
- **Secondary Action Pill / Tile:** Background `#FFFFFF`, border `1px solid #D1D5DB`, text `#111827`, height `36px`.
- **Add to Cart / Quick Buy:** High-contrast conversion button (`#0284C7` or alternative bright promotional yellow `#F59E0B` when indicating promotional pricing), pill radius, centered text.

### Chips & Filter Scrollers
- Horizontal scroll strip with zero scrollbar visibility.
- White surface, `1px solid #E5E7EB` border, `6px 14px` padding, font size `13px`, font weight `500`. Selected state uses `#0284C7` background with white text.

### Catalog & Product Cards
- **Vertical Feed Card:** White background, minimal `1px solid #E5E7EB` border or borderless on light gray backgrounds, image container centered with `1:1` aspect ratio. Followed by 2-line truncated title (`14px`), star rating row (`12px` gold stars + review count in parentheses), bold price (`18px`), and full-width pill button.
- **Horizontal Deal Banner:** Rounded `8px`, gradient background (`#0284C7` to `#0369A1`), white text headline, compact pill button.

### Bottom Navigation Bar (4-Slot Dock)
- Fixed at the bottom of the viewport with `56px` height.
- **Slot 1 (Inicio):** Home icon (`Outline` / `Solid` on active).
- **Slot 2 (Cuenta):** User profile icon.
- **Slot 3 (Mi QR):** Prominent QrCode icon representing the user's digital membership pass.
- **Slot 4 (Menú):** 3 horizontal bars (hamburger icon) for full application directory.
- Inactive items rendered in `#4B5563`; active item highlighted in brand `#0284C7`.

### Account & Category List Items
- Stacked rows with white background, `8px` border radius, `1px solid #E5E7EB`, padding `12px 16px`, flexible text label (`15px`, bold `600`), and trailing right-facing chevron (`#9CA3AF`).