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

**Separación landing / app / paneles.** Los specs `separacion-invariantes`, `separacion-f1` a `separacion-f5` prueban,
por la interfaz y con lo que llega al navegador, que la landing no opera ni descarga código de operación, que el traspaso
es el que corresponde a visitante, cliente y equipo, que los destinos de retorno no abren redirecciones, y que en la app
las operaciones funcionan. El spec `separacion-f7` (los dos anfitriones) no corre con la suite normal: se salta si no hay build de dos dominios. Se lanza con
`bun run e2e:dos-anfitriones` (construye en `.next-f7` con `NEXT_PUBLIC_LANDING_URL`, `NEXT_PUBLIC_APP_ORIGIN` y
`NEXT_PUBLIC_COOKIE_DOMAIN`; `-- --sin-build` reutiliza el build). Los dominios `membego.test` y `app.membego.test` los resuelve
Chromium con `--host-resolver-rules` (sin tocar `/etc/hosts`); el cliente HTTP de Node no los ve, así que las pruebas sin
navegador fijan el `Host` a mano. Detalle en `docs/F7_CORTE_POR_ANFITRION.md`. El mismo spec cubre la limpieza de cookies heredadas de F8 y ejecuta
`bun run corte:verificar` (con `--via 127.0.0.1:3210`) contra ese servidor. Dos reglas del arnés que importan aquí:

- `entrarComo` firma la cookie de sesión **sin `httpOnly`**, como en producción (`@supabase/ssr` la deja legible por el
  navegador): la landing solo pregunta por la sesión a quien trae esa cookie, y con una cookie `httpOnly` no la vería.
- Next 16 streaming: una página «no encontrada» llega con 200 y el cuerpo puede estar a medias al cargar. Se espera el
  streaming (helper `ir`) y se comprueba el contenido, no el código HTTP; y tras navegar puede quedar unos instantes la
  página anterior OCULTA en el DOM, así que se filtra por `visible`.

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
entra. **INV-1** añade un recorrido: las tres vistas (Existencias · Movimientos ·
Reservas), los 7 movimientos de la empresa, filtros por tipo y por sucursal, la
exportación CSV con los mismos filtros (y sin sesión o sin la capacidad no sale ni
una fila), el salto a la ficha con el SKU exacto de un lector, la advertencia de una
variante «Agotada» a mano (la prueba la fija por Prisma y la restaura) y el umbral
aplicado también a la otra sucursal con existencias. **INV-2a** añade otro: la pestaña
Entradas vacía → «Nueva entrada» con un lector (el SKU exacto se añade solo, repetirlo suma
una unidad, el código de barras funciona igual, un código inexistente y un servicio no
entran, una cantidad en cero no deja registrar) → la entrada `ENT-AAAA-000001` con sus
líneas, factura y nota → su CSV (y una entrada inventada da 404) → existencias e historial
→ lista y filtros (también una URL manipulada) → importación CSV: un archivo con filas malas
no registra NADA (ni siquiera sus filas buenas) y un archivo limpio sí (una fila por SKU y
otra por código de barras) → plantilla descargable → sin sesión, o de una empresa sin la
capacidad, no sale ni una fila. **INV-2b** añade el conteo físico: pestaña Conteos vacía → abrir el conteo de
Principal → pantalla a ciegas (ni una cifra del sistema; los pendientes salen sin cantidades) → escaneo por código y por
SKU, «unidades por escaneo», código inexistente y una ráfaga de escaneos seguidos (la cola no pierde ninguno) → corregir
escribiendo el número → una venta mientras se cuenta → hoja en blanco → importar un archivo con errores (no entra nada)
y uno limpio → revisar (esperado, contado, diferencia) y su CSV → aplicar por la diferencia (la venta se conserva) → un
faltante bajo lo apartado se avisa, se rechaza todo y, corregido, se aplica → cancelar con motivo → id inventado, sin
sesión y sin la capacidad. **INV-2c** añade las transferencias con envío: pestaña Transferencias vacía → «Nueva
transferencia» con un lector (se ve lo que hay en el origen y no deja pasar de ahí) → enviar: la transferencia
`TRF-AAAA-000001` queda «En camino», el origen baja, el destino no sube y la ficha del producto muestra «En camino entre
sucursales» → aviso a los administradores → recibir una parte («Recibida en parte»; lo que falta sigue en camino; escribir más de lo que
falta no deja recibir) → cerrar con faltante (sin motivo no deja; con motivo queda «Recibida» y lo perdido) → su CSV →
cancelar otra (lo que seguía en camino VUELVE al origen) → recibir todo de una vez → la lista y sus filtros → lo que NO
debe pasar (id inventado y CSV de un id inventado, sin sesión, sin la capacidad). **INV-3a** añade el costo
y el valor: la pestaña Valor (los vasos con costo de referencia valen; un producto sin costo se dice, con su aviso) → una
entrada con costo (la coma se rechaza con un mensaje que dice qué hacer; con punto, el detalle muestra lo que costó) → otra en
otra sucursal con una línea sin costo (no mueve el promedio) → la ficha: el promedio ponderado de 10 a 5 y 10 a 7 es 6 →
el valor por producto y por sucursal, «solo sin costo», búsqueda y una URL manipulada → fijar el costo de lo que ya había
(sin motivo no deja) → la entrada de un producto desde su ficha con costo (pondera 20 a 6 con 5 a 10 = 6.80) → importar un
CSV con columna de costo (la coma rechaza TODO el archivo; el limpio dice cuántas líneas traen costo) → el costo de ventas del
mes con el costo que cada venta congeló y el aviso de lo vendido sin costo → los archivos (valor y entrada, números sin
separador de miles) → y quien tiene NEGADA la función `costos` no ve la pestaña, la pantalla, la tarjeta de la ficha, el campo
de costo, el costo de la entrada ni su CSV; la descarga del valor da 403 y un archivo con costos se rechaza. **INV-3b** añade las compras: las pestañas Compras y Proveedores → un proveedor nuevo (el nombre no se repite ni por mayúsculas) → sin proveedor no hay orden → una orden con lector: el costo es obligatorio y la coma se rechaza, el total se calcula mientras se arma → guardar el borrador (no mueve el inventario ni los costos) → editarlo (conserva el número) → pedirla (desde ahí no se edita) → la ficha enseña lo pedido como «Pedido a proveedores», no como existencia → recibir una parte (no deja pasar de lo pedido; con la factura; entra con el costo de la orden, nace el costo promedio y el proveedor queda vinculado con su último costo; la entrada dice de qué orden viene) → cerrar con faltante (sin motivo no deja) → otra orden: cancelar una pedida exige motivo y no entra nada → la lista y sus filtros, el detalle y la desactivación del proveedor (la orden ya pedida se sigue recibiendo) → vincular un proveedor a un producto como preferido y quitarlo → el CSV de la orden → una orden inventada da 404 y su CSV también → y quien tiene NEGADA la función `comprar` no ve las pestañas, ni las órdenes, ni los proveedores, ni las tarjetas de la ficha, ni el enlace de la entrada; la descarga da 403. **INV-3c** añade la reposición: la pestaña Reposición vacía lo explica → en la ficha, «Llenar hasta» 20 (un umbral de 25 se rechaza por quedar sobre el objetivo, uno de 5 vale, y bajar el objetivo al umbral también se rechaza) → la propuesta agrupa por proveedor y sucursal: lo sugerido es lo que falta (20 − 3), el costo es el último de ese proveedor y, si nunca se le compró, queda VACÍO y hay que escribirlo; lo que no tiene proveedor se manda a su ficha y no tiene botón → crear el borrador exige el costo, se puede corregir la cantidad, lleva la nota «Borrador creado desde Reposición.» y no mueve existencias → de vuelta, el borrador se avisa pero NO se descuenta → pedirlo lo vuelve compromiso: el grupo desaparece y solo queda lo que no tiene proveedor → los filtros (sin proveedor, búsqueda sin resultados, sucursal y proveedor ajenos que no filtran) → el CSV con los mismos números (sin lo ya pedido) → y con la función `comprar` negada no hay pestaña, ni enlace «Ver qué comprar», ni cifras, y la descarga da 403, pero «Llenar hasta» sigue disponible (es de `ajustar`). **INV-4a** añade los informes de existencias: la pestaña Reportes con sus tres informes → el kardex de un producto (se busca, +100 con su valor, −30 y el saldo de cada movimiento; un rango sin movimientos conserva la existencia de partida; un producto que no existe lo dice; se llega con un clic desde la ficha) y su CSV (400 sin producto, 404 si no existe) → el stock sin ventas (lo que nunca se vendió con su dinero parado, lo que no tiene costo contado aparte, un periodo más largo que los saldos no lista nada, lo ajeno no filtra) y su CSV → la rotación y la cobertura (venta por día, para cuántos días alcanza, los chips por estado, el costo de ventas y los días de inventario) y su CSV con y sin filtro → y con la función `costos` negada las tres pantallas y los tres archivos siguen funcionando pero ni una cifra de dinero ni una columna de costo. **INV-4b** cambia el formulario de movimientos de la ficha y añade el cuarto informe: ajuste, daño y baja exigen elegir el motivo del catálogo (solo los de su clase; «Otro» pide detalle: vacío lo frena el navegador y solo espacios, el aviso de la pantalla) y el historial enseña «Motivo: …» solo en lo que lo lleva (la entrada, la transferencia y el conteo, que pone «Diferencia de conteo» solo, se comprueban contra el ledger) → el informe «Mermas por motivo» desde el hub (lo perdido no incluye lo dañado ni los sobrantes; lo sin costo se cuenta aparte; cada grupo por motivo de lo que más vale a lo que menos; el detalle sin ventas, entradas ni recuperar; el filtro por motivo con un clic) y su CSV → y con la función `costos` negada el informe y el archivo siguen funcionando pero ni una cifra de dinero ni una columna de costo. **INV-4c** añade el margen real y la tarjeta del dashboard: el hub ofrece «Margen real» solo a quien tiene la función `costos` (7 informes con ella, 6 sin ella) → el informe (ingresos, costo, margen y porcentaje: con una venta bajo el costo el margen sale NEGATIVO con el signo menos de verdad, igual en dinero y en porcentaje; lo vendido sin costo conocido no entra y se cuenta aparte con lo que se cobró; el pedido reembolsado queda fuera y a la vista; producto por producto de lo que más margen dejó a lo que menos, con «Bajo el costo» y «sin costo» marcados) → ordenar por «menos margen primero» y buscar un producto acotan resumen y lista → su CSV (el negativo como número, lo reembolsado fuera del margen, el filtro por producto) → la tarjeta «Inventario» del dashboard (valor con las unidades sin costo, margen del mes con su porcentaje y lo que no entra, lo perdido del mes) con enlaces a cada informe → y con la función `costos` negada el informe avisa que no hay permiso sin ninguna cifra, el archivo responde 403 y la tarjeta enseña solo unidades (ni valor, ni margen, ni lo que costó lo perdido). **INV-5a** añade los lotes (`inventario-lotes.spec.ts`, escritorio): la ficha de un producto sin lotes los ofrece y el formulario de siempre no pide ninguno → activar es de un solo sentido y se pide en dos pasos (cancelar lo cierra; confirmar pasa lo que había a «SIN LOTE»; desde ahí no hay conteo suelto ni transferencia) → recibir exige el lote (sin él avisa) y con un lote nuevo guarda su vencimiento; escribir un lote que ya existe bloquea el campo de la fecha y dice cuándo vence → la tabla de lotes sale de lo que antes vence a lo que no (un lote ya vencido, uno por vencer —«Vence en 10 días»—, uno vigente y «SIN LOTE»), cada uno con su estado → dañar sin decir el lote saca del que antes vence y NO está vencido; eligiéndolo se puede dañar el vencido; un faltante de más de lo que tiene el lote elegido avisa y no mueve nada → mover unidades de un lote a otro (los lotes sin elegir se rechazan en la pantalla) → el historial dice de qué lotes es cada movimiento, y la reasignación se ve pero NO aparece en «Mermas por motivo» → una entrada de varias líneas: el producto con lotes trae sus filas (código, vencimiento, cantidad; «Agregar otro lote»; el total sube solo) y el que no lleva lotes, no; el detalle de la entrada dice «Lotes: JAB-A ×6, JAB-B ×4» y la ficha lo enseña en su tabla. **INV-5b1** añade «Vence pronto» (mismo archivo): el hub de reportes lo ofrece → la lista de lo vencido y de lo que vence en 30 días, de lo que antes vence a lo que después (el lote de 400 días y «SIN LOTE» no salen), con lo vendible y lo dañado de cada uno y el aviso de lo ya vencido → los filtros (estado, ventana de 7 y de 15 días, producto o lote, sucursal; una sucursal inventada no filtra) → el CSV con los mismos filtros (la ventana, los días en negativo si ya venció, nada del lote lejano; sin sesión no se descarga) → y la tarjeta «Inventario» del dashboard con su cifra «Vence pronto» (2 lotes en 30 días, 1 ya vencido), que lleva directo a lo vencido. Las fechas son relativas a hoy. **INV-5b2** añade las compras con lotes (mismo archivo): un proveedor y una orden con un producto que lleva lotes y otro que no (antes se negaba) → la orden dice cuál lleva lotes → al recibir, el producto con lotes pide su lote (por defecto, un lote con todo lo que falta), no hay «Recibir todo lo pendiente» y la pantalla lo explica → sin código de lote no se envía → dos lotes en una línea, cada uno con su vencimiento, y el total es la suma → «Recibidas 12 en Principal», la orden dice «Lotes recibidos: E2E-OC-1 ×6, E2E-OC-2 ×2» y la entrada, de qué lotes llegó cada línea → el resto con otro vencimiento para un lote que ya existe se rechaza sin mover nada, y con el suyo cierra la orden → la ficha tiene los dos lotes en la sucursal que recibió → el CSV de la orden trae los lotes. **INV-5b3** añade el conteo por lote (mismo archivo): la crema recibida en Norte en dos lotes → se abre el conteo de Norte y, a ciegas, lo que falta por contar sale **por lote** y sin cantidades (el conteo dice «(5)») → al escanear la crema la captura no la suma: abre sus lotes (con «SIN LOTE» y los de otras sucursales, sin cantidades) y cada clic cuenta en ese lote (con «unidades por escaneo» y una ráfaga que no pierde ninguno), incluido un lote que el sistema no tenía allí → quitar un lote equivocado quita solo esa línea y corregir escribiendo el número → la hoja en blanco trae la columna `lote` con una fila por lote → importar una hoja: con tres errores (sin lote, lote que no existe, lote en un producto sin lotes) no entra nada, y limpia entra por línea de lote → revisar muestra por lote lo esperado, lo contado y la diferencia, y su CSV trae el lote y su vencimiento → aplicar ajusta cada lote por su diferencia («6 → 5», «0 → 1», «4 → 3», «sin cambio») y los saldos de la ficha de cada sucursal, el historial («Lotes: …») y la lista de conteos lo dicen. **INV-5b4** añade las transferencias con lotes (mismo archivo): un producto con dos lotes (L-A vence pronto, L-B lejano) y un pan sin lotes → transferir desde la ficha SIN elegir saca el que antes vence (L-A) y entra al destino en el mismo lote; L-A se agota en el origen y desaparece de su tabla → transferir ELIGIENDO los lotes de Norte a Principal (1 de L-A y 2 de L-B): la cantidad es la suma de lo tecleado, y el historial dice «Lotes: L-B ×2, L-A ×1» → un envío con lotes: la línea del producto dice «lleva lotes» y deja elegirlos (se enseñan con lo que hay y su cantidad pasa a ser la suma), el pan viaja en el mismo envío sin pedir lotes, y un lote al que le falta lo pedido rechaza TODO el envío → la transferencia enseña los lotes de cada línea (enviado y en camino por lote) y sus movimientos dicen de qué lotes → recibir lote por lote: un lote por encima de lo que de él falta bloquea el botón; llega 1 de L-B → «Recibida en parte» y cada lote dice lo suyo → cancelar devuelve cada lote a su sitio («Devuelto 2», «Devuelto 1») → el CSV trae el bloque de lotes y la columna de lotes de cada movimiento → y las fichas quedan con cada lote en su sitio (lo recibido se queda en Norte, lo devuelto vuelve a Principal, el pan sin tabla de lotes). **INV-5b5** añade corregir y deshacer (`inventario-lotes.spec.ts`): un yogur con 4 unidades sueltas → activar lotes por error → la ficha ofrece «¿Activaste los lotes por error?» (en dos pasos; cancelar lo cierra) → desactivar: las existencias siguen en 4, la activación desaparece y se vuelve a ofrecer activar → se activa otra vez y entran dos lotes (Y-A en 10 días, Y-B lejano) → la tarjeta de deshacer ya no sale → «Vence pronto» ve Y-A «Vence en 10 días» → el «SIN LOTE» no tiene botón de corregir → corregir Y-A a 40 días: con el motivo en blanco avisa y no guarda nada, con motivo guarda («PRONTO → +40 días»), la tabla dice «Vence en 40 días», la ficha enseña la historia con el motivo y las 6 unidades siguen igual → «Vence pronto» ya no lista Y-A a 30 días. **INV-5c** añade las series (`inventario-lotes.spec.ts`): un taladro con 4 unidades sueltas → activar eligiendo «Por series» (no pide vencimiento; lo que había queda «SIN SERIE» y la tabla de la ficha habla de series, sin vencimiento ni «Mover unidades entre lotes») → asignar `TAL-001` y `tal-002` a lo que había (el «SIN SERIE» baja de 4 a 2; una serie que ya está no se asigna otra vez y nada cambia) → una entrada suelta con serie y cantidad 2 se rechaza («una serie es una sola unidad») → una entrada de mercancía con series: repetidas, o una que ya está en el inventario (con la sucursal donde está), se rechazan sin dejar series a medias; con dos nuevas entra y el detalle dice «Lotes: TAL-003 ×1, TAL-004 ×1» y cada serie es UNA unidad (contra la base) → «Buscar una serie» desde el hub: `tal-00` encuentra las cuatro, `TAL-001` dice el producto, que está en existencia en Principal y su historia («Ajuste»), y un número inexistente lo dice. **«Quitar filtros»** (`inventario-admin.spec.ts`) recorre las 14 pantallas con filtros: se escribe una búsqueda (y se elige un estado, tipo o motivo donde lo hay), se filtra, se pulsa «Quitar filtros» y el formulario —no solo la lista— vuelve a vacío (antes conservaba lo elegido; hoy cada formulario se vuelve a montar al cambiar la URL). Una guardia estática (`inventario-filtros-formulario.test.ts`) exige la `key` en cada uno.

**Ojo:** la base de E2E se crea con `db push`, así que NO lleva los
disparadores ni los CHECK de las migraciones (la inmutabilidad del ledger y las
144 combinaciones tipo×origen×destino las prueban `tests/postgres/inventory.db.test.ts`
y `scripts/probar-rls.mjs`, que sí corren sobre una base migrada). Aquí se prueba
la interfaz. **Excepción, los lotes:** sus saldos los mantiene la base con
disparadores, así que `scripts/e2e/base-limpia.mjs` aplica las migraciones
`20261068_inventory_lots` y `20261069_inventory_count_lots` (el conteo por lote: su índice parcial y su disparador) después del `db push` (son idempotentes); si una base de
E2E no la trae, `inventario-lotes.spec.ts` se OMITE con un aviso claro en vez de
fallar por otra cosa.

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
(`EXTERNAL_PAYMENT_REPORTED`: lo reportado por el negocio; comisión CPA RD$100 —desde el sprint de cierre el 8 % espera
a que una fuente externa verifique el pago—) y el mismo QR no se cobra otra vez → la empresa ve ambos pedidos en
`/admin/pedidos-membego` (la venta de mostrador como «Caja»). Tras la auditoría F5–F9 suma dos casos: un pedido **ya
pagado por transferencia** (evidencia sembrada) se busca con su QR → la pantalla dice «ya está pagado», **no** ofrece
elegir cómo paga ni «Cobrar», y «Entregar sin cobrar» lo cierra con la transferencia intacta (`EXTERNAL_PAYMENT_REPORTED`, CPA)
y **sin** cobro nuevo en la caja; y con **dos cajas abiertas** (Principal y Norte) aparece el selector, que marca la
caja elegida y cambia el encabezado, mientras que con una sola no hay selector. **Ojo:** el pedido del marketplace se siembra por
Prisma con su QR conocido (pedir → aceptar → listo ya lo prueba `pedidos-membego`), y el «lector» de QR es el campo de
texto: el lector físico teclea el código y pulsa Enter, que es lo mismo.

**Checkout del marketplace (Fase 8)** — `carrito-checkout` (escritorio), con el mismo arnés (`empresaCatalogo({ capacidad:
true, pedidos: true })` para DOS negocios, `existenciasSembradas`) más una cuenta bancaria sembrada (`metodoPago`) y
`PAGO_TRANSFERENCIA` por override en ambos, y dos sesiones: `carritoCliente` y `carritoAdmin`. Recorre, **sin cuenta**:
agregar un producto (2) y un servicio de un negocio y un servicio de otro → el contador del menú los cuenta → `/carrito`
tiene un bloque por negocio con los precios de hoy (RD$800.00 = 2 × 250 + 300) y sobrevive a recargar → «una más»/«una
menos» recalculan con el servidor (RD$1,100.00 ↔ RD$800.00) y «Vaciar» saca un negocio → pagar sin sesión manda a
`/login?redirect=…` y el carrito sigue intacto. **Con cuenta**: pedir 50 de algo que tiene 10 se avisa por renglón
(«Solo quedan N…») y el botón no deja enviar → un negocio sin cuentas no ofrece transferencia y uno que no existe «no
recibe pedidos» → pagar el carrito por **transferencia**: llega a «Mi pedido» con sus dos renglones, la nota «Pagará por
transferencia. paso a las 5», las instrucciones con el **código del pedido como referencia** y la cuenta del negocio, en
la base `MARKETPLACE`/`TRANSFER`/sin pago/canal `MARKETPLACE_BROWSE`, 2 unidades apartadas (no vendidas) y el carrito de
ese negocio vacío → el negocio acepta, marca listo y **registra el pago con referencia** (las instrucciones
desaparecen del pedido del cliente) → el empleado escanea el QR y entrega: queda `COMPLETED` y las unidades apartadas se
venden. **Ojo:** el spec usa `localStorage` por contexto de navegador (cada persona abre el suyo) y espera el resumen del
servidor, que tarda ~200 ms tras cada cambio.

**Conciliación y riesgo (Fase 9)** — `conciliacion-riesgo` (escritorio), con `empresaCatalogo({ capacidad: true, pedidos: true })`
para una empresa y otra marcada `esDemo`, el superadmin de los demás specs (`facturacionSuperadmin`) y un administrador
de empresa (`conciliacionAdmin`). La base de E2E es `db push` (sin disparadores ni CHECK), así que las anomalías se
**siembran por Prisma**: en cada empresa, un pedido completado SIN comisión, 5 cancelados y 4 completados de la misma
persona. Recorre: el administrador de empresa no entra a `/superadmin/conciliacion` ni a `/superadmin/riesgo` → el
superadmin ve en «Conciliación» la regla C01 con **su** pedido (código y empresa), todas las reglas del catálogo y
**ninguna** mención de la empresa de práctica → en «Señales de riesgo» ve la empresa con «Muchos pedidos cancelados»
(alta, 5 de 10) y a la persona con dos indicios (cancelaciones y ráfaga, porque los 10 pedidos se sembraron de golpe),
sin formularios (una señal no actúa) y sin la empresa ni el cliente de práctica. **Ojo:** el spec no afirma totales de
la plataforma (comparten base con los demás specs): solo las filas de sus propios sujetos. Este spec encontró dos fallos
que las pruebas PG no habían visto (un alias repetido que solo rompía el alcance de la plataforma y la transacción
abortada que tumbaba todas las reglas); hoy cada regla corre en su `SAVEPOINT`.

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
