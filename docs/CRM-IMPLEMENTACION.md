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

## Arquitectura

El CRM se integra con los módulos existentes de la plataforma sin crear
islas de datos. Usa los mismos patrones probados: Server Actions para
mutaciones, Prisma para queries, y el sistema de capacidades para
encender/apagar por empresa.

### Capa de presentación

- **Ruta:** `/admin/crm` dentro del shell de la app (bajo la capacidad
  `CRM`, apagada por defecto).
- **Componentes:** vista Kanban (tablero de pipeline), vista lista, detalle
  de lead con timeline de seguimiento.
- **Filtros:** por estado, etapa, prioridad, asignado, rango de fechas.

### Capa de lógica (Server Actions)

Ubicada en `src/modules/crm/` siguiendo el patrón existente:

```
src/modules/crm/
├── lead-actions.ts        # CRUD de leads
├── seguimiento-actions.ts  # Notas, llamadas, emails
├── queries.ts             # Queries Prisma
└── types.ts               # Tipos compartidos
```

Cada acción valida: (1) el usuario tiene rol ADMIN_EMPRESA o superior, (2)
el lead pertenece a su `companyId`, (3) la capacidad `CRM` está encendida.

### Capa de datos

Prisma schema con modelos `Lead` y `NotaSeguimiento` (ver sección
siguiente). Multi-tenant por `companyId` en todos los modelos.

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

### Lead

Representa un prospecto o contacto potencial. No es un cliente: un lead se
convierte en cliente cuando completa registro y activa membresía.

```prisma
model Lead {
  id                String          @id @default(uuid())
  companyId         String
  company           Company         @relation(fields: [companyId], references: [id])
  clienteId         String?
  cliente           Cliente?        @relation(fields: [clienteId], references: [id])

  nombre            String
  email             String?
  telefono          String?
  fuente            String          // ORGANICO, PAGADO, REFERENCIA, EVENTO, OTRO
  canal             String          // WHATSAPP, INSTAGRAM, FACEBOOK, TELEFONO, PRESENCIAL, WEB
  estado            String          @default("ACTIVO") // ACTIVO, INACTIVO, CONVERTIDO, DESCARTADO
  etapa             String          @default("NUEVO")  // NUEVO, CONTACTADO, INTERESADO, PROPUESTA, NEGOCIACION, GANADO, PERDIDO
  score             Int?            // 0-100, scoring automático
  fechaSeguimiento  DateTime?       // próxima fecha de contacto
  prioridad         String          @default("MEDIA") // BAJA, MEDIA, ALTA, URGENTE
  asignadoA         String?         // userId del responsable
  notas             String?
  tags              String[]        // etiquetas libres
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  notasSeguimiento  NotaSeguimiento[]

  @@index([companyId])
  @@index([companyId, estado])
  @@index([companyId, etapa])
  @@index([fechaSeguimiento])
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
  userId          String      // quién registró
  contenido       String      // texto de la nota
  tipo            String      // NOTA, LLAMADA, EMAIL, WHATSAPP, REUNION
  fechaProxima    DateTime?   // fecha sugerida para siguiente contacto
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

### Enums Prisma

```prisma
enum LeadEstado {
  ACTIVO
  INACTIVO
  CONVERTIDO
  DESCARTADO
}

enum LeadEtapa {
  NUEVO
  CONTACTADO
  INTERESADO
  PROPUESTA
  NEGOCIACION
  GANADO
  PERDIDO
}

enum LeadPrioridad {
  BAJA
  MEDIA
  ALTA
  URGENTE
}
```

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

### Fase 1: Fundamentos (Semanas 1-2)

**Objetivo:** Modelo de datos funcional, CRUD básico, vista lista.

| Tarea | Detalle |
|---|---|
| Migración Prisma | Crear tablas `Lead` y `NotaSeguimiento` con índices |
| Server actions CRUD | Crear, leer, actualizar, eliminar leads |
| Vista lista | Tabla con filtros básicos (estado, etapa, prioridad) |
| Ficha de lead | Vista detalle con timeline de seguimiento |
| Crear nota | Formulario para agregar notas de seguimiento |
| Capacidad CRM | Agregar al catálogo, nace apagada |

**Verificación:** CRUD completo funciona, leads se guardan con companyId
correcto, notas aparecen en timeline.

### Fase 2: Kanban Board (Semanas 3-4)

**Objetivo:** Tablero visual tipo Trello para el pipeline de ventas.

| Tarea | Detalle |
|---|---|
| Tablero Kanban | Columnas por etapa del pipeline |
| Drag & drop | Mover leads entre etapas con mouse/touch |
| Tarjeta de lead | Nombre, fuente, canal, score, prioridad, responsable |
| Filtros avanzados | Por fuente, canal, asignado, rango de fechas |
| Búsqueda | Buscar por nombre, email, teléfono |

**Verificación:** un lead se crea, aparece en Kanban, se mueve entre
columnas, los filtros funcionan.

### Fase 3: Pipelines por Vertical (Semanas 5-6)

**Objetivo:** configuración de pipeline según la categoría del negocio.

| Tarea | Detalle |
|---|---|
| Configuración por vertical | Etapas default por categoría (Car Wash, Barbería, etc.) |
| Campos personalizados | Campos extra que cada vertical necesita |
| Reglas de transición | Qué etapas se pueden saltar, cuáles son obligatorias |
| Labels/etiquetas | Tags predefinidos por vertical |

**Verificación:** dos empresas de distintas categorías ven pipelines
diferentes, las reglas se aplican.

### Fase 4: Automatizaciones (Semanas 7-8)

**Objetivo:** seguimiento automático y notificaciones multi-canal.

| Tarea | Detalle |
|---|---|
| Recordatorios | Push/email cuando vence `fechaSeguimiento` |
| Lead frío | Marcar inactivo después de N días sin contacto |
| Conversión | Al pasar a CONVERTIDO, sugerir crear Cliente |
| Plantillas | Mensajes predefinidos para WhatsApp, email |
| Integración con Automation Engine | Triggers y actions del motor existente |

**Verificación:** un lead sin seguimiento genera alerta, la conversión crea
el Cliente, las plantillas envían correctamente.

### Fase 5: Dashboard (Semanas 9-10)

**Objetivo:** métricas de ventas, reportes, importación/exportación.

| Tarea | Detalle |
|---|---|
| Dashboard de ventas | Leads por etapa, tasa de conversión, tiempo promedio |
| Reporte de conversión | De dónde vienen los leads que convierten |
| Importación | CSV de contactos existentes |
| Exportación | Descargar leads filtrados |
| Métricas por canal | Qué canal genera mejores resultados |

**Verificación:** dashboard muestra datos reales, export CSV funciona,
métricas son consistentes con los datos.

---

## Decisiones de Diseño

### 1. Extender SolicitudEmpresa, no reemplazar

El modelo `SolicitudEmpresa` ya existe para registros de empresa. El CRM
trabaja con leads que pueden o no convertirse en empresas. Mantenemos
separados los conceptos: un lead es un prospecto, una solicitud es una
empresa en proceso de alta.

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

```sql
-- Crear tablas del CRM (correr antes del deploy)
-- La migración es idempotente: si las tablas ya existen, no falla.

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

-- Índices
CREATE INDEX IF NOT EXISTS "leads_companyId_idx" ON "leads"("companyId");
CREATE INDEX IF NOT EXISTS "leads_companyId_estado_idx" ON "leads"("companyId", "estado");
CREATE INDEX IF NOT EXISTS "leads_companyId_etapa_idx" ON "leads"("companyId", "etapa");
CREATE INDEX IF NOT EXISTS "leads_fechaSeguimiento_idx" ON "leads"("fechaSeguimiento");
CREATE INDEX IF NOT EXISTS "notas_seguimiento_leadId_idx" ON "notas_seguimiento"("leadId");
CREATE INDEX IF NOT EXISTS "notas_seguimiento_leadId_createdAt_idx" ON "notas_seguimiento"("leadId", "createdAt");

-- Foreign keys
ALTER TABLE "leads" ADD CONSTRAINT "leads_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leads" ADD CONSTRAINT "leads_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notas_seguimiento" ADD CONSTRAINT "notas_seguimiento_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Prueba manual de Fase 1

1. **Sin capacidad CRM:** entrar a `/admin/crm` → no carga (fail-closed).
2. **Encender CRM:** desde `/superadmin/capacidades`, activar la capacidad
   para la empresa de prueba.
3. **Crear lead:** formulario con nombre, email, teléfono, fuente, canal.
   → aparece en la vista lista con estado ACTIVO y etapa NUEVO.
4. **Editar lead:** cambiar etapa de NUEVO a CONTACTADO.
   → se actualiza, el timestamp de modificación cambia.
5. **Agregar nota:** escribir nota tipo LLAMADA.
   → aparece en la timeline del lead, con fecha y autor.
6. **Eliminar lead:** borrar un lead.
   → desaparece de la lista, las notas se borran en cascada.
7. **Filtrar:** buscar por nombre, filtrar por estado ACTIVO.
   → solo muestran los que coinciden.

---

## Documentos relacionados

- `docs/ESTRATEGIA-PLATAFORMA.md` — estrategia general de la plataforma
- `docs/CAPACIDADES.md` — sistema de capacidades y catálogo
- `docs/CITAS.md` — módulo de citas (integración cercana)
- `docs/SEGUIMIENTO-BENEFICIOS.md` — motor de seguimiento existente
- `docs/ENGAGEMENT_ENGINE.md` — motor de engagement
