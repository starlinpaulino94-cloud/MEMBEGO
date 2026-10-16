import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_SERIES_A_ASIGNAR, MAX_SERIES_POR_LINEA, separarSeries, validarLotesDeLinea, validarSeriesDeLinea } from '../src/modules/inventory/lotes'
import { lotesParaEnviar, seriesDeLotes, sumaDeLotes, type LoteForm } from '../src/components/inventario/EditorDeLotes'

/**
 * INV-5c · SERIES — las reglas PURAS y las guardias estáticas (migración, servicio, lecturas, acciones y pantallas). El comportamiento
 * contra PostgreSQL está en `tests/postgres/inventory-series.db.test.ts`.
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function cuerpoDe(src: string, nombre: string): string {
  const inicio = src.search(new RegExp(`^(export )?(async )?function ${nombre}\\b`, 'm'))
  assert.ok(inicio >= 0, `no encuentro la función ${nombre}`)
  const resto = src.slice(inicio + 10)
  const fin = resto.search(/^(export |async function |function |const |interface |type )/m)
  return src.slice(inicio, fin < 0 ? undefined : inicio + 10 + fin)
}

const serie = (codigo: unknown, extra: Record<string, unknown> = {}) => ({ codigo, cantidad: 1, ...extra })
const codigo = (r: ReturnType<typeof validarSeriesDeLinea>) => (r.ok ? 'OK' : r.codigo)

test('INV-5c · separar lo que se teclea: una serie por renglón, también con coma, punto y coma o tabulador, sin renglones vacíos', () => {
  assert.deepEqual(separarSeries('A-1\nA-2\r\nA-3'), ['A-1', 'A-2', 'A-3'])
  assert.deepEqual(separarSeries('A-1, A-2;A-3\tA-4'), ['A-1', 'A-2', 'A-3', 'A-4'])
  assert.deepEqual(separarSeries('\n\n  A-1  \n\n'), ['A-1'], 'recorta y quita lo vacío')
  assert.deepEqual(separarSeries(''), [])
  assert.deepEqual(separarSeries('  \n , ; '), [])
  assert.deepEqual(separarSeries('a b\nc'), ['a b', 'c'], 'un espacio dentro de la serie es de la serie')
  assert.deepEqual(separarSeries('x\nx'), ['x', 'x'], 'no quita repetidas: el error se tiene que ver')
})

test('INV-5c · las series de una línea: normalizadas, de una unidad, sin vencimiento y sin repetir', () => {
  const ok = validarSeriesDeLinea([serie('sn-1'), serie(' Sn  2 ')], 2)
  assert.ok(ok.ok)
  assert.deepEqual(ok.ok && ok.lotes, [
    { codigo: 'SN-1', vencimiento: null, cantidad: 1 },
    { codigo: 'SN 2', vencimiento: null, cantidad: 1 },
  ])
  assert.equal(codigo(validarSeriesDeLinea([serie('a'), serie('A')], 2)), 'SERIE_REPETIDA', 'a y A son la misma serie')
  assert.equal(codigo(validarSeriesDeLinea([serie('a'), serie('b')], 3)), 'LOTES_NO_CUADRAN')
  assert.equal(codigo(validarSeriesDeLinea([serie('a')], 0)), 'LOTES_NO_CUADRAN')
  assert.equal(codigo(validarSeriesDeLinea([], 1)), 'SERIES_FALTAN')
  assert.equal(codigo(validarSeriesDeLinea(undefined, 1)), 'SERIES_FALTAN')
  assert.equal(codigo(validarSeriesDeLinea('A-1', 1)), 'SERIES_FALTAN')
  assert.equal(codigo(validarSeriesDeLinea([serie('SIN LOTE')], 1)), 'SERIE_REQUERIDA', '«SIN LOTE» no es una serie')
  assert.equal(codigo(validarSeriesDeLinea([serie('sin lote')], 1)), 'SERIE_REQUERIDA')
  assert.equal(codigo(validarSeriesDeLinea([serie('a', { vencimiento: '2027-12-01' })], 1)), 'SERIE_CON_VENCIMIENTO')
  assert.equal(codigo(validarSeriesDeLinea([serie('a', { vencimiento: '' }), serie('b', { vencimiento: null })], 2)), 'OK', 'vacío o null no es una fecha')
  assert.equal(codigo(validarSeriesDeLinea([serie('a', { cantidad: 2 })], 2)), 'SERIE_NO_ES_UNA')
  assert.equal(codigo(validarSeriesDeLinea([serie('a', { cantidad: 0 })], 1)), 'SERIE_NO_ES_UNA')
  assert.equal(codigo(validarSeriesDeLinea([{ codigo: 'a' }], 1)), 'OK', 'la cantidad se da por 1 si no viene')
  for (const mala of ['', '   ', 'A,B', 'A"B', null, 12, 'x'.repeat(61)]) assert.equal(codigo(validarSeriesDeLinea([serie(mala)], 1)), 'SERIE_INVALIDA', String(mala))
  assert.equal(codigo(validarSeriesDeLinea([null], 1)), 'SERIE_INVALIDA')
  const muchas = Array.from({ length: MAX_SERIES_POR_LINEA + 1 }, (_, i) => serie(`S-${i}`))
  assert.equal(codigo(validarSeriesDeLinea(muchas, muchas.length)), 'DEMASIADAS_SERIES')
  assert.equal(codigo(validarSeriesDeLinea(muchas.slice(0, MAX_SERIES_POR_LINEA), MAX_SERIES_POR_LINEA)), 'OK', 'el tope exacto cabe')
  const e = validarSeriesDeLinea([serie('a,b')], 1)
  assert.ok(!e.ok && !/lote/i.test(e.error), 'el mensaje habla de series, no de lotes')
})

test('INV-5c · el validador de lotes delega en el de series SOLO cuando el producto las lleva', () => {
  const lotes = [{ codigo: 'L-1', vencimiento: '2027-12-01', cantidad: 3 }]
  assert.equal(validarLotesDeLinea(lotes, 3, { exigirVencimiento: false }).ok, true, 'sin series, un lote de 3 unidades con fecha vale')
  assert.equal(validarLotesDeLinea(lotes, 3, { exigirVencimiento: false, series: false }).ok, true)
  const r = validarLotesDeLinea(lotes, 3, { exigirVencimiento: false, series: true })
  assert.ok(!r.ok && r.codigo === 'SERIE_CON_VENCIMIENTO', 'con series, el mismo lote no vale')
  const sinLotes = validarLotesDeLinea([], 1, { exigirVencimiento: false, series: true })
  assert.ok(!sinLotes.ok && sinLotes.codigo === 'SERIES_FALTAN')
  const sinSeries = validarLotesDeLinea([], 1, { exigirVencimiento: false })
  assert.ok(!sinSeries.ok && sinSeries.codigo === 'LOTES_FALTAN')
  assert.equal(MAX_SERIES_A_ASIGNAR, 200)
  assert.ok(MAX_SERIES_A_ASIGNAR <= MAX_SERIES_POR_LINEA)
})

test('INV-5c · el editor de la línea: el texto de las series es la cantidad de la línea y lo que se envía', () => {
  const forma = (codigo: string): LoteForm[] => [{ codigo, vence: '', cantidad: '1' }]
  assert.deepEqual(seriesDeLotes(forma('A-1\nA-2\n\nA-3')), ['A-1', 'A-2', 'A-3'])
  assert.equal(sumaDeLotes(forma('A-1\nA-2\nA-3'), true), 3)
  assert.equal(sumaDeLotes(forma(''), true), 0)
  assert.equal(sumaDeLotes([{ codigo: 'L', vence: '', cantidad: '7' }]), 7, 'sin series, la cantidad del renglón')
  assert.deepEqual(lotesParaEnviar(forma('A-1, A-2'), true), [
    { codigo: 'A-1', vencimiento: null, cantidad: 1 },
    { codigo: 'A-2', vencimiento: null, cantidad: 1 },
  ])
  assert.deepEqual(lotesParaEnviar([{ codigo: 'L', vence: '2027-12-01', cantidad: '7' }]), [{ codigo: 'L', vencimiento: '2027-12-01', cantidad: 7 }], 'sin series, como siempre')
  // Lo que arma el editor siempre pasa por el validador del servidor.
  const enviado = lotesParaEnviar(forma('A-1\na-1'), true)
  assert.equal(codigo(validarSeriesDeLinea(enviado, sumaDeLotes(forma('A-1\na-1'), true))), 'SERIE_REPETIDA')
})

// ── Guardias estáticas ───────────────────────────────────────────────────────

test('INV-5c · la migración: aditiva, con la regla de «una serie, una unidad» y la bandera inmutable', () => {
  const m = leer('prisma/migrations/20261071_inventory_serials/migration.sql')
  assert.match(m, /ADD COLUMN IF NOT EXISTS "tracksSerials" BOOLEAN NOT NULL DEFAULT false/)
  assert.doesNotMatch(m.replace(/--.*$/gm, ''), /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER COLUMN[^;]*(SET NOT NULL|TYPE)/i, 'solo suma')
  assert.match(m, /inventory_lot_tracking_serie_sin_vencimiento/)
  assert.match(m, /CHECK \(NOT \("tracksSerials" AND "requiresExpiry"\)\)/)
  assert.match(m, /pg_advisory_xact_lock/, 'dos entradas de la misma serie se turnan')
  assert.match(m, /sum\("onHand" \+ "damaged"\)/, 'cuenta vendible y dañado, en TODAS las sucursales')
  assert.match(m, /IF v_total > 1 THEN/)
  assert.match(m, /CREATE CONSTRAINT TRIGGER "inventory_lot_balances_serie_unica"[\s\S]*DEFERRABLE INITIALLY DEFERRED/)
  assert.match(m, /CREATE CONSTRAINT TRIGGER "inventory_lots_serie_unica"/)
  assert.match(m, /IF NOT FOUND OR NOT v_serie OR v_legado THEN\s+RETURN;/, 'los lotes y el legado no se comprueban')
  assert.match(m, /tracksSerials/)
  const prisma = leer('prisma/schema/inventario.prisma')
  assert.match(prisma, /tracksSerials\s+Boolean\s+@default\(false\)/)
})

test('INV-5c · el servicio: activar con series, asignar bajo candado y las series fuera de mover/corregir', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  const act = cuerpoDe(svc, 'activarLotesEnTx')
  assert.match(act, /e\.series === true && e\.exigirVencimiento === true\) fallo\('SERIES_SIN_VENCIMIENTO'/)
  assert.match(act, /tracksSerials: e\.series === true/)
  const asignar = cuerpoDe(svc, 'asignarSeriesEnTx')
  assert.match(asignar, /validarSeriesDeLinea\(filas, filas\.length\)/)
  assert.match(asignar, /MAX_SERIES_A_ASIGNAR/)
  assert.match(asignar, /if \(!politica\?\.series\) fallo\('SERIES_NO_APLICAN'/)
  assert.match(asignar, /await bloquear\(tx, companyId, \[nivelId\]\)/, 'bloquea el saldo antes de leerlo')
  assert.ok(asignar.indexOf('bloquear(tx') < asignar.indexOf('cargarLotesDeNivel('), 'lee los lotes con el saldo ya bloqueado')
  assert.match(asignar, /disponibleDeLote\(legado\)/, 'solo lo disponible del legado')
  assert.match(asignar, /MOTIVO_REASIGNACION_DE_LOTE/, 'es una reasignación, no una merma')
  assert.equal([...asignar.matchAll(/escribirMovimiento\(/g)].length, 2, 'un par de ajustes')
  assert.match(asignar, /:out`/)
  assert.match(asignar, /:in`/)
  assert.match(asignar, /CLAVE_REUTILIZADA/)
  assert.match(cuerpoDe(svc, 'moverEntreLotesEnTx'), /politicaMover\.series\) fallo\('SERIES_NO_SE_MUEVEN'/)
  assert.match(cuerpoDe(svc, 'corregirVencimientoLoteEnTx'), /politica\.series\) fallo\('SERIE_NO_VENCE'/)
  const lotes = cuerpoDe(svc, 'asegurarLotes')
  assert.match(lotes, /politica\.series/)
  assert.match(lotes, /fallo\('SERIE_YA_EXISTE'/)
  assert.match(lotes, /OR: \[\{ onHand: \{ gt: 0 \} \}, \{ damaged: \{ gt: 0 \} \}\]/, 'vendible o dañada')
  const rep = cuerpoDe(svc, 'escribirRepartos')
  assert.match(rep, /politica\?\.series/)
  assert.match(rep, /FOR UPDATE/, 'bloquea las filas de las series que toca')
  assert.match(rep, /\.sort\(\)/, 'en orden, para no interbloquearse')
  // Las tres puertas de entrada validan con la política del producto.
  assert.equal([...svc.matchAll(/series: politica(Mover)?\??\.series/g)].length >= 2, true)
  assert.match(svc, /validarLotesDeLinea\(l\.lotes, l\.cantidad, \{ exigirVencimiento: politica\.exigirVencimiento, series: politica\.series \}\)/, 'la entrada múltiple')
  assert.match(svc, /validarLotesDeLinea\(peticion\.lotes, cantidad, \{ exigirVencimiento: politica\.exigirVencimiento, series: politica\.series \}\)/, 'las entradas sueltas')
  const compras = sinComent(leer('src/modules/inventory/compras-service.ts'))
  assert.match(compras, /tracksSerials: true \}\s*\}\)\)\?\.tracksSerials === true/)
  assert.match(compras, /validarLotesDeLinea\(l\.lotes, l\.cantidad, \{ exigirVencimiento: false, series \}\)/, 'la recepción de una orden valida con series')
})

test('INV-5c · las acciones piden «ajustar» antes de tocar la base y no abren más puertas', () => {
  const a = sinComent(leer('src/modules/inventory/actions.ts'))
  for (const nombre of ['asignarSeriesInventario', 'activarLotesInventario']) {
    const f = cuerpoDe(a, nombre)
    assert.match(f, /await contexto\('ajustar'\)/, nombre)
    assert.ok(f.indexOf("contexto('ajustar')") < f.indexOf('conEmpresa('), `${nombre} autoriza antes de tocar la base`)
  }
  assert.match(cuerpoDe(a, 'activarLotesInventario'), /series: entrada\.series === true/)
  assert.match(cuerpoDe(a, 'asignarSeriesInventario'), /asignarSeriesEnTx\(tx, c\.companyId/)
  assert.match(cuerpoDe(a, 'asignarSeriesInventario'), /idempotencyKey: clave\(entrada\.clave\)/)
  assert.doesNotMatch(a, /buscarSeriesEnTx/, 'la búsqueda es una lectura de la pantalla, no una acción')
})

test('INV-5c · la búsqueda de una serie solo LEE, acota por empresa y solo mira productos con series', () => {
  const q = sinComent(leer('src/modules/inventory/series-queries.ts'))
  assert.doesNotMatch(q, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|DELETE\s+FROM/i, 'una lectura no escribe')
  const lecturas = [...q.matchAll(/tx\.(\w+)\.(findFirst|findMany|count)\(\{\s*where: \{(?=([\s\S]{0,160}))/g)]
  assert.equal(lecturas.length, 2, 'las series y sus pasos; si cambia, revisa esta prueba')
  for (const [llamada, , , donde] of lecturas) assert.match(donde, /companyId/, `una consulta no filtra por empresa → ${llamada.slice(0, 80)}…`)
  assert.match(q, /legacy: false/, 'el «SIN LOTE» no es una serie')
  assert.match(q, /lotTracking: \{ some: \{ companyId, tracksSerials: true \} \}/, 'un lote de un producto con lotes no sale')
  assert.match(q, /MAX_SERIES_ENCONTRADAS \+ 1/, 'pide una de más para saber si hay más')
  const pagina = sinComent(leer('src/app/(admin)/admin/inventario/reportes/series/page.tsx'))
  assert.match(pagina, /requireRole\(ADMIN_ROLES\)/)
  assert.match(pagina, /requireCompanyContext\(user\)/)
  assert.match(pagina, /conEmpresa\(companyId/)
  assert.match(pagina, /buscarSeriesEnTx\(tx, companyId, q\)/)
  assert.doesNotMatch(pagina, /costo|cost/i, 'la historia de una serie no muestra dinero')
  const hub = sinComent(leer('src/app/(admin)/admin/inventario/reportes/page.tsx'))
  assert.match(hub, /href: '\/admin\/inventario\/reportes\/series'/)
})

test('INV-5c · las pantallas: elegir series al activar, series en vez de lotes, y sin mover ni vencimiento', () => {
  const activar = sinComent(leer('src/components/inventario/ActivarLotesCard.tsx'))
  assert.match(activar, /activarLotesInventario\(\{ varianteId, exigirVencimiento: !series && exigir, series \}\)/, 'con series no se manda el vencimiento')
  assert.match(activar, /type="radio"[\s\S]*type="radio"/, 'se elige lotes o series')
  const tarjeta = sinComent(leer('src/components/inventario/SucursalInventarioCard.tsx'))
  assert.match(tarjeta, /const conSeries = lotes\?\.series === true/)
  assert.match(tarjeta, /lotes && !conSeries && lotes\.deSucursal\.some\(/, 'mover unidades entre lotes no se ofrece con series')
  assert.match(tarjeta, /\{!conSeries && \(\s*<div className="space-y-1\.5">\s*<Label htmlFor=\{`vence-/, 'una serie no pide vencimiento')
  assert.match(tarjeta, /\} else if \(conSeries && \(esSinLote \|\| numero !== 1\)\) \{/, 'una serie suelta es de una unidad y no es «SIN LOTE»')
  assert.match(tarjeta, /<AsignarSeries /)
  assert.match(tarjeta, /\{conSeries && \(lotes\?\.deSucursal\.find\(\(l\) => l\.legado\)\?\.disponible \?\? 0\) > 0 && \(/, 'solo si hay algo «SIN SERIE» disponible')
  assert.match(tarjeta, /\.find\(\(l\) => l\.legado\)\?\.disponible/, 'asignar solo se ofrece si hay algo «SIN SERIE» disponible')
  const tabla = sinComent(leer('src/components/inventario/LotesDeSucursal.tsx'))
  assert.match(tabla, /const corregir = series \? undefined : corregirPedido/, 'una serie no se corrige')
  assert.match(tabla, /series && l\.legado \? 'SIN SERIE' : l\.codigo/)
  const asignar = sinComent(leer('src/components/inventario/AsignarSeries.tsx'))
  assert.match(asignar, /asignarSeriesInventario\(\{ varianteId, sucursalId, series, clave: clave\.current \}\)/)
  assert.match(asignar, /clave\.current = nuevaClave\(\)/, 'una clave nueva tras cada éxito')
  for (const f of ['EntradaMultipleForm', 'RecibirOrdenCompraForm']) {
    const src = sinComent(leer(`src/components/inventario/${f}.tsx`))
    assert.match(src, /series=\{l\.llevaSeries\}/, `${f} pasa series al editor`)
    assert.match(src, /series: [^}]*llevaSeries\b/, `${f} valida con series`)
  }
  const ficha = sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(ficha, /series: lotes\.series/)
  const traslado = sinComent(leer('src/components/inventario/EntradaMultipleForm.tsx'))
  assert.match(traslado, /k !== i \? l : l\.llevaSeries \? l :/, 'escanear no suma unidades a una línea de series')
})
