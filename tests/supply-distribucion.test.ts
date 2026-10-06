/**
 * MEMBEGO SUPPLY · pruebas de DISTRIBUCIÓN: FEFO, capacidad y elegibilidad.
 * Ejecutar: npm test
 *
 * Las tres reglas que deciden a quién se le entrega qué, cuándo y desde qué
 * lote. Se prueban juntas porque las tres corren en la misma petición —la
 * persona pulsa «Obtener» y las tres tienen que decir que sí— y porque los
 * fallos interesantes están en sus bordes: el último cupo de la hora, el lote
 * que vence mañana, el segundo intento de la misma persona.
 *
 * PURO: sin base de datos.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ESTRATEGIAS_SELECCION,
  ESTRATEGIA_LABELS,
  ESTRATEGIA_POR_DEFECTO,
  costoDelReparto,
  elegirLote,
  loteUtilizable,
  ordenarLotes,
  repartirEntreLotes,
  type LoteElegible,
} from '../src/modules/supply/fefo'
import {
  diaLocal,
  evaluarCapacidad,
  franjasDelDia,
  horaLocal,
  ventanaDeTexto,
} from '../src/modules/supply/capacidad'
import {
  MOTIVO_RECHAZO_LABELS,
  MOTIVOS_RECHAZO,
  evaluarElegibilidad,
  reglasPorOrigen,
  type HechosCliente,
  type HechosLote,
} from '../src/modules/supply/elegibilidad'

// ── FEFO (Fase 10) ──────────────────────────────────────────────────────────

const AHORA = new Date('2026-09-20T12:00:00Z')

function lote(p: Partial<LoteElegible> & { id: string; venceAt: Date }): LoteElegible {
  return {
    codigo: p.id.toUpperCase(),
    estado: 'ACTIVO',
    inicioAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    costoUnitario: 300,
    utilizables: 100,
    disponibles: 100,
    proveedorId: 'litre',
    snapshotSucursalIds: [],
    ...p,
  }
}

const LOTE_A = lote({ id: 'a', venceAt: new Date('2026-10-01'), createdAt: new Date('2026-03-01') })
const LOTE_B = lote({ id: 'b', venceAt: new Date('2026-11-15'), createdAt: new Date('2026-01-15') })
const LOTE_C = lote({ id: 'c', venceAt: new Date('2026-12-20'), createdAt: new Date('2026-02-01') })

test('FEFO consume primero el lote que vence antes', () => {
  const orden = ordenarLotes([LOTE_C, LOTE_A, LOTE_B], 'FEFO').map((l) => l.id)
  assert.deepEqual(orden, ['a', 'b', 'c'])
  assert.equal(elegirLote([LOTE_C, LOTE_A, LOTE_B], { ahora: AHORA })?.id, 'a')
})

test('FEFO es la estrategia por defecto', () => {
  assert.equal(ESTRATEGIA_POR_DEFECTO, 'FEFO')
  assert.equal(elegirLote([LOTE_C, LOTE_A], { ahora: AHORA })?.id, 'a')
})

test('toda estrategia tiene etiqueta y ordena de forma distinta', () => {
  for (const e of ESTRATEGIAS_SELECCION) {
    assert.ok(ESTRATEGIA_LABELS[e], `falta etiqueta de ${e}`)
  }
  const caro = lote({ id: 'caro', venceAt: new Date('2026-12-31'), costoUnitario: 900 })
  assert.equal(ordenarLotes([LOTE_A, caro], 'MAYOR_COSTO')[0].id, 'caro')
  assert.equal(ordenarLotes([LOTE_A, caro], 'MENOR_COSTO')[0].id, 'a')
  assert.equal(ordenarLotes([LOTE_A, LOTE_B], 'FIFO')[0].id, 'b', 'B se compró antes')
})

test('FEFO desempata por fecha de compra', () => {
  const x = lote({ id: 'x', venceAt: new Date('2026-10-01'), createdAt: new Date('2026-05-01') })
  const y = lote({ id: 'y', venceAt: new Date('2026-10-01'), createdAt: new Date('2026-02-01') })
  assert.deepEqual(ordenarLotes([x, y], 'FEFO').map((l) => l.id), ['y', 'x'])
})

test('un lote vencido, no iniciado, vacío o inactivo NO entrega', () => {
  assert.equal(loteUtilizable(lote({ id: 'v', venceAt: new Date('2026-01-01') }), { ahora: AHORA }), false)
  assert.equal(
    loteUtilizable(lote({ id: 'f', venceAt: new Date('2027-01-01'), inicioAt: new Date('2026-12-01') }), { ahora: AHORA }),
    false
  )
  assert.equal(
    loteUtilizable(lote({ id: 'e', venceAt: new Date('2027-01-01'), utilizables: 0, disponibles: 0 }), { ahora: AHORA }),
    false
  )
  assert.equal(
    loteUtilizable(lote({ id: 'x', venceAt: new Date('2027-01-01'), estado: 'AGOTADO' }), { ahora: AHORA }),
    false
  )
})

test('lista de sucursales VACÍA significa todas, no ninguna', () => {
  const abierto = lote({ id: 'ab', venceAt: new Date('2026-12-31'), snapshotSucursalIds: [] })
  assert.equal(loteUtilizable(abierto, { ahora: AHORA, sucursalId: 'suc_cualquiera' }), true)

  const acotado = lote({ id: 'ac', venceAt: new Date('2026-12-31'), snapshotSucursalIds: ['bavaro'] })
  assert.equal(loteUtilizable(acotado, { ahora: AHORA, sucursalId: 'bavaro' }), true)
  assert.equal(loteUtilizable(acotado, { ahora: AHORA, sucursalId: 'veron' }), false)
})

test('exigirDisponibles ignora lo ya apartado para campañas', () => {
  const l = lote({ id: 'p', venceAt: new Date('2026-12-31'), utilizables: 50, disponibles: 0 })
  assert.equal(loteUtilizable(l, { ahora: AHORA }), true)
  assert.equal(loteUtilizable(l, { ahora: AHORA, exigirDisponibles: true }), false)
})

test('un reparto grande se llena empezando por el que vence antes', () => {
  const a = lote({ id: 'a', venceAt: new Date('2026-10-01'), utilizables: 30, disponibles: 30 })
  const b = lote({ id: 'b', venceAt: new Date('2026-11-01'), utilizables: 100, disponibles: 100, costoUnitario: 250 })
  const { reparto, faltante } = repartirEntreLotes([b, a], 80, { ahora: AHORA })
  assert.deepEqual(reparto.map((r) => [r.loteId, r.cantidad]), [['a', 30], ['b', 50]])
  assert.equal(faltante, 0)
  assert.equal(costoDelReparto(reparto), 30 * 300 + 50 * 250)
})

test('un reparto que no cabe dice CUÁNTO falta', () => {
  const a = lote({ id: 'a', venceAt: new Date('2026-10-01'), utilizables: 30, disponibles: 30 })
  const { reparto, faltante } = repartirEntreLotes([a], 100, { ahora: AHORA })
  assert.equal(reparto[0].cantidad, 30)
  assert.equal(faltante, 70)
})

test('repartir una cantidad no positiva es un error de programación', () => {
  assert.throws(() => repartirEntreLotes([LOTE_A], 0), /entero positivo/)
})

// ── Capacidad (Fases 17-18) ─────────────────────────────────────────────────

const HOY = '2026-09-20'

test('el cupo diario se respeta', () => {
  const lleno = evaluarCapacidad({
    dia: HOY,
    tipo: 'ON_DEMAND',
    limites: { diaria: 50 },
    ocupacion: { delDia: 50, deLaHora: 0 },
    hoy: HOY,
  })
  assert.equal(lleno.cabe, false)
  assert.equal(lleno.cabe === false ? lleno.motivo : '', 'CUPO_DIARIO_LLENO')

  const cabe = evaluarCapacidad({
    dia: HOY,
    tipo: 'ON_DEMAND',
    limites: { diaria: 50 },
    ocupacion: { delDia: 49, deLaHora: 0 },
    hoy: HOY,
  })
  assert.equal(cabe.cabe, true)
  assert.equal(cabe.cabe === true ? cabe.cupoDiarioRestante : null, 1)
})

test('el cupo por hora se respeta aunque quede cupo diario', () => {
  const v = evaluarCapacidad({
    dia: HOY,
    hora: 18,
    tipo: 'ON_DEMAND',
    limites: { diaria: 50, horaria: 10 },
    ocupacion: { delDia: 20, deLaHora: 10 },
    hoy: HOY,
  })
  assert.equal(v.cabe, false)
  assert.equal(v.cabe === false ? v.motivo : '', 'CUPO_HORARIO_LLENO')
})

test('un límite ausente significa SIN límite, no cero', () => {
  const v = evaluarCapacidad({
    dia: HOY,
    hora: 18,
    tipo: 'ON_DEMAND',
    limites: {},
    ocupacion: { delDia: 9999, deLaHora: 9999 },
    hoy: HOY,
  })
  assert.equal(v.cabe, true, 'un contrato sin cupo pactado no bloquea a nadie')
})

test('los días bloqueados y las fechas pasadas se rechazan', () => {
  const bloqueado = evaluarCapacidad({
    dia: HOY,
    tipo: 'ON_DEMAND',
    limites: { diasBloqueados: [HOY] },
    ocupacion: { delDia: 0, deLaHora: 0 },
    hoy: HOY,
  })
  assert.equal(bloqueado.cabe === false ? bloqueado.motivo : '', 'DIA_BLOQUEADO')

  const ayer = evaluarCapacidad({
    dia: '2026-09-19',
    tipo: 'ON_DEMAND',
    limites: {},
    ocupacion: { delDia: 0, deLaHora: 0 },
    hoy: HOY,
  })
  assert.equal(ayer.cabe === false ? ayer.motivo : '', 'FECHA_PASADA')
})

test('no se reserva fuera de la vigencia del contrato', () => {
  const v = evaluarCapacidad({
    dia: '2026-12-25',
    tipo: 'ON_DEMAND',
    limites: {},
    ocupacion: { delDia: 0, deLaHora: 0 },
    vigenteHasta: new Date('2026-12-01T00:00:00Z'),
    hoy: HOY,
  })
  assert.equal(v.cabe === false ? v.motivo : '', 'FUERA_DE_VIGENCIA')
})

test('el stock físico reservado no consume cupo', () => {
  const v = evaluarCapacidad({
    dia: HOY,
    tipo: 'STOCK_RESERVADO',
    limites: { diaria: 5 },
    ocupacion: { delDia: 500, deLaHora: 500 },
    hoy: HOY,
  })
  assert.equal(v.cabe, true, '500 termos apartados no se preparan: se entregan')
})

test('una hora imposible se rechaza', () => {
  for (const hora of [-1, 24, 1.5]) {
    const v = evaluarCapacidad({
      dia: HOY,
      hora,
      tipo: 'ON_DEMAND',
      limites: {},
      ocupacion: { delDia: 0, deLaHora: 0 },
      hoy: HOY,
    })
    assert.equal(v.cabe, false, `hora ${hora}`)
  }
})

test('las franjas llenas se enseñan marcadas, no escondidas', () => {
  const franjas = franjasDelDia(18, 20, { horaria: 10 }, { 18: 10, 19: 3 }, 40)
  assert.equal(franjas.length, 3)
  assert.equal(franjas[0].libre, false, '18:00 está llena')
  assert.equal(franjas[1].libre, true)
  assert.equal(franjas[1].restante, 7)
})

test('sin cupo diario, ninguna franja queda libre', () => {
  const franjas = franjasDelDia(18, 20, { horaria: 10 }, {}, 0)
  assert.ok(franjas.every((f) => !f.libre))
})

test('el día y la hora se calculan en la zona del comercio, no del servidor', () => {
  // 02:30 UTC del día 21 son las 22:30 del día 20 en Santo Domingo. Sin zona,
  // una recogida nocturna consumiría el cupo del día siguiente.
  const nocturna = new Date('2026-09-21T02:30:00Z')
  assert.equal(diaLocal(nocturna, 'America/Santo_Domingo'), '2026-09-20')
  assert.equal(horaLocal(nocturna, 'America/Santo_Domingo'), 22)
  assert.equal(diaLocal(nocturna, 'UTC'), '2026-09-21')
})

test('la ventana horaria se lee del contrato y cae en un valor seguro', () => {
  assert.deepEqual(ventanaDeTexto('11:00-22:00'), { desde: 11, hasta: 22 })
  assert.deepEqual(ventanaDeTexto('de 9 a 18'), { desde: 9, hasta: 18 })
  assert.deepEqual(ventanaDeTexto('cuando abramos'), { desde: 9, hasta: 21 })
  assert.deepEqual(ventanaDeTexto(null), { desde: 9, hasta: 21 })
  assert.deepEqual(ventanaDeTexto('22-11'), { desde: 9, hasta: 21 }, 'rango invertido → default')
})

// ── Elegibilidad (Fase 57) ──────────────────────────────────────────────────

function hechosLote(p: Partial<HechosLote> = {}): HechosLote {
  return {
    estado: 'ACTIVO',
    inicioAt: new Date('2026-01-01'),
    venceAt: new Date('2026-12-31'),
    disponibles: 100,
    asignadas: 200,
    snapshotSucursalIds: [],
    ...p,
  }
}

function hechosCliente(p: Partial<HechosCliente> = {}): HechosCliente {
  return {
    derechosDelLote: 0,
    derechosVivosDelLote: 0,
    derechosDeLaCampana: 0,
    tieneMembresia: false,
    ...p,
  }
}

test('todo motivo de rechazo tiene mensaje para el cliente', () => {
  for (const m of MOTIVOS_RECHAZO) {
    assert.ok(MOTIVO_RECHAZO_LABELS[m], `falta mensaje de ${m}`)
  }
})

test('un cliente nuevo es elegible en la campaña de bienvenida', () => {
  const v = evaluarElegibilidad(
    hechosLote(),
    hechosCliente(),
    { ...reglasPorOrigen('CAMPANA_BIENVENIDA'), ahora: AHORA },
    { activa: true, porEmitir: 27 }
  )
  assert.equal(v.elegible, true)
})

test('la bienvenida es UNA por persona', () => {
  const reglas = reglasPorOrigen('CAMPANA_BIENVENIDA')
  assert.equal(reglas.maxPorCliente, 1)

  const v = evaluarElegibilidad(
    hechosLote(),
    hechosCliente({ derechosDelLote: 1 }),
    { ...reglas, ahora: AHORA },
    { activa: true, porEmitir: 27 }
  )
  assert.equal(v.elegible, false)
  assert.equal(v.elegible === false ? v.motivo : '', 'LIMITE_POR_CLIENTE')
})

test('no se dan dos vouchers vivos del mismo lote a la misma persona', () => {
  const v = evaluarElegibilidad(
    hechosLote(),
    hechosCliente({ derechosVivosDelLote: 1 }),
    { ahora: AHORA },
    { activa: true, porEmitir: 27 }
  )
  assert.equal(v.elegible === false ? v.motivo : '', 'YA_TIENE_ACTIVO')
})

test('una COMPRA sí permite tener varios a la vez', () => {
  const v = evaluarElegibilidad(
    hechosLote(),
    hechosCliente({ derechosVivosDelLote: 2 }),
    { ...reglasPorOrigen('COMPRA'), ahora: AHORA },
    { activa: true, porEmitir: 27 }
  )
  assert.equal(v.elegible, true, 'si alguien paga por tres pizzas, se le venden tres')
})

test('una campaña sin cupo no emite aunque el lote tenga unidades', () => {
  const v = evaluarElegibilidad(
    hechosLote({ disponibles: 900 }),
    hechosCliente(),
    { ahora: AHORA },
    { activa: true, porEmitir: 0 }
  )
  assert.equal(v.elegible === false ? v.motivo : '', 'CAMPANA_SIN_CUPO')
})

test('sin campaña se emite contra las unidades LIBRES, no contra lo apartado', () => {
  const v = evaluarElegibilidad(
    hechosLote({ disponibles: 0, asignadas: 500 }),
    hechosCliente(),
    { ahora: AHORA },
    null
  )
  assert.equal(
    v.elegible === false ? v.motivo : '',
    'SIN_UNIDADES',
    'gastar lo apartado para la bienvenida en una entrega manual es lo que la asignación impide'
  )
})

test('un lote vencido o no iniciado rechaza antes que cualquier regla personal', () => {
  const vencido = evaluarElegibilidad(
    hechosLote({ venceAt: new Date('2026-01-01') }),
    hechosCliente({ derechosDelLote: 99 }),
    { maxPorCliente: 1, ahora: AHORA },
    { activa: true, porEmitir: 10 }
  )
  assert.equal(
    vencido.elegible === false ? vencido.motivo : '',
    'LOTE_VENCIDO',
    'decir "ya alcanzaste el máximo" de un beneficio que no existe manda a la persona a soporte'
  )
})

test('la membresía solo se exige cuando la regla lo pide', () => {
  const sinMembresia = evaluarElegibilidad(
    hechosLote(),
    hechosCliente({ tieneMembresia: false }),
    { ...reglasPorOrigen('MEMBRESIA'), ahora: AHORA },
    { activa: true, porEmitir: 10 }
  )
  assert.equal(sinMembresia.elegible === false ? sinMembresia.motivo : '', 'MEMBRESIA_REQUERIDA')

  const conMembresia = evaluarElegibilidad(
    hechosLote(),
    hechosCliente({ tieneMembresia: true }),
    { ...reglasPorOrigen('MEMBRESIA'), ahora: AHORA },
    { activa: true, porEmitir: 10 }
  )
  assert.equal(conMembresia.elegible, true)
})

test('la sucursal elegida tiene que estar cubierta por el contrato', () => {
  const v = evaluarElegibilidad(
    hechosLote({ snapshotSucursalIds: ['bavaro', 'veron'] }),
    hechosCliente(),
    { sucursalId: 'punta-cana', ahora: AHORA },
    { activa: true, porEmitir: 10 }
  )
  assert.equal(v.elegible === false ? v.motivo : '', 'SUCURSAL_NO_CUBIERTA')
})

test('una campaña cerrada no emite', () => {
  const v = evaluarElegibilidad(
    hechosLote(),
    hechosCliente(),
    { ahora: AHORA },
    { activa: false, porEmitir: 50 }
  )
  assert.equal(v.elegible === false ? v.motivo : '', 'CAMPANA_INACTIVA')
})
