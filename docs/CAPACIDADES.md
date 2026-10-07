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
   (citas, seguimiento, gamificación, leads/CRM, supply, publicaciones,
   comunicación) — el núcleo (clientes, membresías, pagos…) no está mapeado y
   **no puede apagarse por error**. El superadmin nunca se gatea.

## Catálogo v1

| Capacidad | Controla | CAR_WASH base |
|---|---|---|
| `NAVEGACION_V2` | Oculta los módulos operativos del menú MembeGo (viven solo en la app; interruptor D7, E2) | ❌ apagada |
| `CITAS` | Sección citas | ✅ |
| `SEGUIMIENTO` | Sección seguimiento | ✅ |
| `RULETA` | Sección gamificación **y** la ruleta del cliente (`/cliente/ruleta`, acción de giro, acceso en Inicio y «Mis membresías») | ❌ apagada desde la Fase 0 |
| `GIFT_CARDS` | (flujo regalos — cableado fino en E4) | ✅ |
| `CITA_ANTES_DEL_QR` | (flujo del QR — cableado fino en E4) | ✅ |
| `POS_CAJA` | (caja del empleado — cableado fino en E4) | ✅ |
| `INVENTARIO` | Módulo futuro (P2 · E5) | ❌ |
| `COLA_VEHICULOS` | Módulo futuro (P2 · E5) | ❌ |
| `EVIDENCIA_FOTOS` | Módulo futuro (P2 · E5) | ❌ |
| `CRM` | Sección `leads` (todo `/admin/crm`, incluida la bandeja de conversaciones) | ✅ para empresas existentes; ❌ en tenants nuevos (ver «Defaults de la Fase 0») |
| `MENSAJERIA` | Sección `comunicacion` (`/admin/comunicacion`: canales, FAQ, conexión) | ✅ para empresas existentes; ❌ en tenants nuevos |
| `PUBLICACIONES` | Sección `publicaciones` (`/admin/publicaciones`) | ❌ apagada desde la Fase 0 |
| `HOME_BUILDER` | Editor de inicio dentro de `/admin/personalizacion` (**no** tiene sección propia: comparte página con el formulario de marca, que no se oculta) | ❌ apagada desde la Fase 0 |
| `CATALOGO_UNIFICADO` | Secciones `catalogo` (`/admin/catalogo`, Commerce Core · Fase 1) e `inventario` (`/admin/inventario`, Fase 2: existencias por variante y sucursal) | ❌ apagada para todos; se enciende empresa por empresa (Car Town primero) |
| `PEDIDOS_MEMBEGO` | Sección `pedidos-membego` (`/admin/pedidos-membego`, Commerce Core · Fase 3: pedidos del marketplace con atribución, confirmación del cliente y QR). Con ella la ficha pública de sus productos ofrece «Hacer un pedido» y «Mis pedidos» aparece en el menú del cliente | ❌ apagada para todos; solo tiene sentido en empresas con `CATALOGO_UNIFICADO` (las líneas del pedido son variantes del catálogo) |
| *(misma capacidad)* | Sección `facturacion-membego` (`/admin/facturacion-membego`, **«Mi cuenta Membego»**, Commerce Core · Fase 4): lo que la empresa le debe a Membego por esos pedidos —saldo, comisiones, estados de cuenta—, **solo lectura**. No tiene capacidad propia: cuelga de `PEDIDOS_MEMBEGO` | ❌ con ella |
| `DEALS_MARKETPLACE` | Sección `deals` (`/admin/deals`, Growth Engine · Fase 5: **ofertas con presupuesto**). Con ella (y las otras dos) la empresa publica descuentos sobre una variante de su catálogo que los clientes obtienen en `/ofertas`, en su ficha pública y en `/catalogo`, y canjean con el QR del pedido | ❌ apagada para todos; **exige `CATALOGO_UNIFICADO` y `PEDIDOS_MEMBEGO`** (el reclamo ES un pedido): sin las tres, la vitrina no enseña la oferta y reclamarla responde «no está disponible» |
| *(misma capacidad que los pedidos)* | Sección `resultados-membego` (`/admin/resultados-membego`, **«Resultados Membego»**, Analítica · Fase 6): cuántos clientes nuevos, pedidos y ventas le produjo Membego a la empresa, qué le costó (comisiones, retorno, costo por cliente nuevo) y cómo rinde cada oferta, **solo lectura**. No tiene capacidad propia: cuelga de `PEDIDOS_MEMBEGO` | ❌ con ella |

### Cómo encender los pedidos Membego en una empresa

`PEDIDOS_MEMBEGO` tampoco está en ningún paquete base. Se enciende, además de
`CATALOGO_UNIFICADO`, con un override por empresa (`overrides: { CATALOGO_UNIFICADO: true,
PEDIDOS_MEMBEGO: true }`). Hace falta que la empresa esté publicada y tenga al menos una
sucursal activa. Sin ella, la acción de pedir responde «este producto no está disponible
para pedir» y el panel se niega. Si se apaga con pedidos ya hechos, el cliente conserva
«Mis pedidos» y el historial.

**Qué pasa con la plata (Fase 4).** Con `PEDIDOS_MEMBEGO` encendida, cada pedido de
marketplace que se **completa** (QR) le cobra a la empresa una comisión de Membego, en
la misma transacción: CPA fijo (RD$ 100 de serie) si el pedido no tiene el pago
verificado, o el 8 % de la base comisionable si lo tiene (modelo `HYBRID`, que el
superadmin puede cambiar por empresa en `/superadmin/facturacion`). La cuenta se crea
sola con esos valores y un límite de crédito de RD$ 5,000. **Encender la capacidad en una
empresa real es empezar a cobrarle**: avísale antes. Los pedidos que envuelven una compra
de Supply no comisionan (se liquidan por Supply Economics).

### Cómo encender las ofertas con presupuesto en una empresa

`DEALS_MARKETPLACE` tampoco está en ningún paquete base. Se enciende, además de
`CATALOGO_UNIFICADO` y `PEDIDOS_MEMBEGO`, con un override por empresa (`overrides: {
CATALOGO_UNIFICADO: true, PEDIDOS_MEMBEGO: true, DEALS_MARKETPLACE: true }`). La empresa
tiene que estar publicada y activa y tener al menos una sucursal activa donde canjear.

**Qué pasa con la plata (Fase 5).** Cada oferta tiene un **presupuesto** (un *tope*, no un pago
por adelantado): la empresa declara cuánto está dispuesta a pagar por traer clientes. Cada
vez que un cliente **canjea** (el empleado escanea el QR del pedido) Membego le cobra la
**cuota de la oferta** —el CPA de su cuenta, RD$ 100 de serie, **congelado al crear la oferta**—
en su cuenta Membego, y esa parte del presupuesto pasa de «apartada» a «gastada». Cuando el
presupuesto ya no alcanza para otro canje, la oferta se **pausa sola**; ampliar el presupuesto
la reabre. Si la cuenta Membego de la empresa está **suspendida**, no puede crear, publicar ni
reanudar ofertas ni se pueden obtener las que tiene publicadas. **Encender la capacidad en una
empresa real es empezar a cobrarle por canje**: avísale antes. Si se apaga con cupones ya
obtenidos, esos pedidos siguen su curso (se canjean o vencen) y la cuota se cobra igual.

### Cómo encender el catálogo unificado en una empresa

`CATALOGO_UNIFICADO` no está en ningún paquete base. Se enciende con un override
por empresa desde `/superadmin/capacidades` (`overrides: { CATALOGO_UNIFICADO: true }`).
Con ella: aparece «Catálogo» en el menú (*Oferta comercial*) y se abre
`/admin/catalogo`; sin ella, la sección se niega (`requireSection`) y la entrada
no se pinta. Los datos que se hayan creado se conservan si se apaga después.

El **inventario** (Fase 2) no tiene capacidad propia: cuelga de esta misma. Al
encenderla aparece también «Inventario» en el menú, y solo lleva existencias de
los productos que tienen activado «Controla inventario» en su ficha del
catálogo (los servicios no). Se activa por sucursal: hace falta al menos una
sucursal activa en la empresa.

### El puente Supply → Catálogo (empresa «de la casa»)

Las ofertas de Supply 2.0 son de Membego, no de una empresa. Para que aparezcan
en el catálogo y en `/catalogo` («Ofertas MembeGo») hace falta una **empresa de la
casa** que sea su dueña en el catálogo: el superadmin la designa en
`/superadmin/puente-supply`. Esa empresa necesita, **a mano**: estar activa y
publicada, no ser de demostración y tener `CATALOGO_UNIFICADO: true` en su
override (el panel muestra los requisitos pero no los enciende). Sin casa
designada el puente no hace nada. Retirar la casa archiva los ítems puente (se
conservan y se reactivan al designar una nueva).

## Defaults de la Fase 0 (Plan Maestro §8)

Ocultamiento de módulos secundarios mientras el foco pasa a Commerce Core y
Marketplace. Se hace con este mismo sistema, sin borrar datos:

| Módulo | Capacidad | Para empresas existentes | Para tenants nuevos |
|---|---|---|---|
| Gamificación / ruleta | `RULETA` | apagada | apagada |
| Publicaciones (blog) | `PUBLICACIONES` | apagada | apagada |
| Editor de inicio | `HOME_BUILDER` | apagada | apagada |
| CRM | `CRM` | **encendida** (no pierden nada) | apagada |
| Mensajería / comunicación | `MENSAJERIA` | **encendida** | apagada |

- **Existente vs. nuevo no es una fecha, es un override.** `CRM` y `MENSAJERIA`
  siguen en `CAPACIDADES_BASE`; los tres puntos de alta de empresa
  (`registrarEmpresa`, `crearEmpresaDesdeSolicitud`, `crearEmpresa`) y
  `duplicarEmpresa` escriben `capacidades: { overrides: CAPACIDADES_OVERRIDE_TENANT_NUEVO }`
  (`CRM: false`, `MENSAJERIA: false`). Cualquier alta nueva de empresa DEBE
  usar esa constante. La copia de `duplicarEmpresa` no hereda las capacidades
  del original: nace como tenant nuevo.
- **Reactivar** cualquiera es un override desde el panel de capacidades
  (`/superadmin/capacidades`); `RULETA`, `PUBLICACIONES` y `HOME_BUILDER`
  pueden volver a encenderse por empresa cuando se decida.
- **Dónde se cierra cada una.** Rutas de admin: `requireSection` vía
  `SECCIONES_POR_CAPACIDAD`. `HOME_BUILDER` (sin sección): la página
  `personalizacion` no pinta el editor y las acciones de `modules/home` se
  niegan. `RULETA` en el cliente: `/cliente/ruleta` redirige, `girarRuleta`
  responde «no disponible», y `navDisponible` fuerza oculta la ruta **aunque
  un `MOSTRAR` viejo del panel diga lo contrario**.
- **Los datos persisten.** Premios, jugadas, publicaciones e historial siguen
  en base de datos. Las publicaciones ya emitidas siguen viéndose en el perfil
  público de la empresa (solo se cierra la gestión).
- **La bandeja de conversaciones es del CRM**, no de `MENSAJERIA`:
  `/admin/crm/conversaciones` y sus acciones (`modules/mensajeria/actions.ts`)
  cuelgan de `leads`.
- **Puntos y niveles de gamificación no dependen de `RULETA`**: se derivan de
  hechos reales y siguen mostrándose; solo desaparece el acceso a la ruleta.
- Supply V1 **no** se ocultó en la Fase 0 (ver Plan Maestro, decisión abierta).
- Al sumar una capacidad nueva, hay cuatro listas que mantener en sincronía:
  `CAPACIDADES`/`CAPACIDAD_LABELS` (catálogo), `FUNCIONES_EMPRESA`
  (`modules/plataforma/conceptos.ts`), `CapacidadNav` (`nav-config.ts`) y
  `CAPACIDADES_DEL_MENU` (`modules/navegacion/contexto.ts`). Las pruebas
  `plataforma-conceptos`, `navegacion-espacios` y `capacidades-fase0` avisan si
  se separan.

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
| `RULETA` | `/cliente/ruleta` | hay premios activos **y** la capacidad `RULETA` está encendida (sin ella se oculta siempre, incluso con `MOSTRAR`) |
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
