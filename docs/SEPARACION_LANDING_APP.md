# Separación Landing · App del cliente · Paneles — diagnóstico y plan

> Estado: **diagnóstico, sin cambios de código**. Documento para aprobar antes de
> ejecutar. Complementa `docs/ARQUITECTURA_SEPARACION.md` (separación física por
> dominios, etapas 1–6) y `docs/ARQUITECTURA_OBJETIVO_V2.md` (dominios objetivo).
> Aquí se trata la separación **funcional** dentro del repositorio actual: qué
> pantalla pertenece a qué espacio y qué enlaces y flujos cruzan la frontera.

Fecha de la auditoría: 2026-10-09 · rama `claude/gracious-pasteur-87pexr`.

## Decisiones aprobadas (2026-10-09)

Estas condiciones reemplazan lo que el borrador original proponía donde se contradigan.

1. **Landing exclusivamente informativa.** Sin carritos, compras, reservas, redenciones ni operaciones comerciales, tampoco para el visitante anónimo. Se conservan las páginas de consulta (productos, promociones, empresas, excursiones) para SEO y enlaces compartidos; toda acción operativa se ejecuta desde la aplicación.
2. **App del cliente independiente.** Todo lo que el cliente hace existe dentro de `/cliente`, sin volver a la landing.
3. **Rutas nuevas aprobadas de forma provisional.** Antes de crear cada una se verifica que respete la organización actual y no duplique. Las excursiones comparten la capa de experiencia (un solo carrito visible, mismo patrón de componente con modo, mismo traspaso de inicio de sesión), no el modelo de datos: una excursión no es un ítem del catálogo y su reserva no es un pedido.
4. **Estado de sesión en la landing** con un componente de cliente ligero, sin volver dinámico el layout público.
5. **Se conservan** autenticación, autorización, aislamiento multiempresa, servicios, lógica de negocio y base de datos.
6. **URL públicas con valor** de SEO y enlaces compartidos se conservan. Las rutas operativas públicas que se retiren redirigen de forma segura, conservando destino y parámetros, sin bucles.
7. **Una fase a la vez**, un commit por fase. Antes de cada una se presentan archivos, cambios, riesgos y pruebas de aceptación, y se espera aprobación.
8. **Pruebas** unitarias, de integración y E2E por fase.

Efecto en el plan: la pregunta 3 de §7 queda resuelta en contra de la recomendación original. **No hay carrito anónimo**: el visitante ve la ficha y un botón que lleva a iniciar sesión y volver a la ruta de la app. Seguir empresa y reseñas son acciones del cliente; se mueven a la app salvo que producto decida otra cosa (marcadas «decisión de producto» en la lista de excepciones).

## Estado de las fases

| Fase | Estado |
|---|---|
| F0 · Red de seguridad | **Hecha.** Ver abajo. |
| F1 · Enlaces de la app a su propio espacio | **Hecha.** Ver abajo. |
| F2 · Producto, servicio, oferta, carrito y pago en la app | **Hecha.** Ver abajo. |
| F3 · Excursiones, carrito único y vendedores en la app | **Hecha.** Ver abajo. |
| F4 · Ofertas Membego, membresías, campañas y regalos en la app | **Hecha.** Ver abajo. |
| F5 · Landing consciente de la sesión y orden en auth | **Hecha.** Ver abajo. |
| F6 | Pendiente de aprobación. |

### F0 · Red de seguridad (hecha)

Solo pruebas y documentación; ningún archivo de `src` cambia.

- `tests/separacion-landing-app.test.ts`: guardias estáticas (13 casos). Fijan que la app del cliente no enlaza a rutas operativas de la landing, que los componentes compartidos no cablean lo operativo al espacio público, que la landing no importa operaciones comerciales, que el layout público no lee la sesión en servidor, que los paneles no enlazan a la portada, que cada rol tiene una casa abierta por su propia protección, que el logout termina en `/login`, que el proxy rechaza destinos externos y que las URL públicas de SEO siguen existiendo.
- Las guardias 1 a 3, la de sesión en páginas públicas y la de paneles usan **listas de excepciones que solo pueden encogerse**: una violación nueva falla, y una excepción ya resuelta que siga en la lista también falla. Cada excepción nombra la fase que la elimina. **En F6 todas deben quedar vacías.**
- `tests/e2e/separacion-invariantes.spec.ts`: invariantes de acceso y de consulta pública, para ejecutarse tras cada fase.
- Verificación de las guardias por mutación: un enlace nuevo a `/carrito` en la app, un import operativo en la portada pública, una fase que arregla un enlace y olvida la lista, y un layout público que lee la sesión, hacen fallar la prueba.

Límite conocido: las guardias son análisis de texto. Ven literales de ruta, constantes `RUTA_*` públicas e imports. No ven un enlace armado por concatenación arbitraria; para eso están el E2E y las pruebas de cada fase.

### F1 · Enlaces de la app a su propio espacio (hecha)

Alcance real, más corto que el del plan original: tres piezas no tenían todavía un destino en `/cliente` y se reasignaron a la fase donde su destino existe.

| Pieza | Fase |
|---|---|
| Avisos «Ver ofertas» y «Ver promociones» en compras y bonos (hablan de ofertas Membego de Supply; `/cliente/promociones` lista otra cosa) | F4 |
| Tarjeta del catálogo (necesita el detalle de producto en la app) | F2 |
| Tarjeta de excursión (necesita la ficha de excursión en la app) | F3 |

Lo que sí se hizo:

- `src/modules/comercio/rutas.ts` (nuevo, módulo puro): el mapa único de rutas por espacio, `publico` o `app`. F2 a F4 lo amplían; los componentes compartidos ya no escriben a mano la ruta de un recurso.
- `TarjetaOferta` recibe `espacio` como dato **obligatorio** y arma el enlace a la empresa con ese mapa. La app pasa `app`, la landing pasa `publico`, y el perfil de empresa pasa el que le corresponde. Sin valor por defecto: una pantalla de la app que lo olvidara sacaría al cliente a la landing sin aviso.
- «Ver el catálogo» en pedidos vacíos va a `/cliente/explorar?ver=productos`.
- `BuscadorExcursiones` y `BuscadorUnificado` apuntan a `/cliente/excursiones`. **Ninguno está montado en ninguna pantalla hoy**; se corrigieron sus enlaces y se dejan para decidir en F6 si se eliminan.
- Los logos de las pantallas de establecer contraseña del cliente y del vendedor (sin sesión todavía) van a `/login` y no a la portada.

Pruebas: `tests/comercio-rutas.test.ts` (el mapa, y que cada tarjeta declara el espacio que corresponde a donde se pinta, algo que el tipado no puede comprobar), la guardia de F0 con la lista reducida y verificada por mutación, y `tests/e2e/separacion-f1.spec.ts` (móvil y escritorio, incluida la comprobación de que la landing no cambió).

### F2 · Producto, servicio, oferta, carrito y pago dentro de la app (hecha)

La landing deja de tener formularios, botones y código de compra, reserva, oferta o pago de productos y servicios. Sus fichas siguen existiendo para consulta, SEO y enlaces compartidos, y donde estaban los botones hay el traspaso a la app.

**Trasladado a `/cliente`**

| Antes (landing) | Ahora (app) |
|---|---|
| Ficha con pedir, reservar, agregar al carrito y obtener oferta | `/cliente/empresas/[slug]/catalogo/[item]` |
| `/carrito` | `/cliente/carrito`; la URL vieja redirige (temporal, con su consulta) |
| `/carrito/pagar/[slug]` | `/cliente/carrito/pagar/[slug]`; la URL vieja redirige |
| Icono de carrito en la barra pública | Icono con contador en el encabezado de la app |
| «Obtener oferta» en las tarjetas de `/ofertas`, `/catalogo` y la vitrina pública | Mismo botón en Explorar, Buscar, inicio y vitrina dentro de la app; en la landing, «Obtener en la app» |

**Arquitectura**

- `src/modules/comercio/ficha-item.ts`: el cargador de datos es uno y lo comparten las dos fichas, así que «no existe» y «no es público» se ven igual en ambos espacios.
- `FichaDeItem` es presentación pura con dos ranuras (oferta y compra). La app las llena con `AccionesDeCompra`; la landing, con `TraspasoALaApp`. La landing no importa ni una operación.
- `TarjetaOferta` recibe su acción por ranura, y `CompanyProfile` la recibe de la página que lo monta. `TarjetaCatalogoPublica` toma `espacio` y arma la ficha con el mapa único de rutas.
- `GET /api/v1/auth/sesion` (nuevo, solo lectura): rol y casa, sin identidad y sin caché. Lo consulta el hook `useSesionLigera`, una vez por página, sin volver dinámico el layout público.

**El traspaso reconoce quién mira**

| Quien mira | Ve |
|---|---|
| Visitante | «Iniciar sesión» y «Crear cuenta», que vuelven a la ficha de la app |
| Cliente | Enlace directo a la ficha dentro de `/cliente` |
| Administrador, empleado, vendedor, superadmin | «Ir a mi panel»; ningún enlace de compra |

Mientras llega la respuesta (y sin JavaScript) se pinta la variante de visitante, cuyos enlaces funcionan para cualquiera porque `/login` devuelve en un solo salto a quien ya tiene sesión.

**Destinos de retorno endurecidos (`src/lib/auth/destino-seguro.ts`)**

Un único validador para `?redirect=` y `?next=`, usado por el proxy, el login, el asistente de registro y los dos formularios clásicos. Solo acepta rutas internas autorizadas, normaliza (`/a/../b`, `%2e%2e`), rechaza esquemas, contrabarras, controles y barras dobles, nunca acepta el propio flujo de acceso (sin bucles) y, con el rol a la vista, descarta destinos de espacios que ese rol no puede abrir. Cambios de comportamiento a tener presentes:

- El registro clásico general no respetaba `?next=`; ahora sí, también al confirmar el correo. «Regístrate» desde el login conserva el destino.
- El proxy recuerda ruta **y consulta** al mandar al login, y no duplica la consulta propia del login. Antes `/login?redirect=` perdía la consulta.
- Con sesión, `/login?redirect=` da un solo salto al destino permitido para el rol, o a su casa.

**Guardia reforzada (`tests/separacion-landing-app.test.ts`)**

El cierre de imports de la landing es transitivo: sigue importaciones, reexportaciones e imports dinámicos, ignora los de solo tipos y se detiene al llegar a un nodo que opera (componentes de compra, servicios que escriben, o cualquier módulo `'use server'` no permitido). No prohíbe por directorio, así que una tarjeta que solo presenta no se marca. Verificada por mutación en tres casos que debe atrapar y dos que debe dejar pasar. Cuando falla, imprime la cadena de imports que lo demuestra.

**Pruebas de comportamiento (`tests/e2e/separacion-f2.spec.ts`, móvil y escritorio)**: la landing no tiene formularios, botones de operación ni carrito, y al navegador de la landing no llega el código de las operaciones (se busca en los scripts descargados, no solo en lo visible); los tres estados del traspaso; el equipo no entra a la ficha de la app y vuelve a su espacio sin bucle; `/login` rechaza destinos externos, del propio acceso y de otros espacios; en la app, ficha, carrito y contador; la ficha no publicada se ve igual que la inexistente; el endpoint de sesión no filtra identidad.

#### Hallazgos de F2

- La ficha pública de un producto y la vitrina de empresa se renderizan **por visita** (`ƒ` en la tabla de rutas), aunque declaran `revalidate`. Ya era así antes de F2: el build de F1 las marca igual. La caché real es la de datos (`getItemCatalogoPublico`, con etiqueta). La portada y `/ofertas` siguen siendo estáticas (ISR) y una prueba lo fija.
- La guardia transitiva encontró operaciones alcanzables que la directa no veía: la landing de invitación incrusta el alta de cuenta (`registro/actions`) y contadores del embudo. Se clasificaron como permitidas (alta de cuenta, captación B2B y analítica; no son pedidos ni compras) y quedan nombradas en el test.
- El encabezado `x-nextjs-cache` ya no existe en esta versión de Next; las pruebas miran `Cache-Control`.
- El formulario de pedido se llama «Hacer un pedido» también para servicios; lo que cambia es su título y su botón.
- Las pruebas que escriben estados directamente en la base no ven el cambio si la lectura del catálogo está en caché con etiqueta; solo la invalidan las acciones reales.

### F3 · Excursiones, carrito único y enlaces de vendedor (hecha)

Decisiones aprobadas: (1) «seguir empresa» pasa a la app y la landing ofrece «Seguir en la app»; (2) se elimina el cajón de carrito de excursiones a favor de un solo carrito; (3) las tres rutas de entrada y `/e/[slug]` terminan en la lista de excursiones de la empresa **dentro de la app**.

| Antes | Ahora |
|---|---|
| Ficha pública de excursión con formulario de reserva | Ficha pública = consulta (misma presentación, SEO y metadatos de enlace compartido) con el traspaso «Reservar esta excursión». La reserva vive en `/cliente/empresas/[empresa]/excursiones/[excursión]` |
| Lista pública con «agregar» | Lista pública de consulta; lista de la app en `/cliente/empresas/[empresa]/excursiones` |
| `/checkout` público y cajón de carrito de excursiones en el layout público | `/cliente/carrito/excursiones`; el cajón desaparece. `/checkout` redirige allí |
| Dos carritos (productos en `/cliente/carrito`, excursiones en cajón) | Una sola página `/cliente/carrito` con ambos; el contador del encabezado suma unidades de producto y excursiones. Cada uno conserva su almacenamiento y sus acciones |
| `/carrito`, `/carrito/pagar/[empresa]` | Redirigen al carrito de la app |
| `/e/[slug]` (QR del vendedor) → registro → excursiones públicas | → registro con `next=` a las excursiones de la app (cliente con sesión: directo). La atribución sigue en cookies (`mg_ven`, visitante), no en la URL |
| Botón «Seguir» en la vitrina pública | Solo en la vitrina de la app; la pública muestra «Seguir en la app» (ranura `ranuraSeguir`) |

Cómo se hizo (sin reescribir reglas): presentación compartida con `espacio: 'publico' | 'app'` y ranuras (`FichaDeExcursion`, `ListaDeExcursionesDeEmpresa`, `CompanyProfile`), cargadores neutrales en `src/modules/comercio` (`ficha-excursion`, `lista-excursiones`), mapa único de rutas en `rutas.ts`, y el formulario de reserva y el checkout movidos tal cual a `src/components/excursiones`. El contrato de la API móvil no cambia (`getInicioVista` mantiene `espacio='publico'` por defecto).

Pruebas: `tests/separacion-f3.test.ts` (unitarias), guardia F0/F2 sin las excepciones de excursiones, `tests/e2e/separacion-f3.spec.ts` (landing sin formularios ni código de reserva, traspaso por visitante/cliente/equipo, reserva completa hasta «mis excursiones» por el carrito único, rutas retiradas, `/e/[slug]`, seguir empresa) y los specs de excursiones reescritos a rutas de la app.

#### Hallazgos de F3

- La ficha pública de excursión ya era dinámica (`ƒ`) antes de F3; no se cambia el régimen de caché.
- Hoy no tiene salida si ya pasó la hora: el formulario elige solo la primera fecha disponible.
- Las excursiones de la portada (carruseles de promociones, planes y empresas) todavía enlazan a páginas públicas: es alcance de F4.
- El E2E de reserva real contra Supabase (`reservas-excursiones.spec.ts`, `excursiones-catalogo.spec.ts`) se salta sin Supabase de pruebas; el nuevo `separacion-f3.spec.ts` sí corre con la sesión firmada local.

### F4 · Ofertas Membego, membresías, campañas y regalos de empresa (hecha)

| Antes | Ahora |
|---|---|
| `/promociones/membego/[slug]`: ficha pública con `BotonComprar` (beneficios, cupón, compra), leyendo la sesión | Ficha pública = consulta (misma presentación `FichaDeOfertaMembego`) con el traspaso «Comprar esta oferta». La compra vive en `/cliente/ofertas-membego/[slug]`. `?beneficio=` y `?cupon=` viajan del enlace público hasta la app |
| `/promociones/membresias` con `BotonContratarMembresia` | Escaparate público de consulta (`ListaDeMembresias`) con «Contratar en la app»; contratar vive en `/cliente/membresias-membego` |
| `/promociones/campanas` y `/[code]` leían la sesión para «para ti» y «Mis cupones» | La landing no conoce al cliente; `/cliente/campanas` y `/cliente/campanas/[code]` sí (`paraTi`, «Mis cupones»). Mismas presentaciones (`ListaDeCampanas`, `FichaDeCampana`), con enlaces del espacio donde se pintan |
| `/oferta/[codigo]`: el regalo de una empresa se abría y reclamaba en la landing | La landing solo muestra «Tienes un regalo esperándote» y el traspaso «Abrir mi regalo» (el contenido del regalo no se filtra, ni a la vista previa). Abrirlo y reclamarlo vive en `/cliente/oferta/[codigo]` |
| La app enlazaba a las rutas públicas de Supply (bonos, cupones, fidelización, compras, checkout, ficha de ítem) | Todas usan `RUTA_OFERTAS_CLIENTE`, `RUTA_CAMPANAS_CLIENTE`, `RUTA_MEMBRESIAS_CLIENTE` (en `core/catalogo.ts`) o el mapa único `rutas.ts` |

Cómo se hizo: presentación compartida por espacio y ranuras (la landing pasa el traspaso, la app pasa el botón de verdad), mapa único de rutas ampliado (`rutaDeOfertaMembego`, `rutaDeCampana(s)`, `rutaDeMembresias`, `rutaDePromociones`, `rutaDeOfertaLegada`), constantes de cliente en Supply con un test que las ata a las públicas, y las acciones de Supply refrescan también las pantallas de la app. No se tocó ninguna regla de compra, beneficio, cupón, importe ni idempotencia, ni el contrato de la API.

Con F4, todas las listas de excepciones de la guardia están vacías: la landing no alcanza ninguna operación comercial, ninguna página pública lee la sesión en servidor y la app no enlaza a rutas operativas públicas.

#### Hallazgos de F4

- La guardia no veía una ruta pública escrita en un **cargador** (`modules/comercio/ficha-item.ts`): la ficha de ítem de la app enlazaba «Ver la oferta y comprar» a la oferta pública. Se corrigió (el cargador devuelve el slug, la presentación arma la ruta por espacio) y la guardia ahora también escanea `src/modules/comercio` (con mutación verificada).
- Los avisos de membresía (`supply.notify.membership_*`) llevaban a `/cliente/membresias`, que no es una página. Ahora llevan a `/cliente/fidelizacion`, donde está la membresía.
- La ficha pública de la oferta ya no calcula beneficios ni promociones por cliente (no hay sesión): eso se ve en la app.
- Las pruebas de sesión local firman `clienteId: null`; para el regalo de empresa (`getOfertaParaCliente` necesita el cliente) el arnés ganó un `clienteId` opcional.
- Los recorridos de Supply (slices 2 a 8) y el puente siguen siendo la prueba de compra de punta a punta; `separacion-f4.spec.ts` prueba la separación y no repite la configuración de la cuenta de cobro.

### F5 · La landing sabe si hay sesión, y orden en auth (hecha)

| Antes | Ahora |
|---|---|
| La barra siempre decía «Ingresar / Registrarse», también a quien ya tenía cuenta | Visitante: igual. Cliente: «Ir a mi app» (→ `/cliente/inicio`). Equipo (administrador, empleado, vendedor, superadmin): «Ir a mi panel» (→ su casa según `ROLE_HOME`) |
| Héroe, cierre de la portada y pie: «Crear mi cuenta gratis», «Ya tengo cuenta», «Crear cuenta» | Los tres cambian a la puerta de su espacio; «Ya tengo cuenta» desaparece con sesión |
| 404 y error mandaban a `/` a cualquiera | «Volver a mi espacio» lleva a la casa de quien tiene sesión; el visitante sigue yendo a `/` |
| `/registro` vivía en la landing y perdía la consulta (`next`, `utm`, `ref`) | Vive en `(auth)/registro/page.tsx` (misma URL) y conserva la consulta |

Mecanismo (resuelve el riesgo R5): el HTML del servidor es el mismo para todos —el de visitante— y la landing sigue siendo estática (la portada, ISR de 10 minutos; el TTFB medido de `/` es el mismo con y sin cookie, ~7 ms). Todo se decide en el navegador con `useSesionLigera`, que ahora **solo pregunta al servidor si el navegador trae la cookie de sesión** (`hayCookieDeSesion`): el tráfico anónimo no hace ninguna petición, y al cerrar sesión la cookie desaparece y la landing vuelve a la del visitante al instante (la comprobación va antes del caché de 15 s). Quien trae la cookie ve los enlaces invisibles —en su sitio— hasta que llega la respuesta: sin salto de diseño ni un «Registrarse» que parpadee. Si algún despliegue marcara la cookie como `httpOnly`, el resultado seguro es la vista de visitante (sus enlaces siguen sirviendo: `/login` rebota a quien ya tiene sesión).

Decisiones: (1) **no** se redirige `/` en el servidor a quien tiene sesión (puede seguir viendo la landing; el SEO y los enlaces compartidos no cambian); (2) `/mis-membresias` y `/membresia/[id]` **se quedan** fuera de `/cliente`: la app móvil (`apps/client`) tiene esas mismas rutas y las usa en su lista de rutas nativas, y el servidor ya emitió esos hrefs en avisos guardados y correos.

#### Excepciones permanentes de la landing (fijadas por prueba)

Lo único de la landing que envía datos al servidor, y por qué se queda: `/eliminar-cuenta/**` (las tiendas de apps exigen una URL pública para borrar la cuenta), `/registro-empresa` y `/solicitud-empresa` (captación B2B), y la consulta GET de solo lectura del estado de sesión. `/acceso` (la puerta del equipo) sigue sin enlazarse desde la web. Una pieza nueva de la landing que envíe datos hace fallar la prueba: o es captación, o es una operación del cliente y va en `/cliente`.

#### Hallazgos de F5

- `main` llegó con un error de tipos entre el #588 (nueva `/ofertas/[dealId]`) y las fichas de F2: la página usaba `TarjetaOferta` con la API vieja (`retorno`) y habría vuelto a poner la obtención de la oferta en la landing. Ahora usa `espacio="publico"` y el traspaso (`AccionDeOfertaPublica`), como `/ofertas`.
- El arnés E2E firmaba la cookie de sesión como `httpOnly`, lo que no pasa en producción (`@supabase/ssr` la deja legible). Ahora no lo es.
- Con `loading.tsx` en el grupo, el redirect de `/registro` llega por streaming (200 + salto del cliente): las pruebas comprueban dónde termina la persona, no el código HTTP.

#### Excepciones vigentes, por fase que las elimina

| Fase | Qué se elimina |
|---|---|
| F1 | Hecha. |
| F2 | Hecha. |
| F3 | Hecha. |
| F4 | Hecha. No quedan excepciones en la guardia. |

La lista exacta, archivo por archivo y con conteo, está en el propio test.

### Hallazgos de F0 que ajustan el diagnóstico

- `ResenaForm` (reseñas) y `FollowButton` (seguir empresa) también son acciones del cliente montadas en la landing mediante el perfil de empresa compartido. No estaban en el inventario original.
- `/oferta/[codigo]` monta `ReclamarOferta` (canje de beneficios legacy): se suma a F4.
- La app enlaza a rutas públicas también mediante constantes `RUTA_*` de Supply (cupones, fidelización, bonos), no solo con literales.
- El estado HTTP no distingue «no encontrado» en el panel ni en la landing (Next transmite por streaming y deja 200); las pruebas miden el contenido.
- `logout` revoca la sesión en Supabase Auth. Con las sesiones firmadas localmente del arnés E2E esa revocación no puede completarse, así que el caso E2E de cierre de sesión solo corre con `E2E_SUPABASE_REAL=1`. El destino del logout queda fijado por la guardia estática.

---

## 0. Veredicto en una frase

La separación **técnica** (route groups, layouts, auth, permisos, redirects) ya
está bien hecha; lo que falla es la **funcional**: diez pantallas operativas del
cliente (detalle de producto, carrito, pago, detalle y reserva de excursión,
checkout de excursiones, compra de ofertas Membego, contratar membresía,
campañas/cupones y obtención de ofertas) **viven solo bajo el layout de la
landing** y la app del cliente enlaza hacia ellas en 14 puntos, así que el
cliente autenticado sale de su app para completar cualquier compra.

---

## 1. Diagnóstico detallado

### 1.1 Arquitectura actual (verificada en el código)

| Espacio | Route group | Layout | Protección | Casa |
|---|---|---|---|---|
| Landing + marketplace público | `src/app/(public)` | `PublicNav` + `PublicFooter` + `theme-landing` + **`ExcursionCarritoWrapper`** | ninguna (páginas leen sesión opcionalmente) | `/` |
| Autenticación | `src/app/(auth)` + `src/app/auth/callback` | logo → `/`, pie legal | `/login`, `/acceso` rebotan al rol si ya hay sesión (`src/proxy.ts:277-291`) | — |
| App del cliente | `src/app/(cliente)` (`/cliente/*`, `/mis-membresias`, `/membresia/[id]`) | `CustomerShell` (+ `ExcursionCarritoWrapper`) | `ROUTE_PROTECTION` `/cliente`, `/mis-membresias`, `/membresia` → `CLIENTE` | `/cliente/inicio` |
| Panel empresa | `src/app/(admin)` | `AppShell` + `nav-config.ts` | rol + sección (`puedeEntrarAlPanel`, `seccionPermitida`) | `/admin/dashboard` |
| Superadmin | `src/app/(superadmin)` | idem | `SUPERADMIN` | `/superadmin/dashboard` |
| Escáner / caja | `src/app/(empleado)` | propio | `SCANNER_ROLES` | `/empleado/scanner` |
| Vendedor de excursiones | `src/app/(vendedor)` | propio, logo → `/` | `VENDEDOR` | `/vendedor` |
| Onboarding B2B | `src/app/(onboarding)` | propio | `FULL_ADMIN_ROLES` | — |
| Enlaces cortos / growth | `src/app/{e,r,invita,invitacion,invitar,sso}` | sin layout de grupo | según ruta | — |

Fuente única de verdad: `ROLE_HOME` y `ROUTE_PROTECTION` en `src/types/index.ts:73-156`;
el proxy (`src/proxy.ts`) protege por prefijo, conserva `?redirect=` interno
(rechaza `//`), rebota al `ROLE_HOME` cuando el rol no encaja y falla cerrado.
Los guards (`src/lib/auth/guards.ts`) repiten la comprobación en servidor. El
cierre de sesión (`src/modules/auth/actions.ts:6-8`) borra la sesión y manda a
`/login`; `/login` es público, así que **no hay bucle**. Los paneles admin,
superadmin y empleado **no enlazan a la landing** en ningún sitio (0 `href="/"`
en sus layouts y componentes). Hasta aquí, nada que corregir.

### 1.2 Lo que está mal: operaciones del cliente bajo el layout de la landing

Todas estas rutas renderizan dentro de `src/app/(public)/layout.tsx` (barra
pública con «Ingresar / Registrarse», pie comercial, carrito flotante) y son las
**únicas** pantallas donde el cliente puede hacer la operación:

| # | Ruta pública | Operación que contiene | Archivo | Equivalente en la app |
|---|---|---|---|---|
| P1 | `/empresas/[slug]/catalogo/[itemSlug]` | detalle de producto/servicio, **Pedir / Reservar** (`PedirForm`), **Agregar al carrito**, **Obtener oferta** (`ReclamarOfertaBoton`) | `src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx` | **no existe** |
| P2 | `/carrito` | carrito de productos (localStorage) | `src/app/(public)/carrito/page.tsx` + `CarritoVista` | **no existe** |
| P3 | `/carrito/pagar/[companySlug]` | **checkout de pedidos** (`hacerCheckout`), termina en `/cliente/pedidos/{id}` | `src/app/(public)/carrito/pagar/[companySlug]/page.tsx` + `PagarFormulario.tsx:82-91` | **no existe** |
| P4 | `/empresas/[slug]/excursiones/[excSlug]` | detalle de excursión + **reserva** (`reservarExcursion`, `toggleSeguirEmpresa`), termina en `/cliente/mis-excursiones/{id}` | `.../excursiones/[excursionSlug]/page.tsx:78-100`, `ReservaExcursionForm.tsx:535,1454,1484` | **no existe** (`/cliente/excursiones/[reservaId]` es la reserva ya hecha) |
| P5 | `/checkout` | **checkout del carrito de excursiones** (`reservarCarritoAction`), lee sesión | `src/app/(public)/checkout/page.tsx` + `CheckoutClient.tsx:90-111` | **no existe** |
| P6 | `/excursiones` | buscador público de excursiones | `src/app/(public)/excursiones/page.tsx` | sí: `/cliente/excursiones`, `/cliente/excursiones/buscar` (pero la app enlaza al público, ver 1.3) |
| P7 | `/promociones/membego/[slug]` | oferta Membego (Supply) con **Comprar** (`BotonComprar`, consciente de sesión), termina en `/cliente/compras/{id}` | `src/app/(public)/promociones/membego/[slug]/page.tsx:4-8` | **no existe** |
| P8 | `/promociones/membresias` | **Contratar membresía** (`BotonContratarMembresia`) → `/cliente/compras/{id}` o `/cliente/fidelizacion` | `src/app/(public)/promociones/membresias/page.tsx` | **no existe** |
| P9 | `/promociones/campanas`, `/promociones/campanas/[code]` | campañas y cupones, leen sesión (`getUser`) | `src/app/(public)/promociones/campanas/**` | parcial: `/cliente/cupones` lista los ya obtenidos |
| P10 | `/oferta/[codigo]`, `/ofertas` | landing compartible de una oferta (lee sesión, enlaza a `/cliente/promociones`); listado con `TarjetaOferta` → vitrina pública | `src/app/(public)/oferta/[codigo]/page.tsx:37-100`, `ofertas/page.tsx` | listado sí (`/cliente/explorar?ver=ofertas`); la tarjeta enlaza fuera |

Además, el layout público monta **estado operativo**: `ExcursionCarritoWrapper`
(provider + cajón del carrito) en `src/app/(public)/layout.tsx:3,15`, y
`PublicNav` lleva `IconoCarrito` (`PublicNav.tsx:9,79,98`). Ambos carritos
(`src/components/checkout/useCarrito.ts`, `ExcursionCarritoContext.tsx`)
persisten en `localStorage` del mismo origen, así que una pantalla de la app que
use los mismos hooks **ve el mismo carrito sin migración**.

### 1.3 Enlaces desde la app del cliente hacia la landing (14 puntos)

| Origen (archivo:línea) | Enlaza a | Debería ir a |
|---|---|---|
| `src/app/(cliente)/cliente/pedidos/page.tsx:37` | `/catalogo` | `/cliente/explorar?ver=productos` |
| `src/app/(cliente)/cliente/compras/page.tsx:84` | `/promociones` | `/cliente/promociones` (o la pantalla de ofertas Membego en la app, fase 4) |
| `src/app/(cliente)/cliente/bonos/page.tsx:46` | `/promociones` | idem |
| `src/components/cliente/inicio/BuscadorExcursiones.tsx:22,46` | `/excursiones` | `/cliente/excursiones/buscar` |
| `src/components/cliente/inicio/BuscadorUnificado.tsx:168,240` | `/excursiones?q=` | `/cliente/excursiones/buscar?q=` |
| `src/components/cliente/inicio/BuscadorUnificado.tsx:178` | `/empresas/{e}/excursiones/{x}` | ruta de excursión dentro de la app (fase 3) |
| `src/components/public/ExcursionCard.tsx:47-55` (sin `hrefBase` desde `/cliente/excursiones`) | `/empresas/{e}/excursiones/{x}` | idem |
| `src/components/marketplace/CompanyProfile.tsx:713` (también en `mode="app"`) | `/empresas/{e}/excursiones/{x}` | idem |
| `src/components/catalogo/TarjetaCatalogoPublica.tsx:31` (usada en `/cliente/explorar`, `/cliente/inicio`, `/cliente/buscar`, `/cliente/empresas/[slug]`) | `/empresas/{e}/catalogo/{item}` o `/promociones/membego/{slug}` | detalle de producto / oferta Membego dentro de la app (fases 2 y 4) |
| `src/components/deals/TarjetaOferta.tsx:32` (usada en `/cliente/explorar?ver=ofertas` y `CompanyProfile` app) | `/empresas/{e}` | `/cliente/empresas/{e}` |
| `src/components/checkout/AgregarAlCarrito.tsx:46,74`, `IconoCarrito.tsx:11`, `PagarFormulario.tsx:56,136,178`, `CarritoVista.tsx:108` | `/carrito`, `/empresas` | `/cliente/carrito`, `/cliente/explorar` cuando se renderizan en la app |

Los enlaces de los paneles al perfil público (`/empresas/{slug}`, «Ver como
cliente» en `PanoramaComercial`) **son correctos**: son vista previa de lo que
ve el mundo, no una operación.

### 1.4 La landing no sabe si hay sesión

- `PublicNav` es estático: siempre «Ingresar / Registrarse» (`PublicNav.tsx:14-20,76-92`).
- Un cliente o un admin con sesión que entra a `/` ve la web comercial sin
  atajo a su app; el proxy solo rebota en `/login` y `/acceso`.
- Enlaces del logo hacia `/` desde superficies autenticadas: `src/app/(vendedor)/layout.tsx:32`
  (vendedor con sesión) y el layout «sin sesión» del cliente para
  `/cliente/establecer-contrasena` (`src/app/(cliente)/layout.tsx:27`, aceptable:
  aún no hay sesión). `src/app/not-found.tsx:9,23` y `src/app/(public)/error.tsx:26`
  mandan a `/` a cualquier usuario, también a los autenticados.

### 1.5 Autenticación: pequeñas incoherencias de ubicación (no de seguridad)

- `src/app/(public)/registro/page.tsx` es un redirect de auth (`/registro` →
  `/registro/{empresaPrincipal}` o `/registro/cuenta`) que vive en el grupo de la
  landing; los destinos están en `(auth)/registro/**`.
- `/mis-membresias` y `/membresia/[id]` son pantallas de cliente fuera del prefijo
  `/cliente`, lo que obliga a dos entradas extra en `ROUTE_PROTECTION`
  (`src/types/index.ts:154-155`) y a `/cliente/dashboard` como redirect legacy.
- `/registro-empresa` (alta B2B) crea la cuenta y manda a `/login`
  (`RegistroEmpresaForm.tsx:45-50`): el formulario puede seguir en la landing
  (captación), la lógica ya está en `modules`.
- `/eliminar-cuenta/**` llama a `/api/v1/auth/cuenta` con sesión: es una
  **excepción legítima** (las tiendas de apps exigen una URL pública de borrado
  de cuenta). Se mantiene.
- `/acceso` es la puerta del equipo (no enlazada desde la web); `/login` la del
  cliente. Comparten `LoginForm`. Correcto.

### 1.6 Componentes compartidos: patrón correcto a medias

Ya existe el patrón bueno: `CompanyProfile` recibe `mode: 'public' | 'app'` y
deriva sus enlaces (`CompanyProfile.tsx:154-163,513,689`); `PromotionCard` y
`ExcursionCard` aceptan `hrefBase`. Pero `TarjetaCatalogoPublica`,
`TarjetaOferta`, el bloque de excursiones de `CompanyProfile` y los componentes
de carrito tienen el destino **cableado al espacio público**. No hay imports de
`components/cliente|admin|layout` desde `(public)` ✅, y `(cliente)` importa de
`components/public` solo tarjetas presentacionales ✅.

### 1.7 Lo que ya está bien y no se toca

Auth (proxy, guards, callback, confirmar, recuperar, logout), `ROUTE_PROTECTION`,
permisos por sección, aislamiento multi-tenant, APIs `/api/v1`, Prisma, nav de
paneles, `site.ts` (`landingUrl`, `appUrl`, `sessionCookieDomain` listos para el
corte físico), páginas OG compartibles (`/promocion/[clave]`, `/oferta/[codigo]`,
`/plan/[id]`, `/i/[code]`, `/invitar/[code]`): deben seguir siendo públicas y
responder 200 para las vistas previas de WhatsApp.

---

## 2. Arquitectura actual vs. propuesta

### Actual

```
(public)  landing + marketplace + DETALLE/CARRITO/PAGO/RESERVA/COMPRA  ← el cliente opera aquí
(auth)    login · registro · recuperar · confirmar
(cliente) inicio · explorar · pedidos · compras · … (enlaza hacia (public) para operar)
(admin) (superadmin) (empleado) (vendedor) (onboarding)  ← correctos
```

### Propuesta (mismo repositorio, misma app Next, sin duplicar backend ni auth)

```
(public)   LANDING + MARKETPLACE DE SOLO LECTURA
           home, caracteristicas, faq, blog, contact, descargar, legal,
           empresas/[slug] (+catalogo/[item], +excursiones/[x]) en modo "vitrina",
           catalogo, ofertas, promociones/*, plan/[id], oferta/[codigo], promocion/[clave],
           registro-empresa, solicitud-empresa, eliminar-cuenta (política de tiendas), i/[code]
           → toda acción (Pedir, Reservar, Comprar, Obtener, Contratar) es un CTA que
             manda a /login?redirect=<ruta de la app> o, con sesión, a la ruta de la app.
           → sin carrito, sin formularios que creen pedidos/reservas/compras.
           → sabe si hay sesión: «Ir a mi app» en lugar de «Ingresar».

(auth)     login · acceso · registro (incluido el redirect /registro) · recuperar ·
           actualizar-password · confirmar · callback

(cliente)  APP COMPLETA
           + /cliente/empresas/[slug]/catalogo/[itemSlug]   (detalle + Pedir + carrito + oferta)
           + /cliente/carrito  · /cliente/carrito/pagar/[slug]
           + /cliente/empresas/[slug]/excursiones/[excSlug] (detalle + reserva)
           + /cliente/carrito/excursiones                    (checkout de excursiones)
           + /cliente/ofertas-membego/[slug] · /cliente/membresias-membego · /cliente/campanas/[code]
           (nombres propuestos; evitan chocar con /cliente/excursiones/[reservaId] y /cliente/promociones/[id])

(admin) (superadmin) (empleado) (vendedor) (onboarding)  sin cambios
```

**Regla de composición** (evita duplicar pantallas): una **pantalla** = un
componente compartido en `src/components/**` que recibe `modo: 'public' | 'app'`
(o `hrefBase`), y dos **páginas finas** que lo montan: la pública con los datos
de lectura y el CTA de traspaso; la de la app con la sesión, los formularios y
las acciones. Es exactamente lo que `CompanyProfile` ya hace. Los módulos de
dominio (`modules/checkout`, `modules/orders`, `modules/excursiones`,
`modules/supply-v2`, `modules/deals`) no cambian.

**Traspaso público → app**: el CTA público construye
`/login?redirect=/cliente/...`; el proxy ya valida ese `redirect` y lo respeta
tras el login (`src/proxy.ts:277-291`). Con sesión de cliente la página pública
puede enlazar directo a la ruta de la app. El carrito en `localStorage` es el
mismo en ambos layouts, así que lo añadido antes de iniciar sesión aparece en
`/cliente/carrito`.

**Separación física por dominios** (`membego.com` / `app.membego.com`) queda como
etapa posterior y opcional, ya preparada en `docs/ARQUITECTURA_SEPARACION.md`;
esta propuesta la facilita porque, al terminar, `(public)` no tendrá ninguna
mutación de pedidos/reservas/compras.

---

## 3. Inventario de funcionalidades mal vinculadas a la landing

| Funcionalidad | Dónde está hoy | Decisión |
|---|---|---|
| Detalle de producto/servicio con Pedir/Reservar y carrito | `(public)/empresas/[slug]/catalogo/[itemSlug]` | **Trasladar** la operación a la app; la pública queda como vitrina + CTA |
| Carrito de productos y pago | `(public)/carrito`, `(public)/carrito/pagar/[slug]` | **Trasladar** a `/cliente/carrito*`; las URL públicas pasan a redirigir (con sesión → app; sin sesión → login con redirect) |
| Detalle y reserva de excursión | `(public)/empresas/[slug]/excursiones/[excSlug]` | **Trasladar** la reserva; la pública queda como ficha + CTA |
| Checkout de excursiones | `(public)/checkout` | **Trasladar**; la URL pública redirige |
| Carrito flotante en la barra pública | `PublicNav` + `ExcursionCarritoWrapper` en `(public)/layout` | **Eliminar** del layout público (el estado en localStorage se conserva) |
| Compra de ofertas Membego | `(public)/promociones/membego/[slug]` | **Trasladar** la compra; la pública queda como ficha + CTA |
| Contratar membresía Membego | `(public)/promociones/membresias` | **Trasladar** la contratación; la pública queda como ficha + CTA |
| Campañas / cupones con sesión | `(public)/promociones/campanas/**` | **Trasladar** la obtención; la pública queda como ficha + CTA |
| Obtener oferta desde la pública | `ReclamarOfertaBoton` en P1 | **Trasladar** (vive en el detalle de la app) |
| Buscador público de excursiones enlazado desde la app | `(public)/excursiones` | **Mantener** la pública; **corregir** los enlaces de la app |
| `/registro` (redirect) | `(public)/registro/page.tsx` | **Mover** a `(auth)` (misma URL) |
| Landing sin conciencia de sesión | `PublicNav` | **Añadir** «Ir a mi app» cuando hay sesión |
| Logo → `/` en vendedor autenticado | `(vendedor)/layout.tsx:32` | **Corregir** a `/vendedor` |
| `not-found` / `error` público → `/` para todos | `src/app/not-found.tsx`, `(public)/error.tsx` | **Mantener** (son páginas públicas); el `not-found` de cada grupo privado ya lleva a su casa |
| Alta B2B, solicitud de empresa, eliminar cuenta, páginas OG compartibles, `/i`, `/invitar`, `/e`, `/r` | `(public)` y raíz | **Mantener** (captación, política de tiendas y vistas previas; no son operación del cliente) |
| Vista previa del perfil público desde el panel | `PanoramaComercial`, admin | **Mantener** |

---

## 4. Plan por fases (pequeñas, cada una verificable y reversible)

Cada fase termina con `bun run typecheck`, los unit tests que fija, los E2E
afectados y `bun run build`; se commitea por separado en la rama.

| Fase | Alcance | Archivos principales | Verificación |
|---|---|---|---|
| **F0 · Red de seguridad** (sin cambio de comportamiento) | Test unitario que prohíbe `href` desde `(cliente)` y `components/cliente` a rutas operativas públicas (`/carrito`, `/checkout`, `/empresas/*/catalogo`, `/empresas/*/excursiones`, `/promociones/membego`, `/excursiones`); test que prohíbe importar `modules/*/actions` y `modules/checkout/actions` desde `(public)`. Al principio documentan las excepciones conocidas y se van vaciando fase a fase. | `tests/separacion-landing-app.test.ts` (nuevo), este documento | unit |
| **F1 · Enlaces de la app a sus propias pantallas** | Corregir los enlaces de 1.3 que **ya tienen** destino en la app: `/cliente/pedidos` → explorar productos; `/cliente/compras` y `/cliente/bonos` → `/cliente/promociones`; buscadores de excursiones → `/cliente/excursiones/buscar`; `TarjetaOferta` y `TarjetaCatalogoPublica` ganan `hrefBase`/`modo` (por defecto el público, así la landing no cambia); `CompanyProfile` en modo app enlaza a `/cliente/empresas/{slug}`; logo del vendedor → `/vendedor`. | 9 archivos de 1.3, `TarjetaOferta.tsx`, `TarjetaCatalogoPublica.tsx`, `CompanyProfile.tsx`, `(vendedor)/layout.tsx` | unit (`navegacion-cliente`, `catalogo-publico`, F0), E2E `catalogo-publico`, `comercio-experiencia` |
| **F2 · Producto, carrito y pago dentro de la app** | Nuevas páginas `/cliente/empresas/[slug]/catalogo/[itemSlug]`, `/cliente/carrito`, `/cliente/carrito/pagar/[slug]` montando los **mismos** componentes (`PedirForm`, `AgregarAlCarrito`, `ReclamarOfertaBoton`, `CarritoVista`, `PagarFormulario`) con `hrefBase="/cliente"`; `IconoCarrito` pasa a `CustomerShell`; la página pública del ítem deja de montar formularios y muestra el CTA de traspaso; `/carrito`, `/carrito/pagar/*` públicas → redirect (sesión → app; sin sesión → login con redirect). `PublicNav` pierde el carrito y `(public)/layout` el `ExcursionCarritoWrapper` **solo si F3 ya no lo necesita** (si no, se deja hasta F3). | nuevas páginas en `(cliente)`, `CustomerShell.tsx`, `PublicNav.tsx`, 4 componentes de `checkout/`, página pública del ítem | PG `comercio-experiencia`, E2E `carrito-checkout`, `pedidos-membego`, `deals-membego`, `catalogo-publico`, `comercio-experiencia`, `capturas-comercio` |
| **F3 · Excursiones dentro de la app** | `/cliente/empresas/[slug]/excursiones/[excSlug]` (ficha + `ReservaExcursionForm`) y `/cliente/carrito/excursiones` (`CheckoutClient`); `ExcursionCard` recibe `hrefBase` desde las páginas del cliente; `BuscadorUnificado`/`CompanyProfile` enlazan dentro; la ficha pública queda informativa + CTA; `/checkout` público → redirect. Retirar `ExcursionCarritoWrapper` e `IconoCarrito` de `(public)`. | nuevas páginas, `ExcursionCard.tsx`, `BuscadorUnificado.tsx`, `CompanyProfile.tsx:713`, `(public)/layout.tsx` | E2E `publico.spec` (regresión 404 excursiones), specs de excursiones, `navegacion-cliente` |
| **F4 · Ofertas Membego, membresías y campañas dentro de la app** | `/cliente/ofertas-membego/[slug]` (`BotonComprar`), `/cliente/membresias-membego` (`BotonContratarMembresia`), `/cliente/campanas/[code]`; las públicas `promociones/membego/[slug]`, `promociones/membresias`, `promociones/campanas/**` quedan informativas + CTA; `RUTA_*` del catálogo Supply ganan las variantes de la app; `TarjetaCatalogoPublica` (ítems Supply) enlaza dentro en modo app. | `src/modules/supply-v2/core/catalogo.ts`, páginas públicas, nuevas páginas | E2E `puente-supply`, specs supply-v2, unit `supply-bridge` |
| **F5 · Landing consciente de sesión y orden en auth** | `PublicNav` muestra «Ir a mi app» (→ `ROLE_HOME` del rol) cuando hay sesión; se decide el mecanismo (ver riesgo R5); mover `(public)/registro/page.tsx` a `(auth)/registro/page.tsx` (misma URL); opcional: alias `/cliente/membresias` para `/mis-membresias` manteniendo las URL viejas con redirect. | `PublicNav.tsx`, `(public)/layout.tsx`, `(auth)/registro/page.tsx`, `next.config.ts` | E2E `publico.spec` («carga y ofrece un camino para entrar»), `registro-v2`, unit `navegacion-cliente` |
| **F6 · Documentación y cierre** | Actualizar `docs/ARQUITECTURA_SEPARACION.md` (mapa de route-groups), `docs/IMPLEMENTATION_STATUS.md`, tabla final de rutas por espacio, y vaciar las excepciones del test de F0. | docs, `tests/separacion-landing-app.test.ts` | unit completo, PG completo, E2E tocados, build |
| **F7 (opcional, fuera de este encargo)** | Corte físico `membego.com` / `app.membego.com` según etapas 6–7 de `ARQUITECTURA_SEPARACION.md` (`NEXT_PUBLIC_COOKIE_DOMAIN`, 301 de `/login`, `/registro`, paneles). | infra | — |

Orden recomendado: F0 → F1 → F2 → F3 → F4 → F5 → F6. F1 ya elimina la mayor
parte de las salidas a la landing con riesgo mínimo; F2–F4 son las que crean
pantallas nuevas y conviene aprobarlas una a una.

---

## 5. Riesgos por fase y medidas

| Riesgo | Fase | Medida |
|---|---|---|
| **R1 · Romper E2E que hoy pasan por rutas públicas** (`carrito-checkout`, `pedidos-membego`, `deals-membego`, `catalogo-publico`, `comercio-experiencia`, `puente-supply`, `publico`) | F2–F4 | Correr cada spec antes y después; actualizar los specs al nuevo recorrido (login → app) y mantener un caso que verifique el **traspaso** público → login → app. No se borra ningún spec. |
| **R2 · Carritos huérfanos en el navegador** (quien ya añadió algo en la landing antes de F2/F3) | F2, F3 | La clave de `localStorage` no cambia y la página de la app usa los mismos hooks, así que lo ya guardado aparece en `/cliente/carrito` tras iniciar sesión. A partir de F2 la landing deja de poder añadir. Prueba E2E: con una línea sembrada en el navegador, `/cliente/carrito` la muestra. |
| **R3 · SEO y vistas previas** (WhatsApp/Facebook no siguen redirects) | F2–F4 | Las URL públicas de **lectura** (`/empresas/**`, `/catalogo`, `/ofertas`, `/promociones/**`, `/plan`, `/oferta`, `/promocion`) se mantienen con 200, canónicos y OG. Solo `/carrito*` y `/checkout` redirigen, y nunca estuvieron en el sitemap (`src/app/sitemap.ts:14-16`). |
| **R4 · Choques de rutas en `(cliente)`** (`/cliente/excursiones/[reservaId]`, `/cliente/promociones/[id]`) | F3, F4 | Usar `/cliente/empresas/[slug]/excursiones/[excSlug]` y nombres nuevos (`ofertas-membego`, `membresias-membego`, `campanas`); el test `navegacion-cliente` («toda entrada del menú lleva a una pantalla que existe») y `tsc` detectan segmentos dinámicos en conflicto. |
| **R5 · Hacer dinámica la landing** al leer la sesión en `(public)/layout` (hoy `revalidate = 600` en la home) | F5 | No leer `getUser` en el layout. Opción recomendada: componente cliente `EstadoSesionNav` que consulta un endpoint ligero existente o la presencia de la cookie `sb-*-auth-token` vía una cabecera que el proxy ya puede fijar; se decide en F5 con una medición de TTFB antes/después. |
| **R6 · Bucles de redirección** | F2–F5 | Solo se añaden redirects públicos → app o → `/login?redirect=`; `/login` rebota a `ROLE_HOME` o al `redirect` interno validado. Prueba E2E existente «una ruta protegida manda al login y recuerda a dónde iba» + nuevo caso para `/carrito` sin sesión. |
| **R7 · Permisos y aislamiento** | todas | Las páginas nuevas caen bajo el prefijo `/cliente`, ya cubierto por `ROUTE_PROTECTION` y `requireRole('CLIENTE')` en el layout; las server actions no cambian (siguen validando sesión y tenant). Correr `tests/accesos.test.ts`, `permisos-empleado.test.ts`. |
| **R8 · Duplicar pantallas** | F2–F4 | Regla de composición de §2: una pantalla = un componente compartido; las páginas pública y de la app son finas. Revisión del diff con esa lupa antes de cada commit. |
| **R9 · Supply-v2 enlaza por constantes** (`RUTA_OFERTAS_PUBLICAS`, `RUTA_MEMBRESIAS_PUBLICAS`, `RUTA_CAMPANAS_PUBLICAS`) | F4 | Añadir constantes `RUTA_*_CLIENTE` en `core/catalogo.ts` y un test que verifique que cada pública tiene su par; no renombrar las existentes. |
| **R10 · Lint roto por configuración** (`react-hooks` sin registrar en `eslint.config.mjs`, igual que en `main`) | todas | No depender de `bun run lint` como señal; usar `tsc`, unit, PG, E2E y build. Arreglar la config es trabajo aparte. |

---

## 6. Qué NO se va a hacer

- Crear repositorios, apps o backends nuevos; duplicar auth, Prisma o APIs.
- Tocar el proxy, los guards, `ROUTE_PROTECTION`, permisos por sección ni el
  aislamiento multi-tenant.
- Reconstruir pantallas que funcionan: se reutilizan los componentes actuales.
- Quitar de la landing el marketplace de lectura (negocios, catálogo, ofertas,
  promociones): es contenido comercial y SEO, no operación.
- Cambiar la app Expo (`apps/client`): consume `/api/v1` y no depende de estas
  rutas web.

---

## 7. Aprobación

1. ¿Se aprueba el orden F0 → F6 y ejecutarlo fase a fase con commit por fase?
2. Nombres de las rutas nuevas de la app (§2): `/cliente/carrito`,
   `/cliente/carrito/pagar/[slug]`, `/cliente/carrito/excursiones`,
   `/cliente/empresas/[slug]/catalogo/[itemSlug]`,
   `/cliente/empresas/[slug]/excursiones/[excSlug]`, `/cliente/ofertas-membego/[slug]`,
   `/cliente/membresias-membego`, `/cliente/campanas/[code]`.
3. ~~Comportamiento del visitante anónimo~~ **Resuelto:** sin carrito en la
   landing; la ficha ofrece un botón que lleva a iniciar sesión y volver a la
   ruta de la app.
4. ~~Mecanismo de sesión en la landing~~ **Resuelto:** componente de cliente ligero.
