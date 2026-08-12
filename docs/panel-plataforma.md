# Centro de control (panel de plataforma) — auditoría y rediseño

Revisión del módulo **Resumen del superadmin**. Quince cambios aprobados, todos
aplicados. Este documento recoge qué se cambió, por qué, y las dos cosas en las
que el análisis inicial se equivocó.

---

## 1. Lo que no se veía en la pantalla

Los dos hallazgos más graves no eran de diseño.

### Dos transacciones anidadas

`dashboard/page.tsx` abría una transacción y, desde dentro, llamaba a
`empresasDelPanel()` y `nuevosReales()`, **que abrían la suya**. Eso pide una
segunda conexión desde dentro de una abierta: con el pooler de Supabase delante,
es como se agota el pool. No da un error legible — da timeouts intermitentes bajo
carga.

Venía de la migración de RLS. La comprobación de entonces buscaba llamadas
`prisma.` sueltas dentro de un envoltorio; **no veía una llamada a función que
por dentro abre su propia transacción**. El método tenía un punto ciego y sobre
él se escribió «cero transacciones anidadas, comprobado».

Ahora lo vigila `scripts/transacciones-anidadas.mjs`, y al aplicarlo aparecieron
**diez**, no dos:

| Archivo | Llamada |
|---|---|
| `superadmin/dashboard/page.tsx` | `empresasDelPanel()`, `nuevosReales()` |
| `admin/empleados/page.tsx` | `listInvitacionesPendientes()` |
| `api/stats/route.ts` | `filasAproximadas()` ×2 |
| `lib/auth/reparar-contexto.ts` | `getEmpresaPrincipal()`, `otorgarBienvenidaDirecta()`, `vincularRegalosPorContacto()`, `capturarCanalRegistro()` |
| `modules/admin/dashboardQueries.ts` | `contarColasDePago()` |
| `modules/admin/automatizaciones.ts` | `getUmbralesRetencion()` |

Dos detalles del detector que costaron una pasada cada uno:

- **Pasar el `tx` no es anidar, es lo contrario.** Cuatro avisos eran funciones
  que aceptan un `tx` opcional justamente para participar en la transacción de
  quien llama. Marcarlas enseñaría a ignorar el aviso, que es la peor
  consecuencia posible para una guardia.
- **`const X = unstable_cache(...)` también abre transacción.** Buscar solo
  `function NOMBRE` daba por inofensivos a `getEmpresaPrincipal` y
  `getUmbralesRetencion`. Y esos son los peores: con la caché caliente no abren
  nada, con la caché fría sí. Ese «a veces» es lo que hace irreproducible un
  agotamiento de pool.

`reparar-contexto.ts` tenía además una **llamada HTTP a Supabase dentro de la
transacción**: mantenía una conexión abierta durante una ida y vuelta de red, y
esto corre en `getUser()` — en el peor momento, cuando varias sesiones rotas se
reparan a la vez. Ahora la transacción solo toca la base y decide; lo demás pasa
fuera, con la conexión ya devuelta.

### «Empresas 4» contaba la demo; las otras tres tarjetas no

La misma fila aplicaba dos reglas mientras la propia página afirmaba abajo que
los números de las empresas de práctica no cuentan. Ahora hay **una sola regla**,
en `modules/superadmin/panel.ts`, y las de práctica aparecen como subtítulo
(`+1 de práctica`) en vez de sumadas en silencio.

---

## 2. Lo que se cambió en la pantalla

| | Antes | Ahora |
|---|---|---|
| Métricas | Empresas · Clientes · Membresías · Clientes nuevos | Empresas · Clientes · Membresías · **Cobrado** |
| Comparación | ninguna | cada métrica contra el mismo tramo anterior |
| Tarjetas | decorativas | pulsables, con destino y etiqueta para lectores |
| Salud | 3 avisos | 4, con **Empresas en silencio** |
| Empresa | Clientes · Planes · Activas | Clientes · Activas · **Actividad** |
| Estado | una insignia | activa **y** publicada, separadas |
| Actividad | `CUENTA_ELIMINADA` | `Cuenta eliminada · Cliente · CARTOWN · starlin` |
| Periodo | 30 días fijo | 7 / 30 / 90 |
| Móvil | métricas primero | **salud primero** |

**El dinero faltaba por completo.** Un centro de control de un SaaS sin lo
cobrado no contesta la primera pregunta de quien lo opera. Se añadió con la
**misma definición** que usan el Resumen de la empresa y Reportes: estaba escrita
tres veces a mano y ahora vive en `modules/pagos/cobrado.ts`, con pruebas.

De esas pruebas salió un detalle que las tres copias tenían bien por costumbre y
nadie había escrito: el respaldo por `updatedAt` va con `fechaPago: null`
explícito. Como dos ramas sueltas de un `OR`, un cobro con fecha propia tocado
dentro del rango entraría por las dos y el mes cerraría de más.

**«Planes» salió de las tarjetas de empresa.** Lo repetían las de arriba y no
distinguía una empresa de otra. Lo que sí distingue —y avisa de la que se está
apagando— es cuánto hace que pasó algo.

---

## 3. Dos cosas en las que el análisis se equivocó

### «Globales» sí distinguía algo

El análisis dijo que la palabra no distinguía nada «en un panel donde todo es
global». Falso: el superadmin tiene **dos paneles** —Plataforma y Panel de
empresa— y la paleta de comandos los enseña juntos. Ahí «Planes» de la plataforma
y «Planes» de una empresa coincidían, y el sufijo los separaba. Lo destapó una
prueba que ya existía.

Pero la solución no era el sufijo: en el menú lateral, que enseña **un panel cada
vez**, «globales» no distinguía nada y solo alargaba. La ambigüedad está donde se
mezclan, así que se resuelve ahí — la paleta compone el encabezado como
`Plataforma Membego · Negocio`. La etiqueta corta se queda; lo que se añade es de
qué panel viene.

La prueba pasó a comprobar unicidad **por contexto**, y se añadió una segunda que
cubre el caso de la paleta. Aflojar la primera sin escribir la segunda habría
dejado la ambigüedad suelta justo donde importa.

### La regla de «en silencio» estaba escrita dos veces

El aviso la calculaba en el módulo y la tarjeta la repetía en el render. El
linter lo señaló por otro motivo (`Date.now()` durante el render, impuro), pero
el problema de fondo era la duplicación: el día que una cambiara, el panel diría
«3 en silencio» y solo dos tarjetas saldrían marcadas. Ahora se decide una vez,
en `panel.ts`.

`DIAS_SILENCIO` es **fijo y no depende del selector de periodo**: el aviso tiene
que significar lo mismo mirando 7 días que mirando 90. Si dependiera, cambiar el
periodo cambiaría cuántas empresas «están en silencio».

---

## 4. Reparto del cambio

**Solo frontend** — M02 (regla única visible), M04 (`entidadTipo`), M05
(`href` en `StatCard`), M10 (activa/publicada), M11 (ver todo), M12 (orden
móvil), M13 (menú).

**Backend** — M06 (cobrado), M07 (comparación), M08 (última actividad), alerta
de silencio, M14 (periodo). Todo son consultas nuevas sobre tablas existentes.

**Base de datos** — ninguno. **Sin migración.**

**APIs nuevas** — ninguna. La ruta `/superadmin/tickets` es una página, y renderiza
el mismo componente que `/admin/tickets`.

---

## 5. Componentes que entran al sistema de diseño

- **`AlertTile`** (`packages/ui`) — el aviso de trabajo pendiente. Eran 40 líneas
  copiadas tres veces cambiando solo el color. Además, el color ya no es la única
  señal: encendido cambia el grosor del icono y lleva su propio texto para
  lectores de pantalla.
- **`StatCard`** — gana `href` y `hrefLabel`.
- **`BandejaTickets`** — la bandeja, montada en dos rutas.

---

## 6. Lo que queda apuntado y no se tocó

En el paso de ubicación del registro, el botón **«Atrás» del mini-selector
avanza** en vez de retroceder: en `pais` llama a `onDone()`, que es el `avanzar()`
del asistente. Es anterior a esta revisión y arreglarlo cambia comportamiento que
nadie pidió cambiar.

---

# Empresas (CRM) — segunda revisión

Doce mejoras aprobadas, todas aplicadas. Y como en el Resumen, lo peor no se
veía en la pantalla.

## Los números decían tres cosas distintas

**La demo contaba como negocio real.** `listEmpresas` no seleccionaba `esDemo`,
así que la empresa de práctica entraba en las cuatro cifras de cabecera y en la
lista con insignia «Activa» —mientras el Resumen la marcaba «Demo» y la
restaba—. En las capturas del usuario: **99 clientes en una pantalla y 100 en la
de al lado**, a un clic de distancia.

**«Ingresos» era la cuarta definición de dinero cobrado, y la más laxa.**

```ts
where: { montoPagado: { not: null } }   // sin exigir pagoConfirmado
```

Sumaba cualquier membresía con un monto escrito, cobrado o no. Es la cifra con
la que se juzga qué empresa vale la pena.

**«Activas» no miraba el vencimiento.** `estado: 'ACTIVA'` a secas, cuando
`membresiaVigente()` existe justo porque nada las vence solas.

## Y las copias no eran cuatro: eran trece

Las dos guardias nuevas (`tests/definiciones-unicas.test.ts`) destaparon el
alcance real:

| Concepto | Sitios corregidos |
|---|---|
| Dinero cobrado | Resumen de empresa, CRM (×2), referidos |
| Membresía vigente | perfil del cliente, `/api/stats`, Resumen de empresa (×3), CRM, gamificación, marketplace, reportes |

Dos hallazgos dentro del barrido:

- El Resumen de la empresa fechaba el mes por **`updatedAt`** en vez de
  `fechaPago`: editar una membresía vieja la movía de mes y un informe ya
  cerrado cambiaba solo. Es exactamente el defecto que la auditoría anterior
  corrigió en Reportes; había sobrevivido aquí.
- El perfil del cliente llevaba la condición de vigencia **copiada a mano**.
  Funcionaba, pero basta con que una copia se quede atrás.

**Las guardias empezaron con falsos positivos.** La primera versión buscaba
`estado: 'ACTIVA'` en cualquier sitio y señalaba a `productoCompra` y
`campanaInvitacion`, que tienen su propio estado. Una guardia con falsos
positivos se desactiva en una semana, así que ahora extrae las llamadas sobre
`membership` con paréntesis balanceados. Y exime «por vencer en 7 días», que ya
acota `fechaVencimiento`: pedirle una condición redundante sería pedir que se
calle a la guardia.

## El filtro que no filtraba nada

`email`, `telefono`, `ciudad`, `categoria` y `website` se leían con un cast desde
un objeto que **no los traía en el `select`**: llegaban siempre `null`.

Consecuencia: **los desplegables de Categoría y Ciudad no tenían ni una opción**,
y los botones de correo y WhatsApp de cada tarjeta no aparecían nunca. Es la
misma familia que el buscador muerto de `DataTable`.

## Lo demás

| | Antes | Ahora |
|---|---|---|
| Filtrado | todo en el navegador, con la lista entera descargada | en servidor, con paginación |
| Estado del filtro | dentro del componente | en la URL: se comparte, y «atrás» funciona |
| Filtros | «Todos» / «Todas», sin decir de qué | etiqueta visible + fichas quitables |
| Orden | 3 criterios | 5, con **más tiempo en silencio** |
| Tarjeta | 5 cifras iguales | 2 grandes + una línea secundaria |
| «Ver dashboard» | `<button>` con `router.push` | enlace |
| Estado | una insignia, «Suspendida» | dos ejes, mismas palabras que el Resumen |
| Exportar | no había | CSV con el filtro aplicado |

`EmpresasCRM.tsx` (668 líneas) y `listEmpresas` quedaron huérfanos y se
borraron: código muerto que el gate de RLS seguía escaneando.

## Una guardia ajena que hubo que enseñar

`tests/aislamiento.test.ts` empezó a marcar como fuga una consulta que sí está
acotada. Su regla leía `where: <identificador>` y, ante `where: whereCobrado(…,
where)`, capturaba el nombre del ayudante en vez de lo que se le pasa.

No se aflojó: ahora sigue los ARGUMENTOS de la llamada, que es donde viaja el
acotado. Comprobado en los dos sentidos — con una fuga real introducida a
propósito, la guardia salta.

## Reparto

**Solo frontend:** M18, M19, M20, M21, M22 (parte visual).
**Backend:** M15, M16, M17, M23, M24, M25, M26.
**Base de datos:** ninguno. **Sin migración.**

## Lo que va a bajar

`whereCobrado` y `membresiaVigente` hacen que **«Ingresos» y «Activas» muestren
menos que antes** en varias pantallas. No es una regresión: antes contaban de
más.
