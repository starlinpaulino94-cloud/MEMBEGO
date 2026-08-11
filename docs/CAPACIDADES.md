# Capacidades por empresa (Plataforma modular · E1)

> Fundaciones de la plataforma modular (docs/ESTRATEGIA-PLATAFORMA.md):
> cada empresa tiene una **categoría** (Car Wash…) que le da un **paquete
> base** de capacidades, y **overrides** para encender/apagar puntualmente.
> Fuente de verdad del catálogo: `src/modules/capacidades/catalogo.ts`.

## Cómo funciona

1. **Categoría**: `Company.type` legacy ("carwash"…) → categoría del catálogo
   (`CAR_WASH`), o un override explícito en el JSON. Solo CAR_WASH está
   operativa; BARBERIA/RESTAURANTE/GYM son valores reservados (E6+).
2. **Paquete base**: `CAPACIDADES_BASE[categoria]` — para CAR_WASH incluye
   TODO lo activo hoy en producción (regla D4: nada desaparece).
3. **Overrides**: `companies.capacidades` JSON
   `{ categoria?, overrides?: { CAPACIDAD: boolean } }` (migración
   `20260758_capacidades`, idempotente). `null` = paquete base.
4. **Resolutor** (`resolver.ts`): cacheado 5 min con tag `CAPACIDADES_TAG`
   (el panel E4 debe `revalidateTag` al guardar). **Fail-open total**: BD
   caída, columna sin migrar o empresa sin config = todo lo actual permitido.
5. **Barrera real**: `requireSection` (guards.ts) ahora exige rol **Y**
   capacidad. Solo gatea las secciones mapeadas en `SECCIONES_POR_CAPACIDAD`
   (citas, seguimiento, gamificación) — el núcleo (clientes, membresías,
   pagos…) no está mapeado y **no puede apagarse por error**. El superadmin
   nunca se gatea.

## Catálogo v1

| Capacidad | Controla | CAR_WASH base |
|---|---|---|
| `NAVEGACION_V2` | Oculta los módulos operativos del menú MembeGo (viven solo en la app; interruptor D7, E2) | ❌ apagada |
| `CITAS` | Sección citas | ✅ |
| `SEGUIMIENTO` | Sección seguimiento | ✅ |
| `RULETA` | Sección gamificación | ✅ |
| `GIFT_CARDS` | (flujo regalos — cableado fino en E4) | ✅ |
| `CITA_ANTES_DEL_QR` | (flujo del QR — cableado fino en E4) | ✅ |
| `POS_CAJA` | (caja del empleado — cableado fino en E4) | ✅ |
| `INVENTARIO` | Módulo futuro (P2 · E5) | ❌ |
| `COLA_VEHICULOS` | Módulo futuro (P2 · E5) | ❌ |
| `EVIDENCIA_FOTOS` | Módulo futuro (P2 · E5) | ❌ |

## API para el equipo

- `getCapacidadesEmpresa(companyId)` → `{ categoria, activas, navegacionV2 }`.
- `tieneCapacidad(companyId, 'CITAS')` → boolean (fail-open).
- `seccionPermitidaPorCapacidades(companyId, seccion)` — la usa
  `requireSection`; P1 la puede usar para filtrar menús (E2).
- `navegacionV2` es la bandera del interruptor para P1-T3.
- E4 (P2): al guardar el panel, `revalidateTag(CAPACIDADES_TAG)`.

## E2 entregada: launchpad + shell

- **Launchpad** `/admin/aplicaciones` (entrada "Aplicaciones" en el menú):
  tarjetas de las apps de la categoría de la empresa.
- **Shell Car Wash** `/admin/app/carwash`: cabecera con identidad del negocio
  (color/logo) + "← Volver a MembeGo" + menú de módulos operativos que
  ENLAZAN a las pantallas actuales (D5: ninguna URL se movió). Los módulos
  futuros (cola, inventario, evidencia) aparecen "próximamente" hasta
  encender su capacidad.
- **Interruptor D7**: con `NAVEGACION_V2` encendida (override
  `{"overrides":{"NAVEGACION_V2":true}}` en `companies.capacidades`), los
  módulos operativos salen del menú de MembeGo (capa `hiddenNav` del
  AppShell). Apagada = menú idéntico al de siempre. Encender/apagar NO
  requiere deploy (esperar el caché de 5 min o `revalidateTag`).

## E4 entregada: panel de administración + cableado

- **Panel superadmin** `/superadmin/capacidades` (entrada "Capacidades" en el
  menú Plataforma): selector de empresa, categoría y un toggle por capacidad.
  Guarda SOLO las diferencias contra el paquete base (si el paquete base
  evoluciona, las empresas sin override lo heredan solo) y deja AuditLog.
  Al guardar hace `revalidateTag(CAPACIDADES_TAG)` → los cambios aplican de
  inmediato (sin esperar los 5 min de caché).
- **Cableado real (además de las secciones citas/seguimiento/gamificación
  de E1):** `GIFT_CARDS` bloquea la compra de gift cards en el servidor;
  `CITA_ANTES_DEL_QR` controla la regla de agendar antes de mostrar el QR
  del regalo; `NAVEGACION_V2` controla el menú (E2).
- Pendiente de cablear cuando existan: `INVENTARIO`, `COLA_VEHICULOS`,
  `EVIDENCIA_FOTOS` (P2 · E5) — sus guards deben usar
  `tieneCapacidad(companyId, '…')` y son fail-closed por nacer fuera del
  paquete base.

## Migración (Supabase SQL Editor, idempotente)

```sql
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "capacidades" JSONB;
```

El módulo funciona sin correrla (fail-open); solo guardar overrides (E4) la
necesita.

## Prueba manual de E1 (documentada)

1. **Sin config** (estado actual de CARTOWN): todas las secciones abren igual
   que antes. ✔ (paquete base CAR_WASH cubre todo lo mapeado)
2. **Con categoría**: empresa `type='restaurante'` → mismo comportamiento
   (paquete base equivalente en v1).
3. **Con override**: `{"overrides":{"CITAS":false}}` en una empresa de prueba
   → /admin/citas queda bloqueada (server action devuelve no autorizado) y
   al quitar el override vuelve a funcionar (esperar el caché de 5 min o
   revalidar).

## E5 entregada: cola, inventario y fotos antes/después

Los tres módulos operativos nuevos de la app Car Wash, cada uno detrás de su
capacidad (todas NACEN APAGADAS — encenderlas por empresa en
/superadmin/capacidades):

| Capacidad | Ruta | Qué hace |
|---|---|---|
| `COLA_VEHICULOS` | /admin/app/carwash/cola | Tablero de pista: EN_ESPERA → EN_SERVICIO → LISTO → ENTREGADO (o CANCELADO). Alta rápida por placa; si la placa es de un vehículo registrado, la entrada se liga sola al cliente. |
| `INVENTARIO` | /admin/app/carwash/inventario | Productos con stock/mínimo/costo. El stock SOLO cambia con movimientos (ENTRADA/SALIDA/AJUSTE) que congelan el stock resultante. |
| `EVIDENCIA_FOTOS` | /admin/app/carwash/evidencias | Fotos antes/después por placa o ligadas a una entrada de la cola (desde la tarjeta de la pista, icono de cámara). |

Código: `src/modules/carwash/{cola,inventario,evidencias}[-actions].ts` y
`src/components/carwash/`. Todas las acciones exigen sección `app` + capacidad
encendida + pertenencia a la empresa, y dejan rastro en AuditLog.

Requisitos de infraestructura:

1. **Migración `20260759_e5_carwash`** (Supabase SQL Editor, idempotente):
   crea `cola_vehiculos`, `productos_inventario`, `movimientos_inventario` y
   `evidencias_foto`. Sin la migración, las pantallas muestran un aviso (no
   rompen nada).
2. **Bucket de Storage `evidencias`** + SUS POLÍTICAS RLS:
   `scripts/supabase-20260759-bucket-evidencias.sql`. Crear el bucket desde la
   interfaz NO basta — las fotos se suben desde el navegador con la sesión del
   empleado (rol `authenticated`) y las políticas de `storage.objects` de este
   proyecto se escriben POR NOMBRE de bucket. Sin la política de INSERT que
   nombre a `evidencias`, la subida falla con error de permisos aunque el
   bucket exista y sea público. El script trae verificación de 9 filas.

## E6 entregada: segunda categoría (la prueba de fuego)

La E6 no era "construir barbería": era **comprobar si montar una categoría
nueva se puede hacer solo con catálogo + navegación**. La respuesta fue *casi*:
la prueba destapó tres fugas y se corrigieron.

### Fugas encontradas y corregidas

| Fuga | Antes | Ahora |
|---|---|---|
| El launchpad decidía la app con un `if (categoria === 'CAR_WASH')` y la tarjeta escrita a mano. | Código | Lee `APPS_POR_CATEGORIA`. |
| El shell era la ruta fija `/admin/app/carwash/page.tsx` con sus módulos escritos a mano. | Código | Ruta genérica `/admin/app/[app]`; identidad y módulos salen del catálogo. |
| El menú lateral ocultaba 4 enlaces con una lista escrita en `(admin)/layout.tsx`. | Código | Cada app declara su `navOculta`. |
| El dashboard operativo vivía en `modules/carwash/` aunque no tiene nada de car wash. | Ubicación engañosa | Movido a `modules/apps/dashboard.ts`, compartido por todas las apps. |

### Cómo se agrega una categoría ahora

Una sola entrada en `src/modules/apps/catalogo.ts`:

```ts
BARBERIA: {
  slug: 'barberia',
  nombre: 'Barbería',
  descripcion: '…',
  icon: 'Scissors',
  modulos: [ESCANER, CITAS, SEGUIMIENTO, /* … */],
  navOculta: NAV_SERVICIOS,
},
```

Cero módulos nuevos, cero columnas nuevas, cero cambios en el núcleo. Los
módulos apuntan a las pantallas que YA existen (regla D5: ninguna URL se mueve).

### Rutas

- `/admin/app/carwash` → sigue funcionando **igual** (la resuelve la ruta
  dinámica; el manifiesto del build lo confirma). Los enlaces que ya usa el
  equipo no cambian.
- `/admin/app/barberia` → nuevo, para empresas de categoría BARBERIA.
- `/admin/app/<slug desconocido>` → 404 controlado.
- `/admin/app/carwash/{cola,inventario,evidencias,vehiculos}` → intactas; son
  módulos propios del Car Wash y conservan prioridad sobre la ruta dinámica.

### Cómo probar barbería sin afectar producción

1. Crear una empresa de prueba (o usar una existente que NO sea CARTOWN).
2. En `/superadmin/capacidades`, elegirla y cambiar su categoría a
   **Barbería / Salón**; encender `NAVEGACION_V2`.
3. Entrar como admin de esa empresa → *Aplicaciones* muestra la tarjeta
   **Barbería**, y dentro está el mismo tablero del día con sus módulos.

CARTOWN no se toca: su categoría sigue siendo CAR_WASH y su app es la misma.

### Lo que E6 NO hizo (a propósito)

Restaurante y gimnasio siguen **sin app**. Sus categorías existen en el catálogo
pero no tienen entrada en `APPS_POR_CATEGORIA`, así que el launchpad dice
"aún no tiene una aplicación especializada". Construirlas exige módulos nuevos
grandes (mesas, cocina, rutinas) y eso está fuera del alcance de esta etapa.


## Encender y apagar desde la terminal (`npm run cap`)

El panel `/superadmin/capacidades` sigue siendo la vía normal. El script existe
para el momento en que hay que **apagar algo en segundos** —estrenando una
capacidad en producción, con la pista llena— sin depender de que el panel
cargue ni de encontrar la casilla correcta con prisa.

```bash
npm run cap                          # estado de CARTOWN
npm run cap -- estado "El Fogón"     # estado de otra empresa
npm run cap -- on  NAVEGACION_V2     # encender
npm run cap -- off NAVEGACION_V2     # apagar  ← la vuelta atrás
npm run cap -- reset NAVEGACION_V2   # quitar el override (vuelve al paquete base)
npm run cap -- on NAVEGACION_V2 --si # sin confirmación
npm run cap -- sql on NAVEGACION_V2  # solo imprime el SQL, no conecta
```

**No duplica lógica**: importa `CAPACIDADES`, `CAPACIDAD_LABELS` y
`capacidadesEfectivas` de `src/modules/capacidades/catalogo.ts`, así que no
puede desincronizarse de lo que hace la app. Por eso es `.ts` y corre con tsx.

**Protecciones** (todas verificadas contra PostgreSQL 16 real):

- Pide confirmación antes de escribir, avisando que es producción. `--si` la salta.
- Si el nombre coincide con **varias** empresas, aborta y las lista, en vez de
  tocar la equivocada.
- Rechaza capacidades y acciones que no existen, listando las válidas.
- Relee de la base después de escribir y falla si no quedó como se esperaba.
- Si no hay nada que cambiar, lo dice y no escribe.

**Modo `sql`** para cuando no hay `DATABASE_URL` a mano: imprime la sentencia
para pegar en el SQL Editor de Supabase. Es la vía natural si administras la
base desde Supabase y no quieres montar un entorno local.

### Las tres sentencias listas para Supabase

```sql
-- VER el estado actual
SELECT name, type, capacidades FROM companies WHERE name ILIKE '%CARTOWN%';

-- ENCENDER
UPDATE companies
   SET capacidades = COALESCE(capacidades, '{}'::jsonb)
     || jsonb_build_object('overrides',
          COALESCE(capacidades->'overrides', '{}'::jsonb)
          || jsonb_build_object('NAVEGACION_V2', true))
 WHERE name ILIKE '%CARTOWN%';

-- APAGAR (la vuelta atrás: cambia true por false)
UPDATE companies
   SET capacidades = COALESCE(capacidades, '{}'::jsonb)
     || jsonb_build_object('overrides',
          COALESCE(capacidades->'overrides', '{}'::jsonb)
          || jsonb_build_object('NAVEGACION_V2', false))
 WHERE name ILIKE '%CARTOWN%';

-- VERIFICAR (correr siempre después)
SELECT name, capacidades->'overrides' AS overrides
  FROM companies WHERE name ILIKE '%CARTOWN%';
```

El cambio es **inmediato**: no hay que desplegar. La app lee `capacidades` en
cada request.

### Detalle: por qué el SQL usa `||` y no `jsonb_set`

`jsonb_set(capacidades, '{overrides,X}', ...)` **no crea el objeto intermedio**.
Si la fila todavía no tiene la clave `overrides` —el caso de cualquier empresa
que nunca haya tenido un override— el `UPDATE` reporta éxito y **no cambia
nada**. Es un no-op silencioso, el peor tipo de fallo.

La versión que usa el script fusiona con `||`, que crea `overrides` si falta y
conserva `categoria` y los demás overrides:

```sql
UPDATE companies
   SET capacidades = COALESCE(capacidades, '{}'::jsonb)
     || jsonb_build_object('overrides',
          COALESCE(capacidades->'overrides', '{}'::jsonb)
          || jsonb_build_object('NAVEGACION_V2', true))
 WHERE name ILIKE '%CARTOWN%';
```

---

## Módulos del cliente: qué se le enseña a quien compra

Las capacidades responden **qué puede hacer el negocio por dentro**. Falta la
pregunta simétrica: **de qué se le habla al cliente**. Son ejes distintos y
mezclarlos producía las dos averías que originaron esta sección.

**La avería 1 — pedirle un carro al cliente de un restaurante.** El motor de
requisitos preguntaba la categoría con `categoriaDeType`, que ante un tipo
ilegible devuelve `CAR_WASH` por diseño (fail-open). Sirve para *encender*
módulos; para *exigir* es exactamente el error opuesto. Y el formulario público
de registro de empresas ofrece `otro` como opción, así que el caso no era raro:
era el camino normal. Desde la corrección conviven dos funciones con respuestas
opuestas ante la duda:

| | Pregunta | Tipo desconocido |
|---|---|---|
| `categoriaDeType` | ¿qué módulos le enciendo? | `CAR_WASH` — no perder funciones |
| `categoriaExplicitaDeType` | ¿qué le exijo al cliente? | `null` — no cerrar puertas |

`capacidadesEfectivas` devuelve las dos (`categoria` y `categoriaExplicita`).
El motor de elegibilidad usa la explícita, y solo `CATEGORIAS_CON_VEHICULO`
—hoy `CAR_WASH`— puede pedir placa. Elegir la categoría a mano en el panel sí
cuenta como afirmación explícita.

**La avería 2 — módulos que abren en vacío.** Un negocio recién dado de alta
mostraba a sus clientes "Planes", "Mis membresías", "Invita y Gana" y "Mis
vehículos" sin haber publicado nada. Un módulo vacío no es una promesa: es una
puerta que no lleva a ningún sitio.

`MODULOS_CLIENTE` (catálogo) + `rutasOcultasCliente` (decisión pura) +
`modules/cliente/navDisponible.ts` (los datos) resuelven la visibilidad **en dos
capas, en este orden**:

1. **Automática** — ¿hay algo dentro? Es el criterio por defecto.
2. **Forzada** — `MOSTRAR` / `OCULTAR` guardados en
   `capacidades.modulosCliente` desde el panel del superadmin. Gana sobre la
   automática, porque el dato no sabe qué se lanza mañana ni qué se quiere
   guardar para después. `AUTO` no se guarda: es la ausencia de decisión, y
   escribirla congelaría el criterio el día que cambie.

| Módulo | Rutas | Se ve cuando |
|---|---|---|
| `MEMBRESIAS` | `/cliente/planes`, `/mis-membresias` | la empresa tiene planes activos **o** el cliente ya tiene una membresía |
| `OFERTAS` | `/cliente/promociones` | hay promociones vigentes |
| `BENEFICIOS` | `/cliente/mis-promociones` | el cliente compró beneficios o recibió regalos VIP |
| `REGALOS` | `/cliente/regalos` | `GIFT_CARDS` encendida **o** ya hay regalos/gift cards suyas |
| `INVITA_Y_GANA` | `/cliente/invita-y-gana` | hay campaña ACTIVA **y** el programa premia algo |
| `RULETA` | `/cliente/ruleta` | hay premios activos |
| `CITAS` | `/cliente/citas` | `CITAS` encendida **o** el cliente ya tiene citas |
| `VEHICULOS` | `/cliente/vehiculos` | la categoría trabaja con vehículos **o** el cliente ya registró uno |

Las condiciones "**o** el cliente ya tiene…" no son cortesía: quien pagó una
membresía o registró un vehículo no puede perderlos de vista porque el negocio
despublique su catálogo.

**Regla de fallo.** Si una consulta se cae, el módulo se considera disponible.
Un menú con un módulo de más es un defecto; un cliente sin acceso a su membresía
es una avería.

**Alcance.** Esto controla el **menú** (sidebar, barra inferior, buscador,
breadcrumb). Las rutas siguen respondiendo por URL con su estado vacío — no es
una barrera de seguridad y no pretende serlo. Lo que sí es barrera es el motor
de requisitos: los planes que no se pueden comprar no viajan al navegador.

El menú del cliente está cacheado 5 minutos con el tag `CAPACIDADES_TAG`, así
que un forzado desde el panel se ve al instante y el contenido nuevo aparece
solo a los pocos minutos.
