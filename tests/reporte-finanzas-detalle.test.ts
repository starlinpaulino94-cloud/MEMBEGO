import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * FINANZAS · EL DETALLE COBRO POR COBRO (reportes · Fase 9).
 *
 * El reporte decía «RD$142.300 de caja» y ahí se acababa: para cuadrar contra
 * el arqueo había que creer el número. Lo que estas guardias fijan:
 *
 *  1. Que el total del encabezado salga de un AGREGADO y no de sumar las filas
 *     que se enseñan. Con el tope de 300, sumar la lista diría una cifra más
 *     baja que el reporte y nadie sabría cuál de las dos está mal. Es la
 *     tercera regla de docs/REPORTES.md aplicada a una pantalla de dinero.
 *  2. Que los cobros de membresía se fechen con `whereCobrado`, la única
 *     puerta —segunda regla—: fechar por `updatedAt` movería de mes un cobro
 *     viejo al editarlo.
 *  3. Que solo `APPROVED` y `APPLIED` cuenten como dinero, igual que el motor.
 *  4. Que las pestañas de pasarela NO se filtren por sucursal —`PagoIntento`
 *     no la guarda— y que la pantalla lo diga en vez de aplicar el filtro a
 *     medias y dejar que el total parezca recortado cuando no lo está.
 *  5. Que toda la pantalla exija `ver_financieros`: aquí todo es dinero.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const DETALLE = 'src/app/(admin)/admin/reportes/finanzas/detalle/page.tsx'
const VISTA = 'src/components/reportes/ReporteFinanzasVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/finanzas/page.tsx'

test('el total del encabezado sale de un agregado, no de sumar las filas', () => {
  const src = leer(DETALLE)
  for (const tabla of ['transaction', 'membership', 'pagoIntento']) {
    assert.match(
      src,
      new RegExp(`tx\\.${tabla}\\.aggregate\\(`),
      `la pestaña de ${tabla} no agrega en la base: sumaría la lista recortada`
    )
  }
  assert.ok(
    !/filas\.reduce\(/.test(src),
    'el total se está sumando en JavaScript sobre la lista recortada'
  )
})

test('los cobros de membresía se fechan con whereCobrado, la única puerta', () => {
  const src = leer(DETALLE)
  // En las DOS consultas: si solo una lo usara, el encabezado y la tabla
  // contarían cosas distintas. Va dentro de cada llamada —y no en una
  // variable— porque es la convención del resto del código y lo que
  // `tests/definiciones-unicas.test.ts` sabe comprobar.
  const usos = src.match(/whereCobrado\(rango\.desde, rango\.hasta, acota\)/g) ?? []
  assert.equal(
    usos.length,
    2,
    'las filas y el total de membresías deben fecharse los dos con whereCobrado'
  )
  // Y la fila enseña el mismo respaldo que usa el filtro: sin él, las filas
  // anteriores a la columna saldrían con la fecha en blanco.
  assert.match(src, /m\.fechaPago \?\? m\.updatedAt/)
})

test('solo APPROVED y APPLIED son dinero, igual que el motor', () => {
  const src = leer(DETALLE)
  assert.match(src, /const COBRADOS = \['APPROVED', 'APPLIED'\] as const/)
  assert.match(src, /const DESHECHOS = \['CANCELLED', 'REVERTED'\] as const/)
  assert.match(
    src,
    /estado: \{ in: vista === 'DESHECHAS' \? \[\.\.\.DESHECHOS\] : \[\.\.\.COBRADOS\] \}/,
    'la pestaña de caja dejó de distinguir el dinero cobrado del deshecho'
  )
})

test('la pasarela NO se filtra por sucursal, y la pantalla lo dice', () => {
  // `PagoIntento` no guarda sucursal. Aplicar el filtro a medias dejaría un
  // total que parece recortado sin estarlo.
  const src = leer(DETALLE)
  assert.match(
    src,
    /const recorte = tabla === 'pasarela' \? null : sucursal/,
    'las pestañas de pasarela están recibiendo el filtro de sucursal'
  )
  assert.match(src, /Esta lista no se puede filtrar por sucursal/)
})

test('«cobrado sin entregar» es la alarma: no depende del periodo', () => {
  const src = leer(DETALLE)
  assert.match(src, /vista === 'SIN_ENTREGAR'/)
  assert.match(src, /\{ estado: 'APROBADO', fulfillmentEstado: 'PENDIENTE' \}/)
  assert.match(src, /FUERA_DEL_EJE/, 'no se avisa de que esta lista ignora el periodo')
})

test('toda la pantalla exige ver_financieros', () => {
  // Esconder columnas dejaría una página vacía y una pregunta; negar el acceso
  // con su motivo dice lo que pasa. Igual que el reporte.
  assert.match(
    leer(DETALLE),
    /requireSection\('reportes', 'ver_financieros'\)/,
    'el detalle de dinero dejó de exigir el permiso financiero'
  )
})

test('filas y total comparten el MISMO criterio, y todo lleva la empresa', () => {
  const src = leer(DETALLE)
  // Caja y pasarela comparten literalmente el objeto `where`; membresías
  // comparte la acotación y aplica `whereCobrado` en las dos (arriba).
  assert.match(src, /tx\.transaction\.aggregate\(\{ where, _sum/, 'caja no reusa el where de las filas')
  assert.match(src, /tx\.pagoIntento\.aggregate\(\{ where, _sum/, 'la pasarela no reusa el where')
  const conEmpresa = src.match(/^\s*companyId,$/gm) ?? []
  assert.ok(conEmpresa.length >= 3, 'alguna rama del detalle no acota por empresa')
})

test('el detalle está ENLAZADO desde el reporte, incluida la alarma', () => {
  const vista = leer(VISTA)
  assert.match(vista, /Ver el detalle cobro por cobro/, 'el enlace prominente desapareció')
  for (const v of ['CAJA', 'MEMBRESIAS', 'DESCUENTOS', 'DESHECHAS', 'INTENTOS', 'RECHAZADOS']) {
    assert.match(vista, new RegExp(`detalle\\('${v}'\\)`), `la cifra ${v} no se puede abrir`)
  }
  assert.match(vista, /detalle\('SIN_ENTREGAR'\)/, 'la alarma no lleva a sus filas')
})

test('el detalle hereda el MISMO periodo y el MISMO filtro que el reporte', () => {
  assert.match(leer(PAGINA), /qs=\{qsExport\}/, 'el reporte no le pasa su periodo y filtro al detalle')
  const src = leer(DETALLE)
  assert.match(src, /leerRango\(sp, timeZone\)/, 'el detalle recalcula el periodo por su cuenta')
  assert.match(src, /leerParam\('sucursal'\)/, 'el detalle ignora el filtro de sucursal')
  // Y un id de sucursal ajeno no filtra en silencio: se valida contra la empresa.
  assert.match(src, /where: \{ id: sucursalPedida, companyId \}/)
})

test('los campos del detalle tienen nombre accesible', () => {
  const src = leer(DETALLE)
  assert.match(src, /aria-label="Buscar por cliente"/)
  assert.match(src, /aria-label="Filtrar por sucursal"/)
})
