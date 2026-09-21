import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  leerOrden,
  resumenTope,
  siguienteDireccion,
  type MetaCampo,
} from '@/modules/reportes/orden-detalle'

/**
 * ORDENAR LAS TABLAS LARGAS DE LOS DETALLES (rediseño de reportes · Fase 7).
 *
 * Las tablas del reporte se ordenan en el navegador porque están enteras en la
 * página. Las de `/detalle` NO: traen hasta 300 filas ya recortadas por la
 * consulta, y el recorte lo decide el `orderBy`. Ordenarlas en el navegador
 * daría «las 300 más recientes, ordenadas por monto» — que no son «las 300 de
 * mayor monto», y el cobro más grande del trimestre podría no estar en la lista
 * mientras la tabla parece estar respondiendo a la pregunta.
 *
 * Lo que estas pruebas vigilan:
 *
 *  1. Que un `?o=` inventado a mano en la barra de direcciones no llegue nunca
 *     a un `orderBy`.
 *  2. Que ninguna pantalla de detalle se quede con un orden fijo, y que
 *     ninguna ordene en memoria DESPUÉS del tope.
 *  3. Que el subtítulo del tope salga del orden vigente. «Se muestran las 300
 *     más recientes» con la tabla ordenada por monto es falso.
 *  4. Que no se pueda ordenar por un dato que el permiso esconde.
 *  5. Que todo encabezado ordenable corresponda a un campo real de su pantalla:
 *     uno que no exista reordenaría por el de por defecto sin decir nada.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const DETALLES = ['citas', 'finanzas', 'membresias', 'operacion'].map(
  (r) => `src/app/(admin)/admin/reportes/${r}/detalle/page.tsx`
)

const CAMPOS: MetaCampo[] = [
  { clave: 'fecha', label: 'Cuándo', inicial: 'desc', tope: (d) => `fecha ${d}` },
  { clave: 'monto', label: 'Monto', inicial: 'desc', tope: (d) => `monto ${d}` },
  { clave: 'cliente', label: 'Cliente', inicial: 'asc', tope: (d) => `cliente ${d}` },
]

// ───────────────────────── lo que llega por la URL ─────────────────────────

test('un campo inventado en la URL cae al de por defecto', () => {
  const o = leerOrden(CAMPOS, 'montoPagado; drop', 'desc')
  assert.equal(o.clave, 'fecha')
})

test('una dirección inventada usa la inicial del campo', () => {
  assert.equal(leerOrden(CAMPOS, 'cliente', 'lo-que-sea').direccion, 'asc')
  assert.equal(leerOrden(CAMPOS, 'monto', undefined).direccion, 'desc')
  assert.equal(leerOrden(CAMPOS, 'monto', 'asc').direccion, 'asc')
})

test('el encabezado se da la vuelta en su columna y empieza de nuevo en otra', () => {
  const actual = leerOrden(CAMPOS, 'monto', 'desc')
  assert.equal(siguienteDireccion(CAMPOS, actual, 'monto'), 'asc')
  // Otra columna arranca por su propia inicial, no por la que estaba puesta.
  assert.equal(siguienteDireccion(CAMPOS, actual, 'cliente'), 'asc')
  assert.equal(siguienteDireccion(CAMPOS, actual, 'fecha'), 'desc')
})

// ───────────────────────── el texto del tope ─────────────────────────

test('sin recorte no se dice nada', () => {
  assert.equal(resumenTope(CAMPOS, leerOrden(CAMPOS, 'fecha', 'desc'), 12, 300), null)
  assert.equal(resumenTope(CAMPOS, leerOrden(CAMPOS, 'fecha', 'desc'), 300, 300), null)
})

test('con recorte, el texto sigue al orden vigente', () => {
  const porMonto = resumenTope(CAMPOS, leerOrden(CAMPOS, 'monto', 'desc'), 4000, 300)
  assert.match(String(porMonto), /monto desc/)
  assert.match(String(porMonto), /300 de 4000/)
  const porFecha = resumenTope(CAMPOS, leerOrden(CAMPOS, 'fecha', 'asc'), 4000, 300)
  assert.match(String(porFecha), /fecha asc/)
})

// ──────────────────── lo que tiene que pasar en las páginas ────────────────────

test('las cuatro pantallas de detalle existen y leen el orden de la URL', () => {
  for (const ruta of DETALLES) {
    assert.ok(existsSync(join(raiz, ruta)), `falta ${ruta}`)
    const txt = leer(ruta)
    assert.match(txt, /leerOrden\(/, `${ruta} no lee el orden de la URL`)
    assert.match(txt, /resumenTope\(/, `${ruta} no dice qué deja fuera el tope`)
  }
})

test('ninguna pantalla de detalle deja el orden escrito a mano en la consulta', () => {
  for (const ruta of DETALLES) {
    const txt = leer(ruta)
    // Los `orderBy` que quedan son los de los desplegables de filtro (sucursal,
    // empleado, servicio), no los de la lista. La lista pide un `take: MAX`, y
    // ese `findMany` tiene que ordenar por lo que eligió quien mira.
    const i = txt.indexOf('take: MAX')
    assert.ok(i > 0, `${ruta} ya no recorta: revisa esta prueba`)
    const consulta = txt.slice(Math.max(0, i - 700), i)
    assert.match(
      consulta,
      /orderBy: (orderByDe\(|orden)/,
      `${ruta} recorta a MAX con un orden fijo: cambiar de columna no cambiaría qué filas entran.`
    )
  }
})

test('ninguna pantalla de detalle reordena en memoria después del tope', () => {
  for (const ruta of DETALLES) {
    const txt = leer(ruta)
    assert.equal(
      /\bfilas\s*\.\s*sort\(|\bfilasCrudas\s*\.\s*sort\(|\brows\s*\.\s*sort\(/.test(txt),
      false,
      `${ruta} ordena las filas ya recortadas: eso reordena 300, no elige las 300 correctas.`
    )
  }
})

test('el tope no se describe a mano en ninguna pantalla', () => {
  for (const ruta of DETALLES) {
    assert.equal(
      /se muestran las \$\{MAX\}/.test(leer(ruta)),
      false,
      `${ruta} describe el tope a mano: con otro orden ya no serían «las más recientes».`
    )
  }
})

test('no se puede ordenar por un dato que el permiso esconde', () => {
  // `ver_empleados` decide si el nombre de quien atendió se pide siquiera a la
  // base. Un `?o=empleado` ordenaría la lista por un dato invisible.
  for (const ruta of DETALLES) {
    const txt = leer(ruta)
    if (!txt.includes('ver_empleados')) continue
    for (const prohibida of ["clave: 'empleado'", "clave: 'atendida'", "clave: 'revertidaPor'"]) {
      assert.equal(txt.includes(prohibida), false, `${ruta} ofrece ordenar por ${prohibida}`)
    }
  }
})

test('todo encabezado ordenable existe entre los campos de su pantalla', () => {
  for (const ruta of DETALLES) {
    const txt = leer(ruta)
    const claves = new Set([...txt.matchAll(/clave: '([^']+)'/g)].map((m) => m[1]))
    const usados = [...txt.matchAll(/<ThOrden\s+campo="([^"]+)"/g)].map((m) => m[1])
    assert.ok(usados.length > 0, `${ruta} no tiene ningún encabezado ordenable`)
    for (const u of usados) {
      assert.ok(
        claves.has(u),
        `${ruta}: el encabezado «${u}» no es un campo de esa pantalla — reordenaría por el de por defecto sin decirlo.`
      )
    }
  }
})

test('ordenar conserva la pestaña y los filtros', () => {
  for (const ruta of DETALLES) {
    const txt = leer(ruta)
    assert.match(
      txt,
      /siguienteDireccion\(/,
      `${ruta} arma el enlace de orden sin decidir la dirección siguiente`
    )
    // El formulario de filtros tiene que arrastrar el orden, o filtrar lo
    // devolvería al de por defecto sin avisar.
    assert.match(
      txt,
      /name="o" value=\{orden\.clave\}/,
      `${ruta}: filtrar perdería el orden elegido`
    )
  }
})
