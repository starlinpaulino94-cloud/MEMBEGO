# CRM - Implementación

> Documento de diseño e implementación del módulo CRM (Customer Relationship
> Management) para la plataforma MembeGo. Define arquitectura, modelos de
> datos, integraciones con motores existentes y roadmap de desarrollo.

---

## Introducción

El CRM es un módulo para gestionar prospectos y leads dentro de la plataforma
MembeGo. Su propósito es dar a cada empresa una vista centralizada de sus
clientes potenciales: quiénes son, de dónde vienen, en qué etapa del embudo
están, y cuándo toca darles seguimiento.

No reemplaza lo que ya existe. Los clientes ya registrados (con membresía
activa o histórica) siguen en `Cliente`. El CRM cubre el embudo ANTES de que
alguien se convierta en cliente: captación, calificación, seguimiento y
conversión.

### Problema que resuelve

Hoy no hay registro estructurado de prospectos. Un lead entra por WhatsApp,
otro por Instagram, otro por referencia boca a boca. No hay visibility sobre
quién está en proceso de compra, quién lleva días sin respuesta, ni cuántos
leads se pierden en cada etapa. El CRM pone orden sin crear trabajo extra:
captura rápida, vista Kanban, recordatorios automáticos.

### Alcance

| Dentro del CRM | Fuera del CRM |
|---|---|
| Leads, prospectos, contactos fríos | Clientes ya convertidos (viven en `Cliente`) |
| Notas de seguimiento, llamadas, emails | Membresías, planes, pagos |
| Pipelines por vertical | Automatizaciones de engagement (ya existen) |
| Scoring básico de leads | Score de fidelización (ya existe) |
| Importación/exportación de contactos | Reportes ejecutivos globales (ya existen) |

---

## Estado Actual

> **Última actualización:** Septiembre 2026

El módulo CRM está implementado y funcional. Incluye pipeline Kanban con
drag & drop, CRUD completo de leads, notas de seguimiento, estadísticas
y permisos por sección.

### Lo que funciona

- **Pipeline Kanban** con 7 columnas (Nuevo → Ganado/Perdido), drag & drop
  nativo del navegador
- **CRUD de leads**: crear, editar, eliminar (soft delete → DESCARTADO),
  mover entre etapas, asignar responsable
- **Notas de seguimiento**: crear y eliminar notas asociadas a un lead,
  con timeline visible en el detalle
- **Estadísticas**: total leads, nuevos hoy, seguimientos pendientes,
  leads en pipeline
- **Búsqueda y filtros**: por nombre, email, etapa, prioridad, estado,
  fuente, canal
- **Paginación**: server-side con 20 leads por página
- **Detalle de lead**: Sheet lateral con tabs Info/Notas, edición inline,
  movimiento de etapa, eliminación con confirmación
- **Permisos**: guard por sección `leads`, acciones protegidas con
  `requireSection`
- **Multi-tenant**: todos los datos filtran por `companyId`

### Lo que falta (pendiente)

- Fase 3: Pipelines configurables por vertical (modelo `PipelineConfig`
  creado pero sin UI de configuración)
- Fase 4: Automatizaciones (recordatorios, lead frío, conversión)
- Fase 5: Dashboard de métricas, importación/exportación CSV
- Integración con motor de segmentación existente
- Integración con motor de automatizaciones existente
- Vista lista alternativa al Kanban
- Scoring automático de leads

### Capacidad CRM

La capacidad `CRM` está registrada en el catálogo y controla el acceso
al módulo:

```ts
// En src/modules/capacidades/catalogo.ts
CRM: 'CRM: leads, seguimiento y pipeline comercial',
```

Secciones habilitadas: `leads`, `seguimiento`, `conversaciones`,
`pipeline`, `configuracion`.

---

## Arquitectura

El CRM se integra con los módulos existentes de la plataforma sin crear
islas de datos. Usa los mismos patrones probados: Server Actions para
mutaciones, Prisma para queries, y el sistema de secciones/permisos para
encender/apagar por empresa.

### Capa de presentación

- **Ruta:** `/admin/crm` dentro del shell de la app (bajo la sección
  `leads`, controlada por la capacidad CRM).
- **Layout:** `src/app/(admin)/admin/crm/layout.tsx` — guard con
  `requireSection('leads')`, header con título y tabs de navegación.
- **Server Component:** `page.tsx` — carga leads, stats y filtros,
  renderiza el pipeline board.
- **Client Component:** `pipeline-board.tsx` — tablero Kanban con drag &
  drop, diálogos de creación/edición, sheet de detalle con tabs Info/Notas.
- **Colores:** `paleta.ts` — constantes de colores para etapas y prioridades.
- **Tabs:** `CrmTabs.tsx` — navegación entre secciones del CRM.

### Capa de lógica (Server Actions)

Ubicada en `src/modules/crm/` siguiendo el patrón existente:

```
src/modules/crm/
├── lead-actions.ts    # createLead, updateLead, deleteLead, moveToStage, assignLead, fetchLeadDetails
├── nota-actions.ts    # createNota, deleteNota
├── queries.ts         # getLeads, getLeadById, getStats, getPipelineConfig
└── types.ts           # Lead, NotaSeguimiento, CrmStats, PipelineConfig, filtros, paginación
```

Cada acción valida: (1) el usuario tiene permiso de sección (`requireSection`),
(2) el lead pertenece a su `companyId`, (3) la sección `leads` está habilitada.

### Capa de datos

Prisma schema en `prisma/schema/crm.prisma` con modelos `Lead`,
`NotaSeguimiento`, `Conversacion`, `Mensaje` y `PipelineConfig`.
Multi-tenant por `companyId` en todos los modelos. Sin enums Prisma:
valores controlados en código como tipos TypeScript string-literal.

### Diagrama de integración

```
┌─────────────────────────────────────────────────┐
│                  CRM Module                      │
│                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐ │
│  │   Lead   │  │  Seguimiento │  │  Pipeline  │ │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘ │
│       │               │                │         │
└───────┼───────────────┼────────────────┼─────────┘
        │               │                │
        ▼               ▼                ▼
┌───────────┐  ┌──────────────┐  ┌──────────────┐
│ Segmenta- │  │ Automatiza-  │  │   Capacida-  │
│   ción    │  │   ciones     │  │    des       │
│  Engine   │  │   Engine     │  │   System     │
└───────────┘  └──────────────┘  └──────────────┘
```

---

## Modelos de Datos

> **Nota:** El schema Prisma real (`prisma/schema/crm.prisma`) no usa
> enums Prisma. Todos los valores son strings controlados en código
> TypeScript (tipos string-literal en `types.ts`).

### Lead

Representa un prospecto o contacto potencial. No es un cliente: un lead se
convierte en cliente cuando completa registro y activa membresía.

```prisma
model Lead {
  id                String          @id @default(uuid())
  companyId         String
  clienteId         String?

  nombre            String
  email             String?
  telefono          String?
  fuente            String          @default("ORGANICO")  // ORGANICO, PAGADO, REFERENCIA, EVENTO, OTRO
  canal             String          @default("WEB")       // WHATSAPP, INSTAGRAM, FACEBOOK, TELEFONO, PRESENCIAL, WEB
  estado            String          @default("ACTIVO")    // ACTIVO, INACTIVO, CONVERTIDO, DESCARTADO
  etapa             String          @default("NUEVO")     // NUEVO, CONTACTADO, INTERESADO, PROPUESTA, NEGOCIACION, GANADO, PERDIDO
  score             Int?
  fechaSeguimiento  DateTime?
  prioridad         String          @default("MEDIA")     // BAJA, MEDIA, ALTA, URGENTE
  asignadoA         String?         // userId
  notas             String?
  tags              String[]        @default([])
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  notasSeguimiento  NotaSeguimiento[]
  conversaciones    Conversacion[]

  @@index([companyId])
  @@index([companyId, estado])
  @@index([companyId, etapa])
  @@index([fechaSeguimiento])
  @@index([asignadoA])
}
```

**Campos clave:**

| Campo | Propósito |
|---|---|
| `fuente` | De dónde vino el lead (orgánico, pago, referencia, evento) |
| `canal` | Por dónde se comunica (WhatsApp, Instagram, teléfono) |
| `estado` | Ciclo de vida: activo, inactivo, convertido, descartado |
| `etapa` | Posición en el pipeline de ventas |
| `score` | Puntuación automática (0-100) basada en interacción |
| `fechaSeguimiento` | Cuándo toca contactarlo de nuevo |
| `prioridad` | Urgencia del seguimiento |
| `asignadoA` | Quién es responsable del lead |

### NotaSeguimiento

Registro de cada interacción con un lead. Timeline completa visible en la
ficha del lead.

```prisma
model NotaSeguimiento {
  id              String      @id @default(uuid())
  leadId          String
  lead            Lead        @relation(fields: [leadId], references: [id], onDelete: Cascade)
  userId          String
  contenido       String
  tipo            String      @default("NOTA")  // NOTA, LLAMADA, EMAIL, WHATSAPP, REUNION
  fechaProxima    DateTime?
  createdAt       DateTime    @default(now())

  @@index([leadId])
  @@index([leadId, createdAt])
}
```

**Tipos de seguimiento:**

| Tipo | Descripción |
|---|---|
| `NOTA` | Anotación interna, referencia |
| `LLAMADA` | Llamada telefónica realizada |
| `EMAIL` | Correo enviado o recibido |
| `WHATSAPP` | Mensaje de WhatsApp |
| `REUNION` | Reunión presencial o virtual |

### Conversacion

Hilo de conversación con un lead por un canal específico. Modela
conversaciones de WhatsApp, Instagram, etc. con soporte para mensajes
entrantes y salientes.

```prisma
model Conversacion {
  id            String      @id @default(uuid())
  leadId        String
  lead          Lead        @relation(fields: [leadId], references: [id], onDelete: Cascade)
  companyId     String
  canal         String      // WHATSAPP, INSTAGRAM, MESSENGER, EMAIL
  canalThreadId String?     // ID externo (wa_id, instagram_thread_id, etc.)
  estado        String      @default("ABIERTA") // ABIERTA, CERRADA, ARCHIVADA
  ultimoMensaje String?
  ultimaFecha   DateTime?
  noLeidos      Int         @default(0)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  mensajes      Mensaje[]

  @@index([companyId])
  @@index([leadId])
  @@index([canal])
}
```

### Mensaje

Mensaje individual dentro de una conversación. Registra dirección
(entrante/saliente), tipo de contenido y metadata del proveedor.

```prisma
model Mensaje {
  id              String      @id @default(uuid())
  conversacionId  String
  conversacion    Conversacion @relation(fields: [conversacionId], references: [id], onDelete: Cascade)
  direccion       String      // ENTRANTE, SALIENTE
  tipo            String      // TEXTO, IMAGEN, DOCUMENTO, AUDIO, UBICACION
  contenido       String
  metadata        Json?       // payload original del proveedor
  proveedorMsgId  String?     // message_id de WhatsApp/Meta/etc.
  estado          String      @default("ENVIADO") // ENVIADO, ENTREGADO, LEIDO, FALLIDO
  creadoPor       String?     // userId si saliente
  createdAt       DateTime    @default(now())

  @@index([conversacionId, createdAt])
}
```

### PipelineConfig

Configuración del pipeline de ventas por empresa. Almacena etapas,
campos personalizados y reglas de automatización en formato JSON.

```prisma
model PipelineConfig {
  id              String      @id @default(uuid())
  companyId       String      @unique
  categoria       String      // CAR_WASH, BARBERIA, etc.
  stages          Json        // [{id, nombre, color, orden, esObligatoria, reglasTransicion}]
  camposCustom    Json        // [{key, label, tipo, opciones, obligatorio}]
  automatizaciones Json       // {bienvenida:bool, recordatorioDias:int, cierre:bool, plantillas:{...}}
  updatedAt       DateTime    @updatedAt
}
```

### Tipos TypeScript

Los enums de Prisma se reemplazan por tipos string-literal en
`src/modules/crm/types.ts`:

```ts
type LeadFuente   = 'ORGANICO' | 'PAGADO' | 'REFERENCIA' | 'EVENTO' | 'OTRO'
type LeadCanal    = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'TELEFONO' | 'PRESENCIAL' | 'WEB'
type LeadEstado   = 'ACTIVO' | 'INACTIVO' | 'CONVERTIDO' | 'DESCARTADO'
type LeadEtapa    = 'NUEVO' | 'CONTACTADO' | 'INTERESADO' | 'PROPUESTA' | 'NEGOCIACION' | 'GANADO' | 'PERDIDO'
type LeadPrioridad = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE'
type NotaTipo     = 'NOTA' | 'LLAMADA' | 'EMAIL' | 'WHATSAPP' | 'REUNION'
```

Ventaja: sin migración de enums, los valores se controlan 100% en código
y se pueden extender sin `ALTER TYPE`.

---

## Puntos de Integración

El CRM no vive aislado. Se conecta con los motores existentes de la
plataforma para enriquecer la experiencia y evitar duplicación de lógica.

### Segmentación

Usa el sistema de segmentos existente para categorizar leads:

- **Segmento por fuente:** leads de Instagram vs. WhatsApp vs. referidos.
- **Segmento por actividad:** leads activos vs. fríos vs. perdidos.
- **Segmento por vertical:** leads de car wash vs. barbería vs. restaurante.

El motor de segmentación ya existe (`Segmentation Engine`). El CRM lee los
segmentos para pre-filtros y reportes, sin crear una nueva capa de
segmentación.

### Semáforo (Risk States)

El sistema de semáforo existente monitorea el riesgo de clientes activos. El
CRM extiende ese concepto a leads:

| Estado del lead | Color | Acción sugerida |
|---|---|---|
| Sin seguimiento > 3 días | 🔴 Rojo | Escalar o descartar |
| Sin seguimiento 1-3 días | 🟡 Amarillo | Programar contacto |
| Seguimiento reciente | 🟢 Verde | Mantener ritmo |

La lógica de escalación reutiliza el patrón del semáforo existente, no lo
reinventa.

### Automatizaciones

Conecta con el `Automation Engine` para triggerar acciones automáticas:

- **Recordatorio de seguimiento:** cuando `fechaSeguimiento` vence, crear
  una notificación para el responsable.
- **Lead frío:** si un lead lleva > 7 días sin interacción, marcar como
  inactivo o escalar.
- **Conversión exitosa:** cuando un lead cambia a estado `CONVERTIDO`,
  crear el registro en `Cliente` con los datos del lead.

Las automatizaciones usan el motor existente (`Automation Engine`), no crean
un sistema nuevo.

### Capacidades

El CRM es una capacidad más del catálogo:

```ts
// En src/modules/capacidades/catalogo.ts
CRM: {
  label: 'CRM / Gestión de Leads',
  descripcion: 'Pipeline de ventas, seguimiento de prospectos, scoring de leads',
},
```

- **Nace apagada:** la mayoría de empresas no necesita CRM al principio.
- **Se enciende por empresa:** desde `/superadmin/capacidades`.
- **Fail-closed:** sin la capacidad encendida, `/admin/crm` no carga.

### Clientes existentes

Un lead puede vincularse a un `Cliente` ya existente via `clienteId`. Esto
permite:

- Ver el historial completo de un contacto (antes y después de convertirse).
- Evitar duplicados: si el email ya existe como cliente, sugerir vincular.
- Tracking de attribution: de qué lead vino cada cliente.

---

## Roadmap de Implementación

### Fase 1: Fundamentos ✅ Completada

**Objetivo:** Modelo de datos funcional, CRUD básico, vista lista.

| Tarea | Estado |
|---|---|
| Migración Prisma | ✅ `prisma/schema/crm.prisma` con Lead, NotaSeguimiento, Conversacion, Mensaje, PipelineConfig |
| Server actions CRUD | ✅ `lead-actions.ts`: createLead, updateLead, deleteLead, moveToStage, assignLead |
| Notas de seguimiento | ✅ `nota-actions.ts`: createNota, deleteNota |
| Queries | ✅ `queries.ts`: getLeads, getLeadById, getStats, getPipelineConfig |
| Tipos TypeScript | ✅ `types.ts`: interfaces y tipos string-literal (sin enums Prisma) |
| Capacidad CRM | ✅ Registrada en catálogo con secciones: leads, seguimiento, conversaciones, pipeline, configuracion |
| Permisos | ✅ Sección `leads` en permissions.ts, guard en layout.tsx |

### Fase 2: Kanban Board ✅ Completada

**Objetivo:** Tablero visual tipo Trello para el pipeline de ventas.

| Tarea | Estado |
|---|---|
| Tablero Kanban | ✅ 7 columnas (Nuevo → Ganado/Perdido) con drag & drop nativo |
| Tarjeta de lead | ✅ Nombre, email, teléfono, prioridad (con color), fecha de creación |
| Crear lead | ✅ Diálogo modal con formulario (nombre, email, teléfono, prioridad, notas) |
| Editar lead | ✅ Sheet lateral con tabs Info/Notas, edición inline |
| Mover entre etapas | ✅ Drag & drop + selector en detalle |
| Eliminar lead | ✅ Soft delete (estado → DESCARTADO) con AlertDialog de confirmación |
| Detalle de lead | ✅ Sheet con info completa, tags, notas, movimiento de etapa |
| Notas de seguimiento | ✅ Crear/eliminar notas en tab "Notas" del detalle |
| Estadísticas | ✅ 4 cards: Total Leads, Nuevos Hoy, Seguimientos Pendientes, En Pipeline |
| Búsqueda | ✅ Input de búsqueda por nombre/email en Server Component |
| Filtros | ✅ Soporte para etapa, prioridad, estado, fuente, canal via searchParams |
| Paginación | ✅ Server-side con navegación anterior/siguiente |

### Fase 3: Pipelines por Vertical ⏳ Pendiente

**Objetivo:** configuración de pipeline según la categoría del negocio.

| Tarea | Estado |
|---|---|
| Modelo PipelineConfig | ✅ Creado en schema Prisma |
| Configuración por vertical | ⏳ UI para configurar etapas por categoría |
| Campos personalizados | ⏳ Renderizado de campos extra |
| Reglas de transición | ⏳ Validación de movimientos |
| Labels/etiquetas | ⏳ Tags predefinidos por vertical |

### Fase 4: Automatizaciones ⏳ Pendiente

**Objetivo:** seguimiento automático y notificaciones multi-canal.

| Tarea | Estado |
|---|---|
| Recordatorios | ⏳ Push/email cuando vence `fechaSeguimiento` |
| Lead frío | ⏳ Marcar inactivo después de N días sin contacto |
| Conversión | ⏳ Al pasar a CONVERTIDO, sugerir crear Cliente |
| Plantillas | ⏳ Mensajes predefinidos para WhatsApp, email |
| Integración con Automation Engine | ⏳ Triggers y actions del motor existente |

### Fase 5: Dashboard ⏳ Pendiente

**Objetivo:** métricas de ventas, reportes, importación/exportación.

| Tarea | Estado |
|---|---|
| Dashboard de ventas | ⏳ Leads por etapa, tasa de conversión, tiempo promedio |
| Reporte de conversión | ⏳ De dónde vienen los leads que convierten |
| Importación | ⏳ CSV de contactos existentes |
| Exportación | ⏳ Descargar leads filtrados |
| Métricas por canal | ⏳ Qué canal genera mejores resultados |

---

## Archivos del Módulo

### Archivos creados

| Archivo | Descripción |
|---|---|
| `prisma/schema/crm.prisma` | Schema Prisma: Lead, NotaSeguimiento, Conversacion, Mensaje, PipelineConfig |
| `src/modules/crm/types.ts` | Interfaces TypeScript: Lead, NotaSeguimiento, CrmStats, PipelineConfig, filtros, paginación |
| `src/modules/crm/queries.ts` | Queries: getLeads (con filtros/paginación), getLeadById, getStats, getPipelineConfig |
| `src/modules/crm/lead-actions.ts` | Server Actions: createLead, updateLead, deleteLead, moveToStage, assignLead, fetchLeadDetails |
| `src/modules/crm/nota-actions.ts` | Server Actions: createNota, deleteNota |
| `src/app/(admin)/admin/crm/page.tsx` | Server Component: carga leads/stats, renderiza PipelineBoard, paginación |
| `src/app/(admin)/admin/crm/pipeline-board.tsx` | Client Component: tablero Kanban, drag & drop, diálogos, sheet de detalle |
| `src/app/(admin)/admin/crm/paleta.ts` | Constantes de colores para etapas (ETAPA_CHIP) y prioridades (PRIORIDAD_PUNTO) |
| `src/components/crm/CrmTabs.tsx` | Componente de navegación por secciones del CRM |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/modules/capacidades/catalogo.ts` | Agregada capacidad `CRM` con secciones: leads, seguimiento, conversaciones, pipeline, configuracion |
| `src/lib/auth/permissions.ts` | Agregada sección `leads` al sistema de permisos |
| `src/lib/auth/funciones.ts` | Agregada función `leads: 'Leads'` |
| `src/app/(admin)/admin/crm/layout.tsx` | Layout con guard `requireSection('leads')`, header con CrmTabs |

---

## Decisiones de Diseño

### 1. Sin enums Prisma

El schema usa strings en lugar de enums Prisma. Ventajas:
- Sin migración `ALTER TYPE` para agregar valores
- Los tipos se controlan 100% en código TypeScript (string-literal types)
- Más fácil de extender sin tocar la BD

### 2. Config-driven por vertical

Usamos el sistema de capacidades existente para configuración por vertical.
Cada categoría define sus etapas de pipeline default y campos
personalizados. Sin config = defaults razonables (fail-open para lo
existente).

### 3. Multi-tenant

`companyId` en todos los modelos. Un lead pertenece a una empresa. Un admin
solo ve los leads de su empresa. El superadmin puede ver todos.

### 4. Fail-open para config, fail-closed para acceso

- Si falta configuración de pipeline, usar etapas default.
- Si falta la capacidad CRM, la sección no carga (fail-closed).
- Si falta `companyId` en el token, denegar acceso (fail-closed).

### 5. No duplicar motores

El CRM no crea un motor de scoring propio: reutiliza lo que exista en la
plataforma. No crea un motor de segmentación: usa el existente. No crea un
motor de notificaciones: integra con el existente.

### 6. URLs estables

`/admin/crm` es la ruta principal. No se mueve ni se renombra. Siguiendo la
regla D5, las URLs del CRM son permanentes desde el día uno.

### 7. Migración sin downtime

La migración Prisma es idempotente y se corre antes del deploy. El código
tolera que las tablas no existan aún (patrón ya usado en seguimiento,
adquisición, citas).

---

## Migración

> **Nota:** La migración real se ejecuta con `bun run db:push` o
> `bun run db:migrate`. El siguiente SQL es referencia del schema
> generado por Prisma.

```sql
-- Tablas del CRM (generadas por Prisma schema)
-- lead, nota_seguimiento, conversacion, mensaje, pipeline_config

-- Lead
CREATE TABLE IF NOT EXISTS "leads" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "clienteId" TEXT,
  "nombre" TEXT NOT NULL,
  "email" TEXT,
  "telefono" TEXT,
  "fuente" TEXT NOT NULL DEFAULT 'ORGANICO',
  "canal" TEXT NOT NULL DEFAULT 'WEB',
  "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
  "etapa" TEXT NOT NULL DEFAULT 'NUEVO',
  "score" INTEGER,
  "fechaSeguimiento" TIMESTAMP(3),
  "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
  "asignadoA" TEXT,
  "notas" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- NotaSeguimiento
CREATE TABLE IF NOT EXISTS "notas_seguimiento" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "leadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contenido" TEXT NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'NOTA',
  "fechaProxima" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notas_seguimiento_pkey" PRIMARY KEY ("id")
);

-- Conversacion
CREATE TABLE IF NOT EXISTS "conversaciones" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "leadId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "canal" TEXT NOT NULL,
  "canalThreadId" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
  "ultimoMensaje" TEXT,
  "ultimaFecha" TIMESTAMP(3),
  "noLeidos" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversaciones_pkey" PRIMARY KEY ("id")
);

-- Mensaje
CREATE TABLE IF NOT EXISTS "mensajes" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "conversacionId" TEXT NOT NULL,
  "direccion" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "contenido" TEXT NOT NULL,
  "metadata" JSONB,
  "proveedorMsgId" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'ENVIADO',
  "creadoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mensajes_pkey" PRIMARY KEY ("id")
);

-- PipelineConfig
CREATE TABLE IF NOT EXISTS "pipeline_configs" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "companyId" TEXT NOT NULL,
  "categoria" TEXT NOT NULL,
  "stages" JSONB NOT NULL,
  "camposCustom" JSONB NOT NULL,
  "automatizaciones" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pipeline_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_configs_companyId_key" UNIQUE ("companyId")
);

-- Índices
CREATE INDEX IF NOT EXISTS "leads_companyId_idx" ON "leads"("companyId");
CREATE INDEX IF NOT EXISTS "leads_companyId_estado_idx" ON "leads"("companyId", "estado");
CREATE INDEX IF NOT EXISTS "leads_companyId_etapa_idx" ON "leads"("companyId", "etapa");
CREATE INDEX IF NOT EXISTS "leads_fechaSeguimiento_idx" ON "leads"("fechaSeguimiento");
CREATE INDEX IF NOT EXISTS "leads_asignadoA_idx" ON "leads"("asignadoA");
CREATE INDEX IF NOT EXISTS "notas_seguimiento_leadId_idx" ON "notas_seguimiento"("leadId");
CREATE INDEX IF NOT EXISTS "notas_seguimiento_leadId_createdAt_idx" ON "notas_seguimiento"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "conversaciones_companyId_idx" ON "conversaciones"("companyId");
CREATE INDEX IF NOT EXISTS "conversaciones_leadId_idx" ON "conversaciones"("leadId");
CREATE INDEX IF NOT EXISTS "conversaciones_canal_idx" ON "conversaciones"("canal");
CREATE INDEX IF NOT EXISTS "mensajes_conversacionId_createdAt_idx" ON "mensajes"("conversacionId", "createdAt");

-- Foreign keys
ALTER TABLE "leads" ADD CONSTRAINT "leads_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notas_seguimiento" ADD CONSTRAINT "notas_seguimiento_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversaciones" ADD CONSTRAINT "conversaciones_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_conversacionId_fkey"
  FOREIGN KEY ("conversacionId") REFERENCES "conversaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Prueba manual

### Flujo Kanban (implementado)

1. **Sin permisos:** entrar a `/admin/crm` sin permiso `leads` → redirige a `/admin/dashboard`.
2. **Con permisos:** entrar a `/admin/crm` → carga el tablero Kanban con 7 columnas.
3. **Crear lead:** presionar `+` en cualquier columna → completar formulario → lead aparece en esa columna.
4. **Mover lead:** arrastrar una tarjeta a otra columna → se actualiza la etapa.
5. **Ver detalle:** hacer click en una tarjeta → se abre sheet lateral con tabs Info/Notas.
6. **Editar lead:** en el detalle, presionar "Editar" → modificar campos → guardar.
7. **Agregar nota:** en el tab "Notas", escribir y presionar `+` → nota aparece en la timeline.
8. **Eliminar lead:** en el detalle, presionar "Eliminar" → confirmar → lead cambia a DESCARTADO.
9. **Buscar:** escribir en el input de búsqueda → filtra por nombre/email.
10. **Estadísticas:** las 4 cards muestran total, nuevos hoy, pendientes y en pipeline.

---

## Documentos relacionados

- `docs/ESTRATEGIA-PLATAFORMA.md` — estrategia general de la plataforma
- `docs/CAPACIDADES.md` — sistema de capacidades y catálogo
- `docs/CITAS.md` — módulo de citas (integración cercana)
- `docs/SEGUIMIENTO-BENEFICIOS.md` — motor de seguimiento existente
- `docs/ENGAGEMENT_ENGINE.md` — motor de engagement
