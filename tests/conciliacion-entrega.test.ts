/**
 * La regla que separa «hay un cliente esperando» de «el registro quedó sin cerrar».
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMORA_SOSPECHOSA_MS,
  ENTREGA_EN_CURSO_MS,
  MARGEN_DE_ENTREGA_MS,
  MOTIVOS_DE_CIERRE,
  anteriorAlControlDeEntregas,
  describirDemora,
  diagnosticoDeEntrega,
  entregaEnCurso,
  entregaRequierePersona,
  esMotivoDeCierre,
  evidenciaDeEntrega,
  productoYaEntregado,
  situacionDeEntrega,
} from '../src/modules/observabilidad/conciliacion-entrega'

const cobro = new Date('2026-10-01T15:00:00Z')
const ahora = new Date('2026-10-16T15:00:00Z')
const despues = (ms: number) => new Date(cobro.getTime() + ms)
const vieja = new Date(ahora.getTime() - 3_600_000)

test('una membresía activada a partir del cobro es un producto entregado', () => {
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(10_000) }, compra: null }), true)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(3 * 3_600_000) }, compra: null }), true, 'aunque se activara horas después, por otra vía')
})

test('un pago ANTERIOR de la misma membresía no prueba que ESTE cobro se entregó', () => {
  const anterior = new Date(cobro.getTime() - 2 * MARGEN_DE_ENTREGA_MS)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: anterior }, compra: null }), false)
})

test('sin pago confirmado, sin fecha o sin fecha del cobro no hay nada demostrado', () => {
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: false, fechaPago: despues(1000) }, compra: null }), false)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: null }, compra: null }), false)
  assert.equal(productoYaEntregado({ activadoAt: null, membership: { pagoConfirmado: true, fechaPago: despues(1000) }, compra: null }), false)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: null, compra: null }), false)
})

test('una compra de promoción activada a partir del cobro también cuenta', () => {
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: null, compra: { pagoConfirmado: true, fechaActivacion: despues(20_000) } }), true)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: null, compra: { pagoConfirmado: true, fechaActivacion: null } }), false)
})

test('una entrega recién empezada no es un fallo; una vieja o una FALLIDA sí se revisan', () => {
  const reciente = new Date(ahora.getTime() - ENTREGA_EN_CURSO_MS + 5_000)
  assert.equal(entregaEnCurso('PENDIENTE', reciente, ahora), true)
  assert.equal(entregaEnCurso('PROCESANDO', reciente, ahora), true)
  assert.equal(entregaEnCurso('PENDIENTE', vieja, ahora), false)
  assert.equal(entregaEnCurso('FALLIDA', reciente, ahora), false, 'una entrega que ya falló nunca está «en curso»')
})

test('la situación decide la acción: esperando → reintentar; registro sin cerrar → marcar; en curso/entregada → nada', () => {
  const sinProducto = { activadoAt: cobro, membership: { pagoConfirmado: false, fechaPago: null }, compra: null }
  const conProducto = { activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(5_000) }, compra: null }
  assert.equal(situacionDeEntrega({ ...sinProducto, estado: 'FALLIDA', actualizadoAt: vieja }, ahora), 'CLIENTE_ESPERANDO')
  assert.equal(situacionDeEntrega({ ...sinProducto, estado: 'PROCESANDO', actualizadoAt: vieja }, ahora), 'CLIENTE_ESPERANDO', 'PROCESANDO atascado: antes era invisible')
  assert.equal(situacionDeEntrega({ ...conProducto, estado: 'PENDIENTE', actualizadoAt: vieja }, ahora), 'REGISTRO_SIN_CERRAR')
  assert.equal(situacionDeEntrega({ ...sinProducto, estado: 'PENDIENTE', actualizadoAt: new Date(ahora.getTime() - 1000) }, ahora), 'EN_CURSO')
  assert.equal(situacionDeEntrega({ ...conProducto, estado: 'COMPLETADA', actualizadoAt: vieja }, ahora), 'ENTREGADA')
})

test('la evidencia dice qué activación se usó y cuánto tardó tras el cobro', () => {
  const m = { pagoConfirmado: true, fechaPago: despues(3 * 3_600_000) }
  assert.deepEqual(evidenciaDeEntrega({ activadoAt: cobro, membership: m, compra: null }), { fuente: 'MEMBRESIA', fecha: m.fechaPago, demoraMs: 3 * 3_600_000 })
  const c = { pagoConfirmado: true, fechaActivacion: despues(5_000) }
  assert.deepEqual(evidenciaDeEntrega({ activadoAt: cobro, membership: null, compra: c }), { fuente: 'COMPRA', fecha: c.fechaActivacion, demoraMs: 5_000 })
  assert.equal(
    evidenciaDeEntrega({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(-2 * MARGEN_DE_ENTREGA_MS) }, compra: null }),
    null,
    'sin evidencia no hay nada que describir'
  )
})

test('la demora se lee en palabras y la sospechosa empieza en un día', () => {
  assert.equal(describirDemora(5_000), 'unos segundos')
  assert.equal(describirDemora(60_000), '1 minuto')
  assert.equal(describirDemora(12 * 60_000), '12 minutos')
  assert.equal(describirDemora(3_600_000), '1 hora')
  assert.equal(describirDemora(2 * 3_600_000), '2 horas')
  assert.equal(describirDemora(3 * 86_400_000), '3 días')
  assert.equal(describirDemora(-5_000), 'unos segundos', 'dentro del margen de reloj no hay demora negativa')
  assert.equal(DEMORA_SOSPECHOSA_MS, 24 * 3_600_000)
})

test('un cambio de plan pagado necesita a una persona; una renovación automática no, aunque tenga un cambio pedido', () => {
  const cambio = { estado: 'ACTIVA', planIdSolicitado: 'plan-nuevo' }
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: cambio }), true)
  assert.equal(entregaRequierePersona({ canal: null, membership: cambio }), true)
  assert.equal(entregaRequierePersona({ canal: 'RENOVACION_AUTOMATICA', membership: cambio }), false, 'la renovación se entrega extendiendo')
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: { estado: 'ACTIVA', planIdSolicitado: null } }), false)
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: { estado: 'PENDIENTE', planIdSolicitado: 'plan-nuevo' } }), false, 'una activación normal sí se reintenta')
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: null }), false)
})

// ── El caso real de oct-2026: cobros de agosto, anteriores a la columna de cumplimiento ─────────────────────────────

test('una membresía que se activó con el cobro y HOY está pendiente no es un cliente esperando: la bitácora lo prueba', () => {
  // Activada con el cobro, vencida en septiembre y vuelta a pedir: `pagoConfirmado` es false aunque el cobro se entregó.
  const membresiaDeHoy = { pagoConfirmado: false, fechaPago: despues(200) }
  const sinBitacora = { activadoAt: cobro, membership: membresiaDeHoy, compra: null }
  assert.equal(situacionDeEntrega({ ...sinBitacora, estado: 'PENDIENTE', actualizadoAt: cobro }, ahora), 'CLIENTE_ESPERANDO', 'sin bitácora parecía esperando (y reintentar regalaba un periodo)')
  const conBitacora = { ...sinBitacora, activacionRegistrada: despues(430) }
  assert.equal(situacionDeEntrega({ ...conBitacora, estado: 'PENDIENTE', actualizadoAt: cobro }, ahora), 'REGISTRO_SIN_CERRAR')
  assert.deepEqual(evidenciaDeEntrega(conBitacora), { fuente: 'BITACORA', fecha: despues(430), demoraMs: 430 })
})

test('una activación anotada ANTES del cobro no prueba nada', () => {
  const e = { activadoAt: cobro, membership: null, compra: null, activacionRegistrada: despues(-2 * MARGEN_DE_ENTREGA_MS) }
  assert.equal(productoYaEntregado(e), false)
})

test('producto borrado: sin bitácora no hay nada que entregar (SIN_PRODUCTO); con bitácora, solo falta cerrar el registro', () => {
  const huerfano = { activadoAt: cobro, membership: null, compra: null }
  assert.equal(situacionDeEntrega({ ...huerfano, estado: 'PENDIENTE', actualizadoAt: cobro }, ahora), 'SIN_PRODUCTO')
  assert.equal(situacionDeEntrega({ ...huerfano, estado: 'FALLIDA', actualizadoAt: vieja }, ahora), 'SIN_PRODUCTO', 'reintentar nunca podría funcionar')
  assert.equal(
    situacionDeEntrega({ ...huerfano, activacionRegistrada: despues(300), estado: 'PENDIENTE', actualizadoAt: cobro }, ahora),
    'REGISTRO_SIN_CERRAR'
  )
})

test('un cobro cerrado sin entregar ya no vuelve a la conciliación ni se reintenta', () => {
  const huerfano = { activadoAt: cobro, membership: null, compra: null }
  assert.equal(situacionDeEntrega({ ...huerfano, estado: 'DESCARTADA', actualizadoAt: vieja }, ahora), 'DESCARTADA')
})

test('anterior al control de entregas = PENDIENTE sin intentos y sin error; lo de hoy siempre pasa por PROCESANDO', () => {
  assert.equal(anteriorAlControlDeEntregas({ estado: 'PENDIENTE', intentos: 0, error: null }), true)
  assert.equal(anteriorAlControlDeEntregas({ estado: 'PENDIENTE', intentos: 1, error: null }), false)
  assert.equal(anteriorAlControlDeEntregas({ estado: 'FALLIDA', intentos: 0, error: 'x' }), false)
})

test('el diagnóstico dice por qué está aquí y qué hacer, sin abrir la base de datos', () => {
  const antiguoEntregado = diagnosticoDeEntrega({
    situacion: 'REGISTRO_SIN_CERRAR',
    estado: 'PENDIENTE',
    error: null,
    intentos: 0,
    evidencia: { fuente: 'BITACORA', fecha: despues(400), demoraMs: 400 },
    productoEliminado: true,
  })
  assert.match(antiguoEntregado, /anterior al control de entregas/)
  assert.match(antiguoEntregado, /bitácora registra la activación del producto unos segundos después/)
  assert.match(antiguoEntregado, /se eliminó después/)

  const sinProducto = diagnosticoDeEntrega({ situacion: 'SIN_PRODUCTO', estado: 'PENDIENTE', error: null, intentos: 0, evidencia: null, productoEliminado: true })
  assert.match(sinProducto, /reintentar no puede funcionar/)
  assert.match(sinProducto, /Cerrar sin entregar/)

  const fallida = diagnosticoDeEntrega({ situacion: 'CLIENTE_ESPERANDO', estado: 'FALLIDA', error: 'Plan inactivo', intentos: 2, evidencia: null, productoEliminado: false })
  assert.match(fallida, /La entrega falló \(2 intentos\): Plan inactivo\./)
  assert.match(fallida, /el cliente pagó y no lo tiene/)
})

test('los motivos para cerrar sin entregar son una lista cerrada', () => {
  assert.ok(MOTIVOS_DE_CIERRE.length >= 3)
  for (const m of MOTIVOS_DE_CIERRE) assert.equal(esMotivoDeCierre(m.codigo), true)
  assert.equal(esMotivoDeCierre('CUALQUIERA'), false)
  assert.equal(esMotivoDeCierre(undefined), false)
})

test('un cambio de plan cuyo cobro recuerda el plan pedido se entrega solo; si el pedido cambió o el cobro es viejo, lo decide una persona', () => {
  const pide = (planIdSolicitado: string | null) => ({ estado: 'ACTIVA', planIdSolicitado })
  assert.equal(entregaRequierePersona({ canal: 'APP', planDestinoId: 'plan-b', membership: pide('plan-b') }), false, 'el cobro respalda el pedido: se aplica solo')
  assert.equal(entregaRequierePersona({ canal: 'WEB', planDestinoId: 'plan-b', membership: pide('plan-c') }), true, 'el cliente cambió su pedido después de pagar')
  assert.equal(entregaRequierePersona({ canal: 'APP', planDestinoId: null, membership: pide('plan-b') }), true, 'cobro anterior a que se guardara el plan')
  assert.equal(entregaRequierePersona({ canal: 'APP', planDestinoId: 'plan-b', membership: pide(null) }), false, 'sin pedido ya no hay cambio que aplicar a mano')
})
