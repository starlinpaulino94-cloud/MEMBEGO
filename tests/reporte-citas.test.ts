import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CITAS · EL REPORTE QUE NO EXISTÍA (reportes · Fase 7).
 *
 * La agenda no se podía medir: `grep -i cita src/modules/reportes/` no
 * devolvía nada. Pero el peligro de este reporte no es lo que cuenta, es lo
 * que PODRÍA aparentar contar:
 *
 *  1. `citas` no guarda cuándo cambió de estado —confirmar, completar, marcar
 *     no-asistió y cancelar escriben el mismo campo encima—, así que el
 *     reporte no puede decir «cuántas se cancelaron esta semana». Si algún día
 *     alguien borra ese aviso, el reporte pasa a mentir sin cambiar una cifra.
 *  2. `citas.sucursalId` existe y NADIE lo escribe. Un desglose o un filtro por
 *     sucursal sería una trampa que solo devuelve vacío.
 *  3. La tasa de asistencia sale de las CERRADAS, nunca del total: sobre el
 *     total, una agenda a medio cerrar daría una asistencia baja que no fue.
 *  4. `ver_empleados` manda en la consulta, porque la exportación reusa la
 *     misma función.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const MOTOR = 'src/modules/reportes/citas.ts'
const VISTA = 'src/components/reportes/ReporteCitasVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/citas/page.tsx'
const EXPORTA = 'src/app/(admin)/admin/reportes/citas/export/route.ts'

/** Los valores del enum `CitaEstado`, sin comentarios. */
function estadosDelEnum(): string[] {
  const src = leer('prisma/schema/citas.prisma')
  const abre = src.indexOf('enum CitaEstado {')
  assert.notEqual(abre, -1, 'no se encontró el enum en el esquema')
  return src
    .slice(abre, src.indexOf('\n}', abre))
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l && !l.startsWith('///'))
}

test('el reporte conoce TODOS los estados del enum', () => {
  // Un estado nuevo que no llegara a `ESTADOS_CITA` desaparecería de los
  // totales sin que nada fallara: las citas existirían y no se contarían.
  const motor = leer(MOTOR)
  const lista = motor.slice(motor.indexOf('export const ESTADOS_CITA'), motor.indexOf('] as const'))
  const faltan = estadosDelEnum().filter((e) => !lista.includes(`'${e}'`))
  assert.deepEqual(
    faltan,
    [],
    'estos estados existen en la tabla y el reporte no los conoce:\n' +
      faltan.map((e) => `  · ${e}`).join('\n')
  )
})

test('el reporte AVISA de que el estado es el de hoy, no el del día de la cita', () => {
  // Es la línea que separa un reporte honesto de uno que miente sin cambiar
  // una cifra: sin ella, «canceladas: 14» se lee como «se cancelaron 14 esa
  // semana», que es justo lo que la tabla no sabe.
  assert.match(
    leer(VISTA),
    /El estado es el de hoy, no el del día de la cita/,
    'el aviso desapareció de la pantalla'
  )
  assert.match(
    leer(EXPORTA),
    /ES EL DE HOY, no el del dia de la cita/,
    'el CSV ya no lo dice, y descargado es indistinguible de un histórico'
  )
})

test('la RESERVA guarda la sucursal: sin eso, el desglose sería una trampa', () => {
  // Esta guardia nació al revés —prohibía el desglose mientras la columna
  // estuviera muerta— y se dio la vuelta cuando `reservarCita` empezó a
  // escribirla. Lo que vigila ahora es la causa, no el síntoma: si la reserva
  // dejara de guardarla, el desglose volvería a ser una tabla con una sola
  // fila «(sin asignar)» y un filtro que solo devuelve vacío.
  const acciones = leer('src/modules/citas/actions.ts')
  const create = acciones.slice(acciones.indexOf('tx.cita.create('))
  assert.match(
    create.slice(0, 600),
    /^\s*sucursalId,$/m,
    'la cita se vuelve a crear sin sucursal: el reporte por sucursal quedaría vacío'
  )
  // Con una sola activa se asigna sola; con varias, el id se valida contra la
  // empresa — si no, el id de otro negocio entraría tal cual desde el formulario.
  assert.match(acciones, /sucursalesActivas\.length === 1/)
  assert.match(acciones, /!sucursalesActivas\.some\(\(s\) => s\.id === pedida\)/)
})

test('el desglose por sucursal existe y no esconde las citas sin asignar', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /porSucursal: FilaCitas\[\]/, 'falta el desglose por sucursal')
  assert.match(motor, /conElResto\(sucursales, actual\)/)
  // Las anteriores a que la reserva la pidiera caen en «(sin asignar)» y se
  // enseñan: esconderlas rompería la suma de los subtotales.
  assert.ok(
    !/sucursalId: \{ not: null \}/.test(motor),
    'el reporte esconde las citas sin sucursal y sus subtotales dejarían de sumar'
  )
  assert.match(leer(VISTA), /sin asignar/)
  assert.match(leer(EXPORTA), /no se rellenan hacia atras/)
})

test('la tasa de asistencia sale de las CERRADAS, no del total', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /const cerradas = completadas \+ noAsistio/)
  assert.match(
    motor,
    /cerradas === 0 \? null : Math\.round\(\(completadas \/ cerradas\) \* 100\)/,
    'la tasa de asistencia dejó de calcularse sobre las citas cerradas'
  )
})

test('las citas que ya pasaron sin cerrar son una cifra, no una nota al pie', () => {
  // Si nadie cierra la agenda, la tasa de asistencia no significa nada. El
  // reporte lo dice en vez de dejar que alguien decida con ella.
  const motor = leer(MOTOR)
  assert.match(motor, /sinCerrar: number/)
  assert.match(motor, /estado: \{ in: ABIERTOS \}/)
  // El corte es el mínimo entre «ahora» y el fin del rango: sin él, mirar el
  // mes en curso contaría como sin cerrar las citas de la semana que viene.
  assert.match(motor, /Math\.min\(ahora\.getTime\(\), rango\.hasta\.getTime\(\)\)/)
  assert.match(leer(VISTA), /sin cerrar/)
})

test('la demanda y la agenda son DOS cifras: createdAt nunca se mezcla con inicio', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /campo: 'inicio' \| 'createdAt' = 'inicio'/)
  assert.match(motor, /filtro,\n\s*'createdAt'\n\s*\)/, 'las reservadas no se fechan por createdAt')
})

test('sin ver_empleados la consulta por persona NI SE LANZA', () => {
  // Traerla para esconderla en la vista dejaría el dato saliendo por el CSV,
  // que usa esta misma función.
  const motor = leer(MOTOR)
  assert.match(motor, /opciones\.verEmpleados\s*\n?\s*\?/)
  assert.match(motor, /:\s*Promise\.resolve\(null\)/)
  const csv = leer(EXPORTA)
  assert.match(csv, /puedeFuncion\('reportes', 'ver_empleados'\)/, 'el CSV no recomprueba el permiso')
  assert.match(csv, /OMITIDO - sin permiso ver_empleados/)
  assert.match(leer(VISTA), /r\.porEmpleado === null/)
})

test('todo se cuenta en la base y el día se corta en la zona del negocio', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /groupBy\(/, 'las cifras deben salir de agregados, no de listas')
  assert.match(motor, /AT TIME ZONE/, 'el día se cortaría en UTC y las citas de la noche bailarían')
  assert.ok(!/findMany\(\)\.length|\.length\s*,\s*fallos/.test(motor))
})

test('las agrupaciones van con tope y lo recortado se declara', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /LIMIT \$\{TOPE_GRUPOS\}/)
  assert.match(motor, /RESTO = '\(resto, agrupado\)'/)
  assert.match(motor, /conElResto\(servicios, actual\)/)
})

test('los filtros se validan contra la empresa y van parametrizados', () => {
  const motor = leer(MOTOR)
  const cuerpo = motor.slice(
    motor.indexOf('async function resolverFiltro'),
    motor.indexOf('/** Las sucursales activas de la empresa')
  )
  // Un servicio o una sucursal inventados NO filtran a ciegas: se descartan,
  // porque aplicar un id que no existe pintaría toda la agenda en cero y el
  // cero es una afirmación sobre el negocio, no sobre la URL.
  assert.match(cuerpo, /where: \{ companyId, servicio: pedidoServicio \}/, 'el servicio no se valida')
  assert.match(cuerpo, /where: \{ id: pedido\.sucursalId, companyId \}/, 'la sucursal no se valida')
  assert.match(cuerpo, /if \(!servicio && !sucursal\) return null/)
  assert.match(motor, /Prisma\.sql`AND "servicio" = \$\{/, 'el servicio no viaja como parámetro')
  assert.match(motor, /Prisma\.sql`AND "sucursalId" = \$\{/, 'la sucursal no viaja como parámetro')
})

test('un fallo se dice, no se enseña como cero', () => {
  assert.match(leer(MOTOR), /incompleto: fallos\.n > 0/)
  assert.match(leer(VISTA), /r\.incompleto &&/)
})

test('al cliente solo se le pregunta la sucursal cuando hay más de una', () => {
  // Un desplegable con una sola opción es una pregunta sin pregunta, en un
  // formulario que se rellena desde el teléfono. Con una sola, la asigna el
  // servidor; el selector aparece solo cuando de verdad hay que elegir, y va
  // obligatorio: una cita sin local en un negocio con varios es justo el
  // agujero que esto viene a cerrar.
  const form = leer('src/components/citas/ReservarCita.tsx')
  assert.match(form, /sucursales\.length > 1 && \(/, 'el selector no se condiciona a que haya varias')
  assert.match(form, /name="sucursalId"\n\s*required/, 'el selector de sucursal no es obligatorio')
})

test('el reporte se alcanza desde la pantalla de reportes', () => {
  assert.match(leer('src/app/(admin)/admin/reportes/page.tsx'), /\/admin\/reportes\/citas/)
})

test('la exportación lleva el mismo periodo y el mismo filtro que la pantalla', () => {
  const csv = leer(EXPORTA)
  assert.match(csv, /leerRango\(sp, timeZone\)/, 'el CSV no debe recalcular el periodo por su cuenta')
  assert.match(csv, /servicio: sp\.servicio/, 'el CSV ignora el filtro de la pantalla')
  assert.match(csv, /Alcance del reporte/)
  assert.match(leer(PAGINA), /aria-label="Filtrar por servicio"/)
})
