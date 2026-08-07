# Plan de Geolocalización, Mapa Interactivo y Campañas Geosegmentadas — MembeGo

**Fecha:** 2026-08-06
**Estado:** propuesta (análisis previo a implementación — sin cambios de código)
**Alcance:** registro de ubicación del cliente, descubrimiento de ofertas cercanas, mapa interactivo, sucursales geolocalizadas, campañas segmentadas por ubicación, consentimiento y privacidad.
**Base:** auditoría del modelo actual contra la especificación (secciones 1-43 del requerimiento).

---

## 0. Resumen ejecutivo

MembeGo hoy es una plataforma multiempresa con marketplace social (seguir, guardar, reseñar), motor de campañas de marketing y módulos comerciales maduros, pero **sin ninguna capa geoespacial real**:

- No existe país/región/ciudad/sector normalizados.
- `Company`, `Cliente` y `Sucursal` guardan ubicación como **texto libre** o no la guardan.
- Solo `Company` tiene `latitud`/`longitud` opcionales, capturadas con un selector de mapa (Leaflet + OSM) en el perfil público del admin.
- Las campañas (`MarketingCampaign`) no tienen segmentación de audiencia: se muestran a todos los clientes de la empresa.
- No hay PostGIS, ni índices espaciales, ni consultas por proximidad.

La propuesta construye el sistema por capas sobre lo existente, sin romper nada:

1. **Fundamentos geográficos**: tablas `Country`, `Region`, `City`, `Sector` + PostGIS en sucursales y ubicaciones de cliente.
2. **Onboarding de ubicación**: pasos opcionales (país → ciudad → sector → vivienda en mapa) dentro del asistente de registro existente, nunca obligatorios.
3. **Mapa interactivo**: módulo de cliente "Cerca de mí" con Leaflet + clustering + listas sincronizadas + consultas geoespaciales reales en servidor.
4. **Campañas geosegmentadas**: constructor visual de segmentos (ciudad, sector, radio, condiciones combinadas) reutilizando el patrón de condiciones del Rule Engine.
5. **Privacidad**: consentimientos separados (funcional vs. marketing), sin GPS obligatorio, sin seguimiento continuo, sin exposición de coordenadas a las empresas.

**Decisiones de arquitectura que marcan todo el diseño** (detalle en cada sección):

| # | Decisión | Recomendación | Por qué |
|---|----------|---------------|---------|
| G-1 | Ubicación de persona atada a | `User` (dbUserId), no a `Cliente` | Una vivienda no depende de la empresa; `UserInteres`, `CompanyFollow`, `PromocionGuardada` ya usan `User` para lo cross-empresa. |
| G-2 | Rendering del mapa | **Leaflet + tiles OSM** (ya instalado y en CSP), con `Leaflet.markercluster` | Costo cero, sin API key, ya probado en `MapaUbicacion.tsx`. Capa de abstracción para migrar a vector tiles si hace falta. |
| G-3 | Geocodificación / autocompletado / reverso | **Geoapify** como primario (permite almacenar coordenadas), Nominatim público como fallback dev; Mapbox/Google documentados como ruta de upgrade | Se **deben almacenar coordenadas** (sucursales + vivienda): el "Temporary Geocoding" de Mapbox lo prohíbe y su "Permanent Geocoding" es otro SKU; Google es caro y restrictivo. Geoapify lo permite, es barato y OSM-based (buena cobertura en RD). |
| G-4 | Geoespacial en BD | **PostGIS** (`geography(Point,4326)` + GiST) con patrón Prisma "columnas Float + columna PostGIS sincronizada por trigger" | Supabase lo habilita gratis; consultas `ST_DWithin`/`ST_Distance`/viewport escalables. Prisma no modela `geography` → se sincroniza por trigger desde lat/lng. |
| G-5 | Segmentos | Modelos `SavedSegment`/`SegmentCondition` nuevos, con la **misma forma** que `RuleCondition`/`RuleConditionGroup` (campo+operador+valor y árbol AND/OR/NOT) | Reutiliza la mentalidad del Rule Engine sin acoplarlo; UI visual, no técnica. |
| G-6 | Campañas dirigidas | Modelo nuevo `CampanaDirigida` (+ snapshots de audiencia y entregas). NO reescribir `MarketingCampaign` | `MarketingCampaign` es el banner "vivo en home" sin audiencia ni canales; `Campana` agrupa promos; `CampanaGlobal` replica ofertas entre empresas. Ninguno sirve. |

---

## 1. Análisis del modelo de ubicación actual

### 1.1 Estado por modelo

| Modelo | Campos de ubicación | ¿Coordenadas? | ¿Normalizado? | Uso actual |
|--------|---------------------|---------------|---------------|------------|
| `Company` | `ciudad`, `provincia`, `pais` (texto), `direccion`, `codigoPostal`, `latitud`, `longitud`, `zonaCobertura`, `googleMapsUrl` | `lat`/`lng` opcionales (Float) | No (texto libre) | Perfil público (vitrina), dirección en cards, selector de mapa en `/admin/perfil`. |
| `Sucursal` | `direccion` (texto), `telefono` | **No** | No | Escáner (de dónde se registra la visita), caja, citas, compras POS, cola de vehículos. Sin mapa. |
| `Cliente` | `ciudad` (texto, campo único F5/onboarding B2C) | No | No | Perfil; sin filtros ni segmentación real. |
| `User` | — | No | No | Identidad + consentimientos (`termsAcceptedAt`, `termsVersion`, `marketingConsent`, `marketingConsentAt`). |
| `Vehiculo` | `pais` (ISO 3166-1 alfa-2, default `DO`) | No | Sí (pais) | Identidad de placa (`pais+placaNormalizada` único). |
| `Plan`/`Membership`/`Visit`/`ProductoCompra` | `sucursalPagoId` (en compra POS) | No | FK a sucursal | Relación operativa, no geográfica. |

### 1.2 Lo que ya existe y se puede reutilizar

- **Selector de mapa**: `src/components/admin/MapaUbicacion.tsx` — Leaflet + OSM, pin arrastrable, `locateMe`, emite lat/lng. Patrón a generalizar.
- **CSP**: los tiles de OSM ya están permitidos (ver el comentario en `MapaUbicacion.tsx`).
- **Identidad de placa/pais**: patrón "normalizado + texto de respaldo" (`placaNormalizada` + `pais`), exactamente el patrón que la spec pide para geografía (§30): identificador normalizado + texto original + estado de verificación.
- **Consentimientos de `User`**: `marketingConsent`/`marketingConsentAt` ya establecen la separación funcional vs. marketing en la cuenta; falta el consentimiento geo.
- **Multi-tenant + RLS**: `conEmpresa`/`sinEmpresa` (`src/lib/tenant.ts`) con `set_config('app.company_id'|'app.omnisciente')`; RLS por empresa en `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`. Las tablas geo heredan este patrón.
- **Rule Engine**: `RuleCondition`/`RuleConditionGroup` con `RuleLogicalOperator` (AND/OR/NOT/XOR) y operadores extensibles (`eq`, `gte`, `in`, …) — la base conceptual del constructor de segmentos.
- **Cola de trabajos**: `src/modules/jobs/cola.ts` (QStash) — ya se usa para el fan-out de notificaciones (`notificarClientesEmpresa`); el envío de campañas lo reutiliza.
- **Notificaciones in-app**: `src/modules/notificaciones/service.ts` (crearNotificacion, notificarAdmins, encolarFanOut).
- **Rate limiting**: `registerLimiter` (`src/lib/rate-limit.ts`, Upstash Redis) — reutilizable para el control de abuso del geocoding.
- **Caché**: `unstable_cache` (Next) y `lru-cache` (ya en dependencias) — para geocodificación y consultas frecuentes.
- **Asistente de registro**: `src/components/auth/AsistenteRegistro.tsx` (una pregunta por pantalla, sessionStorage como borrador, validación por paso, consentimientos al final) — el lugar donde entra la etapa de ubicación.
- **Flujos declarativos**: `src/modules/onboarding/flujos.ts` (`FLUJOS_ONBOARDING`, `flujoParaCategoria`, `flujoRequiereVehiculo`) — patrón a extender con un paso de ubicación.
- **Categorías de negocio**: `src/modules/capacidades/catalogo.ts` (`CategoriaNegocio`, `capacidadesEfectivas`) — para el módulo de capacidades `GEO` si se quiere togglear el mapa por empresa.
- **Enums de carwash**: `Servicio`, `TipoVehiculo`, `MetodoPago` — para los atributos de sucursal (servicios, métodos de pago) sin crear tablas nuevas si aplican por empresa.

### 1.3 Vacíos estructurales

1. No hay jerarquía geográfica (país → región → ciudad → sector) ni catálogo normalizado.
2. Las sucursales no tienen coordenadas, ni sector/ciudad, ni radio de servicio, ni presencia en mapa.
3. La ubicación del cliente es texto libre en `Cliente.ciudad`; no hay vivienda guardada ni ubicaciones múltiples.
4. No existe consentimiento de ubicación separado (funcional vs. marketing).
5. No existen consultas geoespaciales (PostGIS ausente; sin índices).
6. Las campañas no tienen segmentación por audiencia ni canales.
7. No hay módulo de mapa de cliente ni secciones "cerca de ti" en el inicio.

---

## 2. Inventario de tablas y componentes reutilizables

### 2.1 Tablas (Prisma) — resumen de lo relevante

| Archivo (`prisma/schema/`) | Modelos clave | Relación con la propuesta |
|---------------------------|---------------|---------------------------|
| `identidad.prisma` | `User`, `Company`, `Sucursal`, `AuditLog`, `Notificacion`, `UserCompanyAccess`, `Invitacion` | `Sucursal` se amplía con geo; `User` gana consentimientos geo; `AuditLog` audita cambios de ubicación. |
| `clientes.prisma` | `Cliente`, `Vehiculo`, `ClienteNota`, `UserInteres` | `Cliente` referencia ubicación vía `User`; `UserInteres` alimenta "recomendaciones por categorías de interés". |
| `membresias.prisma` | `Plan`, `Membership`, `QrToken`, `Visit` | `Visit`/`Membership` se usan para "historial de visitas", "membresía activa/vencida" en segmentación. |
| `promociones.prisma` | `Promocion`, `ProductoCompra`, `CompanyPost`, `Campana` | Ofertas "activas y vigentes" en mapa; `ProductoCompra` = "promoción adquirida". |
| `marketplace.prisma` | `BusinessCategory`, `CompanyToCategory`, `CompanyFollow`, `PromocionGuardada`, `CompanyRating` | Filtros por categoría; "sigue/guardó" para recomendaciones; calificaciones reales. |
| `campanas.prisma` | `MarketingCampaign`, `OfertaPrivada`/`OfertaInvitado`/`OfertaUso`, `CampanaGlobal`/`CampanaPaso`/`CampanaInscripcion` | Referencia para el modelo `CampanaDirigida`; `OfertaPrivada` = ofertas por lista cerrada. |
| `motores.prisma` | `Rule`, `RuleCondition`, `RuleConditionGroup`, `Automation`, `Benefit`, `Promotion`, `MembershipPlan` | Patrón de condiciones para el constructor de segmentos. |
| `caja.prisma` / `carwash.prisma` / `citas.prisma` | `MetodoPago`, `Servicio`, `Bahia`, `Cita`, `ColaVehiculo` | Atributos opcionales de sucursal. |

### 2.2 Módulos (`src/modules/`) y componentes reutilizables

| Pieza | Ubicación | Reutilización |
|-------|-----------|---------------|
| `MapaUbicacion` | `src/components/admin/MapaUbicacion.tsx` | Base del selector de pin; generalizar con geocodificación y confirmación. |
| `AsistenteRegistro` | `src/components/auth/AsistenteRegistro.tsx` | Insertar pasos de ubicación (opcionales). |
| `flujos.ts` / `vehiculo.ts` / `marcas.ts` | `src/modules/onboarding/` | Patrón de pasos declarativos + validadores por paso. |
| `WizardCliente` / `getOnboardingCliente` | `src/components/onboarding/`, `src/modules/social/queries.ts` | Añadir ítem "Mi ubicación" al checklist B2C. |
| `ProfileForm` / `cliente/perfil` | `src/components/cliente/ProfileForm.tsx`, `src/app/(cliente)/cliente/perfil/page.tsx` | Sección "Mi ubicación" y "Privacidad y consentimientos" en el perfil. |
| `MarketingCampaignForm` | `src/components/engagement/MarketingCampaignForm.tsx` | Estructura de formulario de campaña; el de segmentación lo extiende (no lo reemplaza). |
| `getCampanasVivas` / `campanas.ts` | `src/modules/engagement/` | Motor de "campañas vivas" para filtrar por segmento. |
| `getPromoFeed` | `src/modules/social/queries.ts` | Base de "Ofertas cerca de ti" (añadir filtro geo + distancia). |
| `getNovedadesInicio` / `DescubreMas` | `social/queries.ts`, `components/cliente/DescubreMas.tsx` | Secciones del inicio. |
| `conEmpresa`/`sinEmpresa` | `src/lib/tenant.ts` | Multi-tenant de todas las tablas geo y de segmentación. |
| `encolar` / `jobs/cola.ts` | `src/modules/jobs/cola.ts` | Envío de campañas (fan-out por lotes). |
| `crearNotificacion` / `notificarAdmins` | `src/modules/notificaciones/service.ts` | Canal in-app de campañas. |
| `registerLimiter` | `src/lib/rate-limit.ts` | Protección de geocoding y endpoints del mapa. |
| `unstable_cache` / `lru-cache` | Next + deps | Caché de geocodificación y de "sucursales en viewport". |
| `formatMoney`/`formatDate` + `getRegionalPrefs` | `src/lib/format.ts`, `src/modules/empresas/regional.ts` | Formateo por empresa (distancia, moneda) en cards. |
| `capacidadesEfectivas` / `CAPACIDAD_DE_SECCION` | `src/modules/capacidades/catalogo.ts` | Capacidad `GEO`/`MAPA` para togglear el módulo por empresa. |
| Nav del cliente | `src/modules/cliente/navDisponible.ts` | Ocultar/mostrar "Cerca de mí" según haya sucursales con coordenadas y ofertas. |

### 2.3 RLS y migraciones

- RLS por empresa: `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`.
- Patrón de migración: `prisma/migrations/<fecha>_<slug>/migration.sql` + SQL manual en `prisma/migrations_manual/` para extensiones (PostGIS) y cosas que Prisma no gestiona (políticas RLS, triggers).

---

## 3. Propuesta del modelo de datos

### 3.1 Catálogo geográfico normalizado

Modelos nuevos en `prisma/schema/geo.prisma`:

```prisma
// ── Catálogo geográfico normalizado (país → región → ciudad → sector) ──
model Country {
  id          String   @id @default(cuid())
  isoCode     String   @unique // ISO 3166-1 alfa-2, ej. "DO"
  name        String
  // Etiqueta del campo de 2º nivel, ej. "Provincia" | "Estado" | "Departamento" | "Región".
  regionLabel String
  isOperative Boolean  @default(true) // países donde opera MembeGo
  createdAt   DateTime @default(now())

  regions Region[]

  @@map("geo_countries")
}

model Region {
  id        String  @id @default(cuid())
  countryId String
  country   Country @relation(fields: [countryId], references: [id], onDelete: Cascade)
  name      String
  // Nombre normalizado (sin tildes/mayúsculas) para búsquedas y segmentación.
  normalizedName String
  isOperative    Boolean @default(true)

  cities City[]

  @@unique([countryId, normalizedName])
  @@index([countryId, isOperative])
  @@map("geo_regions")
}

model City {
  id             String  @id @default(cuid())
  regionId       String
  region         Region  @relation(fields: [regionId], references: [id], onDelete: Cascade)
  name           String
  normalizedName String
  isOperative    Boolean @default(true)

  sectors Sector[]

  @@unique([regionId, normalizedName])
  @@index([regionId, isOperative])
  @@index([normalizedName])
  @@map("geo_cities")
}

model Sector {
  id             String  @id @default(cuid())
  cityId         String
  city           City    @relation(fields: [cityId], references: [id], onDelete: Cascade)
  name           String
  normalizedName String
  // Punto de referencia aproximado del sector (para centrar el mapa).
  latitud        Float?
  longitud       Float?
  isVerified     Boolean @default(false) // confirmado con datos oficiales/OSM
  isOperative    Boolean @default(true)

  @@unique([cityId, normalizedName])
  @@index([cityId, isOperative])
  @@map("geo_sectors")
}
```

**Principios** (§30):
- `normalizedName` (mayúsculas, sin tildes) es la clave de segmentación → evita variaciones ortográficas ("Bávaro" vs "BAVARO").
- El texto original vive en las tablas de uso (`Sucursal.formattedAddress`, `CustomerLocation.formattedAddress`) como respaldo.
- Los catálogos se **siembran** (seed) con datos reales de RD (ver §11); nunca se hardcodean en componentes.
- Permiten "escribir manualmente cuando no exista" (ciudad/sector) con un `isVerified: false` y un flujo de revisión por superadmin.

### 3.2 Ubicaciones del cliente (multi-ubicación)

```prisma
enum CustomerLocationType { HOME WORK OTHER }
enum CustomerLocationSource {
  MANUAL
  MAP_SELECTION
  GEOCODED_ADDRESS
  DEVICE_LOCATION
  ADMIN_ASSIGNED
}
enum LocationVerificationStatus {
  UNVERIFIED // solo ciudad/sector
  CONFIRMED  // con coordenadas aproximadas y verificación visual
}

model CustomerLocation {
  id                 String @id @default(cuid())
  // G-1: la ubicación es de la PERSONA (cross-empresa), por eso cuelga de User.
  userId             String
  user               User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  label              String? // "Casa", "Trabajo", "Otra"
  type               CustomerLocationType @default(HOME)

  countryId          String?
  country            Country? @relation(fields: [countryId], references: [id], onDelete: SetNull)
  regionId           String?
  region             Region?  @relation(fields: [regionId], references: [id], onDelete: SetNull)
  cityId             String?
  city               City?    @relation(fields: [cityId], references: [id], onDelete: SetNull)
  sectorId           String?
  sector             Sector?  @relation(fields: [sectorId], references: [id], onDelete: SetNull)

  // Textos originales como respaldo (regla §30).
  regionNameRaw      String? // texto original de provincia/estado
  cityNameRaw        String?
  sectorNameRaw      String?

  formattedAddress   String? // dirección de referencia (avenida, #, residencial, punto de referencia)
  latitud            Float?  // aproximada (fuente MAP_SELECTION / GEOCODED_ADDRESS / DEVICE_LOCATION)
  longitud           Float?
  // PostGIS (ver §6): columna sincronizada por trigger, no la gestiona Prisma.

  isPrimary          Boolean @default(false)
  source             CustomerLocationSource
  verificationStatus LocationVerificationStatus @default(UNVERIFIED)
  // Separación de consentimientos (§33): guardar la vivienda ≠ usarla para campañas.
  consentForPersonalization Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, isPrimary])
  @@index([cityId])
  @@index([sectorId])
  @@map("customer_locations")
}
```

**Decisiones:**
- **Multi-ubicación desde el día 1**: `isPrimary` (una sola primaria por usuario, validado en servicio) permite HOME/WORK/OTHER sin migración posterior.
- **Alcance de precisión**: se guardan coordenadas aproximadas solo cuando el usuario las confirma (mapa) o las declara; si solo da ciudad/sector, `verificationStatus = UNVERIFIED` y sin coordenadas.
- **Las empresas jamás leen esta tabla** (ver §7.7): la segmentación entrega agregados e IDs, no coordenadas.

### 3.3 Sucursales geolocalizadas

Ampliar `Sucursal` (en `identidad.prisma`) con geo + presencia en mapa:

```prisma
model Sucursal {
  // ... campos existentes (id, companyId, nombre, direccion, telefono, activa) ...

  // Normalizado (regla §30)
  countryId String?
  regionId  String?
  cityId    String?
  sectorId  String?
  // Textos originales como respaldo
  ciudadTexto    String?
  sectorTexto    String?
  latitud        Float?
  longitud       Float?
  // PostGIS: columna sincronizada por trigger (§6).

  // Publicación en el mapa y radio de servicio
  mostrarEnMapa      Boolean @default(true)
  radioServicioKm    Int?    // radio de atención (segmentación por radio, §25)
  ubicacionVerificada Boolean @default(false) // coordenadas validadas visualmente por el admin (§8)
  ubicacionActualizadaAt DateTime?
  horarioDetallado   Json?  // horario estructurado (reemplaza/amplía el texto libre de Company.horario)

  @@index([companyId, activa, mostrarEnMapa])
  @@index([cityId])
  @@index([sectorId])
}
```

**Regla de visibilidad pública (§7)**: una sucursal **no** aparece en el mapa si falta `latitud`/`longitud`, está inactiva, la empresa está suspendida/no publicada (`isPublished:false`), `mostrarEnMapa=false`, o la empresa es de demostración (`esDemo`). Esto se centraliza en `NearbyBusinessService`, no en cada pantalla.

**Atributos de sucursal** (imagen, servicios, métodos de pago, tipos de negocio, indicador de ofertas):
- **MVP**: se heredan de la empresa (`Company.logoUrl`, `Company.galleryImages`, categorías vía `CompanyToCategory`, `MetodoPago` de la empresa, ofertas activas = `Promocion.activo && vigente && sucursalPagoId match` cuando aplique). No se duplican en sucursal salvo que un negocio lo pida explícitamente (fase 4/6).
- **Futuro**: `SucursalServicio`, `SucursalImagen`, `SucursalMetodoPago` cuando una empresa real necesite diferenciar por sucursal.

### 3.4 Consentimiento de ubicación

```prisma
enum GeoConsentTipo {
  // Funcional: usar ubicación (actual o guardada) para mostrar negocios cercanos.
  FUNCTIONAL_USAGE
  // Guardar vivienda/ubicaciones en el perfil.
  HOME_STORAGE
  // Marketing: usar ciudad/sector/radio para personalizar campañas.
  MARKETING_GEO
  // Sesión puntual: usar la ubicación GPS actual SOLO para esta búsqueda.
  DEVICE_LOCATION_SESSION
}
enum GeoConsentEstado { ACTIVE REVOKED }

model GeoConsent {
  id          String          @id @default(cuid())
  userId      String
  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  tipo        GeoConsentTipo
  estado      GeoConsentEstado @default(ACTIVE)
  version     String          // versión del texto aceptado (ej. "1.0")
  canal       String          // "onboarding" | "perfil" | "mapa" | "campana"
  grantedAt   DateTime        @default(now())
  revokedAt   DateTime?
  ipAddress   String?
  userAgent   String?

  @@unique([userId, tipo])
  @@index([userId, estado])
  @@map("geo_consents")
}
```

- **Un registro por tipo por usuario** (única activa por tipo); revocar = marcar `REVOKED` con `revokedAt` (auditoría).
- Separación estricta funcional vs. marketing (§33): `MARKETING_GEO` nunca se asume de `FUNCTIONAL_USAGE` ni del `marketingConsent` general.

### 3.5 Segmentos y campañas dirigidas

```prisma
// ── Segmentos guardados (constructor de audiencias) ──
enum SegmentoEstado { BORRADOR ACTIVO ARCHIVADO }

model SavedSegment {
  id          String         @id @default(cuid())
  companyId   String
  company     Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name        String
  description String?
  createdById String?
  estado      SegmentoEstado @default(BORRADOR)
  // Regla §24: la audiencia se recalcula al ejecutar; no se guarda lista estática.
  ultimaAudienciaEstimada Int?
  ultimaEvaluacionAt      DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  conditions SegmentCondition[]
  campaigns  CampanaDirigida[]

  @@index([companyId, estado])
  @@map("saved_segments")
}

// Mismo patrón que RuleCondition/RuleConditionGroup (§G-5): campo + operador +
// valor y árbol AND/OR/NOT con anidamiento.
model SegmentCondition {
  id        String            @id @default(cuid())
  segmentId String
  segment   SavedSegment      @relation(fields: [segmentId], references: [id], onDelete: Cascade)
  groupId   String?
  group     SegmentConditionGroup? @relation(fields: [groupId], references: [id], onDelete: Cascade)
  campo     String  // dot-path del contexto de segmentación, ej. "cliente.ubicacion.sectorId"
  operador  String  // "eq" | "in" | "radius" | "within_region" | "has_membership" | ...
  valor     Json    @default("{}")
  orden     Int     @default(0)
  createdAt DateTime @default(now())

  @@index([segmentId, orden])
  @@map("segment_conditions")
}

model SegmentConditionGroup {
  id       String                  @id @default(cuid())
  segmentId String
  segment  SavedSegment            @relation(fields: [segmentId], references: [id], onDelete: Cascade)
  parentId String?
  parent   SegmentConditionGroup?  @relation("SegmentGroupTree", fields: [parentId], references: [id], onDelete: Cascade)
  children SegmentConditionGroup[] @relation("SegmentGroupTree")
  operator String                  @default("AND") // AND | OR | NOT
  orden    Int                     @default(0)

  conditions SegmentCondition[]

  @@map("segment_condition_groups")
}

// ── Campañas dirigidas (audiencia + canales + entregas) ──
enum CampanaDirigidaEstado { BORRADOR PROGRAMADA ACTIVA PAUSADA FINALIZADA }
enum CampanaCanal { IN_APP EMAIL PUSH_FUTURO }

model CampanaDirigida {
  id          String                 @id @default(cuid())
  companyId   String
  company     Company                @relation(fields: [companyId], references: [id], onDelete: Cascade)
  segmentId   String?
  segment     SavedSegment?          @relation(fields: [segmentId], references: [id], onDelete: SetNull)
  nombre      String
  mensaje     String                 @db.Text
  canales     CampanaCanal[]         // canales habilitados
  programadaEn DateTime?
  estado      CampanaDirigidaEstado  @default(BORRADOR)
  // Controles de frecuencia (§28)
  maxPorDia   Int? @default(1)
  maxPorSemana Int? @default(2)
  prioridad   Int  @default(0)
  // Sucursal/radio para campañas por radio (§25): null = no geográfica.
  sucursalId  String?
  sucursal    Sucursal?              @relation(fields: [sucursalId], references: [id], onDelete: SetNull)
  radioKm     Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  snapshots CampanaAudienciaSnapshot[]
  entregas  CampanaEntrega[]

  @@index([companyId, estado])
  @@map("campanas_dirigidas")
}

// Instantánea de audiencia calculada al programar/activar (§23, §24).
model CampanaAudienciaSnapshot {
  id          String          @id @default(cuid())
  campanaId   String
  campana     CampanaDirigida @relation(fields: [campanaId], references: [id], onDelete: Cascade)
  // Números agregados (§23) — nunca listas de personas.
  totalElegibles Int
  totalExcluidos Int
  sinConsentimiento Int
  porCiudad    Json            @default("{}") // { cityId: count }
  porSector    Json            @default("{}")
  advertencias Json            @default("[]") // audiencia pequeña/grande, sin canal, etc.
  calculadaAt  DateTime        @default(now())

  @@index([campanaId])
  @@map("campana_audiencia_snapshots")
}

// Entrega a un cliente (fan-out en lotes vía jobs/cola).
model CampanaEntrega {
  id          String          @id @default(cuid())
  campanaId   String
  campana     CampanaDirigida @relation(fields: [campanaId], references: [id], onDelete: Cascade)
  clienteId   String
  canal       CampanaCanal
  estado      String          @default("PENDIENTE") // PENDIENTE | ENVIADA | FALLIDA | EXCLUIDA
  motivoExclusion String?
  enviadaAt   DateTime?
  createdAt   DateTime        @default(now())

  @@index([campanaId, estado])
  @@index([clienteId])
  @@map("campana_entregas")
}

// Evento de búsqueda en el mapa (analítica agregada, §35) — nunca recorridos.
model LocationSearchEvent {
  id          String   @id @default(cuid())
  userId      String?
  contexto    String   // "CURRENT" | "HOME" | "MANUAL"
  countryId   String?
  cityId      String?
  sectorId    String?
  latitud     Float?   // aproximada, se redondea (≈1km) para métricas
  longitud    Float?
  radioKm     Int?
  filtros     Json     @default("{}")
  resultCount Int      @default(0)
  createdAt   DateTime @default(now())

  @@index([contexto, createdAt])
  @@index([cityId, createdAt])
  @@map("location_search_events")
}
```

**Nota de nomenclatura** (aplica `docs/GUIA_LENGUAJE_MEMBEGO.md`): hay tres modelos "campaña" ya existentes (`Campana`, `CampanaInvitacion`, `MarketingCampaign`) y uno global (`CampanaGlobal`). El nuevo se llama `CampanaDirigida` para no colisionar conceptualmente y porque su esencia es **audiencia dirigida**.

### 3.6 Qué NO se toca

- `MarketingCampaign` (banners del home) se mantiene intacto.
- `Campana` (agrupador de promos/posts) intacto.
- `CampanaGlobal`/`CampanaPaso` (replica entre empresas) intactos.
- El motor de compras/QR/visitas intacto.
- `Company` conserva sus campos de texto (migrar su `latitud/longitud` a una sucursal, ver §11).

---

## 4. Proveedor de mapas — decisión y comparación

### 4.1 Comparación (datos de referencia, verificar al contratar — julio 2026)

| Criterio | Google Maps Platform | Mapbox | Geoapify | Nominatim (OSM público) |
|----------|---------------------|--------|----------|-------------------------|
| **Rendering (mapa interactivo)** | Maps JS $7/1K cargas | GL JS: 50K cargas/mes gratis, luego ~$3–5/1K | Mapas $2/1K (capa gratuita ~3K créditos/día) | Tiles OSM **gratis** (uso razonable) vía Leaflet |
| **Geocoding** | $5/1K (SKU Essentials) | Temp: 100K/mes gratis, luego ~$0.75–5/1K | desde ~$0.03–0.13/1K; gratis ~3K/día | Gratis, límite de uso estricto (≈1 req/s, sin SLA) |
| **Autocompletado de direcciones** | Places (excelente) | Search Box (incluido) | Autocomplete (incluido) | **No** (sin endpoint de autocomplete para producción) |
| **Reverse geocoding** | Sí | Sí | Sí | Sí (limitado) |
| **¿Permite ALMACENAR coordenadas?** | Restringido (política de caché) | Temp: **NO**; Permanent: otro SKU (caro) | **Sí** (ODbL con atribución) | Datos ODbL; uso propio ok con atribución |
| **Calidad RD** | Muy alta (POI + datos oficiales) | Buena en ciudades (OSM + gov) | Buena en ciudades (OSM) | Buena en ciudades (OSM), variable en rural |
| **Clustering de marcadores** | Vía libs externas | Vía libs externas | Vía libs externas | Leaflet.markercluster (gratis) |
| **Personalización visual** | Media | Muy alta (Studio) | Media (estilos) | Baja (raster OSM) / alta con vector tiles |
| **Rendimiento móvil** | Bien | Muy bien | Bien (OSM) | Bien (tiles raster) |
| **Licencia** | ToS restrictivo (usar con mapas de Google) | Temp=no almacenar; requiere TC | OSM ODbL + atribución | OSM ODbL + atribución |
| **Escalabilidad** | Alta | Alta | Alta | Pública: limitada; self-host: alta |
| **Protección de claves** | API key en frontend (restringir por referer) | Access token frontend (scoped + URL) | API key frontend (restringir dominio) | Sin clave |
| **Compatibilidad Next.js** | SDK oficial | GL JS/MapLibre | Leaflet/MapLibre | Leaflet (ya usado) |
| **Costo mensual estimado (lanzamiento)** | ~$0–50 (con credit) → alto al escalar | ~$0 (free tier) pero TC de almacenamiento | ~$0 (free tier) | $0 |

### 4.2 Decisión G-2/G-3

**Rendering: Leaflet + tiles OSM** (ya instalado y funcionando en `MapaUbicacion.tsx`, tiles ya en la CSP). Añadir `leaflet.markercluster` para agrupación. Mantener un wrapper `MapProvider` (`src/components/geo/`) para que, si se necesita personalización visual pesada, se pueda migrar a **MapLibre + vector tiles** (MapTiler) sin reescribir las pantallas.

**Geocodificación/autocompletado/reverso: Geoapify** como proveedor primario:
- El requisito central de esta feature es **almacenar las coordenadas** de sucursales y vivienda. El "Temporary Geocoding" de Mapbox lo prohíbe explícitamente y obliga a un SKU "Permanent" aparte. Google restringe el caché de resultados. Geoapify permite almacenarlo bajo ODbL con atribución.
- OSM-based → buena cobertura en ciudades dominicanas (Santo Domingo, Santiago, Punta Cana/Bávaro) que es donde operan los negocios Membego.
- Free tier generoso (~3.000 créditos/día: geocoding, autocomplete y routing suman) cubre el lanzamiento: la geocodificación es un evento de admin (registrar sucursal) o del cliente (confirmar vivienda), no una llamada por usuario.
- Autocompletado incluido → base para el buscador de direcciones del admin (§8) y para "seleccionar otra zona".

**Fallback / dev: Nominatim público** con `User-Agent` propio, rate-limit estricto (≈1 req/s), caché `lru-cache`/tabla y solo para casos puntuales (proveedor caído). Nunca para autocomplete en producción.

**Ruta de upgrade documentada**: si en RD la calidad del geocoding de OSM/Geoapify resulta insuficiente para un admin real (prueba de muestra de 100 direcciones antes de decidir, ver metodología en §4.3), migrar a **Mapbox Search** manteniendo la interfaz `GeocodingService` (la capa de abstracción evita acoplamiento, §43).

### 4.3 Prueba de calidad antes de fijar el proveedor

Antes de cerrar el proveedor, ejecutar una **muestra de 100 direcciones dominicanas** (limpias + típicas con errores) y puntuar: acierto rooftop/interpolado, fallos por ciudad, latencia, límites y **derecho a almacenar**. Solo con esa muestra se firma el contrato.

---

## 5. Comparación de costos y limitaciones

### 5.1 Modelo de volumen (lanzamiento, RD)

| Evento | Frecuencia estimada | Costo |
|--------|--------------------|-------|
| Geocoding de sucursales (admin) | decenas/mes | Free tier Geoapify |
| Autocomplete de dirección (admin) | cientos de keystrokes/mes (debounce) | Free tier |
| Geocoding/reverso de vivienda del cliente | 1–2 por cliente nuevo | Free tier |
| Autocomplete "otra zona" (cliente) | miles/mes | Free tier |
| Carga de tiles del mapa | por usuario del módulo | Tiles OSM = $0 |

### 5.2 Presupuesto operativo

| Proveedor | Mes lanzamiento | Mes con 10k usuarios/mapa | Nota |
|-----------|-----------------|---------------------------|------|
| Leaflet + OSM tiles | $0 | $0 | Uso razonable; considerar tiles propios si el tráfico explota |
| Geoapify (geo + autocomplete) | $0 | ~$5–30 (si supera ~90k créditos/mes) | Tiers baratos; cachear agresivamente |
| Mapbox (upgrade) | — | ~$25–150/mes + Permanent geocoding | Solo si la calidad RD lo exige |
| Google (upgrade) | — | ~$50–400/mes | Solo si se necesita POI/Places de primera |

**Presupuesto recomendado en el plan**: $0/mes en lanzamiento; línea de contingencia de $50/mes (2026) para el upgrade si la prueba de muestra lo justifica. **Las claves van SOLO en `.env` (server-side)**: la pública de tiles no es secreta; la API key de geocoding se restringe por dominio y se sirve vía server action/proxy, nunca en el bundle del cliente si es posible (Geoapify admite restricción por referer y la exponer al frontend es aceptable, pero el coste y el abuso se controlan con rate limit + caché).

---

## 6. Estrategia de PostGIS (o alternativa)

### 6.1 Recomendación: PostGIS habilitado en Supabase

- Supabase es PostgreSQL gestionado; habilitar la extensión es una línea SQL (Supabase SQL Editor o `CREATE EXTENSION IF NOT EXISTS postgis;` en un script manual). Es **gratis** en Supabase.
- Por qué: las consultas del mapa (radio, distancia, viewport, orden por cercanía) con miles de sucursales y miles de clientes necesitan índice espacial. Haversine en SQL sobre columnas float hace **full scan** al crecer.

### 6.2 Patrón Prisma + PostGIS (doble escritura con trigger)

Prisma no modela `geography(Point,4326)` (tipo `Unsupported` que degrada la DX). Patrón recomendado, que ya encaja con el estilo del repo:

1. **Prisma es la fuente de verdad de los datos**: `Sucursal.latitud/longitud`, `CustomerLocation.latitud/longitud` (Float), gestionadas con el ORM y las Server Actions.
2. **Columna PostGIS sincronizada por trigger** (SQL manual en `prisma/migrations_manual/`):
   ```sql
   ALTER TABLE sucursales ADD COLUMN location geography(Point, 4326);
   CREATE INDEX idx_sucursales_location ON sucursales USING GIST (location);
   CREATE OR REPLACE FUNCTION sync_sucursal_location() RETURNS trigger AS $$
   BEGIN
     NEW.location := CASE
       WHEN NEW.latitud IS NOT NULL AND NEW.longitud IS NOT NULL
       THEN ST_SetSRID(ST_MakePoint(NEW.longitud, NEW.latitud), 4326)::geography
       ELSE NULL END;
     RETURN NEW;
   END $$ LANGUAGE plpgsql;
   CREATE TRIGGER trg_sucursal_location BEFORE INSERT OR UPDATE OF latitud, longitud
   ON sucursales FOR EACH ROW EXECUTE FUNCTION sync_sucursal_location();
   ```
   (Idéntico para `customer_locations`.)
3. **Consultas geoespaciales** vía `prisma.$queryRaw` (o `$queryRawUnsafe` nunca con input directo; usar parámetros):
   - Radio: `ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radioM})`
   - Distancia: `ST_Distance(s.location, ...)::int AS distancia_m`
   - Viewport: `s.location && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography`
   - Orden: `ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(${lng},${lat}),4326)::geography`
4. **RLS compatible**: las consultas raw ya filtran `WHERE s.companyId = ...` y `conEmpresa`/`sinEmpresa` siguen aplicando; no se rompe el aislamiento.

### 6.3 Alternativa sin PostGIS (fallback documentado)

- Si por cualquier razón no se habilita PostGIS: filtro por **bounding box** sobre índices btree de `(latitud, longitud)` + **Haversine en SQL** para el orden y la distancia exacta. Correcto hasta ~decenas de miles de filas; degrada con un mapa "toda la ciudad" sobre miles de sucursales. Se adopta PostGIS como objetivo; el código se escribe contra una capa `geo/` que abstrae el proveedor espacial.

### 6.4 Índices espaciales y de segmentación

- GiST en `sucursales.location` y `customer_locations.location`.
- btree en `sectorId`/`cityId` de ambas tablas (segmentación por ciudad/sector sin PostGIS).
- btree compuesto en `clientes (companyId, createdAt)` ya existente; añadir índice a `customer_locations (userId, isPrimary)`.

---

## 7. Arquitectura de servicios

### 7.1 Estructura de módulos (nuevo dominio `src/modules/geo/`)

```
src/modules/geo/
├── catalogo/                 # Country/Region/City/Sector (queries + seed + acción "solicitar revisión")
│   ├── queries.ts
│   └── actions.ts
├── ubicaciones/              # LocationService (G-1): CustomerLocation
│   ├── queries.ts
│   ├── actions.ts            # guardarVivienda, cambiarPrimaria, eliminarUbicacion, usarEstaComoVivienda
│   └── service.ts            # normalización, validación, permisos
├── geocodificacion/          # GeocodingService (proveedor abstracto)
│   ├── proveedor.ts          # interfaz GeocodingProvider (forward, reverse, autocomplete)
│   ├── geoapify.ts
│   ├── nominatim.ts          # fallback/dev
│   ├── service.ts            # caché (lru-cache), cuotas, errores, atribución
│   └── actions.ts            # server actions: autocompletar, geocodificar, reverse
├── sucursales/               # geo de sucursal + validación visual (§8)
│   ├── queries.ts
│   ├── actions.ts            # guardarSucursalGeo, verificarCoordenadas, toggleMapa
│   └── sincronizacion.ts     # trigger/sync PostGIS + backfill
├── cercanos/                 # NearbyBusinessService
│   ├── queries.ts            # buscarCercanos (radio/viewport), filtros, orden, elegibilidad
│   └── mapeo.ts              # sucursal → marcador/tarjeta (distancia, ofertas activas, abierto)
├── mapa/                     # Estado de la sesión de exploración (contexto actual/vivienda/zona)
│   ├── contexto.ts           # resolverUbicacionActiva (server)
│   └── actions.ts            # elegirContexto, buscarEnZona, informarRadioAmpliado
├── segmentacion/             # CampaignSegmentationService + AudienceEstimator
│   ├── condiciones.ts        # catálogo de campos/operadores de segmento
│   ├── evaluador.ts          # árbol AND/OR/NOT sobre el contexto de segmento
│   ├── segmentos.ts          # CRUD de SavedSegment
│   ├── estimador.ts          # AudienceEstimator (agregados, advertencias, límites mínimos)
│   └── campañas.ts           # CRUD CampanaDirigida + programación + envío (cola)
├── consentimiento/           # LocationConsentService
│   ├── service.ts            # registrar, revocar, verificar (server-only)
│   └── actions.ts
├── eventos/                  # LocationSearchEvent (analítica agregada §35)
│   └── registrar.ts
└── componentes/              # (UI se mantiene en src/components/geo/)
```

### 7.2 Responsabilidades (mapeo a §31)

| Servicio | Responsabilidades |
|----------|-------------------|
| `LocationService` (`geo/ubicaciones`) | CRUD de `CustomerLocation`, primaria, normalización, validación, permisos por usuario. |
| `GeocodingService` (`geo/geocodificacion`) | Forward/reverse/autocomplete; caché; manejo de errores y cuotas del proveedor; atribución ODbL. |
| `NearbyBusinessService` (`geo/cercanos`) | Buscar sucursales cercanas (radio/viewport), aplicar filtros, ordenar por distancia, verificar ofertas vigentes, elegibilidad (empresa publicada/no demo/sucursal activa y con coordenadas). |
| `CampaignSegmentationService` (`geo/segmentacion`) | Construir consultas seguras, combinar condiciones, respetar multi-empresa, excluir sin consentimiento. |
| `AudienceEstimator` (`geo/segmentacion/estimador`) | Calcular audiencia estimada con agregados; advertencias; límites mínimos de audiencia. |
| `LocationConsentService` (`geo/consentimiento`) | Registrar autorizaciones, revocar, auditar. |

### 7.3 Servicios externos / puertos

- `GeocodingProvider` (interfaz) → `GeoapifyProvider`, `NominatimProvider`. Inyección vía flag `.env` (`GEOCODING_PROVIDER=geoapify|nominatim`). Cumple "no acoplar a un único proveedor".
- `Notificaciones` y `jobs/cola` (ya existentes) como canales de `CampanaDirigida`.

### 7.4 Seguridad multiempresa (§32)

- `Sucursal`/`SavedSegment`/`CampanaDirigida`: `conEmpresa` + filtro `companyId` en toda consulta (dos cierres: app + RLS).
- `CustomerLocation`: **por usuario** (`userId`). Las empresas **nunca** consultan esta tabla. La segmentación geo se resuelve en servidor y devuelve `clienteId`/`userId` de la propia empresa, sin coordenadas.
- `GeocodingService`: server-only (`import 'server-only'`), rate-limited, sin exponer la API key privada.
- Regla de **audiencia mínima** (§32): una campaña geográfica no se ejecuta si el segmento es tan pequeño que permite identificación (umbral configurable, p. ej. < 5 elegibles), salvo superadmin con justificación registrada en auditoría.
- Auditoría: `AuditLog` con nuevas `AuditAccion` (ej. `UBICACION_GUARDADA`, `CONSENTIMIENTO_GEO_REVOCADO`, `CAMPANA_DIRIGIDA_ENVIADA`, `SEGMENTO_EVALUADO`).

### 7.5 Endpoints (Server Actions vs route handlers)

- Lecturas del mapa con latencia: **route handlers** (`/api/geo/cercanos`, `/api/geo/autocompletar`) autenticados, con rate limit, para debounce + abort en cliente. Son GET y con caché.
- Mutaciones (guardar vivienda, consentimientos, segmentos, campañas): **Server Actions** con zod y guards de rol (patrón existente).
- Regla: la lógica geoespacial **nunca** en componentes React (sección 31).

### 7.6 Rendimiento (§37)

- Índices espaciales (GiST) + btree por ciudad/sector.
- Consultas por viewport con límite (`LIMIT 50` + cursor) y paginación progresiva.
- Debounce (300–500 ms) + AbortController en el cliente para autocomplete y movimientos del mapa.
- Caché `unstable_cache` (5 min) para "sucursales en viewport" frecuentes; caché de geocodificación por dirección normalizada (hash) en tabla `geo_cache` o `lru-cache`.
- Clustering en cliente (markercluster) para no dibujar cientos de marcadores.
- Rate limit de `/api/geo/*` (`registerLimiter`), control de cuotas del proveedor con `429` amigable.
- Límites de resultados y "respuestas parciales" (si el viewport está vacío, sugerir ampliar radio y avisar, §15).

### 7.7 Qué ve cada empresa (privacidad §25, §32)

- Una empresa **solo** ve: agregados de sus propios clientes (por ciudad/sector/radio), IDs de clientes de su `companyId` cuando el segmento los califica, y nada de coordenadas de personas.
- La **ubicación actual** del cliente es de sesión; jamás persiste sin `DEVICE_LOCATION_SESSION` y nunca se usa para marketing (las campañas solo usan `CustomerLocation` primaria autorizada, §26).

---

## 8. Diagrama textual de flujos

### 8.1 Onboarding de ubicación (registro progresivo)

```
[AsistenteRegistro]
  nombre → email → contraseña → teléfono → (vehículo si aplica)
  ↓
  ★ PASO UBICACIÓN (opcional, skippable)  ← nuevo
    país (sugerencia por IP, NUNCA silencioso; se confirma)
    ↓ provincia/estado (etiqueta según país, ej. "Provincia" en DO)
    ↓ ciudad (búsqueda en catálogo; permite "escribir otra" → isVerified=false)
    ↓ sector/barrio (búsqueda; permite escribir otro; opción "solo ciudad y sector")
    ↓ [opcional] mapa de confirmación de vivienda (pin, "omitir este paso")
  ↓
  confirmar (resumen + términos + marketingConsent + geoConsent HOME_STORAGE/MARKETING_GEO)
  ↓
  registrarCliente() guarda User + Cliente + [CustomerLocation si se completó]
```

### 8.2 Exploración en el mapa ("Cerca de mí")

```
[Mapa]
  Contexto: ¿Mi ubicación actual | Mi vivienda | Otra zona?
    ├─ Actual → pedir permiso GPS SOLO ahora → loading → coords de sesión
    │            └─ rechazado → mensaje amable + sugerir vivienda/zona (no repetir permiso)
    ├─ Vivienda → CustomerLocation primaria (si falta → ir a completar)
    └─ Otra zona → autocomplete ciudad/sector (no sobrescribe vivienda)
  ↓
  /api/geo/cercanos?lat&lng&radio&filtros&viewport  (server)
    → NearbyBusinessService:
        sucursales activas + con coordenadas + empresa publicada/no demo + en radio
        + ofertas vigentes (si filtro) + orden por distancia (SQL)
  ↓
  marcadores (cluster) + tarjetas sincronizadas (distancia, ofertas, abierto)
  ↓
  tocar marcador → resaltar tarjeta · tocar tarjeta → centrar mapa
  mover mapa → debounce → "buscar en esta zona" · cambiar filtros → recargar
  ↓
  abrir negocio → detalle (datos reales) → [car wash sin vehículo → onboarding vehículo → volver]
```

### 8.3 Registro de sucursal con geocodificación (§8)

```
[Admin /admin/sucursales/[id]]
  dirección (autocomplete) → Geoapify forward → pin en mapa (Leaflet)
  → admin ajusta pin manualmente → reverse geocode del pin (muestra dirección corregida)
  → confirmación explícita → guardar lat/lng + formattedAddress + city/sector/country
  → ubicacionVerificada=true · trigger sincroniza columna PostGIS
  → si no hay coords → advertencia "no aparecerá en búsquedas cercanas"
```

### 8.4 Campaña geosegmentada

```
[Admin /admin/segmentos] (constructor visual)
  condiciones (ciudad=Bávaro) AND (sector=Verón) AND (vehículo SUV) AND (sin membresía)
    → AudienceEstimator → "~214 clientes estimados · 3 excluidos sin consentimiento"
    → guardar SavedSegment
[Admin /admin/campanas-dirigidas]
  crear CampanaDirigida (mensaje + canales + segmento + sucursal/radio + frecuencia)
  → snapshot de audiencia → programar
  → jobs/cola fan-out → CampanaEntrega (respeta consentimiento + frecuencia + exclusión)
```

### 8.5 Consentimiento

```
Registro/perfil → dialogo de consentimiento geo (separado funcional vs marketing)
  → GeoConsent(FUNCTIONAL_USAGE | HOME_STORAGE | MARKETING_GEO) ACTIVE
Perfil → "Privacidad y ubicación" → revocar MARKETING_GEO
  → estado REVOKED + revokedAt (auditable) → segmentación deja de incluirlo al instante
```

---

## 9. Sistema de consentimiento (diseño)

### 9.1 Tipos y separación (§33)

| Consentimiento | Qué autoriza | Se pide en | Relación con marketing |
|----------------|--------------|------------|------------------------|
| `FUNCTIONAL_USAGE` | Usar ubicación (guardada o actual) para mostrar negocios cercanos | Registro (opcional) / mapa | Independiente |
| `HOME_STORAGE` | Guardar la vivienda/ubicaciones en el perfil | Paso de ubicación | Independiente |
| `MARKETING_GEO` | Usar ciudad/sector/radio para campañas | Registro (checkbox aparte) / perfil | Es condición OBLIGATORIA para segmentación geo |
| `DEVICE_LOCATION_SESSION` | Usar el GPS actual SOLO para la búsqueda en curso | Momento de usar "mi ubicación" en el mapa | Nunca |

- **No se mezclan**: aceptar `marketingConsent` (general) no implica `MARKETING_GEO`; ni `FUNCTIONAL_USAGE` implica `MARKETING_GEO`.
- **Versión + canal + fecha**: cada concesión guarda la versión del texto, el canal y timestamps.
- **UI**: en el perfil, sección "Privacidad y ubicación" con switches por tipo, texto de la versión aceptada, fecha, y botón de revocación con confirmación. Al revocar `MARKETING_GEO`, se elimina de la segmentación de forma inmediata (evaluación en vivo, no lista estática).
- **No persistir GPS**: la ubicación actual de sesión se guarda en memoria/sessionStorage y solo se convierte en `CustomerLocation` (o consentimiento) si el usuario lo pide explícitamente ("Usar esta ubicación como mi vivienda" + confirmación, §19).

---

## 10. Constructor de segmentos (diseño)

### 10.1 Experiencia (no técnica)

Constructor visual con **filas de condición** en lenguaje natural:

```
Todos los clientes que cumplan:
  [ Ciudad      ] [ es            ] [ Punta Cana        ]  ✕
  [ Sector      ] [ es            ] [ Bávaro            ]  ✕
  [ Vehículo    ] [ categoría es  ] [ SUV               ]  ✕
  [ Membresía   ] [ NO tiene activa ]                    ]  ✕
+ Agregar condición
Combinar condiciones:  ( Y / O )   → (al menos una de / todas / ninguna)
```

- Operadores disponibles según el campo (no operadores genéricos que confunden): ciudad=es/no es; sector=es/no es; radio=seleccionar sucursal+km; membresía=tiene activa/vencida/sin; vehículo=categoría/tipo; actividad=visitó en X días; cumpleaños=mes; etiqueta=contiene; etc.
- Grupos anidados con `Y` / `O` / `NO` (mismo árbol que `SegmentConditionGroup`).
- **Cada condición se valida contra el catálogo real**: las ciudades/sectores vienen de `City`/`Sector`, los tipos de vehículo de `TipoVehiculo`, las categorías de `BusinessCategory`. No hay valores inventados (§13 "los filtros se construyen con información real").
- Vista previa en vivo con el `AudienceEstimator`: total estimado, elegibles, excluidos, motivos principales, distribución por ciudad/sector, clientes con consentimiento válido, canal disponible y advertencias (audiencia < umbral, > umbral, sin canal) — **sin datos personales** (§23).
- Guardar segmento con nombre/descripción; se re-evalúa al ejecutar (§24).

### 10.2 Catálogo de campos del contexto de segmentación

`campo` (dot-path) sobre un contexto por `Cliente`+`User` (resuelto en servidor):

| Campo | Fuente | Operadores típicos |
|-------|--------|--------------------|
| `cliente.paisId` / `regionId` / `cityId` / `sectorId` | `CustomerLocation` primaria (autorizada) | eq, in, not_in |
| `cliente.distanciaSucursalKm` | `Sucursal` elegida + radio | lt, lte (radio) |
| `cliente.tipo` | `Cliente.esLocal` (mostrador) | eq (excluir mostrador) |
| `cliente.createdAt` | `Cliente` | gte, lt (cliente nuevo) |
| `cliente.ultimaVisitaDias` | `Visit` | gte (inactivo) |
| `cliente.membresia.estado` | `Membership` | eq ACTIVA/VENCIDA, "sin activa" |
| `cliente.vehiculo.tipoVehiculoId` / `marca` | `Vehiculo` | in, eq |
| `cliente.cumpleMes` | `Cliente.fechaNacimiento` | eq (mes) |
| `cliente.etiquetas` | futuras (ClienteNota/segmentos manuales) | contains |
| `cliente.consentimiento.marketingGeo` | `GeoConsent` | eq true (SIEMPRE exigido implícito) |

### 10.3 Evaluación y límites

- `AudienceEstimator` usa SQL (groupBy + joins con índices), **nunca** trae todas las personas al servidor.
- Límite de evaluaciones y tiempo máximo por evaluación (estimador con `LIMIT`/timeout).
- **Guardrail multiempresa**: el constructor solo ofrece campos dentro del `companyId` del admin; un admin de "Car Town Bávaro" no ve clientes de "Tony's".
- **Guardrail de identificación**: audiencias < umbral se bloquean con justificación auditada (§32).

---

## 11. Plan de migración

**Principios**: sin migraciones destructivas (§43); cada cambio en una migración Prisma fechada; SQL espacial/RLS en `migrations_manual`; backfills idempotentes en `scripts/`.

### Fase A — Fundamentos (migración única)

1. `prisma/migrations/20260806_geo_fundaciones/`:
   - `geo_countries`, `geo_regions`, `geo_cities`, `geo_sectors` + enums.
   - `customer_locations` + enums.
   - Ampliar `sucursales`: columnas geo (countryId, regionId, cityId, sectorId, ciudadTexto, sectorTexto, latitud, longitud, mostrarEnMapa, radioServicioKm, ubicacionVerificada, ubicacionActualizadaAt, horarioDetallado).
   - `geo_consents`, `saved_segments`, `segment_conditions`, `segment_condition_groups`, `campanas_dirigidas`, `campana_audiencia_snapshots`, `campana_entregas`, `location_search_events`.
2. `prisma/migrations_manual/2026-08-postgis.sql`: `CREATE EXTENSION IF NOT EXISTS postgis;` + columnas `geography(Point,4326)` + GiST + triggers de sincronización.
3. RLS (`migrations_manual`): políticas para tablas de empresa (`sucursales`, `saved_segments`, `campanas_dirigidas`); `customer_locations` y `geo_consents` solo accesibles por su dueño/superadmin.
4. **Seed** (`prisma/seed.ts` + `scripts/geo-seed.ts`): catálogo DO (32 provincias + municipios + sectores principales de las ciudades operativas, de fuentes públicas/OSM con `isVerified` según procedencia). Región/ciudad/sector adicionales con `isVerified:false` quedan a revisión del superadmin.
5. **Backfill**: `scripts/backfill-sucursales-geo.mjs` — crea la sucursal principal con `lat/lng` de `Company` cuando existan; rellena `ciudadTexto` desde `Company.ciudad`.

### Fase B — Aplicación

- `src/modules/geo/**` completo (catálogo, ubicaciones, geocodificación, cercanos, mapa, segmentación, consentimiento, eventos).
- Ruta de cliente `/cliente/mapa` + secciones del inicio.
- Pasos de ubicación en el asistente de registro y en el perfil.
- Admin: geo de sucursales (formulario ampliado), constructor de segmentos, campañas dirigidas.
- `docs/` actualizadas (GUIA_LENGUAJE_MEMBEGO, RLS.md) y `.env.example` con `GEOCODING_PROVIDER`, `GEOAPIFY_API_KEY`, `MAPA_*`.

### Fase C — Pruebas

- Tests unitarios + integración + e2e (ver §14) y despliegue por fases con `db:migrate:deploy`.

**Rollback**: por ser aditivo (columnas nullable, tablas nuevas), el rollback de Fase A es "no usar los módulos"; no se tocan filas existentes salvo el backfill idempotente.

---

## 12. Riesgos técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Calidad de geocodificación OSM/Geoapify insuficiente en RD | Media | Medio | Prueba de muestra de 100 direcciones antes de firmar; capa `GeocodingProvider` para migrar a Mapbox sin reescribir |
| Prisma no modela `geography` → drift entre floats y columna PostGIS | Baja | Medio | Sincronización por trigger en BD (fuente única de verdad: las columnas Float de Prisma); test de integridad en CI |
| Cargas excesivas al mover el mapa | Media | Alto (coste/latencia) | Debounce + abort + límites de viewport + paginación + caché; rate limit en `/api/geo/*` |
| pgBouncer + `SET LOCAL` con `$queryRaw` en transacciones | Baja | Medio | Usar `conEmpresa`/`sinEmpresa` (ya maneja el contexto por transacción); raw queries con parámetros |
| Abuso del geocoding (autocomplete por keystroke) | Media | Medio (coste) | Debounce 300 ms, rate limit por IP/usuario, caché por hash de query, cuotas del proveedor |
| Clustering de cientos de sucursales en mobile | Media | Medio | Leaflet.markercluster + tiles OSM; no descargar todas las sucursales (solo viewport) |
| Mapa sin servicio de tiles / proveedor caído | Baja | Bajo | Fallback visual (cards de lista siguen funcionando), sin romper la búsqueda de lista |
| RLS mal aplicada en tablas nuevas | Baja | Alto | Tablas nuevas desde el día 1 con `conEmpresa`/`sinEmpresa` y políticas RLS; `rls:probar` |
| Caché de geocodificación con PII | Baja | Medio | Hash de dirección, TTL corto, nunca guardar coordenadas GPS de sesión en caché persistente |
| Volumen de `CampanaDirigida` fan-out en serverless | Media | Medio | Reutilizar `jobs/cola` (QStash) con lotes encadenados (patrón ya probado en notificaciones) |

---

## 13. Riesgos de privacidad

| Riesgo | Exposición | Mitigación (§ correspondiente) |
|--------|-----------|-------------------------------|
| GPS solicitado automáticamente / bloqueo del registro | Fricción y desconfianza | Nunca automático; permiso solo al elegir "mi ubicación"; registro funciona sin GPS (§2, §20) |
| Persistir ubicación actual sin consentimiento | Seguimiento involuntario | `DEVICE_LOCATION_SESSION` de sesión; solo se guarda si el usuario lo pide explícitamente (§2, §19, §26) |
| Usar ubicación actual para marketing | Violación de consentimiento | Campañas usan SOLO `CustomerLocation` primaria autorizada; nunca el GPS de sesión (§26) |
| Empresa ve coordenadas exactas de personas | Identificación/re-identificación | Las empresas jamás leen `customer_locations`; la segmentación devuelve agregados e IDs propios (§32) |
| Audiencia mínima que permita identificación | De-anonimización | Umbral mínimo de audiencia + bloqueo con justificación auditada (§32) |
| Mezclar consentimiento funcional y marketing | Base legal inválida | Tipos separados en `GeoConsent`; revocación inmediata (§33) |
| Recopilar dirección completa sin finalidad | Sobre-recopilación | Dirección de referencia opcional; solo ciudad/sector son la base de descubrimiento (§2, §4) |
| Texto libre de ciudad/sector → segmentación incorrecta o inferencia | Precisión y privacidad | `normalizedName` para segmentar; texto original solo como respaldo (§30) |
| Métricas que reconstruyan recorridos | Vigilancia | `LocationSearchEvent` agregado, sin historial de movimiento (§35) |
| VPN / ubicación imprecisa | Datos engañosos | Siempre mostrar contexto usado y permitir cambio manual; distancia "aproximada" (§36) |

---

## 14. Plan de implementación por fases

> Las fases 1-6 de la especificación (sección 42) con esfuerzos orientativos. Cada fase se cierra con pruebas y se valida con el equipo antes de la siguiente.

### Fase 1 · Fundamentos geográficos
- Catálogo `Country/Region/City/Sector` + seed DO + `isVerified`.
- `CustomerLocation` + servicio `LocationService` (primaria, multi-ubicación, normalización).
- Ampliar `Sucursal` con geo + `SucursalGeoActions` + validación visual (§8) con `GeocodingService` (Geoapify + fallback Nominatim).
- PostGIS habilitado, columnas `geography` + triggers + índices + backfill.
- `GeoConsent` + `LocationConsentService`.
- **Est. 6-8 días.**

### Fase 2 · Onboarding de ubicación
- Paso de ubicación (opcional) en `AsistenteRegistro` (país → provincia → ciudad → sector → vivienda en mapa opcional).
- Sección "Mi ubicación" en el perfil (vivienda, trabajo, otras; editar; eliminar; consentimientos).
- Ítem "Mi ubicación" en el checklist B2C (`getOnboardingCliente`).
- **Est. 4-5 días.**

### Fase 3 · Mapa de negocios
- Ruta `/cliente/mapa` con Leaflet + markercluster, header con contexto (actual/vivienda/zona), selector de contexto, filtros reales, lista sincronizada, detalle de negocio, botón indicaciones (enlace maps) y estado abierto/cerrado.
- `NearbyBusinessService` (radio/viewport/orden/distancias) + route handlers con debounce/caché/rate limit.
- Secciones del inicio: "Ofertas cerca de ti", "Nuevos negocios en tu zona", "Beneficios disponibles hoy", "Ofertas por vencer cerca de ti" (sobre `getPromoFeed` + distancia).
- **Est. 8-10 días.**

### Fase 4 · Integración comercial
- Ofertas/membresías aplicables por sucursal; elegibilidad por tipo de negocio; flujo car wash sin vehículo → onboarding vehículo → regreso al negocio (usa el motor de requisitos existente, `flujos.ts`).
- Conversión desde el mapa (adquirir promoción/membresía sin perder contexto de ubicación).
- **Est. 4-5 días.**

### Fase 5 · Campañas geosegmentadas
- `SavedSegment` + `SegmentCondition` + constructor visual + `AudienceEstimator` + vista previa.
- `CampanaDirigida` + canales (in-app; email a través del servicio existente) + frecuencia + horarios + exclusiones + fan-out por cola.
- Segmentos por ciudad/sector/radio + combinaciones AND/OR/NOT + guardrail de audiencia mínima.
- **Est. 8-10 días.**

### Fase 6 · Analítica, seguridad y optimización
- `LocationSearchEvent` (agregado), monitoreo de latencia de `/api/geo/*`, caché, pruebas de carga, revisión de privacidad, tests RLS.
- **Est. 3-4 días.**

**Total orientativo: 33-42 días**, alineado con la magnitud de la especificación (es una reconstrucción de un dominio completo, no un retoque).

---

## 15. Criterios de aceptación (mapeo a §40)

| Criterio de la especificación | Se cumple en | Cómo se verifica |
|-------------------------------|--------------|------------------|
| Cliente registra ciudad y sector | Fase 2 | e2e registro con ubicación |
| GPS no obligatorio | Fase 2 | e2e registro sin permiso GPS |
| Guardar vivienda | Fase 2 | integración "guardar vivienda" |
| Explorar por ubicación actual / vivienda / otra zona | Fase 3 | e2e mapa |
| Mapa con sucursales reales | Fase 3 | integración "buscar negocios cercanos" |
| Orden por proximidad | Fase 3 | test de cálculo de distancia |
| Filtros con datos reales | Fase 3 | integración filtros |
| Mapa y lista sincronizados | Fase 3 | e2e apertura negocio desde mapa |
| Sucursales con coordenadas verificadas | Fase 1 | integración validación de coordenadas |
| Ofertas activas y vigentes | Fase 3 | unit `ofertaVigente` + integración |
| Car wash respeta requisitos de vehículo | Fase 4 | e2e registro vehículo desde oferta |
| Segmentos por ciudad/sector/radio | Fase 5 | integración crear segmentos |
| Estimación de audiencia | Fase 5 | integración calcular audiencia |
| Campañas respetan consentimiento | Fase 5 | unit verificación de consentimiento + e2e revocación |
| Empresas no ven datos ajenos | Fase 1/5 | unit exclusión multiempresa + `rls:probar` |
| Consultas con índices espaciales | Fase 1 | revisión de índices + plan EXPLAIN |
| Alternativa cuando se rechaza GPS | Fase 3 | e2e |
| Pruebas automatizadas | todas | suite unit/integración/e2e (§39) |
| Sin datos simulados | todas | revisión de código; solo catálogo seed real |
| No exponer ubicaciones precisas innecesarias | Fase 1/5 | auditoría de permisos y API |

---

## 16. Decisiones abiertas para aprobación

> **ESTADO: APROBADO** (2026-08-06). Todas las decisiones fueron aprobadas por el equipo con las opciones recomendadas.

1. **G-3**: se aprueba **Geoapify** como proveedor de geocodificación (autocomplete, geocoding, reverso), con fallback dev Nominatim y ruta de upgrade a Mapbox. Requiere cuenta y API key (`GEOAPIFY_API_KEY`).
2. **G-4**: se habilita **PostGIS** en Supabase (extensión + triggers de doble escritura + índices GiST).
3. **G-1**: la ubicación de persona cuelga de **`User`** (cross-empresa), no de `Cliente`.
4. **Nombre del módulo de cliente**: **"Cerca de mí"**.
5. **Radio por defecto**: **3 km**, con radios ofrecidos 1/3/5/10/20/"toda la ciudad" y ampliación progresiva avisando al usuario (§15).
6. **Umbral de audiencia mínima** para campañas geográficas: **5**, con política de excepción del superadmin.
7. **Catálogo inicial RD**: datos públicos **ONE/OSM** con `isVerified` según procedencia y revisión del superadmin.
8. **Canales de campaña Fase 5 (v1)**: **in-app + email (Resend)** desde el día 1.

---

## Apéndice A · Referencias en el código actual

- Multi-tenant: `src/lib/tenant.ts` (`conEmpresa`, `sinEmpresa`).
- RLS: `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` y `docs/RLS.md`.
- Mapa actual: `src/components/admin/MapaUbicacion.tsx`.
- Asistente de registro: `src/components/auth/AsistenteRegistro.tsx`, `src/modules/registro/actions.ts`.
- Flujos declarativos: `src/modules/onboarding/flujos.ts`, `src/modules/capacidades/catalogo.ts`.
- Feed de ofertas: `src/modules/social/queries.ts` (`getPromoFeed`, `getNovedadesInicio`).
- Campañas: `src/modules/engagement/campanas.ts`, `src/components/engagement/MarketingCampaignForm.tsx`.
- Cola de trabajos: `src/modules/jobs/cola.ts`.
- Notificaciones: `src/modules/notificaciones/service.ts`.
- Rule Engine (patrón de condiciones): `prisma/schema/motores.prisma`.
