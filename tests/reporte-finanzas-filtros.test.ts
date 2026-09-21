import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * FINANZAS · FILTRO POR SUCURSAL (reportes · Fase 5).
 *
 * Aquí el peligro del filtro a medias es dinero: una cifra sin recortar dentro
 * de un reporte que dice «solo la sucursal del Este» se cuadra contra la caja
 * de esa sucursal y no cuadra, y la confianza en el reporte no vuelve. Estas
 * guardias fijan el pacto: lo que tiene sucursal se recorta TODO, lo que no la
 * tiene (pasarela, recurrente) NO se enseña disfrazado, y la alarma de cobrado
 * sin entregar no se apaga por filtrar.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const MOTOR = 'src/modules/reportes/finanzas.ts'
const VISTA = 'src/components/reportes/ReporteFinanzasVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/finanzas/page.tsx'
const EXPORTA = 'src/app/(admin)/admin/reportes/finanzas/export/route.ts'

test('TODO lo que tiene sucursal se recorta: caja, membresías, deshechas y descuentos', () => {
  const src = leer(MOTOR)
  // La caja entra entera por `whereCobros`, que lleva el filtro dentro: una
  // consulta nueva que lo use ya nace filtrada.
  assert.match(src, /function whereCobros\(\n  companyId: string,\n  desde: Date,\n  hasta: Date,\n  filtro: FiltroFinanzasAplicado \| null/)
  assert.match(src, /\.\.\.\(filtro \? \{ sucursalId: filtro\.sucursal\.id \} : \{\}\)/, 'whereCobros no recorta')
  // Las membresías y sus descuentos van por la sucursal DONDE SE PAGÓ, y por
  // el mismo camino los dos: si uno se recorta y el otro no, la nota «ya
  // restados de lo cobrado» miente bajo filtro.
  const conSucursalPago = src.match(/sucursalPagoId: filtro\.sucursal\.id/g) ?? []
  assert.equal(conSucursalPago.length, 2, 'membresías y descuentos deben recortarse por sucursalPagoId (2 sitios)')
  // Las deshechas también son Transaction: sin recorte, un mostrador que anula
  // mucho se escondería detrás del filtro de otro.
  const deshechas = src.slice(src.indexOf('async function deshechas'), src.indexOf('async function sumarDescuentos'))
  assert.match(deshechas, /filtro \? \{ sucursalId: filtro\.sucursal\.id \}/, 'las deshechas no se recortan')
})

test('la pasarela y el recurrente NI SE CONSULTAN con filtro, y no salen disfrazados', () => {
  const src = leer(MOTOR)
  assert.match(
    src,
    /filtro\s*\n?\s*\? Promise\.resolve\(\[\]\)\s*\n?\s*: seguro\(intentosPorEstado/,
    'los intentos de pasarela se consultan aun con filtro'
  )
  assert.match(
    src,
    /filtro\s*\n?\s*\? Promise\.resolve\(\{ monto: 0, membresias: 0 \}\)/,
    'el recurrente estimado se consulta aun con filtro'
  )
  const vista = leer(VISTA)
  assert.match(vista, /no pertenece a ningún mostrador/, 'la vista no explica por qué falta la pasarela')
  assert.match(vista, /La estimación es de la empresa entera/, 'la vista no explica por qué falta el recurrente')
  const csv = leer(EXPORTA)
  assert.match(csv, /OMITIDO - un pago en linea no pertenece a ninguna sucursal/)
  assert.match(csv, /OMITIDO - la estimacion es de la empresa entera/)
})

test('la ALARMA de cobrado sin entregar no se apaga por filtrar', () => {
  // Es el único descuadre que el cliente descubre antes que el negocio: quien
  // vive con el reporte filtrado de SU sucursal tiene que seguir viéndola.
  const src = leer(MOTOR)
  assert.match(
    src,
    /seguro\(cobradoSinEntregar\(tx, companyId\), ceroTotal, fallos\)/,
    'cobradoSinEntregar ya no se consulta siempre entero'
  )
  assert.doesNotMatch(
    src.slice(src.indexOf('async function cobradoSinEntregar'), src.indexOf('async function deshechas')),
    /filtro/,
    'cobradoSinEntregar no debe llevar filtro: es una alarma de toda la empresa'
  )
  assert.match(leer(VISTA), /es de toda la empresa/, 'la vista filtrada no rotula la alarma como de toda la empresa')
})

test('un id que no resuelve DENTRO de la empresa no filtra', () => {
  const src = leer(MOTOR)
  const cuerpo = src.slice(src.indexOf('async function resolverFiltro'), src.indexOf('async function seguro'))
  assert.match(cuerpo, /id: pedido\.sucursalId, companyId/, 'la sucursal no se valida contra la empresa')
  assert.match(cuerpo, /return sucursal \? \{ sucursal \} : null/, 'un id inválido debe descartarse, no aplicarse')
})

test('la exportación se lleva el MISMO filtro que la pantalla, y lo declara', () => {
  const csv = leer(EXPORTA)
  assert.match(csv, /sucursalId: sp\.sucursal/, 'el export ignora ?sucursal=')
  assert.match(csv, /Filtro por sucursal/, 'el bloque de alcance no declara el filtro')
})

test('la pantalla declara el recorte y los enlaces arrastran el filtro APLICADO', () => {
  assert.match(leer(VISTA), /Filtrado:/, 'la vista no declara el filtro (también al imprimir)')
  const page = leer(PAGINA)
  assert.match(page, /if \(r\.filtro\) extra\.set\('sucursal', r\.filtro\.sucursal\.id\)/, 'los enlaces no salen del filtro aplicado')
})
