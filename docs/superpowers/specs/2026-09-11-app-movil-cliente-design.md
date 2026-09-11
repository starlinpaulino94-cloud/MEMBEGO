# Especificación de Diseño: App Universal de Clientes (Web + iOS + Android)

- **Fecha:** 2026-09-11
- **Estado:** Propuesta / En revisión (Actualizado a Universal Web + Mobile)
- **Ubicación:** `apps/client`

---

## 1. Contexto y Objetivos

### 1.1 Problema y Necesidad
MembeGo busca una experiencia unificada para sus clientes que funcione de forma consistente tanto en **aplicación móvil nativa (iOS y Android)** como en **aplicación web en el navegador (móviles y escritorio)**.

En lugar de mantener dos implementaciones desconectadas del portal de clientes, se adopta el modelo de **Aplicación Universal con Expo (Expo Router + React Native Web + NativeWind)**. Una sola base de código en `apps/client` se compila tanto a aplicaciones nativas de tiendas móviles como a una aplicación web moderna y reactiva.

### 1.2 Objetivos Clave
1. **Base de Código Universal:** Una única base de código en `apps/client` para Web, iOS y Android.
2. **Reutilización de Contratos y Modelos Tipados:** Importación directa de `@membego/contracts` y las definiciones de TypeScript de `@/types` (`MembershipEstado`, `InicioVista`, `PanelPersonal`, etc.).
3. **Fidelidad Visual y Tokens MDS:** Consumir los tokens de diseño de `packages/ui/src/tokens.ts` (escala primaria, degradados violeta Stitch, espaciados, radios y tipografía) mediante **NativeWind** (Tailwind universal).
4. **Diseño Adaptativo (Responsive):**
   - **Móvil (< 768px):** Dock inferior de 4 destinos canónicos (`BottomNavNative`).
   - **Escritorio / Tablet (≥ 768px):** Pestañas superiores horizontales y contenedor centrado, replicando el comportamiento de `CustomerShell`.
5. **Cero Impacto en el Core Web / Paneles Admin:** El Core Next.js actual mantiene intactos sus módulos de administración, CRM y facturación, actuando además como Backend For Frontend (API BFF) para los clientes.
6. **Autenticación Universal:** Supabase Auth con adaptador seguro automático: `expo-secure-store` en móvil nativo y `localStorage` / web cookies en navegadores.

---

## 2. Arquitectura del Sistema Universal

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

---

## 3. Estructura de Directorios (`apps/client`)

```text
apps/client/
├── app/                                # Expo Router Universal
│   ├── _layout.tsx                     # Providers globales (QueryClient, AuthContext, Theme)
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx                   # Pantalla de Login universal
│   │   └── recuperar.tsx               # Recuperación de contraseña
│   ├── (tabs)/                         # 4 Destinos Canónicos (Stitch S01)
│   │   ├── _layout.tsx                 # Layout Adaptativo: Bottom Dock en móvil, Header Tabs en Web desktop
│   │   ├── inicio.tsx                  # Inicio Retail (Hero, Categorías, Ofertas Relámpago)
│   │   ├── qr.tsx                      # Mi QR y selector de membresías
│   │   ├── cuenta.tsx                  # Perfil, Vehículos, Historial de visitas y Pagos
│   │   └── menu.tsx                    # Directorio de exploración, categorías y ayuda
│   ├── buscar.tsx                      # Modal / Vista de búsqueda unificada
│   ├── cerca.tsx                       # Mapa y exploración de comercios cercanos
│   └── membresia/
│       └── [id].tsx                    # Vista detallada de membresía o contrato
├── src/
│   ├── components/                     # Componentes universales (Web + Mobile)
│   │   ├── layout/
│   │   │   ├── HeaderVibe.tsx          # Cabecera con degradado violeta + buscador
│   │   │   ├── PillUbicacion.tsx       # Barra "Explorar cerca de ti"
│   │   │   ├── BottomTabDock.tsx       # Dock móvil (< md)
│   │   │   └── TabsEscritorio.tsx      # Pestañas de escritorio (≥ md)
│   │   ├── inicio/
│   │   │   ├── VibeHero.tsx            # Carrusel universal de banners destacados
│   │   │   ├── VibeCategorias.tsx      # Chips de categorías con scroll horizontal
│   │   │   ├── VibeRelampago.tsx       # Ofertas relámpago con cuenta regresiva en vivo
│   │   │   ├── VibeRelacionado.tsx     # Planes recomendados
│   │   │   └── VibeReferidos.tsx       # Banner "Invita y Gana" con Share multiplataforma
│   │   ├── qr/
│   │   │   ├── QrCodeCard.tsx          # Renderizado de QR (SVG en Web y Mobile)
│   │   │   └── MembershipBadge.tsx     # Estado de membresía con tokens de color MDS
│   │   └── ui/                         # Primitivas UI universales (Button, Card, Badge, Skeleton)
│   ├── lib/
│   │   ├── api.ts                      # Cliente HTTP (fetch con Bearer JWT)
│   │   ├── storage.ts                  # Adaptador de persistencia universal (SecureStore en nativo, localStorage en web)
│   │   ├── supabase.ts                 # Cliente Supabase universal
│   │   └── auth-context.tsx            # Estado de sesión de cliente
│   ├── hooks/                          # React Query hooks universales (useInicio, useQr, usePerfil)
│   └── theme/
│       └── tokens.ts                   # Re-export de tokens MDS para NativeWind
├── assets/                             # Logos, favicons, iconos y splash screen
├── app.json                            # Configuración Expo (esquema nativo y web PWA)
├── babel.config.js
├── metro.config.js                     # Configuración monorepo (watchFolders)
├── package.json                        # Expo SDK 52+, react-native-web, NativeWind v4
├── tailwind.config.js                  # Configuración Tailwind universal consumiendo tokens MDS
└── tsconfig.json                       # Configuración TypeScript apuntando a root types
```

---

## 4. Estrategia de Adaptabilidad Multiplataforma (Web + Mobile)

### 4.1 Persistencia de Autenticación
```typescript
// apps/client/src/lib/storage.ts
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

export const universalStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null
    }
    return SecureStore.getItemAsync(key)
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') localStorage.setItem(key, value)
      return
    }
    await SecureStore.setItemAsync(key, value)
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') localStorage.removeItem(key)
      return
    }
    await SecureStore.deleteItemAsync(key)
  },
}
```

### 4.2 Navegación Responsiva
- **En pantallas pequeñas (Mobile < 768px):** Se activa el dock inferior fijo (`BottomTabDock`) con altura calculada respetando los `safe-area-insets` del dispositivo.
- **En pantallas medianas y grandes (Web Desktop/Tablet ≥ 768px):** El dock inferior se oculta (`md:hidden`), y se muestra una barra de navegación superior con pestañas (`TabsEscritorio`) y un ancho máximo centrado (`max-w-xl md:max-w-2xl lg:max-w-4xl`), garantizando que la interfaz mantenga proporciones elegantes sin romperse en monitores ultra-anchos.

### 4.3 Manejo de APIs Nativas vs Web
| Capacidad | En Móvil Nativo (iOS / Android) | En Navegador Web |
| :--- | :--- | :--- |
| **Generación QR** | `react-native-qrcode-svg` | Renderizado SVG nativo idéntico |
| **Compartir enlace** | `Share.share({ message, url })` | `navigator.share` o copiar al portapapeles |
| **Geolocalización** | `expo-location` con permisos nativos | `navigator.geolocation` estándar HTML5 |
| **Haptic Feedback** | `expo-haptics` (vibración sutil) | No-op seguro |
| **Brillo en QR** | `expo-brightness` (sube al máximo) | No-op seguro |

---

## 5. Capa API BFF en Next.js (`src/app/api/v1/cliente/*`)

La capa API central en Next.js atiende indistintamente solicitudes provenientes de la Web o de la App Móvil:

| Endpoint | Método | Descripción | Salida Tipada |
| :--- | :--- | :--- | :--- |
| `/api/v1/cliente/inicio` | `GET` | Vitrina comercial + panel personal | `{ comercial: InicioVista, personal: PanelPersonal }` |
| `/api/v1/cliente/qr` | `GET` | Token dinámico de carnet y membresías | `{ qrPayload: string, memberships: Array<...> }` |
| `/api/v1/cliente/perfil` | `GET` | Datos de cuenta, vehículos e historial | `{ perfil: ClientePerfil, vehiculos: Vehiculo[] }` |
| `/api/v1/cliente/menu` | `GET` | Categorías y módulos disponibles | `{ categorias: Categoria[], filas: FilaNav[] }` |
| `/api/v1/cliente/buscar` | `GET` | Buscador unificado en tiempo real | `{ resultados: ResultadoBusqueda[] }` |

### 5.1 Seguridad y CORS / Headers
- Autenticación homogénea con cabecera `Authorization: Bearer <jwt>` emitida por Supabase.
- Verificación estricta del rol `CLIENTE` en cada endpoint.
- Soporte para peticiones del mismo origen (Web) y desde la app móvil.

---

## 6. Plan de Verificación y Calidad

### 6.1 Pruebas Automatizadas
1. **Typecheck Universal:** `npm run typecheck` en el monorepo asegurando que `apps/client` compila con cero errores contra `@membego/contracts` y `@/types`.
2. **Build Web de Expo:** `npx expo export --platform web` para verificar compilación de bundle web de producción sin errores de empaquetado.
3. **Tests de API BFF:** Pruebas unitarias de los endpoints en `tests/api-mobile-cliente.test.ts`.

### 6.2 Verificación Manual
1. **Ejecución Web:** `npx expo start --web` -> Abrir en navegador y probar flujos de Inicio, QR, Cuenta y Menú en vista móvil y vista escritorio.
2. **Ejecución Móvil:** `npx expo start` -> Abrir en Expo Go en iOS / Android y validar experiencia táctil, pull-to-refresh y generación de QR.
