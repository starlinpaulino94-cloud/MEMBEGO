# Reportes

Todo reporte de MembeGo se puede **ver, exportar e imprimir**. Este documento
dice dónde vive cada pieza y, sobre todo, **qué reglas no se pueden romper** —
porque los fallos de un reporte no se notan: se ven como un número.

## Las pantallas

| Pantalla | Quién | Motor | Periodo | Exporta | Imprime |
| --- | --- | --- | --- | --- | --- |
| `/superadmin/reportes` | Superadmin | `modules/reportes/globales.ts` | presets + a mano | ✅ CSV | ✅ |
| `/superadmin/reportes/[id]` | Superadmin | `modules/reportes/queries.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/reportes` | Dueño del negocio | `modules/reportes/queries.ts` | presets + a mano | ✅ CSV | ✅ |
| `/admin/app/carwash/reportes` | Encargado | `modules/apps/reportes.ts` | desde/hasta | ✅ CSV | ✅ |
| `/admin/retencion` | Dueño del negocio | `modules/riesgo/retencion.ts` | ventana fija (90 d) | ✅ CSV | ✅ |
| `/admin/riesgo` | Dueño del negocio | `modules/riesgo/` | filtros | ✅ CSV | ✅ |
| `/admin/registros` | Dueño del negocio | `modules/registros/` | filtros | ✅ CSV | ✅ |
| `/admin/seguimiento/imprimir` | Dueño del negocio | `modules/seguimiento/` | desde/hasta | ✅ CSV | ✅ |
| `/superadmin/auditoria` | Superadmin | `modules/auditoria/` | filtros | ✅ CSV | — |
| `/admin/actividad` | Dueño del negocio | `modules/auditoria/` | filtros | ✅ CSV | — |

`/superadmin/reportes/[id]` y `/admin/reportes` montan **el mismo componente**
(`components/reportes/ReporteEmpresaVista`). No es ahorro de código: si fueran
dos vistas, el superadmin y el cliente acabarían discutiendo sobre cifras
distintas del mismo negocio.

## Las cinco reglas

### 1. El periodo se corta en la zona horaria del NEGOCIO

`modules/reportes/rango.ts` es la única puerta. Nunca `new Date(año, mes, 1)`:
eso es medianoche del servidor, que en el despliegue es UTC, y un cobro del día
31 a las 9 de la noche en Santo Domingo cae en el mes siguiente.

Cuando el reporte cruza TODAS las empresas y no hay una de la que sacarla, se
usa `TZ_PLATAFORMA` (`lib/format.ts`).

### 2. Los cobros se fechan con `whereCobrado`

`modules/pagos/cobrado.ts`: `fechaPago`, con respaldo a `updatedAt` solo para
las filas anteriores a la columna. Fechar por `updatedAt` hace que editar una
membresía vieja la mueva de mes y que un informe ya cerrado cambie solo.

### 3. Ninguna cifra sale de una lista recortada

Un contador se hace con `count()`/`groupBy`, nunca con el `.length` de un
`findMany` con `take`. Si hay que recortar una LISTA, el recorte se dice en
pantalla y dentro del archivo exportado.

### 4. Las empresas de práctica quedan fuera por defecto

`SIN_DEMO` (`modules/demo/index.ts`). El interruptor «incluir empresas de
práctica» existe para los entrenamientos; lo que no puede pasar es que se
mezclen sin decirlo. El Resumen y los Reportes tienen que dar la misma cifra.

### 5. Un fallo se dice, no se enseña como cero

Cada motor devuelve `incompleto: boolean` y la pantalla lo pinta. Cuatro
tarjetas en `RD$0` porque una consulta no respondió es peor que un error.

## Exportar

- Siempre en el **servidor** (una ruta `export`/`exportar`), nunca en el
  navegador: el navegador solo tiene la página que se está viendo.
- Con **el mismo periodo y el mismo filtro** que la pantalla, leídos con las
  mismas funciones. Un export que exporta otro corte es la forma más silenciosa
  de dar un dato equivocado.
- El archivo abre con un bloque **«Alcance del reporte»**: periodo, filtros y si
  los datos estaban completos. Un CSV descargado no lleva encima las condiciones
  con las que se generó.
- El armado va por `armarCsv` / `armarCsvBloques` (`lib/csv.ts`), que es la
  **única puerta**: separador `;` (Excel en español), BOM al inicio y escapado
  común. `tests/reportes-plataforma.test.ts` prohíbe volver a armarlo a mano.

## Imprimir

`ReporteImprimible` + `BotonImprimir` (`@/components/ui/…`). Un solo bloque
`@media print` para todo el panel; antes eran cinco copias.

- En papel solo se ve la región del reporte: sin menú lateral, sin cabecera del
  panel, sin lo que lleve `print:hidden`.
- **El color del papel no es una decisión de tema**: blanco y negro fijos. Si
  heredara las variables, quien tenga el panel en oscuro imprimiría texto casi
  blanco sobre una hoja blanca.
- La hoja siempre lleva **cuándo se generó**: sobrevive al dato que la produjo.
- `soloPapel` para las pantallas que necesitan una versión distinta en papel
  (Registros: nueve columnas en pantalla, siete en A4).
- **Las gráficas no imprimen.** `ResponsiveContainer` de Recharts mide el
  contenedor al pintar y en `@media print` sale en blanco. Se acompañan de una
  tabla equivalente con `hidden print:block`, que además es la alternativa
  textual para lectores de pantalla.

**No cubre los tickets de 80 mm** (recibos de caja, comprobantes del escáner,
facturas). Papel de rollo continuo con su ancho, su tipografía y su lógica de
reimpresión: solo se parecen a un reporte en que salen por una impresora.

## Guardar como PDF

El mismo botón. El diálogo del navegador ofrece «Guardar como PDF» en todos los
sistemas, y por eso la etiqueta lo dice: mucha gente que quiere el PDF no pulsa
un botón que dice «imprimir» porque cree que necesita una impresora conectada.

No hay librería de PDF en el servidor. Si algún día hace falta una portada con
logo y paginación fija, entra entonces — no antes.

## Monedas

Los ingresos de plataforma se agrupan **por moneda**, nunca en una sola cifra.
Con todas las empresas en DOP se ve igual que antes: una línea. En cuanto haya
dos monedas con dinero, el reporte lo dice y la comparación contra el periodo
anterior se calcula solo para la principal. Sumar pesos con dólares da un número
que no es dinero de nada.
