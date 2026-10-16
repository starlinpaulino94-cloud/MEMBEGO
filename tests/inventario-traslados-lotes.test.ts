import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  pendienteDeLote,
  planDeRecepcion,
  repartoDeCancelacion,
  repartoDeRecepcion,
  repartoDeTextos,
  sinLotes,
  validarLineasTraslado,
  validarRepartoDeLinea,
  type LineaDeTraslado,
  type LoteDeTraslado,
} from '../src/modules/inventory/traslados'
import { MAX_LOTES_POR_LINEA } from '../src/modules/inventory/lotes'
import { lotesTransferiblesDe, type LoteVista } from '../src/modules/inventory/lotes-queries'
import { trasladoToCsv, type TrasladoParaCsv } from '../src/modules/inventory/exportacion'

/**
 * INV-5b4 · LOTES EN TRANSFERENCIAS — las reglas PURAS (validar los lotes de una línea, repartir lo que llega entre los lotes de lo
 * enviado, devolver lo que sigue en camino, lo tecleado en los formularios), el CSV con lotes y las guardias estáticas (servicio,
 * lecturas, acciones y pantallas; y que NO hay migración nueva). El comportamiento contra PostgreSQL está en
 * `tests/postgres/inventory-traslados-lotes.db.test.ts`.
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

const lote = (loteId: string, enviado: number, recibido = 0, devuelto = 0, vencimiento: string | null = null): LoteDeTraslado => ({
  loteId,
  codigo: loteId.toUpperCase(),
  vencimiento,
  legado: false,
  enviado,
  recibido,
  devuelto,
})

// ── «No dijo lotes» ──────────────────────────────────────────────────────────

test('INV-5b4 · «no dijo lotes» es ausente, null o lista vacía; cualquier otra cosa es que sí dijo (aunque esté mal)', () => {
  for (const v of [undefined, null, []]) assert.equal(sinLotes(v), true)
  for (const v of [[{ loteId: 'a', cantidad: 1 }], '', 0, {}, 'a']) assert.equal(sinLotes(v), false)
})

// ── Validar los lotes de una línea ───────────────────────────────────────────

test('INV-5b4 · los lotes de una línea: bien armados, enteros positivos, de a lo más 20 y suman la cantidad; un lote repetido se junta', () => {
  assert.deepEqual(validarRepartoDeLinea([{ loteId: 'a', cantidad: 3 }, { loteId: 'b', cantidad: 2 }], 5), { ok: true, reparto: [{ loteId: 'a', cantidad: 3 }, { loteId: 'b', cantidad: 2 }] })
  assert.deepEqual(validarRepartoDeLinea([{ loteId: 'a', cantidad: 3 }, { loteId: 'a', cantidad: 2 }], 5), { ok: true, reparto: [{ loteId: 'a', cantidad: 5 }] }, 'el repetido se junta')
  assert.deepEqual(validarRepartoDeLinea([{ loteId: ' a ', cantidad: 1 }], 1), { ok: true, reparto: [{ loteId: 'a', cantidad: 1 }] }, 'el id se recorta')
  const codigo = (r: ReturnType<typeof validarRepartoDeLinea>) => (r.ok ? 'OK' : r.codigo)
  assert.equal(codigo(validarRepartoDeLinea([{ loteId: 'a', cantidad: 3 }], 5)), 'LOTES_NO_CUADRAN', 'no suman')
  assert.equal(codigo(validarRepartoDeLinea([{ loteId: 'a', cantidad: 9 }], 5)), 'LOTES_NO_CUADRAN', 'suman de más')
  assert.equal(codigo(validarRepartoDeLinea('a', 5)), 'LOTE_INVALIDO', 'no es una lista')
  assert.equal(codigo(validarRepartoDeLinea({ loteId: 'a', cantidad: 5 }, 5)), 'LOTE_INVALIDO', 'un objeto suelto no es una lista')
  assert.equal(codigo(validarRepartoDeLinea([null], 5)), 'LOTE_INVALIDO')
  assert.equal(codigo(validarRepartoDeLinea([{ cantidad: 5 }], 5)), 'LOTE_INVALIDO', 'sin id')
  assert.equal(codigo(validarRepartoDeLinea([{ loteId: '', cantidad: 5 }], 5)), 'LOTE_INVALIDO', 'id vacío')
  assert.equal(codigo(validarRepartoDeLinea([{ loteId: 7, cantidad: 5 }], 5)), 'LOTE_INVALIDO', 'id que no es texto')
  assert.equal(codigo(validarRepartoDeLinea([{ loteId: 'x'.repeat(121), cantidad: 5 }], 5)), 'LOTE_INVALIDO', 'id desmesurado')
  for (const mala of [0, -1, 1.5, '2x', NaN, null, undefined, 10_000_000]) {
    assert.equal(codigo(validarRepartoDeLinea([{ loteId: 'a', cantidad: mala }], 5)), 'CANTIDAD_INVALIDA', `cantidad ${String(mala)}`)
  }
  const muchos = Array.from({ length: MAX_LOTES_POR_LINEA + 1 }, (_, i) => ({ loteId: `l${i}`, cantidad: 1 }))
  assert.equal(codigo(validarRepartoDeLinea(muchos, muchos.length)), 'DEMASIADOS_LOTES')
  assert.equal(codigo(validarRepartoDeLinea(muchos.slice(0, MAX_LOTES_POR_LINEA), MAX_LOTES_POR_LINEA)), 'OK', 'justo el tope sí')
})

test('INV-5b4 · las líneas de un envío conservan sus lotes ya validados; una línea sin lotes queda exactamente como siempre', () => {
  const r = validarLineasTraslado([
    { varianteId: 'v1', cantidad: 5, lotes: [{ loteId: 'a', cantidad: 3 }, { loteId: 'a', cantidad: 2 }] },
    { varianteId: 'v2', cantidad: 4 },
    { varianteId: 'v3', cantidad: 2, lotes: [] },
    { varianteId: 'v4', cantidad: 1, lotes: null },
  ])
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.lineas[0], { varianteId: 'v1', cantidad: 5, lotes: [{ loteId: 'a', cantidad: 5 }] })
  for (const i of [1, 2, 3]) assert.ok(!('lotes' in r.lineas[i]), `la línea ${i} no inventa un campo lotes`)
  assert.equal(r.unidades, 12)
  const mala = validarLineasTraslado([{ varianteId: 'v1', cantidad: 5, lotes: [{ loteId: 'a', cantidad: 4 }] }])
  assert.ok(!mala.ok && mala.codigo === 'LOTES_NO_CUADRAN')
  const rota = validarLineasTraslado([{ varianteId: 'v1', cantidad: 5, lotes: 'a' }])
  assert.ok(!rota.ok && rota.codigo === 'LOTE_INVALIDO')
})

// ── Lo que sigue en camino de cada lote ──────────────────────────────────────

test('INV-5b4 · de un lote sigue en camino lo enviado menos lo que llegó y lo que volvió al origen', () => {
  assert.equal(pendienteDeLote(lote('a', 10)), 10)
  assert.equal(pendienteDeLote(lote('a', 10, 4)), 6)
  assert.equal(pendienteDeLote(lote('a', 10, 4, 6)), 0)
  assert.equal(pendienteDeLote(lote('a', 10, 10)), 0)
})

// ── Repartir lo que se recibe entre los lotes de lo enviado ──────────────────

test('INV-5b4 · recibir diciendo los lotes: tienen que ser lotes de ESA línea, sumar lo que llegó y no pasar de lo que de cada uno sigue en camino', () => {
  const lotes = [lote('a', 6), lote('b', 4)]
  assert.deepEqual(repartoDeRecepcion(lotes, 7, [{ loteId: 'a', cantidad: 5 }, { loteId: 'b', cantidad: 2 }]), { ok: true, reparto: [{ loteId: 'a', cantidad: 5 }, { loteId: 'b', cantidad: 2 }] })
  const codigo = (r: ReturnType<typeof repartoDeRecepcion>) => (r.ok ? 'OK' : r.codigo)
  assert.equal(codigo(repartoDeRecepcion(lotes, 7, [{ loteId: 'a', cantidad: 7 }])), 'RECIBE_MAS_DE_LO_ENVIADO', 'más de lo que de ese lote sigue en camino, aunque la línea sí alcance')
  assert.equal(codigo(repartoDeRecepcion(lotes, 5, [{ loteId: 'z', cantidad: 5 }])), 'LOTE_AJENO', 'un lote que no se envió en esta línea')
  assert.equal(codigo(repartoDeRecepcion(lotes, 5, [{ loteId: 'a', cantidad: 3 }])), 'LOTES_NO_CUADRAN', 'no suman')
  assert.equal(codigo(repartoDeRecepcion(lotes, 5, 'a')), 'LOTE_INVALIDO')
  // Un lote que ya llegó completo no admite más; el mensaje lo dice.
  const llegado = repartoDeRecepcion([lote('a', 6, 6), lote('b', 4)], 2, [{ loteId: 'a', cantidad: 2 }])
  assert.ok(!llegado.ok && llegado.codigo === 'RECIBE_MAS_DE_LO_ENVIADO' && /ya llegó completo/.test(llegado.error), 'ya llegó completo')
  // Lo devuelto al origen tampoco puede volver a recibirse.
  const devuelto = repartoDeRecepcion([lote('a', 6, 0, 6)], 1, [{ loteId: 'a', cantidad: 1 }])
  assert.ok(!devuelto.ok && devuelto.codigo === 'RECIBE_MAS_DE_LO_ENVIADO')
})

test('INV-5b4 · recibir SIN decir los lotes: si llega todo lo que falta, llega todo lo que falta de cada lote; si no, solo se sabe de qué lote es cuando queda uno', () => {
  const dos = [lote('a', 6), lote('b', 4)]
  assert.deepEqual(repartoDeRecepcion(dos, 10, undefined), { ok: true, reparto: [{ loteId: 'a', cantidad: 6 }, { loteId: 'b', cantidad: 4 }] }, 'todo lo pendiente')
  assert.deepEqual(repartoDeRecepcion(dos, 10, []), { ok: true, reparto: [{ loteId: 'a', cantidad: 6 }, { loteId: 'b', cantidad: 4 }] }, 'lista vacía = no dijo')
  const parcial = repartoDeRecepcion(dos, 3, undefined)
  assert.ok(!parcial.ok && parcial.codigo === 'LOTES_FALTAN', 'con dos lotes vivos y una parte, hay que decir de cuál (no se inventa)')
  // Un solo lote vivo: no hay duda, aunque la línea haya tenido más.
  assert.deepEqual(repartoDeRecepcion([lote('a', 6, 6), lote('b', 4)], 3, undefined), { ok: true, reparto: [{ loteId: 'b', cantidad: 3 }] }, 'el otro lote ya llegó entero')
  assert.deepEqual(repartoDeRecepcion([lote('a', 6)], 2, undefined), { ok: true, reparto: [{ loteId: 'a', cantidad: 2 }] }, 'un solo lote')
  // Y los que ya no tienen nada en camino no aparecen en «todo».
  assert.deepEqual(repartoDeRecepcion([lote('a', 6, 6), lote('b', 4, 1)], 3, undefined), { ok: true, reparto: [{ loteId: 'b', cantidad: 3 }] })
  assert.deepEqual(repartoDeRecepcion([lote('a', 6, 2), lote('b', 4, 0, 4), lote('c', 3)], 7, undefined), { ok: true, reparto: [{ loteId: 'a', cantidad: 4 }, { loteId: 'c', cantidad: 3 }] }, 'lo devuelto no cuenta')
})

test('INV-5b4 · cancelar devuelve al origen, de cada lote, todo lo que sigue en camino (y nada de lo que ya llegó o ya volvió)', () => {
  assert.deepEqual(repartoDeCancelacion([lote('a', 6, 2), lote('b', 4, 4), lote('c', 5, 0, 5), lote('d', 3)]), [
    { loteId: 'a', cantidad: 4 },
    { loteId: 'd', cantidad: 3 },
  ])
  assert.deepEqual(repartoDeCancelacion([]), [])
  assert.deepEqual(repartoDeCancelacion([lote('a', 6, 6)]), [])
})

// ── El plan de recepción conserva los lotes ──────────────────────────────────

const lineaT = (varianteId: string, enviado: number, recibido = 0): LineaDeTraslado => ({ varianteId, enviado, recibido, devuelto: 0, perdido: 0 })

test('INV-5b4 · el plan de una recepción conserva los lotes que dijo quien recibe, y una línea sin lotes no gana el campo', () => {
  const lotes = [{ loteId: 'a', cantidad: 3 }]
  const p = planDeRecepcion([lineaT('v1', 5), lineaT('v2', 4)], [{ varianteId: 'v1', cantidad: 3, lotes }, { varianteId: 'v2', cantidad: 2 }], false, null)
  assert.ok(p.ok)
  if (!p.ok) return
  assert.deepEqual(p.recibir[0], { varianteId: 'v1', cantidad: 3, lotes })
  assert.ok(!('lotes' in p.recibir[1]))
  const todo = planDeRecepcion([lineaT('v1', 5)], 'TODO', false, null)
  assert.ok(todo.ok && !('lotes' in todo.recibir[0]), '«todo» no trae lotes: salen del ledger')
})

// ── Lo tecleado en los formularios ───────────────────────────────────────────

test('INV-5b4 · lo tecleado por lote: vacío y 0 no cuentan; un decimal, un negativo o letras son error; se suma', () => {
  assert.deepEqual(repartoDeTextos({}), { reparto: [], suma: 0, hayError: false })
  assert.deepEqual(repartoDeTextos({ a: '', b: '0', c: '  ' }), { reparto: [], suma: 0, hayError: false })
  assert.deepEqual(repartoDeTextos({ a: '3', b: ' 2 ', c: '' }), { reparto: [{ loteId: 'a', cantidad: 3 }, { loteId: 'b', cantidad: 2 }], suma: 5, hayError: false })
  for (const mala of ['1.5', '-1', 'x', '1,5', '12345678', '٣']) {
    const r = repartoDeTextos({ a: '2', b: mala })
    assert.equal(r.hayError, true, `«${mala}» es un error`)
    assert.equal(r.suma, 2, 'lo bueno se suma igual')
  }
})

// ── Los lotes que se ofrecen al transferir ───────────────────────────────────

const vista = (loteId: string, disponible: number): LoteVista => ({
  loteId,
  codigo: loteId.toUpperCase(),
  vencimiento: null,
  legado: false,
  estado: 'SIN_VENCIMIENTO',
  textoVencimiento: 'No vence',
  onHand: disponible,
  reserved: 0,
  damaged: 0,
  disponible,
})

test('INV-5b4 · los lotes que se ofrecen al transferir son los de ESA sucursal con unidades disponibles, en el orden en que llegan (FEFO)', () => {
  const porSucursal = { s1: [vista('a', 3), vista('b', 0), vista('c', 5)], s2: [vista('d', 9)] }
  assert.deepEqual(lotesTransferiblesDe(porSucursal, 's1').map((l) => l.loteId), ['a', 'c'], 'sin los que no tienen disponible y en el mismo orden')
  assert.deepEqual(lotesTransferiblesDe(porSucursal, 's2').map((l) => l.loteId), ['d'], 'solo los de esa sucursal')
  assert.deepEqual(lotesTransferiblesDe(porSucursal, 'otra'), [], 'una sucursal sin lotes')
  assert.deepEqual(lotesTransferiblesDe({}, 's1'), [])
})

// ── El CSV ───────────────────────────────────────────────────────────────────

const traslado = (sobre: Partial<TrasladoParaCsv> = {}): TrasladoParaCsv => ({
  numero: 'TRF-2030-000009',
  estado: 'PARTIAL',
  origenNombre: 'Principal',
  destinoNombre: 'Norte',
  nota: null,
  creadoEn: new Date('2030-01-02T15:04:05.000Z'),
  cerradoEn: null,
  enviadoPorNombre: 'Ana Pérez',
  cerradoPorNombre: null,
  motivoCierre: null,
  detalle: [{ sku: 'LEC-1', barcode: null, itemNombre: 'Leche', nombreVariante: 'Default', esDefault: true, enviado: 10, recibido: 4, devuelto: 0, perdido: 0 }],
  historial: [{ tipo: 'TRANSFER_OUT', cantidad: 10, sucursalNombre: 'Principal', producto: 'Leche', sku: 'LEC-1', creadoEn: new Date('2030-01-02T15:04:06.000Z'), usuarioNombre: 'Ana Pérez', motivo: null }],
  ...sobre,
})

test('INV-5b4 · el CSV de una transferencia SIN lotes queda idéntico al de siempre (ni bloque «Lotes» ni columna «Lotes»)', () => {
  const csv = trasladoToCsv(traslado(), 'UTC')
  assert.ok(!csv.includes('Lotes'), 'ninguna mención de lotes')
  assert.ok(csv.includes('Fecha y hora;Movimiento;Sucursal;SKU;Producto;Cantidad;Usuario;Motivo\n') || csv.includes('Fecha y hora;Movimiento;Sucursal;SKU;Producto;Cantidad;Usuario;Motivo\r\n'), 'el encabezado de movimientos de siempre')
})

test('INV-5b4 · el CSV de una transferencia CON lotes lleva un bloque «Lotes» (por línea) y la columna «Lotes» de cada movimiento', () => {
  const csv = trasladoToCsv(
    traslado({
      detalle: [
        {
          sku: 'LEC-1',
          barcode: null,
          itemNombre: 'Leche',
          nombreVariante: 'Default',
          esDefault: true,
          enviado: 10,
          recibido: 4,
          devuelto: 0,
          perdido: 0,
          lotes: [
            { codigo: 'L-01', vencimiento: '2030-03-01', enviado: 6, recibido: 4, devuelto: 0, pendiente: 2 },
            { codigo: 'L-02', vencimiento: null, enviado: 4, recibido: 0, devuelto: 0, pendiente: 4 },
          ],
        },
      ],
      historial: [
        { tipo: 'TRANSFER_OUT', cantidad: 10, sucursalNombre: 'Principal', producto: 'Leche', sku: 'LEC-1', creadoEn: new Date('2030-01-02T15:04:06.000Z'), usuarioNombre: 'Ana Pérez', motivo: null, lotes: 'L-01 ×6, L-02 ×4' },
        { tipo: 'TRANSFER_IN', cantidad: 4, sucursalNombre: 'Norte', producto: 'Leche', sku: 'LEC-1', creadoEn: new Date('2030-01-03T10:00:00.000Z'), usuarioNombre: null, motivo: null, lotes: 'L-01 ×4' },
      ],
    }),
    'UTC'
  )
  for (const esperado of [
    'Lotes\n',
    'SKU;Producto;Lote;Vencimiento;Enviado;Recibido;Devuelto al origen;En camino',
    'LEC-1;Leche;L-01;2030-03-01;6;4;0;2',
    'LEC-1;Leche;L-02;No vence;4;0;0;4',
    'Usuario;Motivo;Lotes',
    'Ana Pérez;;"L-01 ×6, L-02 ×4"',
    'Sistema;;L-01 ×4',
  ]) {
    assert.ok(csv.includes(esperado), `falta «${esperado}»`)
  }
})

test('INV-5b4 · en el CSV de lotes, lo que escribe una persona (el código del lote) no se ejecuta como fórmula', () => {
  const csv = trasladoToCsv(
    traslado({
      detalle: [{ sku: 'LEC-1', barcode: null, itemNombre: 'Leche', nombreVariante: 'Default', esDefault: true, enviado: 1, recibido: 0, devuelto: 0, perdido: 0, lotes: [{ codigo: '=CMD()', vencimiento: null, enviado: 1, recibido: 0, devuelto: 0, pendiente: 1 }] }],
      historial: [{ tipo: 'TRANSFER_OUT', cantidad: 1, sucursalNombre: 'P', producto: 'Leche', sku: 'LEC-1', creadoEn: new Date('2030-01-02T15:04:06.000Z'), usuarioNombre: null, motivo: null, lotes: '=CMD() ×1' }],
    }),
    'UTC'
  )
  assert.ok(!/(^|;)=CMD/m.test(csv), 'ninguna celda empieza con =')
  assert.ok(csv.includes("'=CMD()"), 'el código del lote va neutralizado')
})

// ── Guardias estáticas ───────────────────────────────────────────────────────

test('INV-5b4 · NO hay migración nueva: el estado por lote de una transferencia sale del ledger (lo que no existe no puede descuadrarse)', () => {
  const ultimas = readdirSync('prisma/migrations')
    .filter((n) => /^\d{8}_/.test(n))
    .sort()
    .slice(-1)
  assert.deepEqual(ultimas, ['20261069_inventory_count_lots'], 'INV-5b4 no añade migraciones')
  const q = sinComent(leer('src/modules/inventory/lotes-queries.ts'))
  const cuerpo = cuerpoDe(q, 'lotesDeTrasladoEnTx')
  assert.match(cuerpo, /FROM "inventory_transfers" t/)
  assert.match(cuerpo, /JOIN "inventory_movement_lots" ml ON ml\."movementId" = m\."id"/, 'el reparto sale del ledger')
  assert.match(cuerpo, /m\."referenceType" = 'TRANSFER' AND m\."referenceId" = t\."id"/, 'solo los movimientos de ESA transferencia')
  assert.match(cuerpo, /t\."id" = \$\{trasladoId\} AND t\."companyId" = \$\{companyId\}/, 'de la empresa')
  assert.match(cuerpo, /'TRANSFER_OUT'/)
  assert.match(cuerpo, /lv\."locationId" = t\."toLocationId"/, 'lo recibido es lo que entró al destino')
  assert.match(cuerpo, /lv\."locationId" = t\."fromLocationId"/, 'lo devuelto es lo que volvió al origen')
  assert.doesNotMatch(cuerpo, /INSERT|UPDATE|DELETE/i, 'solo lee')
})

test('INV-5b4 · el servicio: transferir, enviar, recibir y cancelar trabajan por lote (ya no se niegan) y cada uno reparte con su regla', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  for (const f of ['transferirEnTx', 'enviarTrasladoEnTx', 'recibirTrasladoEnTx', 'cancelarTrasladoEnTx']) {
    assert.doesNotMatch(cuerpoDe(svc, f), /exigirSinLotes\(/, `${f}: ya trabaja por lote`)
  }
  const directa = cuerpoDe(svc, 'transferirEnTx')
  assert.match(directa, /resolverReparto\(/, 'la salida directa resuelve FEFO o los lotes elegidos')
  assert.match(directa, /tipo: 'SALIENTE'/)
  assert.match(directa, /mismoRepartoQueElPrevio\(/, 'la misma clave con otros lotes no es un reintento')
  assert.equal((directa.match(/reparto\b/g) ?? []).length >= 4, true)
  assert.match(directa, /idempotencyKey: clave \? `\$\{clave\}:out` : null, reparto/, 'la salida lleva su reparto')
  assert.match(directa, /idempotencyKey: clave \? `\$\{clave\}:in` : null, reparto/, 'la entrada lleva el MISMO reparto')

  const envio = cuerpoDe(svc, 'enviarTrasladoEnTx')
  assert.match(envio, /resolverReparto\(/)
  assert.match(envio, /mismoRepartoQueElPrevio\(tx, companyId, p\.outMovementId/, 'el reintento de un envío compara los lotes')
  assert.match(envio, /reparto: repartos\.get\(x\.l\.varianteId\)/)
  assert.ok(envio.indexOf('resolverReparto(') < envio.indexOf('siguienteNumero('), 'si un lote no alcanza falla ANTES de gastar el número')

  const recibir = cuerpoDe(svc, 'recibirTrasladoEnTx')
  assert.match(recibir, /repartosDeRecepcion\(tx, companyId, traslado\.id, lineas, plan\.recibir\)/)
  assert.match(recibir, /reparto: repartos\.get\(r\.varianteId\)/)
  assert.match(recibir, /mismoRepartoQueElPrevio\(tx, companyId, p\.id/, 'el reintento de una recepción compara los lotes')
  assert.ok(recibir.indexOf('bloquearTraslado(') < recibir.indexOf('repartosDeRecepcion('), 'el tope por lote se hace cumplir con la transferencia bloqueada')

  const rec = cuerpoDe(svc, 'repartosDeRecepcion')
  assert.match(rec, /lotesDeTrasladoEnTx\(/)
  assert.match(rec, /repartoDeRecepcion\(pendientes, r\.cantidad, r\.lotes\)/)
  assert.match(rec, /fallo\('LOTES_NO_APLICAN'/, 'un producto sin lotes no admite lotes')
  assert.match(rec, /fallo\('TRASLADO_DESCUADRADO'/, 'si el ledger y la línea no cuadran, no se reparte a ciegas')

  const cancelar = cuerpoDe(svc, 'cancelarTrasladoEnTx')
  assert.match(cancelar, /repartosDeCancelacionEnTx\(tx, companyId, traslado\.id, devolver\)/)
  assert.match(cancelar, /reparto: repartos\.get\(d\.varianteId\)/)
  const cancelarRep = cuerpoDe(svc, 'repartosDeCancelacionEnTx')
  assert.match(cancelarRep, /repartoDeCancelacion\(pendientes\)/)
  assert.match(cancelarRep, /fallo\('TRASLADO_DESCUADRADO'/)
  // El contador de lotes sigue en sus puertas: aquí no se toca ningún saldo.
  for (const f of ['repartosDeRecepcion', 'repartosDeCancelacionEnTx']) assert.doesNotMatch(cuerpoDe(svc, f), /onHand|inventoryLevel\.update|inventoryLotBalance/, `${f} solo calcula`)
})

test('INV-5b4 · lo que sigue vetado: activar lotes con el producto en una transferencia en camino, y el conteo suelto', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  assert.match(cuerpoDe(svc, 'activarLotesEnTx'), /ACTIVAR_CON_TRANSFERENCIA/)
  assert.match(cuerpoDe(svc, 'contarEnTx'), /exigirSinLotes\(/)
})

test('INV-5b4 · las acciones pasan los lotes sin mirarlos (el servicio los valida) y la lectura de lotes pide la función «transferir»', () => {
  const a = sinComent(leer('src/modules/inventory/actions.ts'))
  assert.match(cuerpoDe(a, 'transferirInventario'), /lotes: entrada\.lotes/)
  assert.match(cuerpoDe(a, 'enviarTransferencia'), /lotes: l\?\.lotes/)
  assert.match(cuerpoDe(a, 'recibirTransferencia'), /lotes: l\?\.lotes/)
  const lectura = cuerpoDe(a, 'lotesParaTransferir')
  assert.match(lectura, /await contexto\('transferir'\)/)
  assert.ok(lectura.indexOf("contexto('transferir')") < lectura.indexOf('conEmpresa('), 'autoriza antes de tocar la base')
  assert.match(lectura, /lotesTransferiblesDe\(r\.porSucursal, entrada\.origenId\)/, 'ofrece solo los lotes del origen con unidades que se puedan mover')
})

test('INV-5b4 · las pantallas: la ficha pasa los lotes al formulario, el envío los pide al elegir el producto y la recepción pide lote por lote', () => {
  const ficha = sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(ficha, /lotesPorSucursal=\{lotes\?\.lleva \? lotes\.porSucursal : undefined\}/)
  assert.doesNotMatch(ficha, /Todavía no se puede transferir/)
  const tf = sinComent(leer('src/components/inventario/TransferirForm.tsx'))
  assert.match(tf, /repartoDeTextos\(eleccion\)/)
  assert.match(tf, /\.\.\.\(manual \? \{ lotes: elegido\.reparto \} : \{\}\)/, 'solo manda lotes si se eligieron; si no, FEFO')
  assert.match(tf, /const numero = manual \? elegido\.suma : Number\(cantidad\.trim\(\)\)/, 'eligiendo lotes, la cantidad ES la suma de lo tecleado')
  const env = sinComent(leer('src/components/inventario/EnviarTransferenciaForm.tsx'))
  assert.match(env, /lotesParaTransferir\(\{ varianteId: l\.varianteId, origenId \}\)/)
  assert.match(env, /if \(origenActual\.current !== origenId\) return/, 'descarta la respuesta de otra sucursal')
  assert.match(env, /llevaLotes\?: boolean/)
  assert.match(env, /\.\.\.\(l\.lleva && l\.elegir \? \{ lotes: repartoDeTextos\(l\.eleccion\)\.reparto \} : \{\}\)/, 'solo manda lotes de la línea si se eligieron (si no, FEFO)')
  assert.match(env, /l\.lleva && l\.elegir \? repartoDeTextos\(l\.eleccion\)\.suma : \(entero\(l\.cantidad\) \?\? 0\)/, 'eligiendo lotes, la cantidad de la línea es la suma')
  const rec = sinComent(leer('src/components/inventario/RecibirTransferenciaForm.tsx'))
  assert.match(rec, /\.\.\.\(p\.lotes \? \{ lotes: p\.lotes \} : \{\}\)/)
  assert.match(rec, /x\.cantidad < 0 \|\| x\.cantidad > x\.tope/, 'el tope es POR LOTE: lo que de cada lote sigue en camino')
  const det = sinComent(leer('src/app/(admin)/admin/inventario/transferencias/[id]/page.tsx'))
  assert.match(det, /\.filter\(\(x\) => x\.pendiente > 0\)/, 'la recepción recibe solo los lotes con algo en camino')
  assert.match(det, /abierto \? 'En camino' : 'Perdido'/, 'al cerrar con faltante, lo que quedó de un lote es lo perdido')
  const q = sinComent(leer('src/modules/inventory/queries.ts'))
  const detalle = cuerpoDe(q, 'trasladoDetalleEnTx')
  assert.match(detalle, /lotesDeTrasladoEnTx\(tx, companyId, r\.id\)/)
  assert.match(detalle, /lotesDeMovimientosEnTx\(tx, companyId, movimientos\.map/)
})
