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

Con un Chromium ya instalado en el sistema:
`PLAYWRIGHT_CHROMIUM_PATH=/ruta/a/chrome npm run e2e:limpio`.

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
