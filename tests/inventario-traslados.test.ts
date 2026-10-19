import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ETIQUETA_ESTADO_TRASLADO,
  MAX_LINEAS_TRASLADO,
  TRANSICIONES_TRASLADO,
  enTransito,
  esEstadoTraslado,
  estaAbierto,
  exigirPasoDeEstado,
  motivoDeDevolucion,
  motivoDeEnvio,
  motivoDeRecepcion,
  pendienteDeLinea,
  planDeCancelacion,
  planDeRecepcion,
  puedePasarA,
  resumirTraslado,
  validarLineasTraslado,
  type EstadoTraslado,
  type LineaDeTraslado,
} from '../src/modules/inventory/traslados'
import { CANTIDAD_MAXIMA } from '../src/modules/inventory/domain'
import { trasladoToCsv, type TrasladoParaCsv } from '../src/modules/inventory/exportacion'
import { consultaDeFiltrosTraslados, leerFiltrosTraslados } from '../src/modules/inventory/filtros'

/**
 * COMMERCE CORE · inventario — INV-2c: las reglas PURAS de las transferencias con
 * envío. Sin base de datos: el comportamiento contra PostgreSQL está en
 * `tests/postgres/inventory-traslados.db.test.ts`.
 */

const linea = (varianteId: string, enviado: number, recibido = 0, devuelto = 0, perdido = 0): LineaDeTraslado => ({ varianteId, enviado, recibido, devuelto, perdido })

// ── Estados ──────────────────────────────────────────────────────────────────

test('una transferencia avanza sin saltos ni vueltas: en camino → en parte → recibida, o cancelada; lo cerrado no cambia', () => {
  const todos: EstadoTraslado[] = ['SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED']
  const permitidas: Array<[EstadoTraslado, EstadoTraslado]> = [
    ['SENT', 'PARTIAL'],
    ['SENT', 'RECEIVED'],
    ['SENT', 'CANCELLED'],
    ['PARTIAL', 'RECEIVED'],
    ['PARTIAL', 'CANCELLED'],
  ]
  for (const desde of todos) {
    for (const hasta of todos) {
      const esperado = permitidas.some(([a, b]) => a === desde && b === hasta)
      assert.equal(puedePasarA(desde, hasta), esperado, `${desde} → ${hasta}`)
    }
  }
  assert.throws(() => exigirPasoDeEstado('RECEIVED', 'SENT'), /no se puede pasar de RECEIVED a SENT/)
  assert.doesNotThrow(() => exigirPasoDeEstado('SENT', 'PARTIAL'))
  assert.deepEqual(TRANSICIONES_TRASLADO.RECEIVED, [])
  assert.deepEqual(TRANSICIONES_TRASLADO.CANCELLED, [])
  assert.ok(estaAbierto('SENT') && estaAbierto('PARTIAL') && !estaAbierto('RECEIVED') && !estaAbierto('CANCELLED'))
  assert.ok(todos.every(esEstadoTraslado) && !esEstadoTraslado('LOST') && !esEstadoTraslado(undefined))
  assert.deepEqual(ETIQUETA_ESTADO_TRASLADO, { SENT: 'En camino', PARTIAL: 'Recibida en parte', RECEIVED: 'Recibida', CANCELLED: 'Cancelada' })
  assert.equal(MAX_LINEAS_TRASLADO, 200)
})

// ── Lo que se envía ──────────────────────────────────────────────────────────

test('un envío necesita líneas válidas: al menos una, cada producto una vez, cantidades enteras de 1 en adelante', () => {
  const ok = validarLineasTraslado([{ varianteId: 'a', cantidad: 3 }, { varianteId: ' b ', cantidad: 2 }])
  assert.ok(ok.ok)
  assert.deepEqual(ok.lineas, [{ varianteId: 'a', cantidad: 3 }, { varianteId: 'b', cantidad: 2 }])
  assert.equal(ok.unidades, 5)
  const codigo = (x: unknown, max?: number) => {
    const r = validarLineasTraslado(x, max)
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(codigo([]), 'TRASLADO_SIN_LINEAS')
  assert.equal(codigo(null), 'TRASLADO_SIN_LINEAS')
  assert.equal(codigo([{ varianteId: 'a', cantidad: 1 }, { varianteId: 'a', cantidad: 1 }]), 'LINEA_REPETIDA')
  assert.equal(codigo([{ varianteId: '', cantidad: 1 }]), 'LINEA_INVALIDA')
  assert.equal(codigo([null]), 'LINEA_INVALIDA')
  for (const mala of [0, -1, 1.5, '3', null, CANTIDAD_MAXIMA + 1]) assert.equal(codigo([{ varianteId: 'a', cantidad: mala }]), 'CANTIDAD_INVALIDA', String(mala))
  assert.equal(codigo(Array.from({ length: MAX_LINEAS_TRASLADO + 1 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }))), 'DEMASIADAS_LINEAS')
  assert.equal(codigo(Array.from({ length: MAX_LINEAS_TRASLADO }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }))), 'OK')
  const r = validarLineasTraslado([])
  if (!r.ok) assert.match(r.error, /Agrega al menos un producto al envío/)
})

// ── Lo que va llegando ───────────────────────────────────────────────────────

test('lo pendiente es lo enviado menos lo recibido, lo devuelto y lo perdido; el resumen suma por separado', () => {
  const l = [linea('a', 10, 6, 0, 0), linea('b', 5, 0, 3, 0), linea('c', 4, 1, 0, 2)]
  assert.deepEqual(l.map(pendienteDeLinea), [4, 2, 1])
  assert.equal(enTransito(l), 7)
  assert.deepEqual(resumirTraslado(l), { enviadas: 19, recibidas: 7, devueltas: 3, perdidas: 2, enTransito: 7 })
  assert.deepEqual(resumirTraslado([]), { enviadas: 0, recibidas: 0, devueltas: 0, perdidas: 0, enTransito: 0 })
})

test('recibir una parte deja la transferencia «recibida en parte» y lo que falta sigue en camino; recibirlo todo la cierra', () => {
  const l = [linea('a', 10), linea('b', 5)]
  const parte = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 6 }], false, null)
  assert.ok(parte.ok)
  assert.deepEqual([parte.estadoFinal, parte.pendienteDespues, parte.recibir, parte.perder], ['PARTIAL', 9, [{ varianteId: 'a', cantidad: 6 }], []])
  const completa = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 10 }, { varianteId: 'b', cantidad: 5 }], false, null)
  assert.ok(completa.ok)
  assert.deepEqual([completa.estadoFinal, completa.pendienteDespues], ['RECEIVED', 0])
  const todo = planDeRecepcion([linea('a', 10, 4), linea('b', 5)], 'TODO', false, null)
  assert.ok(todo.ok)
  assert.deepEqual(todo.recibir, [{ varianteId: 'a', cantidad: 6 }, { varianteId: 'b', cantidad: 5 }], 'todo = lo que faltaba, no lo enviado')
  assert.equal(todo.estadoFinal, 'RECEIVED')
  // Recibir lo último de una transferencia ya recibida en parte la cierra.
  const ultimo = planDeRecepcion([linea('a', 10, 6)], [{ varianteId: 'a', cantidad: 4 }], false, null)
  assert.ok(ultimo.ok && ultimo.estadoFinal === 'RECEIVED')
})

test('no se recibe más de lo que falta, ni un producto ajeno, ni dos veces el mismo, ni nada; el cero se ignora', () => {
  const l = [linea('a', 10, 6), linea('b', 5)]
  const codigo = (pedidas: Parameters<typeof planDeRecepcion>[1], cerrar = false, motivo: string | null = null) => {
    const r = planDeRecepcion(l, pedidas, cerrar, motivo)
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(codigo([{ varianteId: 'a', cantidad: 5 }]), 'RECIBE_MAS_DE_LO_ENVIADO')
  assert.equal(codigo([{ varianteId: 'a', cantidad: 4 }]), 'OK')
  assert.equal(codigo([{ varianteId: 'zzz', cantidad: 1 }]), 'LINEA_AJENA')
  assert.equal(codigo([{ varianteId: 'a', cantidad: 1 }, { varianteId: 'a', cantidad: 1 }]), 'LINEA_REPETIDA')
  assert.equal(codigo([{ varianteId: 'a', cantidad: 1.5 }]), 'CANTIDAD_INVALIDA')
  assert.equal(codigo([{ varianteId: 'a', cantidad: -1 }]), 'CANTIDAD_INVALIDA')
  assert.equal(codigo([]), 'SIN_CANTIDADES')
  assert.equal(codigo([{ varianteId: 'a', cantidad: 0 }]), 'SIN_CANTIDADES', 'cero de todo no es recibir nada útil')
  const conCero = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 0 }, { varianteId: 'b', cantidad: 2 }], false, null)
  assert.ok(conCero.ok)
  assert.deepEqual(conCero.recibir, [{ varianteId: 'b', cantidad: 2 }], 'la línea en cero se ignora')
  const r = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 9 }], false, null)
  assert.ok(!r.ok)
  assert.match(r.error, /Solo faltan 4 por llegar/)
  const yaCompleta = planDeRecepcion([linea('a', 3, 3)], [{ varianteId: 'a', cantidad: 1 }], false, null)
  assert.ok(!yaCompleta.ok)
  assert.match(yaCompleta.error, /ya llegó completo/)
})

test('cerrar con faltante EXIGE motivo; lo que no llegó se da por perdido y la transferencia queda recibida', () => {
  const l = [linea('a', 10, 4), linea('b', 5)]
  const sin = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 3 }], true, null)
  assert.ok(!sin.ok && sin.codigo === 'MOTIVO_OBLIGATORIO')
  const blanco = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 3 }], true, '   ')
  assert.ok(!blanco.ok && blanco.codigo === 'MOTIVO_OBLIGATORIO')
  const con = planDeRecepcion(l, [{ varianteId: 'a', cantidad: 3 }], true, 'Se mojaron')
  assert.ok(con.ok)
  assert.deepEqual([con.estadoFinal, con.pendienteDespues], ['RECEIVED', 0])
  assert.deepEqual(con.recibir, [{ varianteId: 'a', cantidad: 3 }])
  assert.deepEqual(con.perder, [{ varianteId: 'a', cantidad: 3 }, { varianteId: 'b', cantidad: 5 }])
  // Si no llegó nada, cerrar con faltante también es válido (con motivo): todo se pierde.
  const nada = planDeRecepcion(l, [], true, 'El camión no llegó')
  assert.ok(nada.ok)
  assert.deepEqual([nada.recibir, nada.perder.reduce((s, x) => s + x.cantidad, 0)], [[], 11])
  // Pedir cerrar cuando llegó TODO no inventa un faltante ni pide motivo.
  const justo = planDeRecepcion([linea('a', 4)], [{ varianteId: 'a', cantidad: 4 }], true, null)
  assert.ok(justo.ok && justo.perder.length === 0 && justo.estadoFinal === 'RECEIVED')
})

test('cancelar devuelve al origen todo lo que sigue en camino, y nada de lo que ya llegó', () => {
  const l = [linea('a', 10, 6), linea('b', 5), linea('c', 3, 3)]
  assert.deepEqual(planDeCancelacion(l), [{ varianteId: 'a', cantidad: 4 }, { varianteId: 'b', cantidad: 5 }])
  assert.deepEqual(planDeCancelacion([linea('a', 3, 3)]), [])
})

test('los motivos que llevan los movimientos nombran el número de la transferencia y las sucursales', () => {
  assert.equal(motivoDeEnvio('TRF-2030-000004', 'Norte'), 'Transferencia TRF-2030-000004 enviada a Norte')
  assert.equal(motivoDeRecepcion('TRF-2030-000004', 'Principal'), 'Transferencia TRF-2030-000004 recibida de Principal')
  assert.equal(motivoDeDevolucion('TRF-2030-000004'), 'Transferencia TRF-2030-000004 cancelada: devuelto al origen')
})

// ── Los archivos ─────────────────────────────────────────────────────────────

const trasladoEjemplo = (sobre: Partial<TrasladoParaCsv> = {}): TrasladoParaCsv => ({
  numero: 'TRF-2030-000004',
  estado: 'RECEIVED',
  origenNombre: 'Principal',
  destinoNombre: 'Norte',
  nota: 'Reposición',
  creadoEn: new Date('2030-01-02T15:04:05.000Z'),
  cerradoEn: new Date('2030-01-03T18:00:00.000Z'),
  enviadoPorNombre: 'Ana Pérez',
  cerradoPorNombre: 'Luis Gómez',
  motivoCierre: 'Se mojaron 3 cajas',
  detalle: [
    { sku: 'GOR-1', barcode: '7501', itemNombre: 'Gorra', nombreVariante: 'Default', esDefault: true, enviado: 12, recibido: 9, devuelto: 0, perdido: 3 },
    { sku: 'MED-1', barcode: null, itemNombre: 'Medias', nombreVariante: 'Talla M', esDefault: false, enviado: 5, recibido: 5, devuelto: 0, perdido: 0 },
  ],
  historial: [
    { tipo: 'TRANSFER_OUT', cantidad: 12, sucursalNombre: 'Principal', producto: 'Gorra', sku: 'GOR-1', creadoEn: new Date('2030-01-02T15:04:06.000Z'), usuarioNombre: 'Ana Pérez', motivo: 'Transferencia TRF-2030-000004 enviada a Norte' },
    { tipo: 'TRANSFER_IN', cantidad: 9, sucursalNombre: 'Norte', producto: 'Gorra', sku: 'GOR-1', creadoEn: new Date('2030-01-03T18:00:00.000Z'), usuarioNombre: null, motivo: null },
  ],
  ...sobre,
})

test('el CSV de una transferencia lleva el encabezado, el resumen, las líneas y cada movimiento, con la hora de la empresa', () => {
  const csv = trasladoToCsv(trasladoEjemplo(), 'America/Santo_Domingo')
  assert.ok(csv.startsWith('﻿'))
  for (const esperado of [
    'Número;TRF-2030-000004',
    'Estado;Recibida',
    'Origen;Principal',
    'Destino;Norte',
    'Enviada;2030-01-02 11:04:05',
    'Cerrada;2030-01-03 14:00:00',
    'Cerrada por;Luis Gómez',
    'Motivo del cierre;Se mojaron 3 cajas',
    'Productos;2',
    'Unidades enviadas;17',
    'Unidades recibidas;14',
    'Unidades perdidas;3',
    'Unidades en camino;0',
    'GOR-1;7501;Gorra;12;9;0;3;0',
    'MED-1;;Medias · Talla M;5;5;0;0;0',
    '2030-01-02 11:04:06;Salida del origen;Principal;GOR-1;Gorra;12;Ana Pérez;Transferencia TRF-2030-000004 enviada a Norte',
    '2030-01-03 14:00:00;Entrada al destino;Norte;GOR-1;Gorra;9;Sistema;',
  ]) {
    assert.ok(csv.includes(esperado), `falta «${esperado}»`)
  }
  const abierta = trasladoToCsv(trasladoEjemplo({ estado: 'PARTIAL', cerradoEn: null, cerradoPorNombre: null, motivoCierre: null, detalle: [{ ...trasladoEjemplo().detalle[0], recibido: 4, perdido: 0 }] }), 'UTC')
  assert.ok(abierta.includes('Estado;Recibida en parte'))
  assert.ok(abierta.includes('Unidades en camino;8'), 'lo que sigue en camino se calcula de las líneas')
})

test('en el CSV de una transferencia, lo que escribe una persona no se ejecuta como fórmula al abrir el archivo', () => {
  const csv = trasladoToCsv(
    trasladoEjemplo({
      nota: '=1+1',
      origenNombre: '@Origen',
      destinoNombre: '+Destino',
      motivoCierre: '-cmd',
      enviadoPorNombre: '=Ana',
      detalle: [{ sku: '=SKU', barcode: '+7501', itemNombre: '@Gorra', nombreVariante: 'Default', esDefault: true, enviado: 1, recibido: 1, devuelto: 0, perdido: 0 }],
      historial: [{ tipo: 'TRANSFER_IN', cantidad: 1, sucursalNombre: '-Norte', producto: '@Gorra', sku: '=SKU', creadoEn: new Date('2030-01-02T15:04:06.000Z'), usuarioNombre: '+Luis', motivo: '=motivo' }],
    }),
    'UTC'
  )
  for (const esperado of ["Nota;'=1+1", "Origen;'@Origen", "Destino;'+Destino", "Motivo del cierre;'-cmd", "Enviada por;'=Ana", "'=SKU;'+7501;'@Gorra;1;1;0;0;0", "'-Norte;'=SKU;'@Gorra;1;'+Luis;'=motivo"]) {
    assert.ok(csv.includes(esperado), `falta «${esperado}»`)
  }
})

// ── Filtros ──────────────────────────────────────────────────────────────────

test('la lista de transferencias lee su URL con las mismas reglas y vuelve a dar los mismos filtros; un estado inventado se ignora', () => {
  const { filtros, cursor } = leerFiltrosTraslados({ sucursal: 'suc_1', estado: 'PARTIAL', desde: '2030-05-10', hasta: '2030-05-01', q: ' TRF-2030 ', tipo: 'SALE' })
  assert.deepEqual(filtros, { sucursalId: 'suc_1', estado: 'PARTIAL', desde: '2030-05-01', hasta: '2030-05-10', q: 'TRF-2030' })
  assert.equal(cursor, null)
  const vuelta = leerFiltrosTraslados(Object.fromEntries(new URLSearchParams(consultaDeFiltrosTraslados(filtros))))
  assert.deepEqual(vuelta.filtros, filtros)
  assert.equal(consultaDeFiltrosTraslados({}), '')
  assert.equal(leerFiltrosTraslados({ estado: 'LOST' }).filtros.estado, undefined)
  for (const e of ['SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED']) assert.equal(leerFiltrosTraslados({ estado: e }).filtros.estado, e)
})
