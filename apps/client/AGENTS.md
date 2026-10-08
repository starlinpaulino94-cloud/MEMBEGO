# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Expo environment

- The client uses Expo `~57.0.26`, React Native `0.86.3`, and Expo Router `~57.0.24`. Keep Expo package versions compatible with the installed SDK and consult its versioned docs before changing native configuration.
- Run commands from `apps/client`: `bun run start` starts Metro (port `8081` by default), `bun run web` starts Expo Web, and `bun run android` / `bun run ios` build native apps. Android requires the Android SDK and ADB; iOS builds require macOS and Xcode.
- Expo Web uses Metro. The Metro config also resolves packages installed in the root Bun workspace; preserve that monorepo resolution when changing `metro.config.js`.
- Run the client typecheck from the repository root with `bunx tsc --noEmit -p apps/client/tsconfig.json`.

## Connecting to the Next.js environment

- The Next.js BFF runs on port `3000`. Expo Web can derive that host from the browser origin; native devices cannot reach the development computer through `localhost`.
- Configure `EXPO_PUBLIC_API_URL` for the BFF. For a physical device, use a LAN-reachable computer address through `EXPO_PUBLIC_DEVICE_HOST` or a reachable host in Expo's development URL. `src/lib/runtimeUrls.ts` defines how these values are resolved.
- Client API requests go through `src/lib/api.ts`, which attaches the current Supabase access token when available. Preserve the authentication contract of each endpoint.
- `app.config.js` passes `GOOGLE_MAPS_ANDROID_API_KEY` to the `react-native-maps` config plugin. Keep key values in local environment configuration; rebuild the native app after changing native map configuration.

## App architecture

- Routes are managed by Expo Router in `app/`. Fetch server data through `src/lib/api.ts` and the existing hooks; keep Prisma and server-only modules in the Next.js app.
- Use `.native.tsx` and `.web.tsx` files when a platform needs different behavior, and verify both native and web implementations when changing shared UI.
- Membership purchase, plan changes, and payment state are server-authoritative. Use the authenticated client API and display the server result instead of deriving eligibility or payment transitions in the UI.

## Design and brand colors

- Use the shared color helpers in `src/lib/brand-color.ts` to normalize company colors and select foregrounds. Do not add per-company hex exceptions. Business content uses that business's color; category color remains the global Inicio accent.
- Keep runtime design values in `src/theme/tokens.ts` aligned with `tailwind.config.js` when changing shared tokens.
- Set `expo-linear-gradient` layout through its `style` prop; NativeWind `className` does not style the gradient view itself.
- Use `src/components/ui/Card.tsx` for cards and its `onPress` prop for pressable cards. Avoid wrapping it in another pressable control.
- Use `HorizontalScrollWithFade` for horizontal Inicio carousels so edge fades reflect whether content remains in that direction.
- `WalletCard` represents an issued membership. `WalletCardPreview` is a pre-purchase plan preview and must not imply that a QR or active membership already exists.
