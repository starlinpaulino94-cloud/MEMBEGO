import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AVISOS,
  AVISO_DEL_DISPARADOR,
  DISPARADORES,
  ETIQUETA_ENTREGA,
  POR_DEFECTO,
  canalesEfectivos,
  claveDeAutomatizacion,
  claveDeAviso,
  conPorDefecto,
  definicionDeAviso,
  diasDeAviso,
  estadoDeEntrega,
  periodoDelDia,
  puedeMandarse,
} from '../src/modules/supply-v2/notifications/dominio'
import { valeLaPenaReintentar, LIMITACION_DE_IDEMPOTENCIA } from '../src/modules/supply-v2/notifications/correo'
import { estadoDeWhatsapp, whatsappDePlataformaDisponible } from '../src/modules/supply-v2/notifications/whatsapp'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · PRUEBAS DE DOMINIO.
 *
 * Todo esto es puro: no hay base de datos ni red. Lo que se prueba es la
 * POLÍTICA de los avisos, que es donde están las decisiones que importan y
 * donde un error no se ve hasta que alguien recibe —o no recibe— algo.
 *
 * `npm test`.
 */

// ── §3 · las tres clases no se mezclan ──────────────────────────────────────

test('el consentimiento de marketing NO apaga un aviso transaccional', () => {
  const pago = definicionDeAviso('supply.notify.order_paid')!
  // Alguien que se dio de baja de las promociones por correo.
  const prefs = { emailMarketing: false, emailTransactional: true }
  assert.equal(puedeMandarse(pago, 'EMAIL', prefs), true, 'su compra confirmada tiene que llegarle igual')
})

test('apagar el correo transaccional SÍ apaga un aviso transaccional', () => {
  const pago = definicionDeAviso('supply.notify.order_paid')!
  assert.equal(puedeMandarse(pago, 'EMAIL', { emailTransactional: false }), false)
})

test('lo operativo no pregunta por preferencias personales', () => {
  const incidente = definicionDeAviso('supply.notify.ops_incident_high')!
  // Aunque la persona lo tenga todo apagado: no se da de baja de los avisos
  // del sistema que opera.
  const todoApagado = {
    inApp: false,
    emailTransactional: false,
    emailMarketing: false,
    whatsappTransactional: false,
    whatsappMarketing: false,
  }
  assert.equal(puedeMandarse(incidente, 'EMAIL', todoApagado), true)
  assert.equal(puedeMandarse(incidente, 'IN_APP', todoApagado), true)
})

test('un aviso no sale por un canal que su definición no declara', () => {
  const pago = definicionDeAviso('supply.notify.order_paid')!
  assert.equal(pago.canales.includes('WHATSAPP'), false)
  assert.equal(puedeMandarse(pago, 'WHATSAPP', { whatsappTransactional: true }), false)
})

// ── §9 · preferencias y valores por defecto ─────────────────────────────────

test('lo promocional está APAGADO por defecto y lo transaccional encendido', () => {
  assert.equal(POR_DEFECTO.emailMarketing, false, 'un consentimiento que nadie dio no es un consentimiento')
  assert.equal(POR_DEFECTO.whatsappMarketing, false)
  assert.equal(POR_DEFECTO.emailTransactional, true)
  assert.equal(POR_DEFECTO.inApp, true)
})

test('un nulo es «no lo ha tocado», no «apagado»', () => {
  assert.deepEqual(conPorDefecto(null), POR_DEFECTO)
  assert.deepEqual(conPorDefecto({}), POR_DEFECTO)
  // Y lo que sí tocó, manda.
  assert.equal(conPorDefecto({ emailTransactional: false }).emailTransactional, false)
  assert.equal(conPorDefecto({ emailTransactional: false }).inApp, true)
})

test('los canales efectivos de un aviso salen de su definición y de la preferencia', () => {
  const pago = definicionDeAviso('supply.notify.order_paid')!
  assert.deepEqual(canalesEfectivos(pago, null), ['IN_APP', 'EMAIL'])
  assert.deepEqual(canalesEfectivos(pago, { emailTransactional: false }), ['IN_APP'])
  assert.deepEqual(canalesEfectivos(pago, { inApp: false, emailTransactional: false }), [])
})

// ── §7 · estados de entrega ─────────────────────────────────────────────────

test('los estados del outbox se traducen al vocabulario de entrega', () => {
  assert.equal(estadoDeEntrega('PENDING'), 'QUEUED')
  assert.equal(estadoDeEntrega('PROCESSING'), 'SENDING')
  assert.equal(estadoDeEntrega('DELIVERED'), 'SENT')
  assert.equal(estadoDeEntrega('FAILED'), 'FAILED')
  assert.equal(estadoDeEntrega('DEAD_LETTER'), 'DEAD_LETTER')
})

test('no existe DELIVERED: el proveedor solo confirma que lo ACEPTÓ', () => {
  // §7 lo prohíbe y el motivo es que el correo puede rebotar después. El techo
  // honesto es SENT, y la etiqueta que ve una persona lo dice con palabras.
  const estados = Object.keys(ETIQUETA_ENTREGA)
  assert.equal(estados.includes('DELIVERED'), false)
  assert.match(ETIQUETA_ENTREGA.SENT, /acept/i)
})

test('la limitación de idempotencia del correo está escrita, no supuesta', () => {
  assert.match(LIMITACION_DE_IDEMPOTENCIA, /idempotencia/i)
  assert.match(LIMITACION_DE_IDEMPOTENCIA, /repetir/i)
})

// ── §6, §12 · identidad estable ─────────────────────────────────────────────

test('la clave de un aviso lleva tipo, canal, persona y agregado, y nunca un correo', () => {
  const k = claveDeAviso({
    aviso: 'supply.notify.order_paid',
    canal: 'EMAIL',
    userId: 'usr_1',
    agregadoId: 'ord_1',
    eventoId: 'evt_1',
  })
  assert.equal(k, 'supply.notify.order_paid:EMAIL:usr_1:ord_1:evt_1')
  assert.equal(k.includes('@'), false, 'una clave se ve en el panel: no lleva direcciones')
})

test('el mismo aviso por dos canales son dos claves distintas', () => {
  const base = { aviso: 'supply.notify.order_paid', userId: 'usr_1', agregadoId: 'ord_1' }
  const a = claveDeAviso({ ...base, canal: 'IN_APP' })
  const b = claveDeAviso({ ...base, canal: 'EMAIL' })
  assert.notEqual(a, b, 'si no, un canal bloquearía al otro por el índice único')
})

test('una automatización del mismo día produce la MISMA clave', () => {
  const dia = new Date('2026-10-03T23:59:00.000Z')
  const otraHora = new Date('2026-10-03T00:01:00.000Z')
  const k1 = claveDeAutomatizacion({ regla: 'MEMBERSHIP_EXPIRING', sujetoId: 'mem_1', periodo: periodoDelDia(dia) })
  const k2 = claveDeAutomatizacion({ regla: 'MEMBERSHIP_EXPIRING', sujetoId: 'mem_1', periodo: periodoDelDia(otraHora) })
  assert.equal(k1, k2, 'dos pasadas del cron el mismo día son UNA acción')
  assert.equal(k1, 'auto:MEMBERSHIP_EXPIRING:mem_1:2026-10-03')
})

test('al día siguiente la clave cambia: el aviso puede repetirse cuando toca', () => {
  const hoy = periodoDelDia(new Date('2026-10-03T10:00:00.000Z'))
  const manana = periodoDelDia(new Date('2026-10-04T10:00:00.000Z'))
  assert.notEqual(
    claveDeAutomatizacion({ regla: 'BENEFIT_EXPIRING', sujetoId: 's', periodo: hoy }),
    claveDeAutomatizacion({ regla: 'BENEFIT_EXPIRING', sujetoId: 's', periodo: manana })
  )
})

// ── §11 · disparadores ──────────────────────────────────────────────────────

test('cada disparador encendido tiene su aviso, y el aviso existe', () => {
  for (const d of DISPARADORES) {
    const clave = AVISO_DEL_DISPARADOR[d]
    assert.ok(clave, `el disparador ${d} no tiene aviso`)
    assert.ok(definicionDeAviso(clave), `el aviso ${clave} del disparador ${d} no está definido`)
  }
})

test('todo aviso declarado tiene clase, destinatario y al menos un canal', () => {
  for (const [clave, a] of Object.entries(AVISOS)) {
    assert.equal(a.clave, clave, 'la clave del mapa y la del aviso tienen que coincidir')
    assert.ok(['TRANSACTIONAL', 'OPERATIONAL', 'MARKETING'].includes(a.clase), clave)
    assert.ok(['CLIENTE', 'PROVEEDOR', 'OPERACIONES'].includes(a.destinatario), clave)
    assert.ok(a.canales.length > 0, clave)
    assert.ok(a.etiqueta.length > 3, clave)
  }
})

test('ningún aviso a un cliente o proveedor es OPERATIONAL, y ninguno de operaciones es de cliente', () => {
  for (const a of Object.values(AVISOS)) {
    if (a.destinatario === 'OPERACIONES') assert.equal(a.clase, 'OPERATIONAL', a.clave)
    else assert.notEqual(a.clase, 'OPERATIONAL', a.clave)
  }
})

// ── §14 · umbrales configurables con valor por defecto ──────────────────────

test('los días de aviso son configurables y un valor absurdo no ciega el sistema', () => {
  const VAR = 'SUPPLY_V2_TEST_DIAS_AVISO'
  delete process.env[VAR]
  assert.equal(diasDeAviso(VAR, 7), 7, 'sin variable manda el valor por defecto')
  process.env[VAR] = '3'
  assert.equal(diasDeAviso(VAR, 7), 3)
  for (const absurdo of ['0', '-1', '999', 'siete', '', '2.5']) {
    process.env[VAR] = absurdo
    assert.equal(diasDeAviso(VAR, 7), 7, `«${absurdo}» tiene que caer al valor por defecto`)
  }
  delete process.env[VAR]
})

// ── §24 · qué fallo del proveedor se reintenta ──────────────────────────────

test('5xx y los cortes de red se reintentan; un 4xx no', () => {
  assert.equal(valeLaPenaReintentar(500), true)
  assert.equal(valeLaPenaReintentar(503), true)
  assert.equal(valeLaPenaReintentar(undefined), true, 'sin respuesta es un corte de red')
  assert.equal(valeLaPenaReintentar(429), true, 'límite de ritmo: se reintenta más tarde')
  assert.equal(valeLaPenaReintentar(408), true)
  assert.equal(valeLaPenaReintentar(422), false, 'un cuerpo mal formado no se arregla esperando')
  assert.equal(valeLaPenaReintentar(400), false)
  assert.equal(valeLaPenaReintentar(401), false)
})

// ── §8, §26 · WhatsApp no se finge ──────────────────────────────────────────

test('WhatsApp de plataforma está NOT_CONFIGURED y dice qué falta', () => {
  delete process.env.SUPPLY_V2_WHATSAPP_PHONE_ID
  delete process.env.SUPPLY_V2_WHATSAPP_TOKEN
  const s = estadoDeWhatsapp()
  assert.equal(s.estado, 'NOT_CONFIGURED')
  assert.equal(whatsappDePlataformaDisponible(), false)
  assert.match(s.motivo, /plataforma/i)
  assert.match(s.remedio, /SUPPLY_V2_WHATSAPP_PHONE_ID/)
  // Y dice explícitamente que las credenciales por empresa no sirven: mandar
  // en nombre de un comercio algo que el comercio no dijo es otro problema.
  assert.match(s.remedio, /empresa/i)
})

test('con credencial pero sin plantillas aprobadas sigue siendo NOT_CONFIGURED', () => {
  process.env.SUPPLY_V2_WHATSAPP_PHONE_ID = '123456'
  process.env.SUPPLY_V2_WHATSAPP_TOKEN = 'token-de-prueba-no-real'
  const s = estadoDeWhatsapp()
  assert.equal(s.estado, 'NOT_CONFIGURED', 'tener la credencial no alcanza: Meta exige plantilla aprobada')
  assert.match(s.motivo, /plantilla/i)
  delete process.env.SUPPLY_V2_WHATSAPP_PHONE_ID
  delete process.env.SUPPLY_V2_WHATSAPP_TOKEN
})
