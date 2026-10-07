<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository map and shared contracts

- The repository root contains the Next.js app, server routes, and Prisma-backed modules. The Expo Router client lives in `apps/client`; it accesses server data through existing `/api/v1/...` routes and `apps/client/src/lib/api.ts`, preserving each endpoint's auth contract instead of importing server or Prisma modules.
- Validate and persist company colors through `src/lib/company-branding.ts` (`normalizeCompanyBrandColor` and `withCompanyBrandColor`) so color data is normalized and other company configuration is preserved.
- Membership purchase, plan-change eligibility, and payment transitions belong in `src/modules/membresia/cliente-service.ts`. API routes delegate these rules to the service; clients should not duplicate authoritative checks.

## Next.js environment

- The root app uses Next.js `^16.3.4`, App Router, Supabase Auth, Prisma, and Bun. Follow the version-specific docs rule above before changing Next APIs or conventions.
- Start the server from the repository root with `bun run dev`; it listens on port `3000` and binds to `0.0.0.0` so the Expo client can reach it over the local network.
- Available checks are `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build`. Use the narrowest relevant check, then the broader checks when the change warrants them.
- Keep HTTP handlers under `src/app/api/`, domain rules under `src/modules/`, and Prisma access on the server. Schema changes should use the repository's Prisma migration workflow; do not use database reset commands for routine verification.
