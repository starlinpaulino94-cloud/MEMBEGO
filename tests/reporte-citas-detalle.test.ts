import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CITAS · EL DETALLE CITA POR CITA (reportes · Fase 8).
 *
 * El reporte decía «43 canceladas» y ahí se acababa. Lo que estas guardias
 * fijan, por orden de lo que dolería:
 *
 *  1. Que cada pestaña use EL MISMO criterio que la cifra que abre, incluidas
 *     las dos que no siguen el eje del reporte —«reservadas» va por
 *     `createdAt` y «por confirmar» no depende del periodo—, y que la pantalla
 *     lo diga cuando toca una de esas dos. Sin el aviso, quien vea citas de
 *     otro mes en la lista pensará que el reporte está roto.
 *  2. Que filas y total compartan el where, o el encabezado diría un número y
 *     la tabla enseñaría otro.
 *  3. Que la lista de estados abiertos sea LA MISMA que usa el motor: dos
 *     listas iguales escritas en dos sitios se separan en cuanto nace un
 *     estado, y entonces el detalle abre otras filas que las que se contaron.
 *  4. Que el aviso de «el estado es el de hoy» viaje también aquí: es la
 *     pantalla donde más fácil sería leer una fila como «cancelada ese día».
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const DETALLE = 'src/app/(admin)/admin/reportes/citas/detalle/page.tsx'
const VISTA = 'src/components/reportes/ReporteCitasVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/citas/page.tsx'
const MOTOR = 'src/modules/reportes/citas.ts'

test('las pestañas fuera del eje del reporte lo DICEN en pantalla', () => {
  // «Reservadas» se fecha por cuándo se pidió la cita, no por cuándo era, así
  // que puede enseñar citas de otro mes; «por confirmar» ignora el periodo.
  // Sin el aviso, las dos parecen un error de la lista.
  const src = leer(DETALLE)
  assert.match(src, /FUERA_DEL_EJE/, 'desapareció la nota de las pestañas que no siguen el eje')
  assert.match(src, /RESERVADAS:\s*\n?\s*'Estas se fechan por CUÁNDO SE RESERVARON/)
  assert.match(src, /POR_CONFIRMAR:\s*\n?\s*'Esta lista NO depende del periodo/)
})

test('cada pestaña recorta la cifra que dice abrir', () => {
  const src = leer(DETALLE)
  assert.match(src, /vista === 'RESERVADAS'\s*\n?\s*\? \{ createdAt: enPeriodo \}/, 'RESERVADAS no va por createdAt')
  assert.match(
    src,
    /vista === 'POR_CONFIRMAR'\s*\n?\s*\? \{ estado: 'PENDIENTE', inicio: \{ gte: ahora \} \}/,
    'POR_CONFIRMAR no es la alarma del reporte'
  )
  assert.match(src, /vista === 'COMPLETADAS' \? \{ estado: 'COMPLETADA' as const \}/)
  assert.match(src, /vista === 'CANCELADAS' \? \{ estado: 'CANCELADA' as const \}/)
  assert.match(src, /vista === 'NO_ASISTIO' \? \{ estado: 'NO_ASISTIO' as const \}/)
})

test('«ya pasaron sin cerrar» usa el MISMO corte que el reporte', () => {
  // El reporte corta en el mínimo entre ahora y el fin del rango. Si el
  // detalle cortara en otro sitio, abriría más filas de las que se contaron.
  const src = leer(DETALLE)
  assert.match(src, /Math\.min\(ahora\.getTime\(\), rango\.hasta\.getTime\(\)\)/)
  assert.match(src, /estado: \{ in: ABIERTOS \}, inicio: \{ gte: rango\.desde, lt: yaPaso \}/)
})

test('la lista de estados abiertos es LA MISMA del motor, no una copia', () => {
  assert.match(
    leer(MOTOR),
    /export const ABIERTOS/,
    'el motor dejó de exportar ABIERTOS y el detalle tendría que duplicarla'
  )
  assert.match(
    leer(DETALLE),
    /import \{ ABIERTOS \} from '@\/modules\/reportes\/citas'/,
    'el detalle duplicó la lista de estados abiertos en vez de reusarla'
  )
})

test('filas y total comparten el MISMO where, y el where lleva la empresa', () => {
  const src = leer(DETALLE)
  assert.match(src, /tx\.cita\.count\(\{ where \}\)/, 'el total no usa el mismo where que las filas')
  assert.match(src, /tx\.cita\.findMany\(\{\n\s*where,/, 'las filas no usan el where compartido')
  const base = src.slice(src.indexOf('const base: Prisma.CitaWhereInput'), src.indexOf('const where:'))
  assert.match(base, /^\s*companyId,$/m, 'el where del detalle no acota por empresa')
})

test('el aviso de que el estado es el de HOY viaja también al detalle', () => {
  assert.match(
    leer(DETALLE),
    /El estado es el de hoy, no el del día de la cita/,
    'sin el aviso, una fila se lee como «cancelada ese día» y solo dice «cancelada»'
  )
})

test('sin ver_empleados el nombre de quien atendió NI SE PIDE a la base', () => {
  assert.match(
    leer(DETALLE),
    /\.\.\.\(verEmpleados \? \{ atendidaPor: \{ select: \{ name: true \} \} \} : \{\}\)/,
    'el select trae el nombre de quien atendió sin comprobar el permiso'
  )
})

test('«reservadas» se ordena por cuándo se reservó', () => {
  // Una lista fechada por un campo y ordenada por otro se lee como si le
  // faltaran filas.
  assert.match(leer(DETALLE), /vista === 'RESERVADAS' \? \{ createdAt: 'desc' \}/)
})

test('el detalle está ENLAZADO desde el reporte, incluidas las dos alarmas', () => {
  const vista = leer(VISTA)
  assert.match(vista, /Ver el detalle cita por cita/, 'el enlace prominente al detalle desapareció')
  for (const v of ['TODAS', 'COMPLETADAS', 'CANCELADAS', 'NO_ASISTIO', 'ABIERTAS', 'RESERVADAS']) {
    assert.match(vista, new RegExp(`detalle\\('${v}'\\)`), `la cifra ${v} no se puede abrir`)
  }
  // Las alarmas también: son las dos que piden actuar HOY.
  assert.match(vista, /detalle\('POR_CONFIRMAR'\)/, 'la alarma de pendientes no lleva a sus filas')
  assert.match(vista, /detalle\('SIN_CERRAR'\)/, 'la alarma de agenda sin cerrar no lleva a sus filas')
})

test('el detalle hereda el MISMO periodo y el MISMO filtro que el reporte', () => {
  assert.match(leer(PAGINA), /qs=\{qsExport\}/, 'el reporte no le pasa su periodo y filtro al detalle')
  const src = leer(DETALLE)
  assert.match(src, /leerRango\(sp, timeZone\)/, 'el detalle recalcula el periodo por su cuenta')
  assert.match(src, /leerParam\('servicio'\)/, 'el detalle ignora el filtro de servicio')
})

test('los campos del detalle tienen nombre accesible', () => {
  const src = leer(DETALLE)
  assert.match(src, /aria-label="Buscar por cliente"/)
  assert.match(src, /aria-label="Filtrar por servicio"/)
})
