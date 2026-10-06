/**
 * MEMBEGO SUPPLY · ESCENARIO COMPLETO (Fase 66).
 * Ejecutar: npm test
 *
 * Recorre la cadena entera del prompt sobre el dominio real —el mismo ledger,
 * las mismas máquinas de estado, la misma elegibilidad y la misma economía que
 * usa la aplicación— sin base de datos:
 *
 *   contrato → orden → lote → asignación → cliente reclama → voucher →
 *   sucursal → escaneo → redención → el supply baja → la campaña cuadra →
 *   el proveedor ve lo suyo → la economía sale
 *
 * QUÉ PRUEBA ESTO QUE NO PRUEBAN LAS DEMÁS: que las piezas ENCAJAN. Cada
 * módulo puede estar bien por separado y aun así dejar que una unidad emitida
 * desde una campaña se redima descontando del sitio equivocado. Aquí se
 * comprueba el recorrido completo de una pizza, paso a paso, con el invariante
 * verificado DESPUÉS DE CADA PASO.
 *
 * Lo que NO cubre, y se dice para que nadie lo confunda: la escritura en
 * Postgres, el bloqueo de fila y los CHECK de la migración. Eso exige una base
 * real; su forma la vigilan `tests/supply-contratos.test.ts` y la revisión del
 * SQL.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarMovimiento,
  comprobarInvariante,
  saldoDeAsientos,
  validarMovimiento,
  type AsientoLedger,
  type SaldoCubetas,
} from '../src/modules/supply/ledger'
import {
  TRANSICIONES_ACUERDO,
  TRANSICIONES_DERECHO,
  TRANSICIONES_ORDEN,
  TRANSICIONES_VOUCHER,
  ORDEN_PUEDE_GENERAR_LOTE,
  puedeTransicionar,
} from '../src/modules/supply/estados'
import { validarAcuerdo, type DatosAcuerdo } from '../src/modules/supply/contrato'
import { evaluarElegibilidad, reglasPorOrigen } from '../src/modules/supply/elegibilidad'
import { evaluarCapacidad } from '../src/modules/supply/capacidad'
import { elegirLote, type LoteElegible } from '../src/modules/supply/fefo'
import { costosDeLote, economiaCampana, metricasAdquisicion } from '../src/modules/supply/economia'
import { codigoAcuerdo, numeroOrden, codigoLote } from '../src/modules/supply/codigos'

/** Un libro de asientos que se puede ir llenando, como el de un lote real. */
class Libro {
  asientos: AsientoLedger[] = []

  anotar(mov: AsientoLedger, motivo?: string): void {
    const saldo = this.saldo()
    const v = validarMovimiento(saldo, { ...mov, motivo })
    assert.equal(v.ok, true, v.ok === false ? v.error : '')
    this.asientos.push(mov)
    // El invariante se comprueba DESPUÉS DE CADA ASIENTO, no al final: un
    // descuadre transitorio que se compensa solo sigue siendo un descuadre.
    const inv = comprobarInvariante(this.asientos)
    assert.equal(inv.cuadra, true, `el invariante se rompió al anotar ${mov.tipo}`)
  }

  saldo(): SaldoCubetas {
    return saldoDeAsientos(this.asientos)
  }
}

const COSTO = 300
const PRECIO_PUBLICO = 700
const INICIO = new Date('2026-10-01T00:00:00Z')
const FIN = new Date('2026-12-31T23:59:59Z')
const HOY = new Date('2026-10-15T12:00:00Z')

test('ESCENARIO COMPLETO · de la negociación a la analítica', () => {
  // ── 1 · CONTRATO ──────────────────────────────────────────────────────────
  // Membego negocia con Litre Pizza: 1.000 pizzas a RD$300 (precio público
  // RD$700), vigencia de octubre a diciembre, máximo 50 al día y 10 por hora.
  const acuerdo: DatosAcuerdo = {
    proveedorId: 'c_litre',
    tipo: 'ON_DEMAND',
    modeloComercial: 'COMPRA_UNIDAD_COMPLETA',
    modalidadPago: 'PREPAGO_PARCIAL',
    anticipoPorcentaje: 30,
    politicaSobrante: 'EXTENDER',
    itemNombre: 'Pizza Grande Pepperoni',
    cantidad: 1000,
    costoUnitario: COSTO,
    precioReferencia: PRECIO_PUBLICO,
    inicioAt: INICIO,
    finAt: FIN,
    capacidadDiaria: 50,
    capacidadHoraria: 10,
    sucursalIds: ['s_bavaro', 's_veron'],
  }
  assert.equal(validarAcuerdo(acuerdo), null, 'el contrato del ejemplo tiene que ser válido')

  const codigo = codigoAcuerdo('Litre Pizza', 2026, 1)
  assert.equal(codigo, 'MBG-LITRE-2026-001')

  // El contrato no nace activo: se aprueba primero.
  assert.equal(puedeTransicionar(TRANSICIONES_ACUERDO, 'BORRADOR', 'ACTIVO'), false)
  assert.equal(puedeTransicionar(TRANSICIONES_ACUERDO, 'PENDIENTE_APROBACION', 'APROBADO'), true)
  assert.equal(puedeTransicionar(TRANSICIONES_ACUERDO, 'APROBADO', 'ACTIVO'), true)

  // ── 2 · ORDEN DE COMPRA ───────────────────────────────────────────────────
  assert.equal(numeroOrden(127), 'MBG-PO-000127')
  assert.equal(
    ORDEN_PUEDE_GENERAR_LOTE.includes('BORRADOR'),
    false,
    'un borrador no puede generar supply'
  )
  assert.equal(puedeTransicionar(TRANSICIONES_ORDEN, 'CONFIRMADA', 'ACTIVA'), true)
  assert.ok(ORDEN_PUEDE_GENERAR_LOTE.includes('CONFIRMADA'))

  // ── 3 · LOTE ──────────────────────────────────────────────────────────────
  assert.equal(codigoLote(codigo, 1), 'MBG-LITRE-2026-001')

  const libro = new Libro()
  libro.anotar({ tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 1000 })
  assert.equal(libro.saldo().DISPONIBLE, 1000)

  const costoContratado = costosDeLote(libro.saldo(), COSTO)
  assert.equal(costoContratado.contratado, 300_000, 'RD$300.000 de inversión')
  assert.equal(costoContratado.consumido, 0, 'comprar no es consumir')

  // ── 4 · ASIGNACIÓN ────────────────────────────────────────────────────────
  // 200 bienvenida, 500 oferta, 100 referidos, 50 membresías, 50 influencers.
  // Quedan 100 sin asignar, como en el ejemplo del prompt.
  const reparto = [
    ['Bienvenida Membego', 200],
    ['Flash Deal', 500],
    ['Referidos', 100],
    ['Membresías', 50],
    ['Influencers', 50],
  ] as const
  for (const [, cantidad] of reparto) {
    libro.anotar({ tipo: 'ASIGNACION', origen: 'DISPONIBLE', destino: 'ASIGNADO', cantidad })
  }
  assert.equal(libro.saldo().DISPONIBLE, 100, 'quedan 100 sin asignar')
  assert.equal(libro.saldo().ASIGNADO, 900)
  assert.equal(
    costosDeLote(libro.saldo(), COSTO).consumido,
    0,
    'ASIGNAR NO ES CONSUMIR: sigue sin costar nada'
  )

  // ── 5 · EL CLIENTE RECLAMA ────────────────────────────────────────────────
  const hechosLote = {
    estado: 'ACTIVO' as const,
    inicioAt: INICIO,
    venceAt: FIN,
    disponibles: libro.saldo().DISPONIBLE,
    asignadas: libro.saldo().ASIGNADO,
    snapshotSucursalIds: ['s_bavaro', 's_veron'],
  }
  const carlosNuevo = {
    derechosDelLote: 0,
    derechosVivosDelLote: 0,
    derechosDeLaCampana: 0,
    tieneMembresia: false,
  }
  const bienvenida = { activa: true, porEmitir: 200 }

  const veredicto = evaluarElegibilidad(
    hechosLote,
    carlosNuevo,
    { ...reglasPorOrigen('CAMPANA_BIENVENIDA'), ahora: HOY },
    bienvenida
  )
  assert.equal(veredicto.elegible, true, 'Carlos se registra y es elegible')

  // Una sucursal fuera del contrato se rechaza ANTES de mover nada.
  const fuera = evaluarElegibilidad(
    hechosLote,
    carlosNuevo,
    { ...reglasPorOrigen('CAMPANA_BIENVENIDA'), ahora: HOY, sucursalId: 's_punta_cana' },
    bienvenida
  )
  assert.equal(fuera.elegible, false)

  // Emitir mueve la unidad de la CAMPAÑA, no del pool libre.
  libro.anotar({ tipo: 'EMISION', origen: 'ASIGNADO', destino: 'EMITIDO', cantidad: 1 })
  assert.equal(libro.saldo().DISPONIBLE, 100, 'el pool libre no se tocó')
  assert.equal(libro.saldo().ASIGNADO, 899)
  assert.equal(libro.saldo().EMITIDO, 1)
  assert.equal(
    costosDeLote(libro.saldo(), COSTO).consumido,
    0,
    'EMITIDO NO ES REDIMIDO: entregar el voucher todavía no costó nada'
  )

  // Y Carlos no puede pedir una segunda: la bienvenida es UNA por persona.
  const segunda = evaluarElegibilidad(
    { ...hechosLote, asignadas: libro.saldo().ASIGNADO },
    { ...carlosNuevo, derechosDelLote: 1, derechosVivosDelLote: 1 },
    { ...reglasPorOrigen('CAMPANA_BIENVENIDA'), ahora: HOY },
    { activa: true, porEmitir: 199 }
  )
  assert.equal(segunda.elegible, false)

  // ── 6 · ELIGE SUCURSAL Y HORA ─────────────────────────────────────────────
  const cabe = evaluarCapacidad({
    dia: '2026-10-15',
    hora: 18,
    tipo: 'ON_DEMAND',
    limites: { diaria: 50, horaria: 10 },
    ocupacion: { delDia: 27, deLaHora: 4 },
    vigenteDesde: INICIO,
    vigenteHasta: FIN,
    hoy: '2026-10-15',
  })
  assert.equal(cabe.cabe, true)
  assert.equal(cabe.cabe === true ? cabe.cupoDiarioRestante : null, 23)

  // El cupo del comercio se respeta: la pizza 51 de ese día no cabe.
  const lleno = evaluarCapacidad({
    dia: '2026-10-15',
    hora: 18,
    tipo: 'ON_DEMAND',
    limites: { diaria: 50, horaria: 10 },
    ocupacion: { delDia: 50, deLaHora: 4 },
    hoy: '2026-10-15',
  })
  assert.equal(lleno.cabe, false)

  // ── 7 · EL COMERCIO ESCANEA Y ENTREGA ─────────────────────────────────────
  assert.equal(puedeTransicionar(TRANSICIONES_DERECHO, 'ACTIVO', 'REDIMIDO'), true)
  assert.equal(puedeTransicionar(TRANSICIONES_VOUCHER, 'ACTIVO', 'REDIMIDO'), true)

  libro.anotar({ tipo: 'REDENCION', origen: 'EMITIDO', destino: 'REDIMIDO', cantidad: 1 })
  assert.equal(libro.saldo().EMITIDO, 0)
  assert.equal(libro.saldo().REDIMIDO, 1)
  assert.equal(
    costosDeLote(libro.saldo(), COSTO).consumido,
    300,
    'AHORA sí: la pizza salió y costó RD$300'
  )

  // ── 8 · DOBLE USO: IMPOSIBLE ──────────────────────────────────────────────
  const segundoIntento = validarMovimiento(libro.saldo(), {
    tipo: 'REDENCION',
    origen: 'EMITIDO',
    destino: 'REDIMIDO',
    cantidad: 1,
  })
  assert.equal(segundoIntento.ok, false, 'no hay nada EMITIDO que redimir otra vez')
  assert.equal(
    puedeTransicionar(TRANSICIONES_VOUCHER, 'REDIMIDO', 'REDIMIDO'),
    false,
    'un voucher redimido no se vuelve a redimir'
  )

  // ── 9 · LA CAMPAÑA ENTERA ─────────────────────────────────────────────────
  // 172 personas más reclaman (173 en total) y 127 más canjean (128 en total).
  for (let i = 0; i < 172; i++) {
    libro.anotar({ tipo: 'EMISION', origen: 'ASIGNADO', destino: 'EMITIDO', cantidad: 1 })
  }
  for (let i = 0; i < 127; i++) {
    libro.anotar({ tipo: 'REDENCION', origen: 'EMITIDO', destino: 'REDIMIDO', cantidad: 1 })
  }

  const eco = economiaCampana({
    asignadas: 200,
    emitidas: 173,
    liberadas: 0,
    redimidas: 128,
    costoUnitario: COSTO,
  })
  assert.equal(eco.porEmitir, 27, 'quedan 27 por repartir en la bienvenida')
  assert.equal(eco.activasSinCanjear, 45, '45 vouchers vivos')
  assert.equal(eco.costoConsumido, 38_400, 'RD$38.400: el gasto REAL de la campaña')
  assert.equal(eco.costoExpuesto, 13_500, 'y RD$13.500 de obligación viva')

  const cac = metricasAdquisicion({
    clientesAlcanzados: 173,
    clientesQueRedimieron: 128,
    costoConsumido: 38_400,
  })
  assert.equal(cac.costoPorClienteActivado, 300)
  assert.equal(cac.tasaActivacion, 74)

  // ── 10 · EL LOTE SIGUE CUADRANDO ──────────────────────────────────────────
  const final = comprobarInvariante(libro.asientos)
  assert.equal(final.cuadra, true)
  assert.equal(final.comprado, 1000)
  assert.equal(final.cubetas.DISPONIBLE, 100)
  assert.equal(final.cubetas.ASIGNADO, 900 - 173)
  assert.equal(final.cubetas.EMITIDO, 45)
  assert.equal(final.cubetas.REDIMIDO, 128)
  assert.equal(
    final.cubetas.DISPONIBLE +
      final.cubetas.ASIGNADO +
      final.cubetas.EMITIDO +
      final.cubetas.REDIMIDO,
    1000
  )

  // ── 11 · EL REPORTE DEL PROVEEDOR CUADRA CON EL LEDGER ────────────────────
  const costos = costosDeLote(final.cubetas, COSTO)
  assert.equal(costos.contratado, 300_000)
  assert.equal(costos.consumido, 38_400, 'lo que Membego le debe por consumo')
  assert.equal(costos.expuesto, 13_500)
  assert.equal(
    costos.disponible + costos.asignado + costos.expuesto + costos.consumido + costos.cerrado,
    costos.contratado,
    'el dinero también cuadra, no solo las unidades'
  )
})

test('ESCENARIO · una entrega mal registrada se reversa sin borrar nada', () => {
  const libro = new Libro()
  libro.anotar({ tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 10 })
  libro.anotar({ tipo: 'EMISION', origen: 'DISPONIBLE', destino: 'EMITIDO', cantidad: 3 })
  libro.anotar({ tipo: 'REDENCION', origen: 'EMITIDO', destino: 'REDIMIDO', cantidad: 3 })

  const antes = libro.asientos.length
  libro.anotar(
    { tipo: 'REVERSA_REDENCION', origen: 'REDIMIDO', destino: 'EMITIDO', cantidad: 1 },
    'El empleado escaneó el voucher del cliente equivocado.'
  )

  assert.equal(libro.asientos.length, antes + 1, 'la reversa SUMA un asiento, no borra el anterior')
  assert.equal(libro.saldo().REDIMIDO, 2)
  assert.equal(
    libro.saldo().EMITIDO,
    1,
    'la unidad vuelve al CLIENTE (EMITIDO), no al pool: el beneficio sigue siendo suyo'
  )
  assert.equal(comprobarInvariante(libro.asientos).cuadra, true)
})

test('ESCENARIO · lo que vence se cierra y el lote sigue cuadrando', () => {
  const libro = new Libro()
  libro.anotar({ tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 100 })
  libro.anotar({ tipo: 'ASIGNACION', origen: 'DISPONIBLE', destino: 'ASIGNADO', cantidad: 40 })
  libro.anotar({ tipo: 'EMISION', origen: 'ASIGNADO', destino: 'EMITIDO', cantidad: 10 })
  libro.anotar({ tipo: 'REDENCION', origen: 'EMITIDO', destino: 'REDIMIDO', cantidad: 4 })

  // Llega el vencimiento: se cierran los derechos sin usar y después lo del pool.
  libro.anotar({ tipo: 'EXPIRACION', origen: 'EMITIDO', destino: 'CERRADO', cantidad: 6 })
  libro.anotar({ tipo: 'EXPIRACION', origen: 'ASIGNADO', destino: 'CERRADO', cantidad: 30 })
  libro.anotar({ tipo: 'EXPIRACION', origen: 'DISPONIBLE', destino: 'CERRADO', cantidad: 60 })

  const inv = comprobarInvariante(libro.asientos)
  assert.equal(inv.cuadra, true)
  assert.equal(inv.cubetas.CERRADO, 96)
  assert.equal(inv.cubetas.REDIMIDO, 4)
  assert.equal(inv.cubetas.DISPONIBLE + inv.cubetas.ASIGNADO + inv.cubetas.EMITIDO, 0)

  const costos = costosDeLote(inv.cubetas, 300)
  assert.equal(costos.consumido, 1_200, 'solo se aprovecharon cuatro unidades')
  assert.equal(costos.cerrado, 28_800, 'RD$28.800 perdidos: esto es lo que el motor de avisos evita')
})

test('ESCENARIO · FEFO elige el lote que vence antes entre varios del mismo producto', () => {
  const base = {
    estado: 'ACTIVO' as const,
    inicioAt: new Date('2026-01-01'),
    costoUnitario: 300,
    utilizables: 100,
    disponibles: 100,
    proveedorId: 'c_litre',
    snapshotSucursalIds: [] as string[],
  }
  const lotes: LoteElegible[] = [
    { ...base, id: 'C', codigo: 'C', venceAt: new Date('2026-12-20'), createdAt: new Date('2026-02-01') },
    { ...base, id: 'A', codigo: 'A', venceAt: new Date('2026-10-01'), createdAt: new Date('2026-03-01') },
    { ...base, id: 'B', codigo: 'B', venceAt: new Date('2026-11-15'), createdAt: new Date('2026-01-15') },
  ]
  assert.equal(elegirLote(lotes, { ahora: new Date('2026-09-20') })?.id, 'A')
})

test('ESCENARIO · el hold del checkout evita vender dos veces la última unidad', () => {
  const libro = new Libro()
  libro.anotar({ tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 1 })

  // Ana entra al checkout: la unidad queda retenida a su nombre.
  libro.anotar({ tipo: 'RETENCION', origen: 'DISPONIBLE', destino: 'RETENIDO', cantidad: 1 })

  // Beto llega un segundo después: ya no hay nada libre que retener.
  const beto = validarMovimiento(libro.saldo(), {
    tipo: 'RETENCION',
    origen: 'DISPONIBLE',
    destino: 'RETENIDO',
    cantidad: 1,
  })
  assert.equal(beto.ok, false, 'la última unidad no se aparta dos veces')

  // Ana no paga y el hold caduca: la unidad vuelve y Beto sí puede.
  libro.anotar({ tipo: 'LIBERACION_RETENCION', origen: 'RETENIDO', destino: 'DISPONIBLE', cantidad: 1 })
  assert.equal(libro.saldo().DISPONIBLE, 1)

  const betoAhora = validarMovimiento(libro.saldo(), {
    tipo: 'RETENCION',
    origen: 'DISPONIBLE',
    destino: 'RETENIDO',
    cantidad: 1,
  })
  assert.equal(betoAhora.ok, true)
  assert.equal(comprobarInvariante(libro.asientos).cuadra, true)
})

test('ESCENARIO · una enmienda que amplía el contrato entra por el ledger', () => {
  const libro = new Libro()
  libro.anotar({ tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 1000 })
  libro.anotar({ tipo: 'ASIGNACION', origen: 'DISPONIBLE', destino: 'ASIGNADO', cantidad: 900 })

  // El contrato pasa de 1.000 a 1.200. No se edita un número: se asienta.
  libro.anotar(
    { tipo: 'AJUSTE', origen: null, destino: 'DISPONIBLE', cantidad: 200 },
    'Enmienda MBG-LITRE-2026-001: ampliación a 1.200 unidades.'
  )

  const inv = comprobarInvariante(libro.asientos)
  assert.equal(inv.comprado, 1200, 'lo comprado sube porque hay un asiento que lo explica')
  assert.equal(inv.cubetas.DISPONIBLE, 300)
  assert.equal(inv.cuadra, true)
})

test('ESCENARIO · la unidad de una campaña cancelada vuelve a SU campaña, no al pool', () => {
  const libro = new Libro()
  libro.anotar({ tipo: 'COMPRA', origen: null, destino: 'DISPONIBLE', cantidad: 100 })
  libro.anotar({ tipo: 'ASIGNACION', origen: 'DISPONIBLE', destino: 'ASIGNADO', cantidad: 20 })
  libro.anotar({ tipo: 'EMISION', origen: 'ASIGNADO', destino: 'EMITIDO', cantidad: 1 })

  // El cliente cancela. La unidad salió de ASIGNADO y allí tiene que volver:
  // devolverla a DISPONIBLE le robaría cupo a la campaña sin que nadie lo
  // decidiera, y el reporte de esa campaña diría que repartió una de menos.
  libro.anotar({ tipo: 'DEVOLUCION_EMISION', origen: 'EMITIDO', destino: 'ASIGNADO', cantidad: 1 })

  assert.equal(libro.saldo().ASIGNADO, 20)
  assert.equal(libro.saldo().DISPONIBLE, 80)
  assert.equal(comprobarInvariante(libro.asientos).cuadra, true)
})
