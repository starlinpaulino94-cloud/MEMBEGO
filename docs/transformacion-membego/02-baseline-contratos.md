# P0 · Línea base verificada y contratos (corte P1A)

Fecha: 2026-09-07 · Commit base: `19919e67` · Árbol previo: limpio.

## 1. Verificaciones ejecutadas sobre el corte

| Comando | Resultado |
|---|---|
| `tsc --noEmit` | 0 errores en producto (`src/`, `tests/`, `packages/`). Únicos errores: `.next/dev/types/routes.d.ts:320` (artefacto generado malformado, preexistente, fuera del código versionado) |
| `eslint` (archivos del corte) | 0 errores, 0 warnings tras retirar 2 imports muertos del dashboard |
| `tsx --test tests/ambito-empresa.test.ts` | 9/9 en verde |
| `node scripts/rls-cobertura.mjs` | 380 archivos con contexto; 23 con llamadas directas justificadas; 0 huecos |
| `git grep companyFilter` en `src/app/(admin)` | 0 resultados (quedan en módulos: `growth` migrado a `resolveCompanyId`, carwash a sesión) |
| `git grep conEmpresaOTodas` en `src/app/(admin)` | 0 resultados |

Suite completa pendiente de corrida final antes de cerrar P1A.

## 2. Contratos establecidos (P1A)

- `requireCompanyContext(user)` (`src/lib/auth/company-context.ts`): única vía de
  ámbito en páginas /admin. El rol nunca decide alcance; sin empresa redirige
  (SA → `/superadmin/empresas`, staff → `/admin/sin-empresa`, nunca `/login`).
- `companyFilter` eliminado de `modules/admin/queries.ts`; `adminMetrics(companyId)`.
- `conEmpresaOTodas` prohibido en páginas /admin (test `ambito-empresa.test.ts`);
  allowlist `sinEmpresa` en páginas: `metodos-pago/nuevo` (picker SA),
  `perfil` (selector `?empresa` SA + estados explícitos).
- Guards y capacidades fail-closed ante error de lectura o fila ausente.
- `cambiarEmpresaActiva` revierte `User.companyId` si falla el sync de Auth.

## 3. Decisiones D01–D08 (acta)

D01 QR activo derivado · D02 rechazo en Inter · D03 superadmin con skin hub
(pendiente F8) · D04 módulos sin Stitch derivados (pendiente F6) ·
D05 renovación opt-in · D06 tokens unificados retail · D07 éxito solo con
payload real · D08 sin contenido ilustrativo. Ninguna aplicada aún salvo D06
(base de F1) y D05 (capacidad existente conservada).

## 6. F1 · Carcasa retail + Cuenta + Menú + QR (S01–S04)

- `CustomerShell` (header degradado + buscador→`/cliente/buscar` + escáner→QR
  + avatar→Cuenta, barra ubicación→`/cliente/cerca`, pestañas en escritorio,
  dock 4 fijos en móvil) + `BottomNav` reescrito (Inicio·Cuenta·Mi QR·Menú).
- Inter en ámbito `.retail` (tokens `@theme` retail-*: única fuente) + lienzo
  claro forzado; AppShell sin dock (personal).
- N `/cliente/menu` (acordeón categorías→explorar, 8 filas filtradas por
  contenido, sesión, nota Cuenta>Configuración) y N `/cliente/qr` (vacío S04
  fiel + activo derivado D01: QR real, usos, vigencia, selector multi-pase).
- `/cliente/perfil` = Cuenta S02 (saludo, accesos, pestañas con conteos,
  membresías, banner, usar-de-nuevo, beneficios, invita, config+soporte,
  sesión) + sección Configuración con los formularios existentes intactos.
- D09 (nueva): la campana de notificaciones de S02 se omite hasta el centro
  de notificaciones (F7); sin campana decorativa. Píldora DO/ES omitida (sin
  i18n real).
- Deuda de diseño contenida (HEX 118≤121, clases 170=170, radios 0, micro 0).
- Pruebas: `tests/cliente-retail.test.ts` (6) + `movil-cliente` migrado.
  Suite completa: 1929/1929. Tipos: 0 en producto. Lint: limpio.

## 7. F2a · Home versionado + sinónimos (modelo y publicación)

- `HomeRevision` (BORRADOR→PROGRAMADA→PUBLICADA→PAUSADA→ARCHIVADA, solo esos
  caminos) + `HomeBloque` (7 tipos cerrados, único por revisión) +
  `BusquedaSinonimo` (global + empresa). Migración `20260913` aditiva.
- Publicar valida: hero 1–3 slides con entidades publicadas de la empresa,
  imágenes del storage propio, CTAs internos, vigencia futura. Auditoría
  COMPOSICION_* nueva. Programar no necesita cron (lectura efectiva).
- Sinónimos: tabla + expansión pura con tope; cableado al buscador en F2c.
- Pruebas: `tests/home-composicion.test.ts` (11). `prisma validate` OK.
  Etiquetas de bitácora para las 4 acciones nuevas. Suite completa: 1945/1945.

## 8. F2b · Editor de inicio (A05)

- `/admin/personalizacion` = editor (territorio, Borrador/Publicar/Programar/
  Pausar/Reanudar/Archivar, 7 bloques con orden y toggles, hero 1–3 slides con
  arte del storage propio, segmentación, preview 1:1 Visitante/Socio) +
  formulario de engagement existente intacto debajo.
- Acciones con estado recargan la página tras éxito (sin estados locales
  divergentes); preview 1:1 solo lectura, sin mutaciones.
- `tsc` salida 0 en todo el proyecto. Deuda contenida (clases 170=170).
  Suite completa: 1945/1945.

## 9. Reapertura de F2b antes de conectar F2c

La declaración anterior de F2b como cerrado no acredita el recorrido
guardar/publicar/ver ni fidelidad visual: no había evidencia de una ejecución
autenticada contra una base aislada. F2c continúa pendiente.

Corregido en esta revisión:

- El editor recupera `ctaDestino.tipo` y `ctaDestino.id`, sin convertir un
  destino plan/promoción/excursión en empresa al reabrir el borrador.
- La vigencia de `datetime-local` se serializa como instante ISO; una fecha
  inválida devuelve un error visible, no una promesa rechazada sin gestionar.
- Un fallo de escritura al publicar llega a la respuesta de error; ya no se
  absorbe antes de devolver `ok: true`.
- El módulo `use server` deja de reexportar una constante no asíncrona.

Evidencia nueva: 4 pruebas conductuales en `home-editor-contrato.test.ts`
aprobadas; TypeScript completo (`--noEmit --incremental false`) y ESLint
estricto de los archivos de este corte con salida 0.

Pendiente antes de activar el nuevo consumidor: RLS explícita para las tablas
de la migración `20260913`, selección correcta de revisión efectiva,
validación de destinos públicos al leer, aplicación real de segmentación y
prueba autenticada publicar → Inicio. No se aplicó ninguna migración ni se
utilizó la base configurada como si fuera una base de pruebas.

Entorno de validación: Docker no está disponible por comando; la CLI Supabase
sí existe. Las variables `E2E_SUPABASE_URL` y `E2E_BASE_URL` no están definidas
en el proceso. Esto no prueba qué contiene `.env`; no se presupone que esa
configuración apunte a un entorno desechable.

## 4. Estado RLS producción

DESCONOCIDO (sin cambios): los SQL y wrappers están en el repo; el rol efectivo
de `DATABASE_URL` y las políticas aplicadas no se verificaron contra la base
viva. Verificación requerida antes de F3.

## 5. P1B · Cobro separado de cumplimiento, cita atómica, dedupe real

- `PagoIntento` suma `fulfillmentEstado` (PENDIENTE|COMPLETADA|FALLIDA),
  `fulfillmentAt`, `fulfillmentError`, `fulfillmentIntentos`; `activadoAt`
  queda como reclamo del CARGO. `confirmarIntento` devuelve `entrega` y
  `reintentarEntrega` recupera FALLIDA→PENDIENTE con reclamo atómico, sin
  recobrar. Renovación con tarjeta marca la entrega en ambos caminos.
- Migración `20260912_p1b_cumplimiento_dedupe` (aditiva; rollback = DROP).
- `reservarCita`: candado `FOR UPDATE` por empresa + vínculo `compraId`
  dentro de la misma transacción (20260756 garantiza la columna).
- Notificaciones: `dedupeKey` + `@@unique([userId, dedupeKey])`; la misma
  clave por lote convierte el reintento en no-op.
- Pruebas: `tests/pagos-cumplimiento.test.ts` (9). Suite completa: 1929/1929.
  Tipos: 0 errores en producto. Lint del corte: limpio. RLS: sin huecos.

---

## 10. Auditoría de avance y cierre técnico de F2c (2026-09-08)

Punto de partida: commit `19919e67` + **árbol de trabajo sin confirmar** (121
archivos modificados, 30 sin seguimiento). Todo F1, F2a, F2b y F2c vivían solo
en disco, sobre la rama `claude/meta-integracion` (8 commits de Meta, aún sin
mezclar). No es una situación estable: se documenta como riesgo abierto.

### 10.1 Verificación real ejecutada sobre ese árbol

| Comando | Antes de este corte | Después |
|---|---|---|
| `tsc --noEmit --incremental false` | 0 errores | 0 errores |
| `eslint src tests --max-warnings=0` | 2 avisos (`opengraph-image`, preexistentes en HEAD) | igual |
| `npm test` | **1962 pruebas · 1 en rojo** | **1962 · 0 en rojo** |
| `SENTRY_UPLOAD=off npm run build` | salida 0 | salida 0 |
| `node scripts/rls-cobertura.mjs` | 387 archivos con contexto · 23 directos justificados · 0 huecos | igual |
| `npx prisma validate` | válido | válido |

La declaración anterior de «suite completa 1945/1945» no cubría F2c: la
reescritura del Inicio dejó en rojo `tests/cliente-sin-empresa.test.ts`.

### 10.2 Defectos encontrados y corregidos

1. **La prueba en rojo no era una regresión de conducta, sino de ubicación.**
   Buscaba `const sinEmpresa = !companyId` dentro de
   `cliente/inicio/page.tsx`; F2c partió esa pantalla en dos y la regla se
   mudó a `InicioPrevio.tsx`. La decisión se extrajo a
   `src/modules/cliente/primerPaso.ts` (función pura) y la guardia pasó a
   ejercitarla: 4 pruebas conductuales sustituyen al grep.

2. **La segmentación por radio dejaba el Inicio publicado invisible.**
   `admiteAudienciaHome` devolvía `false` cuando faltaba la ubicación de la
   persona *o* las coordenadas del negocio. Como el Inicio cae a la pantalla
   anterior cuando no hay composición admitida, el administrador publicaba,
   veía su vista previa correcta, y el cliente sin consentimiento de
   geolocalización —la mayoría— seguía viendo la app vieja, sin error ni
   aviso. El radio es un filtro positivo: solo puede excluir a quien sabemos
   dónde está. Corregido y cubierto con 3 pruebas (no existía ninguna).

3. **`CustomerShell` pintaba `BannerDemo` dos veces** (sobre el contenido y
   bajo el dock). Uno solo.

4. **Las pestañas de escritorio no decían en cuál estabas**: sin
   `aria-current` ni indicador visible, los cuatro destinos se veían y se
   anunciaban idénticos. Se extrajo `TabsEscritorio` (cliente) y la lista de
   destinos pasó a `src/components/layout/destinos-cliente.ts`, única fuente
   que consumen el dock móvil y las pestañas: la misma navegación en dos
   formatos ya no puede separarse.

### 10.3 Pendiente antes de dar F2c por cerrado

- **RLS de la migración `20260913` sin aplicar.** `20260914_home_rls`
  está escrita (políticas por inquilino, revocación a `anon`/`authenticated`,
  único parcial para sinónimos globales) pero **no ejecutada** contra ninguna
  base. Hasta entonces, las tres tablas nuevas viven sin RLS.
- **`scripts/verificar-home-rls.mts` y `verificar-home-e2e.mts` no se han
  ejecutado.** Ambos apuntan al proyecto Supabase `ybzhvfmybyyomwpjpaud` y
  crean empresas, usuarios de Auth, promociones y planes. El de RLS revierte
  por `ROLLBACK`; el E2E limpia al final, pero escribe de verdad mientras
  corre. **No se ejecutan sin decisión explícita sobre qué base es esa.**
- Sin esa corrida no hay evidencia de fidelidad visual por captura
  (390/768/1280) ni del recorrido publicar → ver → pausar.

### 10.4 Decisión abierta D10 · qué pasa con `InicioPrevio`

El Inicio tiene hoy dos pantallas: `InicioComercial` (retail, contrato Stitch)
y `InicioPrevio` (la anterior, íntegra: héroe del motor de experiencias,
`WalletStack`, prueba social, gamificación, onboarding, novedades). La segunda
es la que se ve mientras la empresa no publique composición.

El encargo pide retirar los restos visuales de la estructura anterior, pero
`InicioPrevio` es también el único sitio donde viven seis capacidades reales.
Retirarla sin reubicarlas pierde funciones. Recomendación: darles sitio en el
contrato retail (wallet → bloque propio o `Mi QR`; motor de experiencias →
bloque HERO derivado cuando no hay composición; el resto → Cuenta) y sustituir
el respaldo por un Inicio retail por defecto, no por la pantalla vieja.
Requiere aprobación porque cambia alcance.
