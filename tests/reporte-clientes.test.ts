import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CLIENTES · EL REPORTE DE LA BASE (reportes · Fase 10).
 *
 * Lo que estas guardias fijan, por orden de lo que dolería:
 *
 *  1. LA FRONTERA DE PRIVACIDAD. `docs/REPORTES.md` la llama no negociable:
 *     una empresa ve SU relación con el cliente y nada de lo que esa persona
 *     haga en otro negocio. `Cliente` lleva `companyId`, así que el aislamiento
 *     es directo; lo que rompería la frontera es cruzar por `User`, que sí es
 *     global. El motor no lo nombra ni una vez, y esto lo comprueba.
 *  2. Que la FOTO DE HOY no se compare contra el periodo anterior: el pasado de
 *     una foto de hoy no existe, y una variación ahí sería inventada.
 *  3. Que el reporte NO estrene una tercera definición de «cliente activo». El
 *     semáforo vive en `modules/riesgo/semaforo.ts` y este reporte usa por su
 *     nombre los dos ingredientes que el vocabulario distingue.
 *  4. Que los dos permisos se resuelvan EN LA CONSULTA, porque la exportación
 *     reusa la misma función.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const MOTOR = 'src/modules/reportes/clientes.ts'
const VISTA = 'src/components/reportes/ReporteClientesVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/clientes/page.tsx'
const EXPORTA = 'src/app/(admin)/admin/reportes/clientes/export/route.ts'

/** El código del motor sin comentarios: las reglas se miran sobre lo que corre. */
function motorSinComentarios(): string {
  return leer(MOTOR)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('la frontera de privacidad: NUNCA se llega al cliente por su usuario global', () => {
  // Una misma persona puede ser cliente de tres negocios. `Cliente` está
  // acotado por empresa, pero `User` es global: cruzar por ahí reconstruiría
  // por detrás justo lo que la frontera prohíbe.
  const src = motorSinComentarios()
  assert.ok(
    !/tx\.user\b|supabaseId|\buser:\s*\{/.test(src),
    'el motor de clientes está tocando `User`, que es global y cruza empresas'
  )
  // Y toda consulta lleva la empresa: es la barrera directa.
  const conEmpresaEnWhere = src.match(/companyId/g) ?? []
  assert.ok(
    conEmpresaEnWhere.length >= 12,
    `se esperaban todas las consultas acotadas por empresa y solo hay ${conEmpresaEnWhere.length} menciones de companyId`
  )
})

test('la foto de hoy NO se compara contra el periodo anterior', () => {
  // `base`, `conMembresiaVigente` y `sinMembresiaNunca` son números sueltos y
  // no `Kpi`: si fueran Kpi llevarían una variación, y comparar una foto de hoy
  // contra «la foto de hoy del mes pasado» es inventarse un dato que no existe.
  const motor = leer(MOTOR)
  assert.match(motor, /^\s*base: number$/m, 'la base dejó de ser una cifra suelta')
  assert.match(motor, /^\s*conMembresiaVigente: number$/m)
  assert.match(motor, /^\s*sinMembresiaNunca: number$/m)
  // Y la pantalla lo rotula, que es lo que impide leerlas como del periodo.
  assert.match(leer(VISTA), /Foto de hoy — no depende del periodo/)
  assert.match(leer(EXPORTA), /NO depende del periodo/)
})

test('el reporte no estrena una tercera definición de «cliente activo»', () => {
  // El semáforo (activo / en riesgo / dormido / perdido) vive en un solo sitio
  // y ya tiene pantalla. Este reporte usa los INGREDIENTES por su nombre.
  const src = motorSinComentarios()
  assert.ok(
    !/ACTIVO|EN_RIESGO|DORMIDO|PERDIDO|clasificarCliente/.test(src),
    'el reporte de clientes está reimplementando el semáforo en vez de enlazarlo'
  )
  // La vigencia sale de la única puerta que existe para preguntarla.
  assert.match(leer(MOTOR), /membresiaVigente\(ahora\)/, 'la vigencia no usa el ayudante común')
  assert.match(leer(VISTA), /El semáforo del cliente vive en Riesgo/)
})

test('los cobros se fechan con whereCobrado, la única puerta', () => {
  const usos = leer(MOTOR).match(/whereCobrado\(/g) ?? []
  assert.ok(usos.length >= 3, 'algún cobro se está fechando a mano en vez de con whereCobrado')
})

test('sin ver_financieros el dinero NI SE CONSULTA', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /valorGenerado: Kpi \| null/, 'el valor generado debe poder faltar')
  assert.match(
    motor,
    /verDinero \? seguro\(valorDelPeriodo/,
    'la consulta del dinero se lanza sin comprobar el permiso'
  )
  const csv = leer(EXPORTA)
  assert.match(csv, /puedeFuncion\('reportes', 'ver_financieros'\)/, 'el CSV no recomprueba el permiso')
  assert.match(csv, /OMITIDO - sin permiso ver_financieros/)
})

test('la tabla con NOMBRES exige los dos permisos, y se resuelve en la consulta', () => {
  // Es dinero y nombres a la vez: con uno solo de los dos no se enseña.
  const motor = leer(MOTOR)
  assert.match(
    motor,
    /const verTop = verDinero && opciones\.verDatosPersonales === true/,
    'la tabla de los que más gastan no exige los dos permisos'
  )
  assert.match(motor, /verTop\s*\n?\s*\? seguro\(clientesQueMasDejaron/)
  assert.match(motor, /:\s*Promise\.resolve\(null\)/)
  const csv = leer(EXPORTA)
  assert.match(csv, /puedeFuncion\('reportes', 'ver_datos_personales'\)/)
  assert.match(csv, /OMITIDO - hacen falta ver_financieros Y ver_datos_personales/)
})

test('ver_datos_personales existe en el catálogo: ya no es un interruptor pintado', () => {
  // La regla del catálogo es que solo se listan las funciones que HOY se hacen
  // cumplir. Este reporte es el primero que pone nombres de personas en una
  // tabla, así que es el que le da sentido.
  const catalogo = leer('src/lib/auth/funciones.ts')
  assert.match(catalogo, /codigo: 'ver_datos_personales'/, 'la función no está en el catálogo')
  assert.match(leer(PAGINA), /puedeFuncion\('reportes', 'ver_datos_personales'\)/)
})

test('todo se cuenta en la base y el día se corta en la zona del negocio', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /count\(DISTINCT "clienteId"\)/, 'los clientes distintos deben contarse en SQL')
  assert.match(motor, /EXISTS \(/, 'las altas que volvieron deben resolverse con un EXISTS')
  assert.match(motor, /AT TIME ZONE/, 'el día se cortaría en UTC y las altas de la noche bailarían')
})

test('las agrupaciones van con tope y lo recortado se declara', () => {
  const motor = leer(MOTOR)
  assert.match(motor, /LIMIT \$\{TOPE_GRUPOS\}/)
  assert.match(motor, /RESTO = '\(resto, agrupado\)'/)
  assert.match(motor, /conElResto\(canales, nuevos\)/)
  assert.match(motor, /conElResto\(ciudades, nuevos\)/)
})

test('las tasas sin base son «sin dato», nunca cero', () => {
  // Un 0 % de activación diría que ninguno volvió, que es una afirmación sobre
  // el negocio; sin altas, lo que no hay es dato.
  assert.match(leer(MOTOR), /nuevos === 0 \? null : Math\.round\(\(volvieron \/ nuevos\) \* 100\)/)
  assert.match(leer(VISTA), /Sin dato/)
})

test('un fallo se dice, no se enseña como cero', () => {
  assert.match(leer(MOTOR), /incompleto: fallos\.n > 0/)
  assert.match(leer(VISTA), /r\.incompleto &&/)
})

test('el reporte se alcanza desde la pantalla de reportes', () => {
  assert.match(leer('src/app/(admin)/admin/reportes/page.tsx'), /\/admin\/reportes\/clientes/)
})

test('la exportación lleva el mismo periodo que la pantalla y declara su alcance', () => {
  const csv = leer(EXPORTA)
  assert.match(csv, /leerRango\(sp, timeZone\)/, 'el CSV no debe recalcular el periodo por su cuenta')
  assert.match(csv, /Alcance del reporte/)
  assert.match(csv, /SOLO la relacion de esta empresa con cada cliente/)
})
