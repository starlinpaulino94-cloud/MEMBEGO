<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository map and shared contracts

- The repository root contains the Next.js app, server routes, and Prisma-backed modules. The Expo Router client lives in `apps/client`; it accesses server data through existing `/api/v1/...` routes and `apps/client/src/lib/api.ts`, preserving each endpoint's auth contract instead of importing server or Prisma modules.
- Validate and persist company colors through `src/lib/company-branding.ts` (`normalizeCompanyBrandColor` and `withCompanyBrandColor`) so color data is normalized and other company configuration is preserved.
- Membership purchase, plan-change eligibility, and payment transitions belong in `src/modules/membresia/cliente-service.ts`. API routes delegate these rules to the service; clients should not duplicate authoritative checks.
- MembeGo is not in the app stores: the web app installs as a PWA (`public/manifest.json`, `public/sw.js`, install prompt in `src/components/system/InstalarApp.tsx`) and notifications reach users outside the app through Web Push. Every notification created through `src/modules/notificaciones/service.ts` goes out via `enviarPushNotificaciones` to both Expo tokens and `web_push_suscripciones`; the Web Push protocol (VAPID + RFC 8291) is implemented without dependencies in `src/modules/notificaciones/web-push/protocolo.ts`. Browser subscriptions are registered at `/api/v1/notificaciones/push-web` (same-origin only). Design and platform limits are in `docs/PWA_NOTIFICACIONES_PUSH.md`.
- The client home banner carousel renders each banner in one of three formats (`SOLO_IMAGEN`, `TITULAR_ARRIBA`, `TEXTO_ENCIMA`) chosen per banner in the admin home editor. The pure rules live in `src/modules/home/banner-formatos.ts`, the card in `src/components/cliente/inicio/TarjetaBanner.tsx` (shared by the client carousel and the editor preview), and uploads go through the image framing editor with `FORMATOS.bannerInicio` and `src/modules/home/imagen-banner-accion.ts`. Banners saved before formats existed stay `TEXTO_ENCIMA`. The carousel also fills itself from what companies publish (promotions, catalog items, deals, plans), newest first, with ten templates chosen by rules and per-piece company settings in `banners_inicio` (`src/modules/home/novedades-auto.ts`, pure rules in `banner-formatos.ts` and `banner-hero.ts`); publishing something asks the company whether to highlight it (`DestacarEnInicio`). Details in `docs/BANNER_INICIO.md`.
- A card payment approved by the gateway (app, web, or saved-card renewal) records its sale in the ledger through `asegurarVentaDelIntento` (`src/modules/pagos/venta-tarjeta.ts`), idempotent by `pagoIntentoId`; the daily cron `/api/cron/entregas-pago` retries stuck deliveries and repairs missing receipts. Reconciliation actions live in `src/modules/observabilidad/conciliacion-servicio.ts`. A card-paid plan change is delivered by `aplicarCambioDePlanCobrado` (`src/modules/pagos/cambio-plan-cobrado.ts`) using the plan stored in `pago_intentos.planDestinoId`, and the membership fields it changes come from `datosDeCambioDePlan` (`src/modules/membresia/cambio-plan-aplicar.ts`), shared with the admin approvals. Never persist or print a card number: only brand, last four digits, and authorization. Design and open decisions are in `docs/PAGO_TARJETA_COMPROBANTE.md`.

## Next.js environment

- The root app uses Next.js `^16.3.4`, App Router, Supabase Auth, Prisma, and Bun. Follow the version-specific docs rule above before changing Next APIs or conventions.
- Start the server from the repository root with `bun run dev`; it listens on port `3000` and binds to `0.0.0.0` so the Expo client can reach it over the local network.
- Available checks are `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build`. Use the narrowest relevant check, then the broader checks when the change warrants them.
- Keep HTTP handlers under `src/app/api/`, domain rules under `src/modules/`, and Prisma access on the server. Schema changes should use the repository's Prisma migration workflow; do not use database reset commands for routine verification.
