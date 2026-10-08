# Plan de Implementación: App Universal de Clientes (Web + iOS + Android)

> **Para agentes ejecutores:** HABILIDAD REQUERIDA: Usar `superpowers:subagent-driven-development` para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla de verificación (`- [ ]`) para tracking.

**Objetivo:** Crear la aplicación universal de clientes de MembeGo en `apps/client` utilizando Expo SDK 52+, Expo Router, React Native Web y NativeWind v4, compartiendo tipos, contratos y tokens de diseño, y exponiendo una capa API BFF en Next.js.

**Arquitectura:** Una sola base de código en `apps/client` configurada en el monorepo que compila para Web (navegadores móviles y desktop) y móvil nativo (iOS / Android). Se conecta a Next.js mediante endpoints REST BFF seguros en `/api/v1/cliente/*` autenticados con Supabase JWT, adaptando el almacenamiento según la plataforma (`expo-secure-store` en nativo, `localStorage` en web).

**Diagrama de Arquitectura:**

```mermaid
flowchart TD
    subgraph Monorepo["Monorepo MembeGo"]
        subgraph UniversalApp["apps/client (Expo Universal: Web + iOS + Android)"]
            Router["Expo Router (Universal File-based routing)"]
            Screens["Vistas de Cliente (Inicio, QR, Cuenta, Menú)"]
            ResponsiveShell["CustomerShell Universal (Dock móvil / Tabs escritorio)"]
            UniversalComponents["Componentes Universales (NativeWind)"]
            AuthAdapter["Universal Auth Adapter (SecureStore / Web Storage)"]
        end

        subgraph SharedPackages["Paquetes Compartidos"]
            Tokens["packages/ui/src/tokens.ts (MDS Tokens)"]
            Contracts["packages/contracts (Eventos, DTOs, Errores)"]
            RootTypes["src/types (Roles, Estados, Modelos)"]
        end

        subgraph CoreBackend["src/ (Next.js Core & BFF)"]
            API_BFF["API BFF: /api/v1/cliente/*"]
            Modules["src/modules/ (cliente, home, membresias, auth)"]
            DB[(PostgreSQL / Prisma)]
        end
    end

    UniversalComponents -->|Tokens MDS| Tokens
    UniversalComponents -->|DTOs y Contratos| Contracts
    UniversalComponents -->|Types de Plataforma| RootTypes
    Screens --> ResponsiveShell
    ResponsiveShell --> UniversalComponents
    Router --> Screens

    AuthAdapter -->|Bearer JWT (Web o Nativo)| API_BFF
    API_BFF --> Modules
    Modules --> DB
```

**Tech Stack:** Expo SDK 52+, Expo Router, React Native Web, NativeWind v4, Tailwind CSS, Bun, Supabase JS, Expo SecureStore, React Query, Lucide React Native.

**Spec:** [`docs/superpowers/specs/2026-09-11-app-movil-cliente-design.md`](file:///C:/Users/Usuario/projects/MEMBEGO/docs/superpowers/specs/2026-09-11-app-movil-cliente-design.md)

## Restricciones Globales (Reglas de Oro del Usuario)
- **Gestor de Paquetes y Runtime:** Utilizar exclusivamente **bun** y **bunx** (`bun install`, `bunx create-expo-app`, `bunx expo install`, `bun test`, `bun run`).
- **Rama Git:** Todo el trabajo se ejecuta en una nueva rama derivada de la actual (`feat/expo-app-client`).
- **NO HACER COMMITS:** Los cambios deben permanecer en el working tree sin commitear hasta que el usuario dé la orden explícita.
- **Comandos Oficiales de Expo:** Usar exclusivamente comandos oficiales documentados por Expo invocados con bunx (`bunx create-expo-app`, `bunx expo install`, `bunx expo start`, `bunx expo export`).
- **Reutilización:** Consumir `@membego/contracts`, tipos de [`src/types/index.ts`](file:///C:/Users/Usuario/projects/MEMBEGO/src/types/index.ts) y tokens de [`packages/ui/src/tokens.ts`](file:///C:/Users/Usuario/projects/MEMBEGO/packages/ui/src/tokens.ts).
- **Cero Regresiones:** El portal administrativo y el build de Next.js no deben romperse.

---

### Tarea 1: Creación de Rama y Scaffolding de `apps/client` con Expo CLI y Bun

**Archivos:**
- Modificar: `package.json` (raíz)
- Crear: `apps/client/package.json`
- Crear: `apps/client/app.json`
- Crear: `apps/client/metro.config.js`
- Crear: `apps/client/tsconfig.json`

**Interfaces:**
- Produce: Workspace `apps/client` con Expo SDK 52+, soporte de Metro para monorepos y paquetes de navegación web/nativo instalados con bun.

- [ ] **Paso 1: Crear y cambiar a la nueva rama derivada**
  Ejecutar en terminal:
  ```powershell
  git checkout -b feat/expo-app-client
  ```
  Verificar: `git branch --show-current` debe mostrar `feat/expo-app-client`.

- [ ] **Paso 2: Declarar `apps/*` en workspaces del `package.json` raíz**
  Añadir el campo `"workspaces": ["apps/*", "packages/*"]` en `package.json` raíz si no está presente:
  ```json
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
  ```

- [ ] **Paso 3: Scaffolding con el comando oficial de Expo usando bunx**
  Ejecutar:
  ```powershell
  bunx create-expo-app@latest apps/client --template blank-typescript --no-install
  ```

- [ ] **Paso 4: Instalar paquetes oficiales para Expo Router y soporte Web con Bun**
  Ejecutar dentro de `apps/client` usando Expo CLI y bun:
  ```powershell
  cd apps/client
  bunx expo install expo-router expo-constants expo-linking expo-status-bar react-native-safe-area-context react-native-screens react-dom react-native-web @expo/metro-runtime
  cd ../..
  ```

- [ ] **Paso 5: Configurar Metro Bundler para monorepo (`apps/client/metro.config.js`)**
  Configurar la resolución de dependencias monorepo según la documentación de Expo:
  ```javascript
  const { getDefaultConfig } = require('expo/metro-config');
  const path = require('path');

  const projectRoot = __dirname;
  const monorepoRoot = path.resolve(projectRoot, '../..');

  const config = getDefaultConfig(projectRoot);

  config.watchFolders = [monorepoRoot];
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
  ];

  module.exports = config;
  ```

- [ ] **Paso 6: Ajustar `app.json` para Expo Router y Web**
  Configurar scheme `membego`, plugins de router y web bundler metro:
  ```json
  {
    "expo": {
      "name": "MembeGo",
      "slug": "membego-client",
      "version": "1.0.0",
      "scheme": "membego",
      "web": {
        "bundler": "metro",
        "output": "static",
        "favicon": "./assets/favicon.png"
      },
      "plugins": ["expo-router"]
    }
  }
  ```

- [ ] **Paso 7: Verificar compilación inicial**
  Ejecutar:
  ```powershell
  cd apps/client; bunx expo export --platform web; cd ../..
  ```
  Esperado: Compilación exitosa del bundle web básico. *(Recordatorio: NO hacer commits)*.

---

### Tarea 2: Configuración del Sistema de Diseño (NativeWind v4 + Tokens MDS)

**Archivos:**
- Crear: `apps/client/tailwind.config.js`
- Crear: `apps/client/global.css`
- Crear: `apps/client/babel.config.js`
- Crear: `apps/client/src/theme/tokens.ts`
- Crear: `apps/client/src/components/ui/Button.tsx`
- Crear: `apps/client/src/components/ui/Card.tsx`
- Crear: `apps/client/src/components/ui/Badge.tsx`

**Interfaces:**
- Consume: `packages/ui/src/tokens.ts` (`primary`, `state`, `radius`, `typography`).
- Produce: Componentes primitivos universales tipados listos para pantallas web y nativas.

- [ ] **Paso 1: Instalar NativeWind y dependencias oficiales con Bun**
  Ejecutar:
  ```powershell
  cd apps/client
  bunx expo install nativewind react-native-reanimated tailwindcss@^3.4.17
  cd ../..
  ```

- [ ] **Paso 2: Configurar `apps/client/tailwind.config.js` consumiendo MDS Tokens**
  ```javascript
  const { primary, state, radius } = require('../../packages/ui/src/tokens');

  /** @type {import('tailwindcss').Config} */
  module.exports = {
    content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
    presets: [require('nativewind/preset')],
    theme: {
      extend: {
        colors: {
          primary: primary[600],
          'primary-hover': primary[700],
          'vibe-purple': '#7c3aed',
          'vibe-blue': '#2563eb',
          'vibe-cyan': '#06b6d4',
          'vibe-fondo': '#0b0f19',
          success: state.success,
          warning: state.warning,
          danger: state.danger,
        },
        borderRadius: {
          '2xl': `${radius['2xl']}px`,
          lg: `${radius.lg}px`,
        },
      },
    },
    plugins: [],
  };
  ```

- [ ] **Paso 3: Crear `apps/client/global.css` y `babel.config.js`**
  `apps/client/global.css`:
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
  ```
  `apps/client/babel.config.js`:
  ```javascript
  module.exports = function (api) {
    api.cache(true);
    return {
      presets: [
        ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
        'nativewind/babel',
      ],
    };
  };
  ```

- [ ] **Paso 4: Crear primitivas universales UI (`Button.tsx`, `Card.tsx`, `Badge.tsx`)**
  Implementar componentes utilizando `Pressable`, `View`, `Text` y NativeWind clases estándar accesibles con áreas táctiles mínimas de 44px.

---

### Tarea 3: Endpoints API BFF en Next.js (`src/app/api/v1/cliente/*`)

**Archivos:**
- Crear: `src/app/api/v1/cliente/inicio/route.ts`
- Crear: `src/app/api/v1/cliente/qr/route.ts`
- Crear: `src/app/api/v1/cliente/perfil/route.ts`
- Crear: `src/app/api/v1/cliente/menu/route.ts`
- Crear: `tests/api-cliente-bff.test.ts`

**Interfaces:**
- Consume: `src/modules/cliente/queries.ts`, `src/modules/home/lectura.ts`, `src/modules/cliente/panelPersonal.ts`.
- Produce: Endpoints REST seguros retornando JSON con headers de autenticación.

- [ ] **Paso 1: Escribir tests automatizados para la API BFF (`tests/api-cliente-bff.test.ts`)**
  ```typescript
  import { test } from 'node:test'
  import assert from 'node:assert'

  test('GET /api/v1/cliente/inicio rechaza peticiones sin token Bearer con 401', async () => {
    // Simular llamada sin token y comprobar respuesta status 401
  })
  ```

- [ ] **Paso 2: Ejecutar test y verificar que falle (TDD)**
  ```powershell
  bun test tests/api-cliente-bff.test.ts
  ```
  Esperado: FAIL porque el endpoint aún no existe.

- [ ] **Paso 3: Implementar `src/app/api/v1/cliente/inicio/route.ts`**
  Validar JWT con Supabase, verificar rol `CLIENTE`, y devolver `{ comercial, personal }` usando `getInicioVista(user)` y `cargarPanelPersonal(user)`.

- [ ] **Paso 4: Implementar `src/app/api/v1/cliente/qr/route.ts` y `perfil/route.ts`**
  Exponer datos de carnet dinámico y perfil/vehículos del cliente.

- [ ] **Paso 5: Ejecutar test y verificar que pase**
  ```powershell
  bun test tests/api-cliente-bff.test.ts
  ```
  Esperado: PASS. *(Recordatorio: NO hacer commits)*.

---

### Tarea 4: Capa de Datos, Autenticación Universal y Almacenamiento Seguro

**Archivos:**
- Crear: `apps/client/src/lib/storage.ts`
- Crear: `apps/client/src/lib/supabase.ts`
- Crear: `apps/client/src/lib/api.ts`
- Crear: `apps/client/src/lib/auth-context.tsx`
- Crear: `apps/client/src/hooks/useInicio.ts`
- Crear: `apps/client/src/hooks/useQr.ts`

**Interfaces:**
- Consume: `@supabase/supabase-js`, `expo-secure-store`, `@tanstack/react-query`.
- Produce: Contexto de sesión reactivo y hooks con caché para pantallas.

- [ ] **Paso 1: Instalar dependencias oficiales con Bun**
  ```powershell
  cd apps/client
  bunx expo install @supabase/supabase-js expo-secure-store @tanstack/react-query expo-linear-gradient lucide-react-native react-native-svg react-native-qrcode-svg
  cd ../..
  ```

- [ ] **Paso 2: Implementar adaptador de almacenamiento universal (`apps/client/src/lib/storage.ts`)**
  Soporte automático para `SecureStore` en móvil y `localStorage` en web.

- [ ] **Paso 3: Implementar cliente Supabase y cliente HTTP (`api.ts`)**
  Injectar automáticamente `Authorization: Bearer <token>` en todas las peticiones a la API BFF.

- [ ] **Paso 4: Implementar `auth-context.tsx`**
  Manejo de estado de login, logout y validación de `role === 'CLIENTE'`.

- [ ] **Paso 5: Implementar hooks React Query (`useInicio`, `useQr`)**
  Hooks tipados con interfaces `InicioVista` y `PanelPersonal`.

---

### Tarea 5: Layout Universal y Navegación Adaptativa (Expo Router)

**Archivos:**
- Crear: `apps/client/app/_layout.tsx`
- Crear: `apps/client/app/(auth)/_layout.tsx`
- Crear: `apps/client/app/(auth)/login.tsx`
- Crear: `apps/client/app/(tabs)/_layout.tsx`
- Crear: `apps/client/src/components/layout/HeaderVibe.tsx`
- Crear: `apps/client/src/components/layout/PillUbicacion.tsx`
- Crear: `apps/client/src/components/layout/BottomTabDock.tsx`
- Crear: `apps/client/src/components/layout/TabsEscritorio.tsx`

**Interfaces:**
- Consume: `DESTINOS_CLIENTE` del contrato Stitch.
- Produce: Navegación de 4 pestañas fija en móvil (< 768px) y barra de pestañas en web de escritorio (≥ 768px).

- [ ] **Paso 1: Implementar `app/_layout.tsx`**
  Provider de `QueryClientProvider`, `AuthProvider` y Root Stack.

- [ ] **Paso 2: Implementar `app/(auth)/login.tsx`**
  Pantalla de acceso universal con validación de credenciales.

- [ ] **Paso 3: Implementar `HeaderVibe.tsx` y `PillUbicacion.tsx`**
  Degradado violeta Stitch (`#5b21b6` -> `#7c3aed` -> `#2563eb` -> `#06b6d4`), input de búsqueda, botón directo a QR y avatar.

- [ ] **Paso 4: Implementar `app/(tabs)/_layout.tsx` adaptativo**
  Detectar ancho de pantalla: renderizar `BottomTabDock` en móvil y `TabsEscritorio` en desktop.

---

### Tarea 6: Pantallas de Cliente (Inicio, Mi QR, Cuenta y Menú)

**Archivos:**
- Crear: `apps/client/app/(tabs)/inicio.tsx`
- Crear: `apps/client/app/(tabs)/qr.tsx`
- Crear: `apps/client/app/(tabs)/cuenta.tsx`
- Crear: `apps/client/app/(tabs)/menu.tsx`
- Crear: `apps/client/src/components/inicio/VibeHero.tsx`
- Crear: `apps/client/src/components/inicio/VibeCategorias.tsx`
- Crear: `apps/client/src/components/inicio/VibeRelampago.tsx`
- Crear: `apps/client/src/components/inicio/VibeReferidos.tsx`
- Crear: `apps/client/src/components/qr/QrCodeCard.tsx`

**Interfaces:**
- Consume: Hooks `useInicio`, `useQr`, `usePerfil`, `useMenu`.
- Produce: 4 vistas completas del cliente con experiencia retail Stitch.

- [ ] **Paso 1: Implementar componentes de Inicio Retail**
  - `VibeHero.tsx`: Carrusel horizontal de promociones destacadas.
  - `VibeCategorias.tsx`: Chips de categorías con scroll horizontal.
  - `VibeRelampago.tsx`: Ofertas relámpago con temporizador.
  - `VibeReferidos.tsx`: Tarjeta con acción de compartir multiplataforma.

- [ ] **Paso 2: Implementar pantalla `(tabs)/inicio.tsx`**
  Integrar bloques modulares con soporte de pull-to-refresh (`RefreshControl`).

- [ ] **Paso 3: Implementar pantalla `(tabs)/qr.tsx` y `QrCodeCard.tsx`**
  Renderizado SVG del código QR seguro con selector de membresías activas.

- [ ] **Paso 4: Implementar pantallas `(tabs)/cuenta.tsx` y `(tabs)/menu.tsx`**
  Vistas de perfil, vehículos, historial de compras y directorio de categorías con logout.

---

### Tarea 7: Verificación Multiplataforma (Web & Móvil) y Reporte

**Archivos:**
- Verificación en terminal: `bun run typecheck`, `bunx expo export --platform web`, `bun test`

- [ ] **Paso 1: Ejecutar verificación de tipos TypeScript en todo el monorepo**
  ```powershell
  bun run typecheck
  ```
  Esperado: Cero errores de tipos.

- [ ] **Paso 2: Ejecutar exportación de producción web de Expo**
  ```powershell
  cd apps/client; bunx expo export --platform web; cd ../..
  ```
  Esperado: Bundle web generado exitosamente en `apps/client/dist`.

- [ ] **Paso 3: Ejecutar pruebas unitarias**
  ```powershell
  bun test tests/api-cliente-bff.test.ts
  ```
  Esperado: Todos los tests pasando.

- [ ] **Paso 4: Verificación manual en navegador**
  Ejecutar:
  ```powershell
  cd apps/client; bunx expo start --web
  ```
  Probar navegación, vista responsive móvil y desktop.

- [ ] **Paso 5: Confirmar que NO se han realizado commits**
  Ejecutar:
  ```powershell
  git status
  ```
  Verificar que los archivos permanezcan en working directory/untracked sin commitear, listos para la revisión del usuario.
