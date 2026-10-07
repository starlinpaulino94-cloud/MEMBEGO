# Pruebas de extremo a extremo

Cierra parcialmente el punto **26** del plan de `docs/AUDITORIA-PRODUCCION.md`
(*E2E del recorrido completo del cliente*) — Fase 7.

---

## 1. Por qué hacían falta

Antes de esta fase, MembeGo tenía 164 pruebas y **ninguna había abierto una
página nunca**. Todas son sobre funciones puras: la firma de QStash, el
presupuesto de error, la cola sin conexión. Son buenas pruebas y no ven la
clase de fallo que más duele en producción:

- La portada responde 200 y sale en blanco porque un error de hidratación
  rompió React.
- El botón de "Iniciar sesión" desapareció en móvil tras un cambio de CSS.
- Una ruta protegida deja de redirigir al login.
- El listado de empresas revienta cuando la base está vacía.

Ninguna de esas cosas produce un error en Sentry. El servidor responde
correctamente; lo que está roto es lo que ve la persona.

---

## 2. Cómo se ejecutan

### En CI

`.github/workflows/e2e.yml`, en cada PR y al mezclar en `main`: levanta un
PostgreSQL, aplica el esquema, construye, arranca y recorre con Chromium.

### En local

```bash
npm run build          # se prueba lo que se despliega, no `next dev`
npm run e2e:limpio
```

Eso es todo. `scripts/e2e/correr.mjs` hace las cinco cosas en orden fijo:
recrea la base desechable con el esquema de hoy, da de alta la cuenta con la
que corre la integración de pagos, arranca `next start` contra ESA base, corre
Playwright y apaga el servidor. Acepta los argumentos de Playwright:

```bash
npm run e2e:limpio -- tests/e2e/supply-v2-slice4.spec.ts
npm run e2e:limpio -- --project=escritorio
```

Solo la base, sin correr nada: `npm run e2e:base`.

El Chromium lo resuelve el arnés: si `PLAYWRIGHT_CHROMIUM_PATH` viene puesta la
respeta, y si no, busca el binario en `/opt/pw-browsers/chromium`, donde lo pone
la imagen del contenedor. Antes había que acordarse de exportar la variable, y
olvidarla no daba un error claro: Playwright buscaba un
`chrome-headless-shell` que no existe, las 183 pruebas morían en tres
milisegundos cada una y el mensaje decía «instala los navegadores» en vez de
«te falta una variable». Un arnés que depende de que alguien se acuerde no es
un arnés.

Para apuntar a otro Chromium:
`PLAYWRIGHT_CHROMIUM_PATH=/ruta/a/chrome npm run e2e:limpio`.

El arnés también pone `CRON_SECRET` de relleno, porque los recorridos del
bloque 5 del Slice 9 lanzan `/api/cron/supply-v2` por HTTP. No importan su
servicio a propósito: vive detrás de `server-only`, un spec de Playwright es
código de cliente, y la ruta es además lo que corre en producción —llamar a la
puerta prueba más que llamar a la función—.

Para ver qué pasó en un fallo: `npx playwright show-trace test-results/…/trace.zip`.

### Por qué un comando y no tres

**No corras el E2E contra `membego_dev`.** Se hizo durante un tiempo y el
resultado fue una suite en rojo —9 de 18— que se despachaba como «problema del
entorno». Lo era, con una causa medible: la base de desarrollo lleva acumulada
la basura de toda la historia del proyecto. El 2026-10-03 tenía 2 665 ofertas
ACTIVAS, 1 303 campañas, 920 redenciones, 6 365 compras y 367 885 filas de
bitácora. Con eso pasan dos cosas que no son del producto:

1. **Tiempo.** Pantallas que listan cientos de filas tardan tanto que el
   recorrido agota su plazo. Dos recorridos del Slice 4 morían a los 420 s y
   480 s; sobre una base limpia el archivo entero corre en 1,6 min.
2. **Primera página.** Las pruebas buscan SU fila en tablas que hoy tienen
   cientos. Cuando la suya no entra en la primera página, la prueba concluye
   que no existe.

Subir los plazos habría tapado las dos y dejado la suite igual de frágil. El
comando único existe para que la base limpia no sea un paso que se olvida: era
fácil arrancar el servidor apuntando a un sitio y Playwright a otro, y el
síntoma de eso es «pruebas inestables».

`scripts/e2e/base-limpia.mjs` hace `DROP DATABASE`, así que exige que el nombre
contenga `e2e` y rechaza cualquier otro. No hay bandera para saltárselo.

---

## 3. Qué se comprueba hoy

Dos capas, y conviene no confundirlas.

**El recorrido público** — las 28 pruebas con las que nació esta fase (14
escenarios × móvil y escritorio):

| Grupo | Qué protege |
|---|---|
| Landing | Responde 200, lleva la marca, ofrece un camino visible para entrar, no deja errores de JavaScript en consola, y carga en menos de 8 s |
| Marketplace | Los listados de empresas y promociones cargan **aunque estén vacíos** |
| Acceso | El formulario tiene sus campos, una ruta protegida redirige al login conservando el destino, y no se acepta un `redirect` externo |
| Sistema | 404 con página propia, pantalla sin conexión, `/api/health` responde, `/api/metricas` **no** es público, el manifiesto de la PWA apunta al escáner |
| Seguridad | La portada llega con `X-Content-Type-Options`, CSP y `Referrer-Policy` |

Dos de ellas son **pruebas de regresión de arreglos anteriores**: la del
`redirect` externo protege el arreglo de la Fase 1 (C-05), y la de
`/api/metricas` protege la decisión de la Fase 6 de no exponer datos de negocio.
Ese es el tipo de detalle que un refactor se lleva por delante sin que nadie lo
note.

### Móvil primero

Los dos perfiles son un Pixel 7 y un Chrome de escritorio, en ese orden. El
grueso del tráfico de MembeGo es un teléfono; probar solo en 1920×1080 sería
probar el caso que casi nadie usa. La primera versión de la prueba de la landing
lo demostró: pasaba en escritorio y fallaba en móvil.

---

**El recorrido autenticado de Supply 2.0** — `supply-v2-slice1` … `slice9`,
un archivo por slice. Cubre lo que esta sección decía que era imposible: alta
de proveedor, acuerdo, orden de compra, oferta, checkout, pago, QR, canje,
beneficios, cupones, fidelización y el centro de operaciones, en móvil y
escritorio.

Se desbloqueó sin un proyecto de Supabase, y el truco está en
`tests/e2e/supply-v2-sesion.ts`: el arnés **firma la cookie de sesión con
`SUPABASE_JWT_SECRET`**. Cuando `supabase.auth.getUser()` falla con un error de
red —en CI la URL apunta a un puerto local sin nadie escuchando, a propósito—
la aplicación cae a la verificación LOCAL del token, que es la que acepta esa
cookie. Lo que hacía falta no era un servicio externo: era un secreto de
relleno y una base desechable.

---

**El catálogo unificado (Commerce Core)** — `catalogo-admin`, `catalogo-publico`
y `catalogo-api`, con el arnés de siembra `catalogo-arnes.ts`. Reutilizan el
mismo truco de sesiones firmadas, sin Supabase:

- `catalogo-admin` (escritorio): el panel de punta a punta — alta, precio,
  publicar, variantes (el selector aparece y desaparece), categoría, foto sin
  Storage (avisa y la pantalla sigue viva), filtros — y comprueba que **lo
  publicado desde el panel se ve** en la vitrina de la empresa, en `/catalogo`
  y en el inicio, y que **pausarlo lo saca**: es la prueba de que el panel
  invalida la caché del marketplace. Además: un ítem de otra empresa se ve igual
  que uno inexistente, y una empresa sin la capacidad no entra ni ve el menú.
- `catalogo-publico` (móvil **y** escritorio, datos sembrados): qué se ve (precio,
  «antes» tachado, «desde», agotada marcada, descontinuada ausente) y qué no
  (borrador, pausado, «solo caja», empresa sin capacidad o sin publicar — todas
  idénticas a un 404 —, ni costo ni SKU en el HTML), sin desbordes horizontales
  y sin errores de consola.
- `catalogo-api` (HTTP puro, con claves de empresa reales sembradas): el costo
  solo hacia la clave de la propia empresa, la API arma **borradores** y no
  publica, aislamiento entre empresas y `catalog_not_enabled`.

**El inventario (Commerce Core · Fase 2)** — `inventario-admin` (escritorio),
con el mismo arnés (`itemSembrado({ controlaInventario: true })`,
`sucursalSembrada`, `varianteDe`): lista agotada → entrada → faltante sin motivo
(el navegador no deja enviar) → faltante con motivo → faltante imposible (avisa y
no mueve) → daño → baja de lo dañado → umbral y alerta en la lista → transferencia
entre sucursales → conteo físico → historial con cada movimiento; la variante de
otra empresa se ve igual que una inventada, y una empresa sin la capacidad no
entra. **Ojo:** la base de E2E se crea con `db push`, así que NO lleva los
disparadores ni los CHECK de las migraciones (la inmutabilidad del ledger y las
144 combinaciones tipo×origen×destino las prueban `tests/postgres/inventory.db.test.ts`
y `scripts/probar-rls.mjs`, que sí corren sobre una base migrada). Aquí se prueba
la interfaz.

**El puente Supply → Catálogo (Commerce Core · Fase 2.5)** — `puente-supply`
(escritorio), con `puente-arnes.ts` (proveedor, producto, asignación y ofertas de
Supply sembrados por Prisma): sin casa → el superadmin la designa → sincroniza →
las ofertas aparecen en `/catalogo` (franja «Ofertas MembeGo», filtro de origen,
ficha) y la tarjeta lleva a la compra de Supply → **pausar una oferta desde la
interfaz de Supply la saca del catálogo** (ejercita el enganche real `after()`) →
retirar la casa saca todo; un no-superadmin no entra. La casa es **una sola por
base**: el spec la designa y la retira, así que no debe correrse en paralelo con
otro que la use.

**Merchant Billing (Commerce Core · Fase 4)** — `facturacion-superadmin` (escritorio):
el superadmin (`facturacionSuperadmin`, rol `SUPERADMIN`) abre la lista de cobros y
encuentra una empresa con deuda, asienta un pago (la referencia es obligatoria; queda en
el libro con su saldo corrido y en la bitácora), baja el límite de crédito por debajo del
saldo (la cuenta pasa a «En gracia» y la empresa ve el plazo), suspende la cuenta a mano
(«Retenida a mano») y la libera; la empresa ve cada cambio en una pantalla sin
formularios, y quien no es superadmin no entra al panel de cobros. La base de E2E no
lleva los disparadores del libro (`db push`): las reglas se prueban en
`tests/postgres/billing.db.test.ts`; aquí, la interfaz. El recorrido pedido → comisión →
libro está en el spec de pedidos (abajo).

**Pedidos Membego (Commerce Core · Fase 3)** — `pedidos-membego` (escritorio),
con el mismo arnés (`empresaCatalogo({ capacidad: true, pedidos: true })`,
`existenciasSembradas`) y tres sesiones: la de la empresa (`pedidosAdmin`), la de
quien pide (`pedidosCliente`) y la de otra cliente (`cliente2`). Recorre: la ficha
pública ofrece «Hacer un pedido» solo si la empresa recibe pedidos; sin sesión,
pedir manda a iniciar sesión y vuelve; el cliente pide 2 unidades (nace «Esperando
a la empresa», **aparta** el stock y la empresa recibe el aviso) → la empresa lo
acepta, ajusta el monto (sin motivo no envía) y lo marca listo → el cliente ve el
monto ajustado, lo confirma y ve su QR (y ya no puede cancelar) → **el empleado
escanea el QR con una ráfaga de teclas (lector físico) y lo cierra**: el stock baja,
la reserva se consume y el nivel queda «Confirmado por el cliente»; un segundo
escaneo dice «ya se canjeó» → la empresa registra el pago con referencia y sube a
«Pago verificado» → el cliente cancela a tiempo y se libera lo apartado; la empresa
cancela otro con su motivo → reembolso devolviendo lo vendido al inventario → otra
empresa no ve el pedido (se ve igual que uno inventado) y una empresa sin la
capacidad no entra. **Desde la Fase 4** el mismo spec comprueba además que el pedido
cerrado cobró su comisión (CPA, aún sin pago verificado) y aparece en «Mi cuenta
Membego» con su código, que el reembolso deja el reverso y la cuenta en cero, y que una
empresa sin la capacidad no entra a «Mi cuenta Membego» ni otra empresa ve la cuenta
ajena. La ráfaga del lector tiene una trampa: tras recargar
`/empleado/scanner` hay que esperar a «Lector listo» antes de teclear, o las
primeras teclas se pierden y el código llega incompleto (sale «Código QR no
encontrado»). **Ojo:** como el resto, corre sobre una base creada con `db push` (sin
los disparadores ni los CHECK de las migraciones; esos los prueban
`tests/postgres/orders.db.test.ts` y `scripts/probar-rls.mjs`).

**Ofertas con presupuesto (Growth Engine · Fase 5)** — `deals-membego` (escritorio), con el
mismo arnés (`empresaCatalogo({ capacidad: true, pedidos: true, deals: true })`) y cuatro
sesiones: la de la empresa (`dealsAdmin`) y tres personas que reclaman (`dealsCliente`,
`dealsCliente2`, `dealsCliente3`), más un administrador de otra empresa sin la capacidad
(`dealsSinCapacidad`). Recorre: sin la capacidad el panel no existe → la empresa **crea la oferta
como borrador desde el formulario** (20 % sobre un servicio de RD$ 500, cuota de RD$ 100 y
presupuesto de RD$ 200 = 2 canjes) y la **publica** (un borrador no sale en la vitrina) → la vitrina
enseña el precio (RD$ 400 / RD$ 500 tachado) y **no enseña presupuesto ni cuota**, ni en
`/ofertas` ni en la ficha de la empresa, y una empresa sin la capacidad no enseña nada → sin sesión,
«Obtener oferta» manda a iniciar sesión y vuelve → el cliente la obtiene: recibe su **pedido LISTO
con QR** a RD$ 400 y la cuota queda **apartada**; pulsarla otra vez lo lleva al mismo pedido sin
apartar más → la empresa ve quién la obtuvo y el pedido dice «Obtuvo una oferta con descuento» →
otra empresa no ve la oferta → **el empleado escanea el QR** (el escáner dice «Oferta «…»»): el
pedido se cierra, el presupuesto pasa de apartado a **gastado** y Merchant Billing cobra **una
comisión CPA de RD$ 100 ligada a la oferta** sobre la base de RD$ 400 → una segunda persona la
obtiene y el presupuesto se agota: la oferta pasa sola a «Presupuesto agotado» y una tercera
persona ya no puede (no se crea un tercer reclamo; si la vitrina aún enseña la tarjeta, el servidor responde «se agotó») → la empresa **amplía el
presupuesto** y se reabre sola, la **pausa** (sale de la vitrina) y la **reanuda**. Igual que el
resto, corre sobre una base `db push` (sin los disparadores ni los CHECK de las migraciones: esos
los prueban `tests/postgres/deals.db.test.ts` —27 pruebas, incluida la carrera de 16 reclamos por
5 cupos— y `scripts/probar-rls.mjs`). **Ojo:** `/ofertas` y la ficha de la empresa se cachean
(60 s y 1 h); los cambios hechos desde el panel o por un reclamo las invalidan
(`refrescarVitrinasDeOfertas`), pero un cierre por el escáner o un vencimiento por el cron no: la
vitrina puede ir atrasada hasta esos plazos, y por eso el reclamo se vuelve a comprobar siempre
en el servidor.

**Analítica de Membego (Fase 6)** — `analitica-membego` (escritorio), con el mismo arnés y cinco sesiones:
la de la empresa (`analiticaAdmin`), la de otra empresa (`analiticaOtra`), la de una con catálogo pero **sin**
pedidos Membego (`analiticaSin`), el superadmin (`facturacionSuperadmin`) y un administrador que intenta
entrar a la analítica de la plataforma. A diferencia de los otros specs, **los pedidos completados, sus
atribuciones, sus asientos y sus comisiones se siembran por Prisma** (el recorrido pedir → canjear → comisión ya
lo prueban `pedidos-membego` y `deals-membego`; las cuentas exactas, con los bordes de hora local, las prueba
`tests/postgres/analytics.db.test.ts`). Recorre: la empresa lee «Membego te produjo 2 clientes nuevos, 3
pedidos y RD$1,120.00 en ventas. Te costó RD$300.00 (26.8 % de lo vendido)», el retorno (RD$3.70 por peso) y el
costo por cliente nuevo (RD$150.00), la tabla de ventas por canal (que está en el panel plegable «Ver los datos
de este gráfico»: hay que abrirlo antes de buscar sus filas) y que NO aparece nada de otra empresa ni de la de
práctica → un periodo sin pedidos lo dice en vez de enseñar ceros → otra empresa solo ve lo suyo → una empresa sin
los pedidos no tiene el panel → el superadmin ve el ranking con la empresa y su comisión, sin la de práctica, y el
bloque «Supply Economics (Membego → proveedores)» aparte → un administrador de empresa no entra a
`/superadmin/analitica`. **Ojo:** los totales de la plataforma comparten base con los demás specs de la corrida
(todos crean pedidos «de hoy»), así que el spec no afirma el total de la plataforma, solo la fila de su empresa.

**Caja conectada (Fase 7)** — `pos-membego` (escritorio), con el mismo arnés (`empresaCatalogo({ capacidad: true,
pedidos: true, pos: true })`, `existenciasSembradas`) y dos sesiones de cajero: una empresa CON el POS conectado
(`posAdmin`) y otra SIN él (`posSin`). Recorre: la empresa sin la capacidad abre su caja y **no ve** ninguno de los dos
bloques → el cajero abre la caja desde la interfaz y **vende en el mostrador** un servicio y 2 camisetas (el total
RD$450.00 se calcula en pantalla; una transferencia sin referencia no cobra; en efectivo con RD$500 recibidos el
cambio es RD$50.00): la venta queda `POS` completada, sin comisión, las existencias bajan en 2 y el cobro aparece en
«Últimos cobros del turno» con su ticket → **cobra el pedido del marketplace con el QR del cliente**: un código
inventado y el QR de otra empresa no encuentran nada, el pedido válido muestra que el cliente confirmó el monto, una
tarjeta sin autorización no cobra y deja el pedido como estaba, una transferencia con su referencia cobra y entrega
(`PAYMENT_VERIFIED`, comisión del 8 % = RD$20.00) y el mismo QR no se cobra otra vez → la empresa ve ambos pedidos en
`/admin/pedidos-membego` (la venta de mostrador como «Caja»). **Ojo:** el pedido del marketplace se siembra por
Prisma con su QR conocido (pedir → aceptar → listo ya lo prueba `pedidos-membego`), y el «lector» de QR es el campo de
texto: el lector físico teclea el código y pulsa Enter, que es lo mismo.

Tres cosas que costó aprender y conviene no repetir:

1. **No uses `waitUntil: 'networkidle'`.** Con el build de CI el cliente de
   auth reintenta sin parar contra el puerto sin nadie escuchando y la red no
   queda en reposo nunca (la navegación agota el plazo). Usa aserciones con
   reintento.
2. **Las páginas en streaming tienen un instante con el contenido duplicado**
   (una copia oculta que Next intercambia). `getByText` cuenta las ocultas y da
   «strict mode violation»; `getByRole` no. Para presencia usa roles o
   `expect(locator).toHaveCount(1)` antes de actuar.
3. **La lista del marketplace se cachea 120 s por combinación de filtros** y la
   invalida el panel, no una siembra por Prisma. Para datos sembrados, busca por
   el sufijo único de la corrida (otra clave de caché); lo que invalida la caché
   se prueba desde el panel.

---

## 4. Lo que todavía falta

Del recorrido del cliente **de membresías** (el de `Cliente`/`Visita`, no el de
Supply 2.0) sigue sin cubrirse el escaneo de QR en el mostrador y la caja. Para
eso sí harían falta tres cosas, ninguna de código:

1. **Un proyecto de Supabase de pruebas**, separado del de producción. En el
   plan gratuito basta.
2. **Sus claves como secretos del repositorio** (`E2E_SUPABASE_URL`,
   `E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`).
3. **Un juego de datos sembrado** antes de cada ejecución: una empresa, un plan,
   un empleado, un cliente con membresía activa y su QR. `prisma/seed.ts` ya
   existe y sería el punto de partida.

Con eso, el recorrido que habría que escribir —en este orden de valor— es:

1. Un empleado escanea un QR válido y registra una visita. **El más importante:
   es la operación central del negocio.**
2. El mismo QR escaneado dos veces se rechaza la segunda (idempotencia).
3. Un cliente compra una promoción y le llega su QR.
4. Un canje descuenta el uso y deja la compra consumida.
5. Abrir y cerrar una sesión de caja cuadrando el efectivo.
6. **Conversión desde el mapa (Fase 4)**: un car wash sin vehículo lo registra
   desde la oferta del mapa y vuelve al negocio; adquiere una promoción y el
   contexto de ubicación se conserva hasta volver al mapa. Ya está escrito y
   gateado en `tests/e2e/fase4-conversion.spec.ts` (se activa solo cuando
   existe `E2E_SUPABASE_URL`); es el criterio de aceptación §15 de
   `docs/GEOLOCALIZACION.md`.

Mientras tanto, decir "E2E del recorrido completo del cliente" sería falso.
Estas 28 pruebas cubren la puerta de entrada; el interior sigue sin red.

---

## 5. Reglas para escribir más

Aprendidas escribiendo estas, no en abstracto:

- **Selecciona por destino o por rol, no por texto.** La primera versión de la
  prueba de la landing buscaba `/iniciar sesión|entrar|acceder/` y falló porque
  el botón dice "Ingresar". Era un fallo de la prueba, no del producto: el texto
  es cosa de marketing y cambia cuando quiere; el `href="/login"` no puede
  cambiar sin romper el producto.
- **Prueba el vacío.** La base de CI nace sin datos en cada ejecución, y eso es
  una ventaja: obliga a que las pantallas vacías estén bien resueltas.
- **Ignora el ruido de servicios externos.** En CI no hay Supabase ni Sentry;
  sus errores de red en consola no son defectos del código que se prueba. Están
  filtrados explícitamente, no silenciados en general.
- **Una prueba sin aserción de negocio no vale.** Comprobar que una página
  devuelve 200 y nada más solo protege del error 500 — que es el único que sí
  aparece en Sentry.
- **Cada prueba se queda con SUS datos.** Todo lo que crea lleva un sufijo de la
  corrida y todo lo que busca filtra por él. Una prueba que mire «la primera
  fila» de una tabla funciona hasta que alguien añade otra.
- **Antes de usar un elemento filtrado por texto, afirma que hay uno.**
  `await expect(x).toHaveCount(1)` y luego se pulsa. No es un margen de tiempo
  disfrazado: es la invariante de verdad, Playwright reintenta hasta que se
  cumple, y si la página llegara a duplicar la fila esa línea lo caza en vez de
  esconderlo. Sin ella, durante una navegación del App Router el DOM puede
  tener un instante dos copias del listado y el modo estricto aborta — pasó en
  los Slices 3, 6 y 7.
- **Un plazo no se sube para arreglar un problema de volumen.** Si una prueba
  agota su tiempo, primero se mira contra qué base corre. Subir el plazo
  convierte un fallo en una espera y deja la causa intacta.
- **Lo que la prueba afirma tiene que ser lo que el producto promete hoy.** El
  recorrido del Slice 8 afirmó durante un día que quien crea un programa no
  puede aprobarlo, después de que el producto retirara ese veto a propósito. Una
  prueba que defiende una regla que ya no existe no protege nada: estorba.
