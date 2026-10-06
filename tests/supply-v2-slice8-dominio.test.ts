import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  BASES_ACUMULACION,
  cabeEnElPrograma,
  compromisoDePuntos,
  consumirPorVencimiento,
  disponibleDelLote,
  economiaDelPrograma,
  estadoAlActivar,
  estadoRecompensaSegunUsos,
  exigeVersionNueva,
  lotesVencidos,
  MENSAJES_NO_CONTRATABLE,
  MENSAJES_NO_RECLAMABLE,
  MENSAJES_PROGRAMA_INACTIVO,
  MENSAJES_REFERIDO,
  MEMBRESIA_VIVA,
  membresiaVigente,
  motivoNoContratable,
  motivoNoReclamable,
  motivoProgramaInactivo,
  motivoReferidoNoElegible,
  multiplicadorDeMembresias,
  ordenarPorVencimiento,
  puedeAdministrarPrograma,
  puntosPorCompra,
  REFERIDO_CON_DERECHO,
  reversaDevuelvePuntos,
  saldoDeMovimientosPuntos,
  sumarDias,
  TRANSICIONES_MEMBRESIA,
  TRANSICIONES_PLAN,
  TRANSICIONES_PROGRAMA,
  TRANSICIONES_RECLAMACION,
  TRANSICIONES_RECOMPENSA,
  TRANSICIONES_REFERIDO,
  validarAjusteDePuntos,
  validarPlan,
  validarPrograma,
  validarRecompensa,
  ventanaDeMembresia,
  vencimientoDeLote,
  type ClienteParaReclamar,
  type CompraDelReferido,
  type DatosPlan,
  type DatosPrograma,
  type DatosRecompensa,
  type LoteDePuntos,
  type PlanParaContratar,
  type RecompensaParaReclamar,
  type ReglaDeAcumulacion,
  type ReglasDeReferido,
  type SituacionDelCliente,
  type UsoDelProgramaDeReferidos,
} from '../src/modules/supply-v2/loyalty/domain'
import { puedeTransicionar } from '../src/modules/supply-v2/core/estados'

/**
 * MEMBEGO SUPPLY · SLICE 8 · pruebas de DOMINIO (§44). Sin base de datos.
 *
 * Los 24 casos que pide el enunciado, más los que hicieron falta para no
 * dejar una regla sin comprobar. Lo que garantiza la BASE —candados, CHECK,
 * índices únicos parciales, concurrencia— se prueba aparte, contra PostgreSQL
 * de verdad, en `tests/postgres/supply-v2-slice8.db.test.ts`: una regla que
 * solo se comprueba en TypeScript no protege nada si alguien escribe por otro
 * camino.
 */

const d = (n: number | string) => new Prisma.Decimal(n)
const AHORA = new Date('2026-06-15T12:00:00.000Z')

const PROGRAMA_ACTIVO = { status: 'ACTIVE' as const, startsAt: new Date('2026-01-01'), endsAt: null }

function programa(over: Partial<DatosPrograma> = {}): DatosPrograma {
  return {
    name: 'Fidelización Car Town',
    owner: 'SUPPLIER',
    supplierId: 'sup-1',
    funding: 'SUPPLIER',
    modalities: ['MEMBERSHIPS', 'POINTS'],
    pointsPerUnit: 1,
    amountPerPoint: 100,
    startsAt: new Date('2026-01-01'),
    ...over,
  }
}

// ── 1 · Creación de programas ───────────────────────────────────────────────

test('1 · un programa válido pasa; sin nombre, sin modalidad o con fechas al revés, no', () => {
  assert.equal(validarPrograma(programa()), null)
  assert.match(validarPrograma(programa({ name: '  ' }))!, /necesita un nombre/)
  assert.match(validarPrograma(programa({ modalities: [] }))!, /al menos una modalidad/)
  assert.match(
    validarPrograma(programa({ endsAt: new Date('2025-01-01') }))!,
    /posterior al inicio/
  )
  assert.match(validarPrograma(programa({ modalities: ['POINTS', 'POINTS'] }))!, /repetida/)
})

test('1a · un programa de puntos EXIGE su regla, y la regla va completa o vacía', () => {
  assert.match(
    validarPrograma(programa({ pointsPerUnit: null, amountPerPoint: null }))!,
    /necesita su regla de acumulación/
  )
  // Media regla no acumula nada: «1 punto por cada…» sin el «cada cuánto».
  assert.match(
    validarPrograma(programa({ modalities: ['MEMBERSHIPS'], pointsPerUnit: 1, amountPerPoint: null }))!,
    /va completa/
  )
  assert.equal(validarPrograma(programa({ modalities: ['MEMBERSHIPS'], pointsPerUnit: null, amountPerPoint: null })), null)
})

test('1b · un programa que compromete dinero de Membego exige techo, o quien firme que no lo hay', () => {
  const sinTecho = programa({ owner: 'MEMBEGO', supplierId: null, funding: 'MEMBEGO', budgetTotal: null })
  assert.match(validarPrograma(sinTecho)!, /presupuesto máximo/)
  // Con autorización escrita sí pasa, y queda quién y por qué.
  assert.equal(
    validarPrograma({ ...sinTecho, budgetWaiverById: 'u-finanzas', budgetWaiverReason: 'Piloto de dos semanas aprobado en comité' }),
    null
  )
  // Si lo paga el proveedor, Membego no compromete nada y no hace falta techo.
  assert.equal(validarPrograma(programa({ funding: 'SUPPLIER', budgetTotal: null })), null)
})

test('1c · la máquina de estados del programa: nace borrador y COMPLETED/CANCELLED son finales', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_PROGRAMA, 'DRAFT', 'PENDING_APPROVAL'))
  assert.ok(puedeTransicionar(TRANSICIONES_PROGRAMA, 'PENDING_APPROVAL', 'ACTIVE'))
  assert.ok(puedeTransicionar(TRANSICIONES_PROGRAMA, 'PENDING_APPROVAL', 'DRAFT'), 'rechazar devuelve a borrador')
  assert.ok(puedeTransicionar(TRANSICIONES_PROGRAMA, 'ACTIVE', 'PAUSED'))
  assert.ok(puedeTransicionar(TRANSICIONES_PROGRAMA, 'PAUSED', 'ACTIVE'))
  // Un borrador no se activa saltándose la aprobación.
  assert.ok(!puedeTransicionar(TRANSICIONES_PROGRAMA, 'DRAFT', 'ACTIVE'))
  assert.deepEqual(TRANSICIONES_PROGRAMA.COMPLETED, [])
  assert.deepEqual(TRANSICIONES_PROGRAMA.CANCELLED, [])
})

test('1d · vigencia del programa: cada motivo tiene su mensaje', () => {
  assert.equal(motivoProgramaInactivo(PROGRAMA_ACTIVO, AHORA), null)
  assert.equal(motivoProgramaInactivo({ ...PROGRAMA_ACTIVO, status: 'PAUSED' }, AHORA), 'NO_ACTIVO')
  assert.equal(motivoProgramaInactivo({ ...PROGRAMA_ACTIVO, status: 'COMPLETED' }, AHORA), 'TERMINO')
  assert.equal(motivoProgramaInactivo({ ...PROGRAMA_ACTIVO, startsAt: new Date('2027-01-01') }, AHORA), 'NO_EMPEZO')
  assert.equal(motivoProgramaInactivo({ ...PROGRAMA_ACTIVO, endsAt: new Date('2026-01-02') }, AHORA), 'TERMINO')
  for (const m of Object.values(MENSAJES_PROGRAMA_INACTIVO)) assert.ok(m.length > 10)
})

// ── 2 · Aislamiento entre empresas ──────────────────────────────────────────

test('2 · una empresa solo administra SUS programas; Membego supervisa todos', () => {
  const deA = { owner: 'SUPPLIER' as const, supplierId: 'sup-A' }
  const deMembego = { owner: 'MEMBEGO' as const, supplierId: null }

  assert.ok(puedeAdministrarPrograma(deA, { esPlataforma: false, supplierId: 'sup-A' }), 'el dueño sí')
  assert.ok(!puedeAdministrarPrograma(deA, { esPlataforma: false, supplierId: 'sup-B' }), 'otro proveedor NO')
  assert.ok(!puedeAdministrarPrograma(deMembego, { esPlataforma: false, supplierId: 'sup-A' }), 'participar no es administrar')
  assert.ok(puedeAdministrarPrograma(deA, { esPlataforma: true, supplierId: null }), 'la plataforma supervisa')
  assert.ok(!puedeAdministrarPrograma(deA, { esPlataforma: false, supplierId: null }), 'sin empresa, nada')
})

// ── 3–4 · Membresía gratuita y de pago ──────────────────────────────────────

function plan(over: Partial<DatosPlan> = {}): DatosPlan {
  return { name: 'Gold', kind: 'PAID', price: 1499, durationDays: 30, ...over }
}

test('3 · un plan GRATUITO no lleva precio, y uno OTORGADO tampoco', () => {
  assert.equal(validarPlan(plan({ kind: 'FREE', price: 0 })), null)
  assert.match(validarPlan(plan({ kind: 'FREE', price: 500 }))!, /gratuito no lleva precio/)
  assert.match(validarPlan(plan({ kind: 'GRANTED', price: 500 }))!, /no lo paga el cliente/)
})

test('4 · un plan DE PAGO necesita precio mayor que cero, y duración válida', () => {
  assert.equal(validarPlan(plan()), null)
  assert.match(validarPlan(plan({ price: 0 }))!, /precio mayor que cero/)
  assert.match(validarPlan(plan({ durationDays: 0 }))!, /mayor que cero/)
  assert.match(validarPlan(plan({ durationDays: 4000 }))!, /diez años/)
  assert.match(validarPlan(plan({ price: -5 }))!, /no puede ser negativo/)
})

test('4a · los nombres y los importes del enunciado son CONFIGURACIÓN, no una lista cerrada', () => {
  // Car Town Car Wash: Silver 999, Gold 1 499, Platinum 2 499. Y cualquier
  // otro negocio puede poner los suyos.
  for (const [name, price] of [['Silver', 999], ['Gold', 1499], ['Platinum', 2499], ['Básico', 1], ['VIP Anual', 25000]] as const) {
    assert.equal(validarPlan(plan({ name, price })), null, `${name} debería valer`)
  }
})

// ── 5 · Vigencia ────────────────────────────────────────────────────────────

test('5 · la vigencia sale de la duración contratada, y una membresía vencida no vale', () => {
  const v = ventanaDeMembresia(30, AHORA, null)
  assert.equal(v.activatedAt.toISOString(), AHORA.toISOString())
  assert.equal(v.expiresAt.toISOString(), sumarDias(AHORA, 30).toISOString())

  assert.ok(membresiaVigente({ status: 'ACTIVE', activatedAt: v.activatedAt, expiresAt: v.expiresAt }, AHORA))
  assert.ok(!membresiaVigente({ status: 'ACTIVE', activatedAt: v.activatedAt, expiresAt: new Date('2026-01-01') }, AHORA), 'vencida')
  assert.ok(!membresiaVigente({ status: 'SUSPENDED', activatedAt: v.activatedAt, expiresAt: v.expiresAt }, AHORA), 'suspendida')
  assert.ok(!membresiaVigente({ status: 'SCHEDULED', activatedAt: sumarDias(AHORA, 5), expiresAt: sumarDias(AHORA, 35) }, AHORA), 'aún no empieza')
})

// ── 6 · Renovación ──────────────────────────────────────────────────────────

test('6 · renovar NO solapa períodos: el nuevo empieza cuando acaba el anterior', () => {
  const vence = sumarDias(AHORA, 10)
  const v = ventanaDeMembresia(30, AHORA, vence)
  assert.equal(v.activatedAt.toISOString(), vence.toISOString(), 'arranca al vencer el anterior')
  assert.equal(v.expiresAt.toISOString(), sumarDias(vence, 30).toISOString(), 'y dura sus 30 días completos')
  // Un período que todavía no empieza nace SCHEDULED, no ACTIVE: así no choca
  // con el que está corriendo.
  assert.equal(estadoAlActivar(v, AHORA), 'SCHEDULED')

  // Si el anterior ya venció, el nuevo empieza hoy y no se regalan días.
  const v2 = ventanaDeMembresia(30, AHORA, new Date('2026-01-01'))
  assert.equal(v2.activatedAt.toISOString(), AHORA.toISOString())
  assert.equal(estadoAlActivar(v2, AHORA), 'ACTIVE')
})

test('6a · no se pueden adelantar más períodos de los que el plan permite', () => {
  const p: PlanParaContratar = { status: 'PUBLISHED', kind: 'PAID', maxMembers: null, maxAdvanceRenewals: 1 }
  const base: SituacionDelCliente = { sinPagar: 0, programadas: 0, activas: 1, miembrosDelPlan: 10 }
  assert.equal(motivoNoContratable(PROGRAMA_ACTIVO, p, base, AHORA), null, 'con uno activo puede adelantar uno')
  assert.equal(
    motivoNoContratable(PROGRAMA_ACTIVO, p, { ...base, programadas: 1 }, AHORA),
    'DEMASIADOS_PERIODOS_POR_ADELANTADO'
  )
})

test('6b · una compra sin pagar bloquea la siguiente: el doble clic no compra dos veces', () => {
  const p: PlanParaContratar = { status: 'PUBLISHED', kind: 'PAID', maxMembers: null, maxAdvanceRenewals: 2 }
  assert.equal(
    motivoNoContratable(PROGRAMA_ACTIVO, p, { sinPagar: 1, programadas: 0, activas: 0, miembrosDelPlan: 1 }, AHORA),
    'YA_TIENE_UNA_SIN_PAGAR'
  )
})

test('6c · el resto de motivos para no poder contratar, cada uno con su mensaje', () => {
  const vacio: SituacionDelCliente = { sinPagar: 0, programadas: 0, activas: 0, miembrosDelPlan: 0 }
  const base: PlanParaContratar = { status: 'PUBLISHED', kind: 'PAID', maxMembers: null, maxAdvanceRenewals: 1 }
  assert.equal(motivoNoContratable({ ...PROGRAMA_ACTIVO, status: 'PAUSED' }, base, vacio, AHORA), 'PROGRAMA_INACTIVO')
  assert.equal(motivoNoContratable(PROGRAMA_ACTIVO, { ...base, status: 'DRAFT' }, vacio, AHORA), 'PLAN_SIN_PUBLICAR')
  assert.equal(motivoNoContratable(PROGRAMA_ACTIVO, { ...base, status: 'ARCHIVED' }, vacio, AHORA), 'PLAN_NO_DISPONIBLE')
  assert.equal(motivoNoContratable(PROGRAMA_ACTIVO, { ...base, kind: 'GRANTED' }, vacio, AHORA), 'SOLO_OTORGADA')
  assert.equal(
    motivoNoContratable(PROGRAMA_ACTIVO, { ...base, maxMembers: 5 }, { ...vacio, miembrosDelPlan: 5 }, AHORA),
    'PLAN_LLENO'
  )
  // Quien YA es miembro renueva aunque el plan esté lleno: no pierde su sitio.
  assert.equal(
    motivoNoContratable(PROGRAMA_ACTIVO, { ...base, maxMembers: 5 }, { ...vacio, miembrosDelPlan: 5, activas: 1 }, AHORA),
    null
  )
  for (const m of Object.values(MENSAJES_NO_CONTRATABLE)) assert.ok(m.length > 10)
})

test('6d · la máquina de estados de la membresía', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_MEMBRESIA, 'PENDING_PAYMENT', 'ACTIVE'))
  assert.ok(puedeTransicionar(TRANSICIONES_MEMBRESIA, 'PENDING_PAYMENT', 'SCHEDULED'))
  assert.ok(puedeTransicionar(TRANSICIONES_MEMBRESIA, 'SCHEDULED', 'ACTIVE'))
  assert.ok(puedeTransicionar(TRANSICIONES_MEMBRESIA, 'ACTIVE', 'EXPIRED'))
  assert.ok(puedeTransicionar(TRANSICIONES_MEMBRESIA, 'SUSPENDED', 'ACTIVE'))
  // Una membresía vencida no «revive»: se compra un período nuevo.
  assert.deepEqual(TRANSICIONES_MEMBRESIA.EXPIRED, [])
  assert.deepEqual(TRANSICIONES_MEMBRESIA.CANCELLED, [])
  assert.deepEqual([...MEMBRESIA_VIVA].sort(), ['ACTIVE', 'PENDING_PAYMENT', 'SCHEDULED', 'SUSPENDED'])
  assert.deepEqual(TRANSICIONES_PLAN.ARCHIVED, [])
})

// ── 7 · Beneficios por plan y versiones históricas ──────────────────────────

test('7 · cambiar precio o duración exige versión nueva; cambiar la descripción, no (§14)', () => {
  assert.ok(exigeVersionNueva({ price: 1499, durationDays: 30 }, { price: 1799, durationDays: 30 }), 'sube el precio')
  assert.ok(exigeVersionNueva({ price: 1499, durationDays: 30 }, { price: 1499, durationDays: 60 }), 'cambia la duración')
  assert.ok(!exigeVersionNueva({ price: 1499, durationDays: 30 }, { price: 1499, durationDays: 30 }), 'nada cambió')
  // 1499 y '1499.00' son el mismo precio: no se sube versión por el formato.
  assert.ok(!exigeVersionNueva({ price: 1499, durationDays: 30 }, { price: '1499.00', durationDays: 30 }))
})

// ── 8–10 · Referidos: código, válido, autorreferido ─────────────────────────

const REGLAS: ReglasDeReferido = {
  active: true,
  requiresFirstPurchase: true,
  minPurchaseAmount: d(500),
  requiresPaymentConfirmed: true,
  waitingPeriodDays: 0,
  maxPerReferrer: 5,
  maxTotal: 100,
  budgetTotal: d(10000),
}
const REFERIDO = { referrerId: 'juan', referredId: 'maria', status: 'PURCHASE_ELIGIBLE' as const, codigoActivo: true }
const COMPRA: CompraDelReferido = { importe: d(1000), pagoConfirmado: true, cancelada: false, comprasPrevias: 0, confirmadaEn: AHORA }
const USO: UsoDelProgramaDeReferidos = { recompensasDelReferidor: 0, recompensasTotales: 0, presupuestoUsado: d(0), costeDeEsta: d(200) }

test('8 · el ciclo de vida del referido separa lo informativo de lo que da dinero (§20)', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_REFERIDO, 'LINK_OPENED', 'SIGNED_UP'))
  assert.ok(puedeTransicionar(TRANSICIONES_REFERIDO, 'PURCHASE_ELIGIBLE', 'REWARD_PENDING'))
  assert.ok(puedeTransicionar(TRANSICIONES_REFERIDO, 'REWARD_APPROVED', 'REWARD_GRANTED'))
  // Abrir el enlace NO salta a la recompensa: hace falta todo el camino.
  assert.ok(!puedeTransicionar(TRANSICIONES_REFERIDO, 'LINK_OPENED', 'REWARD_GRANTED'))
  assert.ok(!puedeTransicionar(TRANSICIONES_REFERIDO, 'SIGNED_UP', 'REWARD_PENDING'))
  // Conceder es final: no se concede dos veces.
  assert.deepEqual(TRANSICIONES_REFERIDO.REWARD_GRANTED, [])
  assert.deepEqual([...REFERIDO_CON_DERECHO], ['REWARD_PENDING', 'REWARD_APPROVED', 'REWARD_GRANTED'])
})

test('9 · un referido válido con primera compra confirmada da derecho a la recompensa', () => {
  assert.equal(motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, REFERIDO, COMPRA, USO, AHORA), null)
})

test('10 · AUTORREFERIDO rechazado, aunque todo lo demás esté bien', () => {
  assert.equal(
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, { ...REFERIDO, referredId: 'juan' }, COMPRA, USO, AHORA),
    'AUTORREFERIDO'
  )
})

test('10a · el resto del antifraude: compra cancelada, pago sin confirmar, no primera, mínimo, espera', () => {
  const no = (c: Partial<CompraDelReferido>, r: Partial<ReglasDeReferido> = {}) =>
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, { ...REGLAS, ...r }, REFERIDO, { ...COMPRA, ...c }, USO, AHORA)

  assert.equal(no({ cancelada: true }), 'COMPRA_CANCELADA', 'una compra cancelada no paga recompensa')
  assert.equal(no({ pagoConfirmado: false }), 'PAGO_SIN_CONFIRMAR')
  assert.equal(no({ comprasPrevias: 1 }), 'NO_ES_PRIMERA_COMPRA')
  assert.equal(no({ importe: d(100) }), 'COMPRA_MINIMA')
  // Período de espera: el plazo en el que una cancelación todavía puede llegar.
  assert.equal(no({ confirmadaEn: AHORA }, { waitingPeriodDays: 7 }), 'PERIODO_DE_ESPERA')
  assert.equal(no({ confirmadaEn: sumarDias(AHORA, -8) }, { waitingPeriodDays: 7 }), null, 'pasada la espera, sí')
  assert.equal(
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, { ...REFERIDO, codigoActivo: false }, COMPRA, USO, AHORA),
    'CODIGO_INACTIVO'
  )
  assert.equal(
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, { ...REGLAS, active: false }, REFERIDO, COMPRA, USO, AHORA),
    'REFERIDOS_DESACTIVADOS'
  )
  for (const m of Object.values(MENSAJES_REFERIDO)) assert.ok(m.length > 10)
})

test('10b · límites y presupuesto del programa de referidos', () => {
  const con = (u: Partial<UsoDelProgramaDeReferidos>) =>
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, REFERIDO, COMPRA, { ...USO, ...u }, AHORA)
  assert.equal(con({ recompensasDelReferidor: 5 }), 'LIMITE_POR_PARTICIPANTE')
  assert.equal(con({ recompensasTotales: 100 }), 'LIMITE_GLOBAL')
  // 9 900 usados + 200 de esta = 10 100 > 10 000.
  assert.equal(con({ presupuestoUsado: d(9900) }), 'PRESUPUESTO_AGOTADO')
  assert.equal(con({ presupuestoUsado: d(9800) }), null, 'justo cabe')
})

// ── 11–12 · Recompensa por primera compra y doble confirmación ──────────────

test('11 · la recompensa es por la PRIMERA compra válida, no por abrir el enlace', () => {
  // Abrir el enlace deja el referido en LINK_OPENED y de ahí no se salta a
  // la recompensa: hace falta registro + compra elegible.
  assert.ok(!puedeTransicionar(TRANSICIONES_REFERIDO, 'LINK_OPENED', 'REWARD_PENDING'))
  assert.equal(motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, REFERIDO, { ...COMPRA, comprasPrevias: 2 }, USO, AHORA), 'NO_ES_PRIMERA_COMPRA')
})

test('12 · DOBLE CONFIRMACIÓN: un referido ya recompensado no vuelve a serlo', () => {
  assert.equal(
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, { ...REFERIDO, status: 'REWARD_GRANTED' }, COMPRA, USO, AHORA),
    'YA_RECOMPENSADO'
  )
  // Y la máquina de estados no deja volver a conceder desde el estado final.
  assert.ok(!puedeTransicionar(TRANSICIONES_REFERIDO, 'REWARD_GRANTED', 'REWARD_GRANTED'))
})

// ── 13–14 · Puntos por compra y multiplicadores ─────────────────────────────

const REGLA_PUNTOS: ReglaDeAcumulacion = { pointsPerUnit: 1, amountPerPoint: d(100), basis: 'CONTRACTUAL_VALUE' }

test('13 · 1 punto por cada RD$100: la cifra del enunciado, y el resto se trunca', () => {
  assert.equal(puntosPorCompra(REGLA_PUNTOS, { contractualValue: d(1000), customerPaid: d(1000) }), 10)
  assert.equal(puntosPorCompra(REGLA_PUNTOS, { contractualValue: d(999), customerPaid: d(999) }), 9, 'no se redondea hacia arriba')
  assert.equal(puntosPorCompra(REGLA_PUNTOS, { contractualValue: d(99), customerPaid: d(99) }), 0)
  assert.equal(puntosPorCompra(REGLA_PUNTOS, { contractualValue: d(0), customerPaid: d(0) }), 0)
  // La regla es CONFIGURABLE: 5 puntos por cada RD$50.
  assert.equal(puntosPorCompra({ pointsPerUnit: 5, amountPerPoint: d(50), basis: 'CONTRACTUAL_VALUE' }, { contractualValue: d(500), customerPaid: d(500) }), 50)
})

test('13a · §27: la base decide, y hay que decir cuál es', () => {
  // Compra de 1 000 con un bono: el cliente pagó 600, el valor contractual es
  // 900. Dan números DISTINTOS, y por eso la base se congela en el movimiento.
  const importes = { contractualValue: d(900), customerPaid: d(600) }
  assert.equal(puntosPorCompra({ ...REGLA_PUNTOS, basis: 'CONTRACTUAL_VALUE' }, importes), 9)
  assert.equal(puntosPorCompra({ ...REGLA_PUNTOS, basis: 'CUSTOMER_PAID' }, importes), 6)
  assert.deepEqual([...BASES_ACUMULACION], ['CONTRACTUAL_VALUE', 'CUSTOMER_PAID'])
})

test('14 · multiplicador de membresía: se aplica al final y SIEMPRE trunca', () => {
  const importes = { contractualValue: d(1000), customerPaid: d(1000) }
  assert.equal(puntosPorCompra(REGLA_PUNTOS, importes, 2), 20)
  assert.equal(puntosPorCompra(REGLA_PUNTOS, importes, d('1.5')), 15)
  // 9 × 1,5 = 13,5 → 13. No se regalan puntos por redondeo.
  assert.equal(puntosPorCompra(REGLA_PUNTOS, { contractualValue: d(900), customerPaid: d(900) }, d('1.5')), 13)

  // Con varios planes vivos manda el mayor, no la suma.
  assert.equal(multiplicadorDeMembresias([null, 1, d(2), d('1.5')]).toString(), '2')
  assert.equal(multiplicadorDeMembresias([]).toString(), '1')
  assert.equal(multiplicadorDeMembresias([null, null]).toString(), '1')
})

// ── 15 · Puntos pendientes ──────────────────────────────────────────────────

test('15 · el saldo se reconstruye DESDE LOS MOVIMIENTOS: pendiente → disponible', () => {
  const movs = [
    // Gana 10, pero quedan pendientes mientras la compra puede caerse.
    { availableDelta: 0, pendingDelta: 10, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 },
    // Pasa el plazo: los mismos 10 pasan a disponibles.
    { availableDelta: 10, pendingDelta: -10, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 },
  ]
  assert.deepEqual(saldoDeMovimientosPuntos(movs), { available: 10, pending: 0, reserved: 0, redeemed: 0, expired: 0 })

  // Y una compra que se cae NO deja puntos disponibles.
  const caida = [
    { availableDelta: 0, pendingDelta: 10, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 },
    { availableDelta: 0, pendingDelta: -10, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 },
  ]
  assert.deepEqual(saldoDeMovimientosPuntos(caida), { available: 0, pending: 0, reserved: 0, redeemed: 0, expired: 0 })
  assert.deepEqual(saldoDeMovimientosPuntos([]), { available: 0, pending: 0, reserved: 0, redeemed: 0, expired: 0 })
})

test('15a · el ciclo completo reservar → canjear → liberar cuadra en el ledger', () => {
  const movs = [
    { availableDelta: 100, pendingDelta: 0, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 },
    { availableDelta: -30, pendingDelta: 0, reservedDelta: 30, redeemedDelta: 0, expiredDelta: 0 },
    { availableDelta: 0, pendingDelta: 0, reservedDelta: -30, redeemedDelta: 30, expiredDelta: 0 },
    { availableDelta: -20, pendingDelta: 0, reservedDelta: 20, redeemedDelta: 0, expiredDelta: 0 },
    { availableDelta: 20, pendingDelta: 0, reservedDelta: -20, redeemedDelta: 0, expiredDelta: 0 },
  ]
  assert.deepEqual(saldoDeMovimientosPuntos(movs), { available: 70, pending: 0, reserved: 0, redeemed: 30, expired: 0 })
})

// ── 16 · Vencimiento ────────────────────────────────────────────────────────

const LOTES: LoteDePuntos[] = [
  { id: 'c-sin-vencer', points: 50, consumedFromLot: 0, expiresAt: null },
  { id: 'b-tarde', points: 30, consumedFromLot: 0, expiresAt: new Date('2026-12-31') },
  { id: 'a-pronto', points: 20, consumedFromLot: 5, expiresAt: new Date('2026-07-01') },
]

test('16 · se consume PRIMERO lo que vence antes; lo que no vence, al final (§29)', () => {
  assert.deepEqual(ordenarPorVencimiento(LOTES).map((l) => l.id), ['a-pronto', 'b-tarde', 'c-sin-vencer'])
  assert.equal(disponibleDelLote(LOTES[2]!), 15, '20 menos 5 ya consumidos')

  // 20 puntos: se vacían los 15 del que vence antes y 5 del siguiente.
  assert.deepEqual(consumirPorVencimiento(LOTES, 20), [
    { loteId: 'a-pronto', puntos: 15 },
    { loteId: 'b-tarde', puntos: 5 },
  ])
})

test('16a · si no alcanza, NO se gasta nada: devuelve null en vez de gastar de más', () => {
  assert.equal(consumirPorVencimiento(LOTES, 1000), null)
  assert.equal(consumirPorVencimiento(LOTES, 0), null)
  assert.equal(consumirPorVencimiento(LOTES, -5), null)
  assert.equal(consumirPorVencimiento(LOTES, 1.5), null)
  // 95 es justo todo lo que hay: 15 + 30 + 50.
  assert.equal(consumirPorVencimiento(LOTES, 95)!.reduce((t, c) => t + c.puntos, 0), 95)
  assert.equal(consumirPorVencimiento(LOTES, 96), null)
})

test('16b · los lotes vencidos se identifican sin tocar los demás', () => {
  const vencidos = lotesVencidos(LOTES, new Date('2026-08-01'))
  assert.deepEqual(vencidos.map((l) => l.id), ['a-pronto'], 'el de diciembre no ha vencido y el perpetuo no vence')
  assert.deepEqual(lotesVencidos(LOTES, new Date('2026-01-01')), [])
  assert.equal(vencimientoDeLote(AHORA, null), null, 'sin vencimiento configurado, no vencen')
  assert.equal(vencimientoDeLote(AHORA, 90)!.toISOString(), sumarDias(AHORA, 90).toISOString())
})

// ── 17–18 · Redención de puntos y saldo insuficiente ────────────────────────

function recompensa(over: Partial<RecompensaParaReclamar> = {}): RecompensaParaReclamar {
  return {
    status: 'ACTIVE',
    pointsCost: 100,
    startsAt: new Date('2026-01-01'),
    endsAt: null,
    maxClaims: null,
    timesClaimed: 0,
    maxPerCustomer: 1,
    requiresMembership: false,
    requiredPlanId: null,
    budgetTotal: null,
    unitCost: d(200),
    ...over,
  }
}
function cliente(over: Partial<ClienteParaReclamar> = {}): ClienteParaReclamar {
  return { puntosDisponibles: 500, reclamacionesPropias: 0, enCurso: 0, planesVivos: [], presupuestoUsado: d(0), ...over }
}

test('17 · con puntos de sobra, la recompensa se puede reclamar', () => {
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa(), cliente(), AHORA), null)
  // Justo justo también vale.
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ pointsCost: 500 }), cliente(), AHORA), null)
})

test('18 · SALDO INSUFICIENTE: 99 puntos no compran una recompensa de 100', () => {
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa(), cliente({ puntosDisponibles: 99 }), AHORA),
    'PUNTOS_INSUFICIENTES'
  )
})

test('18a · a quien NO puede pedirla no se le dice que le faltan puntos', () => {
  // El orden importa: primero por qué no puede, y solo después los puntos.
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ requiresMembership: true }), cliente({ puntosDisponibles: 0 }), AHORA),
    'SOLO_MIEMBROS'
  )
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ requiresMembership: true, requiredPlanId: 'plan-gold' }), cliente({ planesVivos: ['plan-silver'] }), AHORA),
    'PLAN_REQUERIDO'
  )
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ requiresMembership: true, requiredPlanId: 'plan-gold' }), cliente({ planesVivos: ['plan-gold'] }), AHORA),
    null
  )
})

// ── 19 · Recompensa reclamada ───────────────────────────────────────────────

test('19 · el ciclo de la reclamación: reservar → reclamar → entregar', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_RECLAMACION, 'RESERVED', 'CLAIMED'))
  assert.ok(puedeTransicionar(TRANSICIONES_RECLAMACION, 'CLAIMED', 'DELIVERED'))
  // Si no se puede crear el beneficio, la reserva se cancela y los puntos vuelven.
  assert.ok(puedeTransicionar(TRANSICIONES_RECLAMACION, 'RESERVED', 'CANCELLED'))
  // Reservada NO salta a entregada: el beneficio tiene que existir primero.
  assert.ok(!puedeTransicionar(TRANSICIONES_RECLAMACION, 'RESERVED', 'DELIVERED'))
  // Entregada solo admite una reversa explícita.
  assert.deepEqual(TRANSICIONES_RECLAMACION.DELIVERED, ['REVERSED'])
  assert.deepEqual(TRANSICIONES_RECLAMACION.REVERSED, [])
})

test('19a · una reclamación en curso bloquea otra de la misma recompensa', () => {
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa(), cliente({ enCurso: 1 }), AHORA), 'YA_TIENE_UNA_EN_CURSO')
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ maxPerCustomer: 2 }), cliente({ reclamacionesPropias: 2 }), AHORA),
    'LIMITE_POR_CLIENTE'
  )
})

test('19b · recompensa inactiva, no vigente, vencida o agotada, cada una con su motivo', () => {
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ status: 'PAUSED' }), cliente(), AHORA), 'RECOMPENSA_INACTIVA')
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ status: 'EXPIRED' }), cliente(), AHORA), 'RECOMPENSA_VENCIDA')
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ status: 'EXHAUSTED' }), cliente(), AHORA), 'RECOMPENSA_AGOTADA')
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ startsAt: new Date('2027-01-01') }), cliente(), AHORA), 'RECOMPENSA_NO_VIGENTE')
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ endsAt: new Date('2026-01-02') }), cliente(), AHORA), 'RECOMPENSA_VENCIDA')
  assert.equal(motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ maxClaims: 3, timesClaimed: 3 }), cliente(), AHORA), 'RECOMPENSA_AGOTADA')
  assert.equal(motivoNoReclamable({ ...PROGRAMA_ACTIVO, status: 'CANCELLED' }, recompensa(), cliente(), AHORA), 'PROGRAMA_INACTIVO')
  for (const m of Object.values(MENSAJES_NO_RECLAMABLE)) assert.ok(m.length > 10)

  assert.equal(estadoRecompensaSegunUsos({ status: 'ACTIVE', maxClaims: 2, timesClaimed: 2, endsAt: null }), 'EXHAUSTED')
  assert.equal(estadoRecompensaSegunUsos({ status: 'ACTIVE', maxClaims: null, timesClaimed: 9, endsAt: new Date('2026-01-01') }, AHORA), 'EXPIRED')
})

test('19c · una recompensa que entrega algo necesita CON QUÉ entregarlo Y CON QUÉ pagarlo', () => {
  const base: DatosRecompensa = { name: 'Lavado gratis', kind: 'FREE_PRODUCT', pointsCost: 300, startsAt: new Date('2026-01-01') }
  // Una que regala un producto necesita la OFERTA con la que se entrega…
  assert.match(validarRecompensa(base)!, /necesita la oferta/)
  // …y además el BENEFICIO que la paga: es lo que el cliente usa en el
  // checkout de siempre. Sin él, reclamarla no daría nada y la persona habría
  // gastado sus puntos a cambio de aire.
  assert.match(validarRecompensa({ ...base, offerId: 'of-1' })!, /necesita el beneficio/)
  assert.equal(validarRecompensa({ ...base, offerId: 'of-1', benefitId: 'bn-1' }), null)

  assert.match(validarRecompensa({ ...base, kind: 'BENEFIT' })!, /necesita el beneficio/)
  assert.equal(validarRecompensa({ ...base, kind: 'BENEFIT', benefitId: 'bn-1' }), null)
  assert.match(validarRecompensa({ ...base, offerId: 'of-1', benefitId: 'bn-1', pointsCost: -1 })!, /no sea negativo/)
  assert.match(validarRecompensa({ ...base, offerId: 'of-1', benefitId: 'bn-1', requiredPlanId: 'p1' })!, /solo para miembros/)
})

// ── 20 · Reversa ────────────────────────────────────────────────────────────

test('20 · REVERSA: una recompensa YA USADA no devuelve puntos (§34)', () => {
  assert.ok(reversaDevuelvePuntos('RESERVED'), 'nada se usó: vuelven')
  assert.ok(reversaDevuelvePuntos('CLAIMED'), 'creada pero sin usar: vuelven')
  // Entregada = el beneficio ya se consumió. Devolver los puntos sería
  // regalarlo dos veces.
  assert.ok(!reversaDevuelvePuntos('DELIVERED'))
  assert.ok(!reversaDevuelvePuntos('EXPIRED'))
  assert.ok(!reversaDevuelvePuntos('REVERSED'))
  assert.ok(!reversaDevuelvePuntos('CANCELLED'))
})

// ── 21 · Presupuesto ────────────────────────────────────────────────────────

test('21 · la economía del programa SE LEE de sus recompensas: no hay segundo contador', () => {
  const e = economiaDelPrograma(10000, [
    { budgetTotal: d(6000), unitCost: d(200), pendientes: 2, entregadas: 5, costoEntregado: d(1000) },
    { budgetTotal: d(3000), unitCost: d(150), pendientes: 1, entregadas: 0, costoEntregado: d(0) },
  ])
  assert.equal(e.comprometido.toFixed(2), '9000.00')
  assert.equal(e.costoRealizado.toFixed(2), '1000.00', 'esto es dinero gastado')
  assert.equal(e.costoPendiente.toFixed(2), '550.00', '2×200 + 1×150, todavía no entregado')
  assert.equal(e.disponible!.toFixed(2), '8450.00')
  assert.equal(e.algunaRecompensaSinTope, false)
})

test('21a · el techo del programa manda sobre la suma de sus recompensas', () => {
  const e = economiaDelPrograma(1000, [{ budgetTotal: d(700), unitCost: d(10), pendientes: 0, entregadas: 0, costoEntregado: d(0) }])
  assert.match(cabeEnElPrograma(e, 500)!, /sumarían 1200\.00 y el presupuesto aprobado es 1000\.00/)
  assert.equal(cabeEnElPrograma(e, 300), null, 'justo cabe')
  assert.match(cabeEnElPrograma(e, null)!, /no pueden ir sin tope/)
  // Sin techo aprobado no hay nada que comprobar.
  assert.equal(cabeEnElPrograma(economiaDelPrograma(null, []), null), null)
  assert.ok(economiaDelPrograma(null, [{ budgetTotal: null, unitCost: null, pendientes: 0, entregadas: 0, costoEntregado: d(0) }]).algunaRecompensaSinTope)
})

test('21b · presupuesto agotado al reclamar', () => {
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ budgetTotal: d(1000), unitCost: d(200) }), cliente({ presupuestoUsado: d(900) }), AHORA),
    'PRESUPUESTO_AGOTADO'
  )
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ budgetTotal: d(1000), unitCost: d(200) }), cliente({ presupuestoUsado: d(800) }), AHORA),
    null
  )
})

test('21c · §37: una estimación NO se presenta como dinero adeudado', () => {
  const c = compromisoDePuntos({ emitidos: 10000, disponibles: 6000, usados: 3000, vencidos: 1000 }, 1500, '0.25')
  assert.equal(c.costoEfectivo.toFixed(2), '1500.00', 'esto sí se gastó')
  assert.equal(c.costoPotencialEstimado.toFixed(2), '1500.00', '6 000 puntos vivos × 0,25')
  assert.equal(c.esEstimacion, true, 'el propio tipo impide presentarlo como deuda')
  // Las cifras van separadas, no sumadas en una sola.
  assert.equal(c.puntosEmitidos, 10000)
  assert.equal(c.puntosDisponibles, 6000)
  assert.equal(c.puntosUsados, 3000)
  assert.equal(c.puntosVencidos, 1000)
  // Sin valor por punto no se inventa una cifra.
  assert.equal(compromisoDePuntos({ emitidos: 10, disponibles: 10, usados: 0, vencidos: 0 }, 0, 0).costoPotencialEstimado.toFixed(2), '0.00')
})

// ── 22 · Aislamiento multitenant ────────────────────────────────────────────

test('22 · los puntos de dos programas NO se mezclan', () => {
  // El saldo se calcula por cuenta, y una cuenta es (programa, cliente): los
  // movimientos de otro programa viven en otra cuenta y no entran en esta suma.
  const programaA = [{ availableDelta: 100, pendingDelta: 0, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 }]
  const programaB = [{ availableDelta: 700, pendingDelta: 0, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 }]
  assert.equal(saldoDeMovimientosPuntos(programaA).available, 100)
  assert.equal(saldoDeMovimientosPuntos(programaB).available, 700)
  // Y una recompensa del programa A no se paga con el saldo del B: quien
  // llama pasa el saldo de SU cuenta.
  assert.equal(
    motivoNoReclamable(PROGRAMA_ACTIVO, recompensa({ pointsCost: 500 }), cliente({ puntosDisponibles: 100 }), AHORA),
    'PUNTOS_INSUFICIENTES'
  )
})

// ── 23 · Idempotencia ───────────────────────────────────────────────────────

test('23 · repetir la misma operación no suma dos veces', () => {
  // Reconstruir el saldo es una función PURA de los movimientos: si un
  // webhook se ejecuta dos veces pero la clave de idempotencia impide el
  // segundo movimiento, el saldo no cambia. Lo que no puede pasar es que el
  // mismo movimiento cuente dos veces.
  const uno = [{ availableDelta: 10, pendingDelta: 0, reservedDelta: 0, redeemedDelta: 0, expiredDelta: 0 }]
  assert.equal(saldoDeMovimientosPuntos(uno).available, 10)
  const dos = [...uno, ...uno]
  assert.equal(saldoDeMovimientosPuntos(dos).available, 20, 'dos movimientos SÍ suman: por eso la clave tiene que impedir el segundo')
  // Y un referido ya concedido no vuelve a serlo, pase lo que pase.
  assert.equal(
    motivoReferidoNoElegible(PROGRAMA_ACTIVO, REGLAS, { ...REFERIDO, status: 'REWARD_GRANTED' }, COMPRA, USO, AHORA),
    'YA_RECOMPENSADO'
  )
})

// ── 24 · Permisos y ajustes administrativos ─────────────────────────────────

test('24 · un ajuste manual de puntos EXIGE motivo escrito y quién lo hace (§43)', () => {
  assert.equal(validarAjusteDePuntos({ puntos: 50, motivo: 'Compensación por el incidente del 12/06', actorId: 'u-1' }), null)
  assert.equal(validarAjusteDePuntos({ puntos: -50, motivo: 'Reverso del ajuste duplicado #881', actorId: 'u-1' }), null)
  assert.match(validarAjusteDePuntos({ puntos: 50, motivo: null, actorId: 'u-1' })!, /motivo escrito/)
  assert.match(validarAjusteDePuntos({ puntos: 50, motivo: 'ok', actorId: 'u-1' })!, /demasiado corto/)
  assert.match(validarAjusteDePuntos({ puntos: 50, motivo: 'Motivo bueno y largo', actorId: null })!, /quién lo hace/)
  assert.match(validarAjusteDePuntos({ puntos: 0, motivo: 'Motivo bueno y largo', actorId: 'u-1' })!, /distinto de cero/)
  assert.match(validarAjusteDePuntos({ puntos: 1.5, motivo: 'Motivo bueno y largo', actorId: 'u-1' })!, /entero/)
})

test('24a · todas las máquinas de estado tienen al menos un estado final', () => {
  const maquinas = {
    programa: TRANSICIONES_PROGRAMA,
    plan: TRANSICIONES_PLAN,
    membresia: TRANSICIONES_MEMBRESIA,
    referido: TRANSICIONES_REFERIDO,
    recompensa: TRANSICIONES_RECOMPENSA,
    reclamacion: TRANSICIONES_RECLAMACION,
  }
  for (const [nombre, tabla] of Object.entries(maquinas)) {
    const finales = Object.entries(tabla).filter(([, v]) => (v as readonly string[]).length === 0)
    assert.ok(finales.length > 0, `${nombre} no tiene estado final: algo se quedaría girando para siempre`)
    // Y ninguna transición apunta a un estado que no existe en la tabla.
    for (const [desde, hacia] of Object.entries(tabla)) {
      for (const h of hacia as readonly string[]) {
        assert.ok(h in tabla, `${nombre}: ${desde} apunta a ${h}, que no está declarado`)
      }
    }
  }
})
