/**
 * RENOVACIÓN AUTOMÁTICA · rechazos, reintentos, cobros dudosos y avisos, fijados contra PostgreSQL real.
 *
 * La pasarela se simula con `fetch` (como en el resto de las pruebas de pagos): aprueba, rechaza con un código del banco,
 * se corta sin responder, falla con un 500, o ni procesa la petición (401). Cada prueba falla si vuelve el defecto que
 * cierra:
 *
 *   1 · un cobro que se cayó SIN RESPUESTA se guardaba como «rechazado» y al día siguiente se volvía a cobrar: si el
 *       primero sí había salido, el cliente pagaba dos veces. Ahora es un cobro DUDOSO: no se repite solo;
 *   2 · un rechazo real avisa al cliente, se reintenta hasta el tope y entonces apaga la renovación (conservando la
 *       tarjeta y retirando el consentimiento);
 *   3 · un segundo cron que llega DESPUÉS de que el primero renovó no vuelve a cobrar;
 *   4 · quien aceptó un texto que promete aviso no se cobra sin aviso;
 *   5 · una tarjeta vencida no genera un solo intento.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import {
  ejecutarRenovacionesTarjeta,
  renovarMembresiaPorTarjeta,
} from '../../src/modules/pagos/cardnetTokenGuardado'
import { ejecutarAvisosDeRenovacion } from '../../src/modules/pagos/avisosRenovacion'
import { TEXTO_VERSION_RENOVACION } from '../../src/modules/pagos/consentimientosCore'
import { reintentarEntrega } from '../../src/modules/pagos/intentos'
import { conciliar } from '../../src/modules/observabilidad/conciliacion'
import { leerMetricas } from '../../src/modules/observabilidad/metricas'
import { ejecutarAutomatizacionesEmpresa } from '../../src/modules/admin/automatizaciones'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 500
const H = 3_600_000
const DIA = 24 * H
const hace = (ms: number) => new Date(Date.now() - ms)
const adelante = (ms: number) => new Date(Date.now() + ms)

// ── La pasarela simulada ────────────────────────────────────────────────────

type Modo = 'aprobar' | 'rechazar' | 'sin-respuesta' | 'http500' | 'http401'
const pasarela = { modo: 'aprobar' as Modo, codigo: '51', llamadas: 0 }
const reiniciar = () => Object.assign(pasarela, { modo: 'aprobar', codigo: '51', llamadas: 0 })

let fetchOriginal: typeof fetch
const anterior = {
  pub: process.env.CARDNET_TOKENS_PUBLIC_KEY,
  priv: process.env.CARDNET_TOKENS_PRIVATE_KEY,
  base: process.env.CARDNET_TOKENS_API_BASE,
}
before(() => {
  fetchOriginal = globalThis.fetch
  // Claves de PRUEBA (sintéticas): solo para que la renovación considere configurada la pasarela. No salen a la red.
  process.env.CARDNET_TOKENS_PUBLIC_KEY = 'prueba-prueba-prueba'
  process.env.CARDNET_TOKENS_PRIVATE_KEY = 'prueba-prueba-prueba'
  // UN solo host: con la lista de laboratorio, un corte sin respuesta reintenta en el segundo host y duplica las llamadas.
  process.env.CARDNET_TOKENS_API_BASE = 'https://cardnet.prueba.test/api'
  globalThis.fetch = (async () => {
    pasarela.llamadas++
    const json = (estado: number, cuerpo: unknown) =>
      new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
    switch (pasarela.modo) {
      case 'sin-respuesta':
        throw new TypeError('fetch failed')
      case 'http500':
        return json(500, { Errors: [{ ErrorCode: 'X', Message: 'error interno' }] })
      case 'http401':
        return json(401, { status: 401, error: 'Acceso denegado' })
      case 'rechazar':
        return json(200, { Response: { Transaction: { ResponseCode: pasarela.codigo, ResponseMessage: 'DECLINED' } }, Errors: [] })
      default:
        return json(200, { Response: { Transaction: { TransactionStatusId: 1, ResponseCode: '00', AuthorizationCode: `AUTH-${pasarela.llamadas}` } }, Errors: [] })
    }
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = fetchOriginal
  for (const [clave, valor] of [
    ['CARDNET_TOKENS_PUBLIC_KEY', anterior.pub],
    ['CARDNET_TOKENS_PRIVATE_KEY', anterior.priv],
    ['CARDNET_TOKENS_API_BASE', anterior.base],
  ] as const) {
    if (valor === undefined) delete process.env[clave]
    else process.env[clave] = valor
  }
})

// ── Fixtures ────────────────────────────────────────────────────────────────

async function empresa(etiqueta: string, o: { conCobro?: boolean; vigenciaDias?: number } = {}) {
  const c = await prisma.company.create({
    data: {
      name: `Renovacion ${etiqueta} ${sufijo}`,
      slug: `renovacion-${etiqueta}-${sufijo}`,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      ...(o.conCobro === false ? {} : { capacidades: { overrides: { PAGO_CARDNET: true } } }),
    },
    select: { id: true },
  })
  const plan = await prisma.plan.create({
    data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: o.vigenciaDias ?? 30, lavadosIncluidos: 4 },
    select: { id: true },
  })
  return { companyId: c.id, planId: plan.id }
}
type Empresa = Awaited<ReturnType<typeof empresa>>

let n = 0
/** Un cliente CON cuenta, su tarjeta guardada, su membresía por vencer y el consentimiento de renovar. */
async function renovable(
  e: Empresa,
  nombre: string,
  o: {
    venceEnMs?: number
    /** Texto del consentimiento: sin él, uno HEREDADO (no promete aviso). */
    texto?: string
    cuenta?: boolean
    venc?: { vencMes: number; vencAnio: number }
  } = {}
) {
  const k = n++
  const cliente = await prisma.cliente.create({
    data: { companyId: e.companyId, supabaseId: `sb-rn-${sufijo}-${k}`, nombre, email: `rn-${sufijo}-${k}@prueba.test` },
    select: { id: true, supabaseId: true },
  })
  if (o.cuenta !== false) {
    await prisma.user.create({
      data: { supabaseId: cliente.supabaseId, email: `u-rn-${sufijo}-${k}@prueba.test`, name: nombre, companyId: e.companyId },
    })
  }
  const tarjeta = await prisma.tarjetaTokenizada.create({
    data: {
      companyId: e.companyId,
      clienteId: cliente.id,
      customerId: `cust-rn-${sufijo}-${k}`,
      paymentProfileId: `pp-rn-${sufijo}-${k}`,
      token: 'CT__sintetico',
      marca: 'VISA',
      ultimos4: '4242',
      activa: true,
      ...(o.venc ?? {}),
    },
    select: { id: true },
  })
  const m = await prisma.membership.create({
    data: {
      companyId: e.companyId,
      clienteId: cliente.id,
      planId: e.planId,
      estado: 'ACTIVA',
      pagoConfirmado: true,
      montoPagado: PRECIO,
      fechaPago: hace(29 * DIA),
      fechaInicio: hace(29 * DIA),
      fechaVencimiento: adelante(o.venceEnMs ?? 30 * H),
      autoRenovar: true,
      tarjetaTokenizadaId: tarjeta.id,
    },
    select: { id: true },
  })
  await prisma.consentimientoPago.create({
    data: {
      companyId: e.companyId,
      clienteId: cliente.id,
      tipo: 'RENOVACION_AUTOMATICA',
      tarjetaId: tarjeta.id,
      membershipId: m.id,
      origen: o.texto ? 'CLIENTE' : 'HEREDADO',
      textoVersion: o.texto ?? 'previo-a-registro',
    },
  })
  return { clienteId: cliente.id, supabaseId: cliente.supabaseId, membershipId: m.id, tarjetaId: tarjeta.id }
}

const renovar = (c: { membershipId: string }) => renovarMembresiaPorTarjeta(c.membershipId, '127.0.0.1')
const intentosDe = (c: { membershipId: string }) =>
  prisma.pagoIntento.findMany({ where: { membershipId: c.membershipId }, orderBy: { createdAt: 'asc' } })
const asientosDe = (c: { membershipId: string }) =>
  prisma.auditLog.findMany({ where: { entidadId: c.membershipId, accion: 'PAGO_RECHAZADO' }, orderBy: { createdAt: 'asc' } })
const membresiaDe = (c: { membershipId: string }) => prisma.membership.findUniqueOrThrow({ where: { id: c.membershipId } })
const vigentes = (c: { membershipId: string }) =>
  prisma.consentimientoPago.count({ where: { membershipId: c.membershipId, tipo: 'RENOVACION_AUTOMATICA', revocadoAt: null } })
const clasif = (i: { respuesta: unknown }) => ((i.respuesta ?? {}) as Record<string, unknown>)._clasificacion
const carga = (a: { payload: unknown }) => (a.payload ?? {}) as Record<string, unknown>
async function avisosDe(c: { supabaseId: string }) {
  const u = await prisma.user.findUnique({ where: { supabaseId: c.supabaseId } })
  return u ? prisma.notificacion.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } }) : []
}
/** Hace pasar el tiempo para los intentos de una membresía: los atrasa `horas`. */
async function envejecer(c: { membershipId: string }, horas: number) {
  for (const i of await intentosDe(c)) {
    await prisma.pagoIntento.update({ where: { id: i.id }, data: { createdAt: new Date(i.createdAt.getTime() - horas * H) } })
  }
}

// ── Un rechazo real: se reintenta hasta el tope y entonces se apaga ─────────

test('1 · un rechazo real avisa y se reintenta; al tercero se apaga la renovación y la tarjeta se CONSERVA', async () => {
  reiniciar()
  const e = await empresa('uno')
  const c = await renovable(e, 'Hector')
  pasarela.modo = 'rechazar'
  pasarela.codigo = '51'

  const r1 = await renovar(c)
  assert.deepEqual([r1.estado, 'desactivada' in r1 && r1.desactivada, 'motivo' in r1 && r1.motivo], ['rechazada', false, 'Fondos insuficientes.'])
  const [i1] = await intentosDe(c)
  assert.deepEqual([i1.estado, i1.motivoRechazo, i1.canal], ['RECHAZADO', 'Fondos insuficientes.', 'RENOVACION_AUTOMATICA'])
  assert.equal(clasif(i1), 'rechazo')
  const a1 = await asientosDe(c)
  assert.equal(a1.length, 1)
  assert.deepEqual([carga(a1[0]).rechazo, carga(a1[0]).maximo, carga(a1[0]).resultado, carga(a1[0]).codigo], [1, 3, 'se_reintentara', '51'])
  assert.equal((await membresiaDe(c)).autoRenovar, true)
  let avisos = await avisosDe(c)
  assert.equal(avisos.length, 1)
  assert.equal(avisos[0].tipo, 'PAGO_RECHAZADO')
  assert.match(avisos[0].mensaje, /Volveremos a intentarlo/)
  assert.match(avisos[0].mensaje, /No se hizo ningún cargo/)
  assert.equal(avisos[0].dedupeKey, `renovacion-rechazo:${i1.id}`)

  // El mismo día no se vuelve a intentar.
  const mismoDia = await renovar(c)
  assert.deepEqual([mismoDia.estado, 'razon' in mismoDia && mismoDia.razon], ['omitida', 'reciente'])
  assert.equal(pasarela.llamadas, 1)

  await envejecer(c, 25)
  const r2 = await renovar(c)
  assert.deepEqual([r2.estado, 'desactivada' in r2 && r2.desactivada], ['rechazada', false])
  await envejecer(c, 24)
  const r3 = await renovar(c)
  assert.deepEqual([r3.estado, 'desactivada' in r3 && r3.desactivada], ['rechazada', true])

  const m = await membresiaDe(c)
  const tarjeta = await prisma.tarjetaTokenizada.findUniqueOrThrow({ where: { id: c.tarjetaId } })
  assert.equal(m.autoRenovar, false)
  assert.equal(m.tarjetaTokenizadaId, c.tarjetaId, 'la tarjeta sigue vinculada')
  assert.equal(tarjeta.activa, true, 'la tarjeta se conserva')
  assert.equal(m.canceladaAlVencimiento, null, 'no es una cancelación del cliente')
  assert.equal(await vigentes(c), 0, 'el consentimiento de renovar queda retirado…')
  assert.equal(await prisma.consentimientoPago.count({ where: { membershipId: c.membershipId } }), 1, '…y NO borrado')
  const asientos = await asientosDe(c)
  assert.equal(asientos.length, 3)
  assert.deepEqual([carga(asientos[2]).resultado, carga(asientos[2]).causa, carga(asientos[2]).rechazo], ['renovacion_desactivada', 'agotado', 3])
  avisos = await avisosDe(c)
  assert.equal(avisos.length, 3)
  assert.equal(new Set(avisos.map((a) => a.dedupeKey)).size, 3, 'un aviso por intento')
  assert.match(avisos[2].titulo, /Desactivamos/)
  assert.doesNotMatch(avisos[2].mensaje, /Volveremos/, 'el aviso de cierre NO promete otro intento')

  const antes = pasarela.llamadas
  const despues = await renovar(c)
  assert.equal(despues.estado, 'omitida')
  assert.equal(pasarela.llamadas, antes, 'apagada, no se vuelve a cobrar')
  assert.equal(antes, 3, 'CardNET recibió 3 intentos, ni uno más')
})

test('2 · un rechazo definitivo (tarjeta vencida según el banco) apaga la renovación en el PRIMER intento', async () => {
  reiniciar()
  const e = await empresa('dos')
  const c = await renovable(e, 'Ines')
  pasarela.modo = 'rechazar'
  pasarela.codigo = '54'
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'desactivada' in r && r.desactivada], ['rechazada', true])
  assert.equal(pasarela.llamadas, 1)
  const a = await asientosDe(c)
  assert.deepEqual([carga(a[0]).causa, carga(a[0]).rechazo], ['definitivo', 1])
  const avisos = await avisosDe(c)
  assert.match(avisos[0].titulo, /Desactivamos/)
  assert.equal((await prisma.tarjetaTokenizada.findUniqueOrThrow({ where: { id: c.tarjetaId } })).activa, true)
})

test('3 · si el siguiente cron caería DESPUÉS del vencimiento, se apaga ya y el aviso no promete un reintento que no llegará', async () => {
  reiniciar()
  const e = await empresa('tres')
  const c = await renovable(e, 'Jaime', { venceEnMs: 10 * H })
  pasarela.modo = 'rechazar'
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'desactivada' in r && r.desactivada], ['rechazada', true])
  assert.equal(carga((await asientosDe(c))[0]).causa, 'sin_tiempo')
  const [aviso] = await avisosDe(c)
  assert.doesNotMatch(aviso.mensaje, /Volveremos/)
})

// ── Un cobro de resultado DESCONOCIDO no es un rechazo ──────────────────────

test('4 · un cobro SIN RESPUESTA es dudoso: sin aviso, sin rechazo, y NO se repite al día siguiente', async () => {
  reiniciar()
  const e = await empresa('cuatro')
  const c = await renovable(e, 'Karla')
  pasarela.modo = 'sin-respuesta'
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'incierto' in r && r.incierto], ['error', true])
  const [i] = await intentosDe(c)
  assert.deepEqual([i.estado, clasif(i)], ['ERROR', 'incierto'])
  assert.equal((await avisosDe(c)).length, 0, 'no se sabe qué decirle al cliente')
  assert.equal((await asientosDe(c)).length, 0)
  assert.equal((await membresiaDe(c)).autoRenovar, true, 'no se apaga nada')

  // Al día siguiente: el primer cobro pudo haber salido. NO se vuelve a cobrar.
  pasarela.modo = 'aprobar'
  await envejecer(c, 25)
  const antes = pasarela.llamadas
  const dia2 = await renovar(c)
  assert.deepEqual([dia2.estado, 'razon' in dia2 && dia2.razon], ['omitida', 'incierta'])
  assert.equal(pasarela.llamadas, antes, 'no se cobró otra vez')
})

test('4b · un 500 de la pasarela y el código 94 («ya se procesó») también son dudosos, no rechazos', async () => {
  reiniciar()
  const e = await empresa('cuatrob')
  const lucas = await renovable(e, 'Lucas')
  pasarela.modo = 'http500'
  const r = await renovar(lucas)
  assert.deepEqual([r.estado, 'incierto' in r && r.incierto], ['error', true])
  assert.equal((await avisosDe(lucas)).length, 0)

  const mia = await renovable(e, 'Mia')
  pasarela.modo = 'rechazar'
  pasarela.codigo = '94'
  const r94 = await renovar(mia)
  assert.deepEqual([r94.estado, 'incierto' in r94 && r94.incierto], ['error', true])
  assert.equal((await intentosDe(mia))[0].estado, 'ERROR', 'nunca RECHAZADO')
  assert.equal((await avisosDe(mia)).length, 0, 'no se le dice «no se cobró» al cliente')
})

test('5 · la pasarela que ni procesó la petición (401) es un fallo técnico: no gasta un rechazo y al día siguiente SÍ se reintenta', async () => {
  reiniciar()
  const e = await empresa('cinco')
  const c = await renovable(e, 'Nora')
  pasarela.modo = 'http401'
  const r = await renovar(c)
  assert.equal(r.estado, 'error')
  assert.ok(!('incierto' in r && r.incierto))
  assert.equal(clasif((await intentosDe(c))[0]), 'tecnico')
  assert.equal((await avisosDe(c)).length, 0)

  pasarela.modo = 'aprobar'
  await envejecer(c, 25)
  const dia2 = await renovar(c)
  assert.equal(dia2.estado, 'renovada', JSON.stringify(dia2))
})

test('6 · un intento que quedó CREADO sin cerrar (el proceso murió) se da por dudoso: tampoco se repite', async () => {
  reiniciar()
  const e = await empresa('seis')
  const c = await renovable(e, 'Yago')
  await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: c.clienteId, proveedor: 'CARDNET', membershipId: c.membershipId, monto: PRECIO, estado: 'CREADO', canal: 'RENOVACION_AUTOMATICA', createdAt: hace(2 * H) },
  })
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'razon' in r && r.razon], ['omitida', 'incierta'])
  assert.equal(pasarela.llamadas, 0)
})

test('7 · la segunda barrera: tres rechazos en el ciclo con la renovación aún encendida no dejan un cuarto cobro', async () => {
  reiniciar()
  const e = await empresa('siete')
  const c = await renovable(e, 'Ximena')
  // Lo que pasa si la transacción que apaga la renovación falla tras el tercer rechazo.
  for (const h of [26, 40, 52]) {
    await prisma.pagoIntento.create({
      data: { companyId: e.companyId, clienteId: c.clienteId, proveedor: 'CARDNET', membershipId: c.membershipId, monto: PRECIO, estado: 'RECHAZADO', canal: 'RENOVACION_AUTOMATICA', createdAt: hace(h * H) },
    })
  }
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'razon' in r && r.razon], ['omitida', 'agotada'])
  assert.equal(pasarela.llamadas, 0)
})

// ── Otros intentos de la misma membresía ────────────────────────────────────

test('8 · un cobro aprobado que no se entregó bloquea: ya se cobró (lo resuelve la Conciliación)', async () => {
  reiniciar()
  const e = await empresa('ocho')
  const c = await renovable(e, 'Oscar')
  await prisma.pagoIntento.create({
    data: {
      companyId: e.companyId, clienteId: c.clienteId, proveedor: 'CARDNET', membershipId: c.membershipId, monto: PRECIO,
      estado: 'APROBADO', activadoAt: hace(25 * H), createdAt: hace(25 * H), updatedAt: hace(25 * H),
      fulfillmentEstado: 'FALLIDA', canal: 'RENOVACION_AUTOMATICA',
    },
  })
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'razon' in r && r.razon], ['omitida', 'cobrada'])
  assert.equal(pasarela.llamadas, 0)
})

test('9 · un cliente pagando a mano AHORA frena el cobro automático; sus rechazos manuales no gastan los intentos del cron', async () => {
  reiniciar()
  const e = await empresa('nueve')
  const c = await renovable(e, 'Paula')
  const manual = await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: c.clienteId, proveedor: 'CARDNET', membershipId: c.membershipId, monto: PRECIO, estado: 'REDIRIGIDO', canal: 'WEB' },
  })
  const bloqueada = await renovar(c)
  assert.deepEqual([bloqueada.estado, 'razon' in bloqueada && bloqueada.razon], ['omitida', 'reciente'])
  assert.equal(pasarela.llamadas, 0)

  await prisma.pagoIntento.delete({ where: { id: manual.id } })
  for (const h of [30, 40, 50]) {
    await prisma.pagoIntento.create({
      data: { companyId: e.companyId, clienteId: c.clienteId, proveedor: 'CARDNET', membershipId: c.membershipId, monto: PRECIO, estado: 'RECHAZADO', canal: 'WEB', createdAt: hace(h * H) },
    })
  }
  const r = await renovar(c)
  assert.equal(r.estado, 'renovada', JSON.stringify(r))
})

test('10 · REGRESIÓN: un segundo cron que llega DESPUÉS de renovar no cobra otra vez, ni con un plan tan corto que sigue «por vencer»', async () => {
  reiniciar()
  const e = await empresa('diez', { vigenciaDias: 2 })
  const c = await renovable(e, 'Quirino', { venceEnMs: 10 * H })
  assert.equal((await renovar(c)).estado, 'renovada')
  assert.equal(pasarela.llamadas, 1)
  // El vencimiento nuevo (≈ 58 h) sigue DENTRO del margen de 3 días: solo «pagada hace poco» lo detiene.
  const segundo = await renovar(c)
  assert.equal(segundo.estado, 'omitida')
  assert.equal(pasarela.llamadas, 1, 'no se cobró dos veces')

  // Un día después, con el siguiente período, sí vuelve a cobrar: una vez por período.
  await envejecer(c, 24)
  await prisma.membership.update({ where: { id: c.membershipId }, data: { fechaPago: hace(24 * H) } })
  assert.equal((await renovar(c)).estado, 'renovada')
  assert.equal(pasarela.llamadas, 2)
  assert.equal((await intentosDe(c)).filter((i) => i.estado === 'APROBADO').length, 2)
})

test('11 · una membresía que ya no está ACTIVA, o fuera de la ventana de cobro, no se cobra', async () => {
  reiniciar()
  const e = await empresa('once')
  const c = await renovable(e, 'Rosa')
  await prisma.membership.update({ where: { id: c.membershipId }, data: { estado: 'VENCIDA' } })
  assert.equal((await renovar(c)).estado, 'omitida')
  await prisma.membership.update({ where: { id: c.membershipId }, data: { estado: 'ACTIVA', fechaVencimiento: adelante(20 * DIA) } })
  assert.equal((await renovar(c)).estado, 'omitida', 'falta más que el margen del primer intento')
  await prisma.membership.update({ where: { id: c.membershipId }, data: { fechaVencimiento: hace(10 * DIA) } })
  assert.equal((await renovar(c)).estado, 'omitida', 'venció hace más de la gracia')
  assert.equal(pasarela.llamadas, 0)
})

// ── Tarjeta vencida ─────────────────────────────────────────────────────────

test('12 · una tarjeta con vencimiento cumplido NO genera intento: apaga la renovación, retira el consentimiento y avisa', async () => {
  reiniciar()
  const e = await empresa('doce')
  const mesAtras = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 15))
  const c = await renovable(e, 'Ruth', { venc: { vencMes: mesAtras.getUTCMonth() + 1, vencAnio: mesAtras.getUTCFullYear() } })
  const r = await renovar(c)
  assert.deepEqual([r.estado, 'razon' in r && r.razon], ['omitida', 'tarjeta_vencida'])
  assert.equal(pasarela.llamadas, 0)
  assert.equal((await intentosDe(c)).length, 0, 'ni siquiera una fila en pago_intentos')
  assert.equal((await membresiaDe(c)).autoRenovar, false)
  assert.equal(await vigentes(c), 0)
  assert.equal((await prisma.tarjetaTokenizada.findUniqueOrThrow({ where: { id: c.tarjetaId } })).activa, true)
  const a = await asientosDe(c)
  assert.deepEqual([carga(a[0]).tipo, carga(a[0]).causa], ['renovacion_no_intentada', 'tarjeta_vencida'])
  const avisos = await avisosDe(c)
  assert.match(avisos[0].mensaje, /No intentamos cobrar/)
  // Repetirlo no duplica nada.
  assert.equal((await renovar(c)).estado, 'omitida')
  assert.equal((await avisosDe(c)).length, 1)
})

test('13 · con vencimiento FUTURO, o sin vencimiento conocido (lo normal), renueva con normalidad', async () => {
  reiniciar()
  const e = await empresa('trece')
  const futura = new Date(Date.UTC(new Date().getUTCFullYear() + 1, new Date().getUTCMonth(), 15))
  const sofia = await renovable(e, 'Sofia', { venc: { vencMes: futura.getUTCMonth() + 1, vencAnio: futura.getUTCFullYear() } })
  assert.equal((await renovar(sofia)).estado, 'renovada')
  const tania = await renovable(e, 'Tania')
  const t = await prisma.tarjetaTokenizada.findUniqueOrThrow({ where: { id: tania.tarjetaId } })
  assert.equal(t.vencMes, null)
  assert.equal((await renovar(tania)).estado, 'renovada', 'sin dato no se bloquea nada por suponer')
})

// ── El aviso previo y la promesa del texto ──────────────────────────────────

test('14 · quien aceptó un texto que promete aviso NO se cobra sin aviso; con el aviso registrado, sí', async () => {
  reiniciar()
  const e = await empresa('catorce')
  const wendy = await renovable(e, 'Wendy', { texto: TEXTO_VERSION_RENOVACION })
  const xavier = await renovable(e, 'Xavier', { texto: TEXTO_VERSION_RENOVACION, cuenta: false })
  const yola = await renovable(e, 'Yola') // consentimiento heredado: nunca prometió aviso

  const sinAviso = await renovar(wendy)
  assert.deepEqual([sinAviso.estado, 'razon' in sinAviso && sinAviso.razon], ['omitida', 'sin_aviso'])
  assert.equal((await intentosDe(wendy)).length, 0)
  assert.equal(pasarela.llamadas, 0)
  assert.equal((await renovar(yola)).estado, 'renovada', 'quien no prometió aviso sigue renovando como antes')

  const avisos = await ejecutarAvisosDeRenovacion(500, e.companyId)
  assert.ok(avisos.enviados >= 1 && avisos.sinDestino >= 1, JSON.stringify(avisos))
  const [aviso] = await avisosDe(wendy)
  assert.equal(aviso.tipo, 'MEMBRESIA_POR_VENCER')
  assert.match(aviso.mensaje, /Cobraremos RD\$500\.00/)
  assert.equal((await renovar(wendy)).estado, 'renovada', 'con el aviso registrado, sale')

  // Sin cuenta no se pudo avisar: no se cobra a quien lo prometió.
  const sinCuenta = await renovar(xavier)
  assert.deepEqual([sinCuenta.estado, 'razon' in sinCuenta && sinCuenta.razon], ['omitida', 'sin_aviso'])
})

test('15 · el aviso previo: dentro del plazo sí, más allá no, una sola vez, y solo si la empresa puede cobrar', async () => {
  reiniciar()
  const e = await empresa('quince')
  const sinCobro = await empresa('quince-sin', { conCobro: false })
  const tomas = await renovable(e, 'Tomas', { venceEnMs: 5 * DIA, texto: TEXTO_VERSION_RENOVACION })
  const ursula = await renovable(e, 'Ursula', { venceEnMs: 10 * DIA, texto: TEXTO_VERSION_RENOVACION })
  const sc = await renovable(sinCobro, 'SinCobro', { venceEnMs: 5 * DIA, texto: TEXTO_VERSION_RENOVACION })
  const mesAtras = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 15))
  const vera = await renovable(e, 'Vera', { venceEnMs: 5 * DIA, texto: TEXTO_VERSION_RENOVACION, venc: { vencMes: mesAtras.getUTCMonth() + 1, vencAnio: mesAtras.getUTCFullYear() } })

  const a1 = await ejecutarAvisosDeRenovacion(500, e.companyId)
  const aSin = await ejecutarAvisosDeRenovacion(500, sinCobro.companyId)
  const [t] = await avisosDe(tomas)
  assert.equal((await avisosDe(tomas)).length, 1)
  assert.equal(t.tipo, 'MEMBRESIA_POR_VENCER')
  assert.match(t.dedupeKey ?? '', new RegExp(`^renovacion-proxima:${tomas.membershipId}:\\d{4}-\\d{2}-\\d{2}$`))
  assert.equal((await avisosDe(ursula)).length, 0, 'más allá del plazo no se avisa')
  assert.equal((await avisosDe(sc)).length, 0, 'una empresa que no puede cobrar no recibe «se renovará»: no ocurriría')
  assert.ok(aSin.omitidas >= 1, JSON.stringify(aSin))
  const [v] = await avisosDe(vera)
  assert.match(v.titulo, /no servirá/, 'si la tarjeta ya estará vencida al cobrar, el aviso es «no servirá», no «se renovará»')

  const a2 = await ejecutarAvisosDeRenovacion(500, e.companyId)
  assert.equal((await avisosDe(tomas)).length, 1, 'la segunda pasada no repite el aviso')
  assert.ok(a2.yaEnviados >= 2 && a1.enviados >= 2, JSON.stringify([a1, a2]))
})

test('16 · el recordatorio genérico «renuévala» no contradice al aviso de renovación', async () => {
  reiniciar()
  const e = await empresa('dieciseis')
  const sinCobro = await empresa('dieciseis-sin', { conCobro: false })
  const tomas = await renovable(e, 'Tomas2', { venceEnMs: 5 * DIA, texto: TEXTO_VERSION_RENOVACION })
  const sc = await renovable(sinCobro, 'SinCobro2', { venceEnMs: 5 * DIA, texto: TEXTO_VERSION_RENOVACION })
  // Quien NO se renueva sola: la membresía sin tarjeta ni renovación.
  const luis = await prisma.cliente.create({
    data: { companyId: e.companyId, supabaseId: `sb-rn-${sufijo}-luis`, nombre: 'Luis', email: `luis-${sufijo}@prueba.test` },
    select: { id: true, supabaseId: true },
  })
  await prisma.user.create({ data: { supabaseId: luis.supabaseId, email: `u-luis-${sufijo}@prueba.test`, name: 'Luis', companyId: e.companyId } })
  await prisma.membership.create({
    data: { companyId: e.companyId, clienteId: luis.id, planId: e.planId, estado: 'ACTIVA', pagoConfirmado: true, fechaVencimiento: adelante(5 * DIA) },
  })

  await ejecutarAutomatizacionesEmpresa(e.companyId)
  await ejecutarAutomatizacionesEmpresa(sinCobro.companyId)
  const porVencer = async (c: { supabaseId: string }) => (await avisosDe(c)).filter((a) => a.tipo === 'MEMBRESIA_POR_VENCER')
  const deLuis = await porVencer({ supabaseId: luis.supabaseId })
  assert.equal(deLuis.length, 1)
  assert.match(deLuis[0].titulo, /por vencer/, 'quien NO se renueva sola recibe el recordatorio')
  await ejecutarAvisosDeRenovacion(500, e.companyId)
  const deTomas = await porVencer(tomas)
  assert.equal(deTomas.length, 1, 'quien SÍ se renueva sola NO recibe «renuévala»: solo el aviso de renovación')
  assert.match(deTomas[0].titulo, /se renovará automáticamente/)
  const deSc = await porVencer(sc)
  assert.equal(deSc.length, 1, 'en una empresa que no puede cobrar no se suprime: el recordatorio sí sale')
  assert.match(deSc[0].titulo, /por vencer/)
})

// ── Lo que ve una persona ───────────────────────────────────────────────────

test('17 · el resumen del cron cuenta lo que espera a una persona y la conciliación lo muestra', async () => {
  reiniciar()
  const e = await empresa('diecisiete')
  const karla = await renovable(e, 'Karla2')
  pasarela.modo = 'sin-respuesta'
  assert.equal((await renovar(karla)).estado, 'error')
  pasarela.modo = 'aprobar'
  await envejecer(karla, 25)

  const resumen = await ejecutarRenovacionesTarjeta(e.companyId)
  for (const k of ['candidatas', 'renovadas', 'rechazadas', 'desactivadas', 'omitidas', 'sinAviso', 'bloqueadas', 'errores', 'inciertas'] as const) {
    assert.equal(typeof resumen[k], 'number', k)
  }
  assert.ok(resumen.bloqueadas >= 1, JSON.stringify(resumen))

  const c = await conciliar(e.companyId)
  const h = c.hallazgos.find((x) => x.clave === 'renovacion-dudosa')
  assert.ok(h, 'la conciliación muestra la renovación dudosa')
  assert.deepEqual([h.severidad, h.cantidad], ['ALTA', 1])
  assert.deepEqual(h.casos.map((x) => [x.tipo, x.acciones]), [['RENOVACION_DUDOSA', ['ABRIR_FICHA']]])
  assert.match(h.casos[0].detalle ?? '', /Referencia en CardNET: [A-Za-z0-9]{12}/)

  const met = await leerMetricas()
  assert.ok(!met.fallos.includes('negocio'), 'la consulta de métricas es válida')
  assert.ok(met.negocio.renovacionesPorConciliar >= 1)
})

test('18 · el procedimiento del runbook funciona: «no se cobró» libera el ciclo y «sí se cobró» lo convierte en un cobro por entregar', async () => {
  reiniciar()
  const e = await empresa('dieciocho')
  const a = await renovable(e, 'Ana')
  const b = await renovable(e, 'Beto')
  pasarela.modo = 'sin-respuesta'
  await renovar(a)
  await renovar(b)
  pasarela.modo = 'aprobar'
  await envejecer(a, 25)
  await envejecer(b, 25)
  const [ia] = await intentosDe(a)
  const [ib] = await intentosDe(b)

  // «NO se cobró»: se marca como descartado.
  await prisma.$executeRaw`UPDATE pago_intentos SET respuesta = coalesce(respuesta, '{}'::jsonb) || '{"_clasificacion":"conciliado_no_cobrado"}'::jsonb WHERE id = ${ia.id} AND estado IN ('ERROR', 'CREADO')`
  assert.equal((await renovar(a)).estado, 'renovada', 'el siguiente cobro automático lo reintenta')

  // «SÍ se cobró»: se registra como aprobado y entra por el camino de entrega de siempre.
  await prisma.$executeRaw`UPDATE pago_intentos SET estado = 'APROBADO', autorizacion = 'AUTH-MANUAL', "activadoAt" = coalesce("activadoAt", now()) WHERE id = ${ib.id} AND "fulfillmentEstado" <> 'COMPLETADA'`
  // En la vida real el cobro dudoso tiene días; una entrega actualizada hace segundos cuenta como «en curso» y no se señala.
  await prisma.$executeRaw`UPDATE pago_intentos SET "updatedAt" = now() - interval '2 days' WHERE id = ${ib.id}`
  const bloqueado = await renovar(b)
  assert.deepEqual([bloqueado.estado, 'razon' in bloqueado && bloqueado.razon], ['omitida', 'cobrada'], 'ya se cobró: no se cobra otra vez')
  const c = await conciliar(e.companyId)
  const esperando = c.hallazgos.find((x) => x.clave === 'cobrado-sin-entregar')
  assert.ok(esperando?.casos.some((x) => x.id === ib.id && x.acciones.includes('REINTENTAR_ENTREGA')), 'aparece en «cobros con entrega pendiente», con su botón')

  // Y ese botón hace lo que debe: extiende la membresía SIN volver a cobrar.
  const llamadasAntes = pasarela.llamadas
  const venceAntes = (await membresiaDe(b)).fechaVencimiento!
  const reintento = await reintentarEntrega(ib.id)
  assert.deepEqual([reintento.ok, reintento.entrega], [true, 'COMPLETADA'])
  assert.equal(pasarela.llamadas, llamadasAntes, 'el reintento no recobra')
  assert.ok((await membresiaDe(b)).fechaVencimiento!.getTime() > venceAntes.getTime(), 'la membresía se extendió')
})
