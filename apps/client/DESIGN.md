# MembeGo Client Design System

## 1. Atmosphere & Identity

The client feels familiar, clear, and reassuring: a quiet retail surface where prices and next steps are easy to scan. CardNET checkout keeps that language and gives the hosted card form a clear boundary. Its signature is a compact, white capture card with an explicit handoff to CardNET; card details remain inside the provider surface.

## 2. Color

The client uses the values currently consumed by `apps/client` NativeWind components. `packages/ui/src/tokens.ts` supplies the shared semantic state colors and scale references; its web brand and font choices are not the active client theme.

| Role | Client token | Value | Usage |
|---|---|---|---|
| Brand action | `primary.DEFAULT` | `#5b21b6` | Existing client buttons, links, focus ring |
| Brand ramp | `primary.50`–`primary.900` | `#f5f3ff`–`#3b0764` | Soft fills and client brand variants |
| Retail accent | `retail.blue` | `#0284c7` | Retail-specific labels and accents |
| Surface | `surface.background`, `surface.card` | `#ffffff` | App and card backgrounds |
| Main text | `surface.foreground` | `#111827` | Headings and body copy |
| Muted surface | `surface.muted` | `#f3f4f6` | Secondary inset surfaces |
| Secondary text | `surface.mutedForeground` | `#4b5563` | Helper and pending copy |
| Border / input | `surface.border`, `surface.input` | `#e5e7eb` | Card and field outlines |
| Focus | `surface.ring` | `#5b21b6` | Keyboard focus and active field |
| Success | `state.success` | `#00864d` | Server-confirmed approval only |
| Warning | `state.warning` | `#ab6300` | Pending and activation guidance |
| Error | `state.danger` | `#e7000b` | Provider, session, and decline errors |
| Information | `state.info` | `#00809b` | Neutral payment guidance |

Pending state uses the muted text and warning surface already present in the client palette. A capture callback never uses the success color or success copy; approval is rendered only from the server status response.

## 3. Typography

`Inter` is the client family loaded by `apps/client/app/_layout.tsx` and configured in `apps/client/tailwind.config.js`. Use `font-sans` for reading text and the existing `font-inter-*` weight classes for emphasis. The mirrored `packages/ui` font families (`Plus Jakarta Sans`, `Geist`, and `Geist Mono`) serve the web design system and are not loaded by this Expo client.

| Role | Size / line height | Weight | Usage |
|---|---:|---:|---|
| H1 | 32 / 1.15 | 800 | Screen title |
| H2 | 24 / 1.25 | 700 | Major card title |
| H3 | 17 / 1.3 | 700 | Card title |
| H4 | 15 / 1.35 | 600 | Small heading |
| Body | 16 / 1.6 | 400 | Instructions and consent copy |
| Small | 14 / 1.5 | 400 | Secondary instructions |
| Caption | 12.5 / 1.45 | 400 | Short metadata |
| Overline | 12 / 1.4 | 600 | Short section labels |

Keep body and control labels at 14px or larger. The client token floor is 12px for compact metadata.

## 4. Spacing & Layout

Use the shared 4px spacing rhythm: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, and 96px. The package token mirror also includes 2px for optical adjustments. Keep ordinary form gaps at 8–16px and card-group gaps at 24–32px. Interactive targets are at least 44px high.

The capture surface is one readable column, centered on larger viewports with a maximum width of 720px. It has 16px mobile page insets and 24px tablet/desktop insets. At 375px the primary content remains one column; at 768px and 1280px the same column stays centered rather than stretching the form.

## 5. Components

Reusable client primitives are composed from `Card`, `Button`, `Input`, `Badge`, `PageHeader`, and `EmptyState` in `apps/client/src/components/ui`. New payment controls should reuse those components and use the existing color, type, spacing, and radius tokens. The reusable payment components are `CardnetCapture`, `CardnetCaptureIntroduction`, `RenewalConsent`, `CardnetPaymentStatusMessage`, `CardnetCaptureError`, and `CardnetActivationForm` in `src/components/pagos/cardnet`; the hosted surface is platform-specific (`CaptureSurface.web.tsx` and `CaptureSurface.native.tsx`).

### CardNET capture form
- **Structure**: `Card` with amount/currency summary, a provider-owned capture surface, and a `Button` that opens CardNET.
- **Variants**: ready, opening, capturing, confirming, pending, and expired.
- **Spacing**: 16px card content, 8–12px field/helper gaps, 24px between sections.
- **States**: idle, loading, active capture, token received/confirming, pending, server-approved, declined, expired, and provider error. A token receipt transitions to confirming; it is never an approval state.
- **Accessibility**: labelled controls, visible keyboard focus on Web, at least 44px touch targets, clear hosted-provider boundary.
- **Motion**: no decorative motion; use the existing 100–200ms interaction feedback only.
- **Layout**: single-column stack. The CardNET form is hosted in its provider iframe on Web and in a controlled native WebView document on Android/iOS.

### Renewal consent
- **Structure**: accessible checkbox row using a `Pressable`, check icon, and explanatory `Text`.
- **Variants**: unchecked and checked; unchecked is the default.
- **Spacing**: 12px row gap, 16px vertical inset.
- **States**: unchecked, checked, disabled while a session is being created, and focus/pressed feedback.
- **Accessibility**: checkbox role and checked state; the text explains that CardNET may store a capture profile and that renewal is enabled only after approval and consent.
- **Motion**: no animation required.
- **Layout**: wraps as a row on mobile and remains aligned to the form column on wider screens.

### Payment status message
- **Structure**: `Card` or `Badge` with a status icon, concise title, and next step.
- **Variants**: pending, approved, declined, activation-required, and expired.
- **Spacing**: 12px icon/text gap and 16px panel inset.
- **States**: server status only; pending remains pending until an authoritative server response changes it.
- **Accessibility**: status copy is announced politely and does not rely on color alone.
- **Motion**: no decorative motion.
- **Layout**: one-column status panel.

### Capture error
- **Structure**: `EmptyState` or bordered `Card` with a specific message and retry/back `Button`.
- **Variants**: invalid session URL, script load failure, bridge rejection, and recoverable network failure.
- **Spacing**: 16px content inset and 12px action gap.
- **States**: visible error, retrying, and disabled action while retrying.
- **Accessibility**: plain-language cause and action; error is not phrased as a card decline unless the server returns `declined`.
- **Motion**: no decorative motion.
- **Layout**: one-column panel.

### Activation form
- **Structure**: `Card` with `Input`, inline validation/helper copy, and submit `Button`.
- **Variants**: ready, invalid code, submitting, pending, and completed from server status.
- **Spacing**: 8px label/input gap and 12px action gap.
- **States**: empty, focused, invalid, submitting, pending, and server-confirmed result.
- **Accessibility**: labelled input, a keyboard suited to the bank's activation-code format, visible focus, and an announced validation message.
- **Motion**: no decorative motion.
- **Layout**: single-column form.

## 6. Motion & Interaction

Use client motion tokens: 100ms instant, 150ms fast, 200ms base, and 350ms slow. Existing Pressables use opacity for press feedback; fields use the ring token for focus. Do not animate layout. Respect `prefers-reduced-motion` on Web and avoid motion where none improves payment clarity.

## 7. Depth & Surface

Use a mixed strategy: white card surfaces with the existing `border-border` outline and `shadow-card` elevation. Reserve stronger `premium` shadows for an overlay that truly sits above the page. The CardNET provider surface has a distinct border and inset background so its ownership is clear without imitating the hosted form.

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- Target WCAG 2.2 AA: 4.5:1 for normal text and 3:1 for large text and essential non-text controls.
- Keep keyboard focus visible on Expo Web and every action reachable without a pointer.
- Keep touch targets at least 44px, labels explicit, status changes announced, and reduced motion respected.
- Never collect or render PAN/CVV in client components. Keep the one-time token in component memory only, submit it once, and render approval only from a server-approved status.

### Accepted debt
| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| The current client `primary.DEFAULT` (`#5b21b6`) and Inter family differ from the blue primary and Geist-family values in the shared `packages/ui` mirror; the checked-in client contract doc also describes a retail-blue client primary. | `apps/client/src/theme/tokens.ts`, `apps/client/tailwind.config.js`, `packages/ui/src/tokens.ts`, `docs/design/client-design-contract.md` | Todo 3 documents the live client primitives and does not expand into a global token migration. | Product design-system owner; reconcile in a dedicated token-alignment change. |
