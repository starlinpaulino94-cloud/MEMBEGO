# CRM — Implementación (Prospectos + Leads)

> Documento de diseño e implementación del módulo CRM de MembeGo tras la
> reconciliación de la PR #455 (`feat/crm-database-connected`) con `main`
> (PR #453, Meta/mensajería). Describe el estado FINAL: dos conceptos CRM
> que conviven — **prospectos** (nacen de la mensajería) y **leads**
> (pipeline manual de ventas) — más el auto-reply portado a mensajería.
>
> **Última actualización:** septiembre de 2026.

---

## 1. Dos conceptos CRM que conviven

El CRM ya no es una sola cosa. Tras la reconciliación conviven dos modelos
de negocio distintos, con modelos de datos y orígenes propios:

| | **Prospectos** (main, PR #453) | **Leads** (rama, PR #455) |
|---|---|---|
| Origen | Automático: primera conversación entrante de un contacto **no cliente** | Manual: alta en el pipeline de ventas |
| Nacen de | `modules/mensajeria` → `modules/crm/prospectos` | CRUD a mano (`lead-actions.ts`) o alta directa |
| Embudo | `nuevo → contactado → cotizacion → negociacion → cerrado/perdido` | `NUEVO → CONTACTADO → INTERESADO → PROPUESTA → NEGOCIACION → GANADO/PERDIDO` |
| Vista | Tablero en `/admin/crm` | Kanban en `/admin/crm/leads` |
| Registro | Uno por contacto (UNIQUE `contactoId`) | Uno por empresa + teléfono (UNIQUE `[companyId, telefono]`) |

Ambos filtran por `companyId` (multi-tenant) y usan strings en vez de
enums Prisma. Los dos pueden convertirse en `Cliente` (los prospectos con
`convertirEnCliente`; los leads con `clienteId`).

> **Regla heredada de la reconciliación:** `main` gana como arquitectura de
> mensajería. Las conversaciones y mensajes SIEMPRE son los de
> `prisma/schema/mensajeria.prisma`; el envío saliente SIEMPRE pasa por
> `mensajeria/salientes.ts`.

---

## 2. Prospectos — nacen de la mensajería

Un prospecto nace **solo** de la primera conversación entrante de un
contacto que todavía no es cliente (`resolverContacto` devuelve
`nuevo: true` cuando se crea la fila `ContactoMensajeria`). Un cliente
conocido que escribe no genera prospecto: ya es cliente. Si la misma
persona escribe por dos canales, son dos contactos y dos prospectos; al
convertir uno, el otro se enlaza al mismo cliente por teléfono.

El registro ocurre en `modules/mensajeria/trasEntrante.ts`, que después de
persistir el mensaje entrante llama a
`registrarProspectoDesdeEntrante` (`modules/crm/prospectos.ts`) y emite los
eventos `mensaje.recibido` / `prospecto.creado`. Todo en try/catch: **nunca
lanza** — si el CRM falla, el webhook no reintenta.

### Módulo

| Archivo | Contenido |
|---|---|
| `src/modules/crm/prospectos.ts` | `registrarProspectoDesdeEntrante`, `listarProspectos`, `prospectoDe`, `cambiarEtapa`, `guardarNotas`, `convertirEnCliente`, `prospectosParaElegir` |
| `src/modules/crm/seguimientos.ts` | `crearSeguimiento`, `marcarSeguimientoHecho`, `listarSeguimientos` |
| `src/modules/crm/metricas.ts` | `metricasCrm` (tiempos de respuesta, tasa de conversión) |
| `src/modules/crm/actions.ts` | Server Actions: `cambiarEtapaAction`, `guardarNotasAction`, `convertirEnClienteAction`, `crearSeguimientoAction`, `marcarSeguimientoHechoAction` |
| `src/modules/crm/nucleo.ts` | `ETAPAS`, `TIPOS_SEGUIMIENTO`, `naceProspecto`, `tasaDeConversion`, etc. (sin enums) |

### Rutas

| Ruta | Qué muestra |
|---|---|
| `/admin/crm` | **Tablero de prospectos** (`ProspectosPage`, main). Ya NO es el Kanban. |
| `/admin/crm/prospectos/[id]` | Detalle de prospecto: cambiar etapa, notas, seguimientos, convertir en cliente |
| `/admin/crm/seguimientos` | Seguimientos de prospectos programados/pendientes |
| `/admin/crm/metricas` | Métricas de prospectos (conversión, tiempos) |
| `/admin/crm/conversaciones` | Bandeja unificada de mensajería (componentes `crm/bandeja/*`) |

### Verificación

- El layout entero del CRM (`layout.tsx`) aplica `requireSection('leads')`.
- `page.tsx` raíz exporta `ProspectosPage`; el Kanban vive en `leads/page.tsx`.
- Tras cada entrante, `trasEntrante.ts` invoca `registrarProspectoDesdeEntrante`
  solo para contactos no clientes.

---

## 3. Leads — pipeline manual de ventas (conservado)

Es el CRM clásico de la rama: alta manual, Kanban con drag & drop, notas de
seguimiento, estadísticas y configuración de pipeline por empresa. Se
conservó tal cual, movido de la raíz a `/admin/crm/leads`.

### Módulo (`src/modules/crm/`)

| Archivo | Contenido |
|---|---|
| `lead-actions.ts` | Server Actions: `createLead`, `updateLead`, `deleteLead` (soft → `DESCARTADO`), `moveToStage`, `assignLead`, `fetchLeadDetails` |
| `nota-actions.ts` | `createNota`, `deleteNota` (timeline en el detalle del lead) |
| `config-actions.ts` | `updateStages`, `updateCampos`, `updateAutomatizaciones`, `resetToDefaults` |
| `queries.ts` | `getLeads`, `getLeadById`, `getStats`, `getPipelineConfig`, `getOrCreatePipelineConfig` + métricas de leads |
| `types.ts` | Tipos string-literal: `Lead`, `NotaSeguimiento`, `PipelineConfig`, `CrmStats`, filtros, paginación |
| `seguimiento-actions.ts`, `seguimientos-queries.ts` | Actividades/agenda del pipeline |

### UI (`src/app/(admin)/admin/crm/`)

| Archivo | Descripción |
|---|---|
| `leads/page.tsx` | Server Component: carga leads/stats/filtros, renderiza el Kanban |
| `pipeline-board.tsx` | Client Component: tablero Kanban (7 columnas), drag & drop nativo, diálogos, sheet de detalle con tabs Info/Notas |
| `paleta.ts` | Colores de etapas y prioridades |
| `configuracion/stages-section.tsx`, `campo-section.tsx`, `automatizacion-section.tsx` | Configuración del pipeline por empresa (vía `config-actions.ts`) |

### Verificación

- `/admin/crm/leads/page.tsx` existe (Todo 15) e importa `PipelineBoard`.
- Cada acción valida permiso de sección (`requireSection`), pertenencia a
  `companyId` y que la sección esté habilitada.
- **Corregido el 24-09-2026:** nueve de esas guardias validaban la sección
  EQUIVOCADA. `lead-actions.ts` (crear, editar, eliminar, mover de etapa,
  asignar) y `autoReply-actions.ts` (leer, crear, editar, eliminar) pedían
  `requireSection('clientes', …)` mientras el resto del CRM pide `'leads'`.
  CAJERO, SUPERVISOR y GERENTE traen `clientes` y no `leads`: no podían abrir
  `/admin/crm` y aun así pasaban las nueve, porque una server action se
  despacha por su id desde cualquier ruta permitida. Además, al no estar esos
  códigos en `FUNCIONES_POR_SECCION`, el editor de Permisos los descartaba al
  validar y **nadie podía negarlos**. Hoy las nueve piden `'leads'`, están en
  el catálogo con su casilla, y `scripts/permisos-catalogo.mjs` lo vigila en
  el CI en las dos direcciones.
- `queries.ts` / `types.ts` del CRM de leads **no** referencian
  `Conversacion`/`Mensaje` (desacoplados en la reconciliación).

---

## 4. Auto-reply portado a mensajería

El motor de respuestas automáticas de la rama se portó de
`connect/autoReply.ts` (eliminado) a **`src/modules/mensajeria/autoReply.ts`**,
adaptado a los modelos de `mensajeria.prisma` y al envío por `salientes.ts`.

### Flujo de disparo

En `modules/mensajeria/trasEntrante.ts`, tras persistir el entrante, solo si
`canal === 'WHATSAPP' && tipo === 'text' && texto`:

1. `buscarAutoReply(companyId, texto)` — primera config activa (por `orden`)
   cuyas keywords matcheen (match case-insensitive con normalización NFD).
2. Si no matcheó y `esNueva` (`contacto.nuevo`) → `buscarBienvenida` —
   config con `esBienvenida: true` de menor `orden`.
3. Si no y `detectarIntencionExcursiones(texto)` (`intenciones.ts`) →
   `resolverUrlCatalogo` (config `CATALOGO`) o, de respaldo,
   `/empresas/{slug}/excursiones`.

Siempre fire-and-safe (try/catch propio): el entrante ya está guardado.

### Motor

| Símbolo | Rol |
|---|---|
| `buscarAutoReply` | Match de keywords contra el texto entrante |
| `buscarBienvenida` | Bienvenida de primer contacto (`esBienvenida`) |
| `resolverUrlCatalogo` | URL del catálogo de la empresa (config `CATALOGO`) |
| `responderAutoReply` | Orquestador: keyword → bienvenida → catálogo |
| `detectarIntencionExcursiones` | `src/modules/mensajeria/intenciones.ts` |

**Envío:** SIEMPRE vía `mensajeria/salientes.ts`
(`enviarTextoEnConversacion` con `origen: 'auto-reply'`), que comprueba la
ventana de 24 h (abierta justo después de un entrante) y **persiste** el
`Mensaje` SALIENTE. El motor no persiste nada a mano ni toca `whatsapp.ts`.

### Configuración

- **Modelo:** `AutoReplyConfig` en `prisma/schema/crm.prisma` (ver §5).
- **UI:** `/admin/crm/configuracion/auto-reply` (`page.tsx` +
  `auto-reply-section.tsx`) — CRUD de reglas.

### Verificación

- `src/modules/connect/autoReply.ts` **no existe** (borrado); el motor está
  en `mensajeria/autoReply.ts`.
- `autoReply.ts` no importa `whatsapp.ts` ni modelos de la rama; usa
  `salientes.ts` + `AutoReplyConfig`.
- La ruta del webhook (`connect/meta/webhook/route.ts`) es la de main
  (EventoMeta + cola); el auto-reply vive en `trasEntrante.ts`.

---

## 5. Modelo de datos

`prisma/schema/crm.prisma` reúne ambos mundos, sin enums Prisma y con
`companyId` en todos los modelos:

| Modelo | Origen | Tabla | Notas |
|---|---|---|---|
| `Prospecto` | main | `prospectos` (`@@map`) | UNIQUE `contactoId`; `etapa` en minúsculas; `clienteId` al convertir |
| `SeguimientoProspecto` | main | `seguimientos_prospecto` (`@@map`) | `programadoAt`/`hechoAt`, CASCADE con el prospecto |
| `Lead` | rama | `"Lead"` (verbatim) | Sin `@@map`; UNIQUE `[companyId, telefono]` |
| `NotaSeguimiento` | rama | `"NotaSeguimiento"` (verbatim) | CASCADE con el lead; `tipo`, `estado`, `fechaProxima` |
| `PipelineConfig` | rama | `"PipelineConfig"` (verbatim) | `companyId` UNIQUE; `stages`/`camposCustom`/`automatizaciones` en JSON |
| `AutoReplyConfig` | rama | `"AutoReplyConfig"` (verbatim) | UNIQUE `[companyId, nombre]`; `keywords String[]`, `esBienvenida`, `tipoRespuesta`, `catalogoPath`, `activa`, `orden` |

**Las conversaciones NO viven en el CRM.** `ContactoMensajeria`,
`Conversacion`, `Mensaje` y `PlantillaWhatsapp` están SOLO en
`prisma/schema/mensajeria.prisma`. `Prospecto` apunta a `ContactoMensajeria`
y guarda `conversacionId` opcional; el modelo `Lead` de la rama **ya no**
tiene relación `conversaciones` (eliminada en la reconciliación).

### Migración

Las tablas de la rama se añaden con una migración **aditiva e idempotente**:
`prisma/migrations/20260912_crm_leads_pipeline_autoreply/migration.sql`
(`Lead`, `NotaSeguimiento`, `PipelineConfig`, `AutoReplyConfig` — nombres
verbatim porque no llevan `@@map`; `IF NOT EXISTS` en todo). No toca las
tablas de prospectos (`20260911_crm_prospectos`) ni las de mensajería.

### Verificación

- `bunx prisma validate` pasa sin modelos duplicados.
- `Conversacion`/`Mensaje` aparecen solo en `mensajeria.prisma`, nunca en
  `crm.prisma`.
- `grep "Conversacion\|Mensaje" src/modules/crm/{queries,types}.ts` → sin
  resultados.

---

## 6. Permisos y capacidades

El CRM se controla con la sección `leads` (la misma para prospectos y
leads) dentro de la capacidad `CRM`:

```ts
// src/modules/capacidades/catalogo.ts
CRM: 'CRM: leads, seguimiento y pipeline comercial',
CRM: ['leads', 'seguimiento', 'conversaciones', 'pipeline', 'configuracion'],
```

| Dónde | Qué hay |
|---|---|
| `src/lib/auth/permissions.ts` | Sección `leads` registrada |
| `src/lib/auth/funciones.ts` | Sección `leads` con sus 9 funciones (prospectos y respuestas automáticas) |
| `src/modules/capacidades/catalogo.ts` | Capacidad `CRM` con sus secciones |

- Guard por sección: `requireSection('leads')` en `layout.tsx` del CRM (y
  en `configuracion/page.tsx`).
- **Fail-closed:** sin la capacidad CRM encendida, `/admin/crm/**` no carga.
- Multi-tenant: cada acción verifica que el registro pertenece al
  `companyId` del usuario.

### Verificación

- `leads` habilitable por empresa desde `/superadmin/capacidades`.
- Sin duplicación de claves tras fusionar la rama con main (Todo 18).

---

## 7. Despliegue

1. Aplicar la migración aditiva:
   ```bash
   bun run db:migrate:deploy
   ```
2. Reaplicar el aislamiento RLS de capa 2 (idempotente):
   ```bash
   # prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql
   ```
3. `bun run db:generate` para regenerar el cliente Prisma.

Las tablas nuevas heredan el mismo patrón de RLS por `companyId` del resto
del schema.

### Verificación

- La migración es 100 % aditiva: cuatro tablas nuevas, sin tocar
  `prospectos`/`seguimientos_prospecto` ni el schema de mensajería.
- No hay marcadores de conflicto (`<<<<<<<`) en `src/` ni `prisma/`.

---

## 8. Historial de la reconciliación

Las PR #453 y #455 construyeron en paralelo WhatsApp-messaging y CRM con
modelos incompatibles: ambas definían `Conversacion`/`Mensaje`, y el CRM de
la rama ocupaba `/admin/crm` con un Kanban que chocaba con el tablero de
prospectos de main. La estrategia aprobada fue **`main` gana como
arquitectura canónica de mensajería/CRM**: se conservaron el webhook con
`EventoMeta` + cola, el pipeline de `modules/mensajeria` (entrantes,
salientes con ventana de 24 h, bandeja) y el modelo `Prospecto` con su
embudo automático.

De la rama se **conservó** lo que no chocaba: el pipeline manual de ventas
(`Lead`, `NotaSeguimiento`, `PipelineConfig`) pasó a convivir junto a
`Prospecto`, con el Kanban reubicado en `/admin/crm/leads` y la página raíz
entregada a los prospectos de main. El **auto-reply** (keywords, bienvenida
y catálogo) se portó de `connect/autoReply.ts` a
`mensajeria/autoReply.ts`, enganchado en `trasEntrante.ts` y enviando
siempre por `mensajeria/salientes.ts` con `origen: 'auto-reply'`; su
configuración quedó en el modelo `AutoReplyConfig` dentro de `crm.prisma`.

Se descartaron los duplicados de la rama (el panel de chat propio y las
acciones/queries de conversaciones sobre los modelos viejos, además del
inbound de WhatsApp duplicado) por estar superseded por la mensajería de
main. El resultado es un schema unificado y aditivo
(`20260912_crm_leads_pipeline_autoreply`) donde prospectos automáticos y
leads manuales coexisten sin pisarse.

---

## Documentos relacionados

- `docs/connect/meta-arquitectura.md` — arquitectura Meta/mensajería (main)
- `docs/CAPACIDADES.md` — sistema de capacidades y catálogo
- `docs/RLS.md` — aislamiento por `companyId` y migraciones manuales
- `docs/SEGUIMIENTO-BENEFICIOS.md` — motor de seguimiento existente
