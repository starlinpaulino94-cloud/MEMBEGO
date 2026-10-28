/**
 * CONCILIACIÓN · POR QUÉ NO SE ENTREGÓ, Y CÓMO SE CIERRA — contra PostgreSQL, con los casos reales de oct-2026.
 *
 * En producción había 9 «Pagos cobrados con entrega pendiente», todos de agosto, sin ningún error y con un solo botón:
 * «Reintentar entrega». La causa: la columna de cumplimiento nació el 12-sep-2026 con `PENDIENTE` por defecto, y esos
 * cobros —que SÍ se entregaron, la bitácora lo dice— nunca se marcaron. En 8 la membresía se había borrado con la cuenta
 * del cliente (reintentar no podía funcionar); en el otro la membresía venció y volvió a quedar pendiente (reintentar le
 * habría dado otro mes con el pago de agosto). Estas pruebas reproducen los tres casos:
 *
 *   A · cobro entregado cuya membresía se borró → «registro sin cerrar» con la evidencia de la bitácora; se cierra y factura;
 *   B · membresía activada con el cobro que HOY está pendiente → no es un cliente esperando: ni el botón ni el barrido la reactivan;
 *   C · cobro sin producto y sin bitácora → «Cerrar sin entregar», con motivo, nota y bitácora en la misma transacción;
 *   D · un cliente esperando de verdad también se puede cerrar sin entregar (reembolso), y nada lo reabre;
 *   E · la bitácora de otra empresa o una activación a mano no prueban la entrega de un cobro sin producto.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conciliar, type Conciliacion } from '../../src/modules/observabilidad/conciliacion'
import {
  cerrarCobroSinEntregar,
  marcarCobroEntregado,
  reintentarEntregaDeCobro,
  type ActorDeConciliacion,
} from '../../src/modules/observabilidad/conciliacion-servicio'
import { reintentarEntrega } from '../../src/modules/pagos/intentos'
import { barridoEntregasDePago } from '../../src/modules/pagos/barrido-entregas'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRECIO = 1600
const DIA = 86_400_000

interface Empresa { companyId: string; clienteId: string; planId: string; userId: string }

async function crearEmpresa(etiqueta: string): Promise<Empresa> {
  const c = await prisma.company.create({ data: { name: `Cierre ${etiqueta} ${sufijo}`, slug: `cierre-${etiqueta}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo' }, select: { id: true } })
  const cliente = await prisma.cliente.create({ data: { companyId: c.id, supabaseId: `sb-ci-${etiqueta}-${sufijo}`, nombre: `Cliente ${etiqueta}`, email: `ci-${etiqueta}-${sufijo}@prueba.test` }, select: { id: true } })
  const plan = await prisma.plan.create({ data: { companyId: c.id, nombre: `Plan ${etiqueta}`, precio: PRECIO, vigenciaDias: 30, lavadosIncluidos: 4 }, select: { id: true } })
  const u = await prisma.user.create({ data: { supabaseId: `sb-ciu-${etiqueta}-${sufijo}`, email: `ciu-${etiqueta}-${sufijo}@prueba.test`, name: `Gerente ${etiqueta}`, role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })
  return { companyId: c.id, clienteId: cliente.id, planId: plan.id, userId: u.id }
}

const actor = (e: Empresa): ActorDeConciliacion => ({ userId: e.userId, ipAddress: '10.0.0.9', userAgent: 'prueba' })
const hallazgo = (r: Conciliacion, clave: string) => r.hallazgos.find((h) => h.clave === clave)
const casoDe = (r: Conciliacion, id: string) => r.hallazgos.flatMap((h) => h.casos.map((c) => ({ ...c, clave: h.clave }))).find((c) => c.id === id)
const mas = (d: Date, ms: number) => new Date(d.getTime() + ms)

/**
 * LO QUE PASÓ EN AGOSTO, CON LAS REGLAS DE AGOSTO.
 *
 * Desde el 7-oct-2026 `pago_intentos_target_xor_check` exige que cada cobro apunte a una membresía O a una compra. Se
 * añadió `NOT VALID`: no revisa lo que ya había, y por eso en producción siguen los cobros de agosto sin producto (su
 * membresía se borró con la cuenta del cliente: `onDelete: SetNull`). Hoy esas filas no se pueden CREAR, así que para
 * reproducirlas se hace lo que pasó: existir antes de la regla. Se quita, se siembra y se vuelve a poner igual que en la
 * migración (`NOT VALID`), de modo que lo que la prueba ejerce después corre con la regla de hoy, como en producción.
 */
async function antesDeLaReglaDeOctubre<T>(sembrar: () => Promise<T>): Promise<T> {
  // Se vuelve a poner la definición que tenga la base (`pg_get_constraintdef`, con su `NOT VALID`), no una copiada aquí:
  // si una migración la cambia, la prueba ejerce la regla nueva sin tocarla.
  const [regla] = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'pago_intentos_target_xor_check'`
  )
  assert.ok(regla, 'la base migrada debe tener pago_intentos_target_xor_check')
  await prisma.$executeRawUnsafe('ALTER TABLE "pago_intentos" DROP CONSTRAINT "pago_intentos_target_xor_check"')
  try {
    return await sembrar()
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_target_xor_check" ${regla.def}`)
  }
}

/** Un cobro aprobado tal como lo dejó la columna de cumplimiento sobre un cobro de agosto: PENDIENTE, sin intentos, sin error. */
async function cobroAntiguo(e: Empresa, cuando: Date, extra: Record<string, unknown>) {
  return antesDeLaReglaDeOctubre(() =>
    prisma.pagoIntento.create({
      data: { companyId: e.companyId, proveedor: 'CARDNET', monto: PRECIO, estado: 'APROBADO', activadoAt: cuando, autorizacion: 'AUT-AGO', createdAt: cuando, updatedAt: cuando, ...extra },
      select: { id: true },
    })
  )
}

/** Lo que `activarMembresia` anota al activar con un cobro: `PAGO_APROBADO`, automático (sin usuario), en el mismo instante. */
async function activacionEnBitacora(companyId: string, membershipId: string, cuando: Date, userId: string | null = null) {
  await prisma.auditLog.create({
    data: { companyId, userId, accion: 'PAGO_APROBADO', entidadTipo: 'Membership', entidadId: membershipId, payload: { monto: PRECIO }, createdAt: cuando },
  })
}

test('A · cobro de agosto entregado cuya membresía se borró: «registro sin cerrar» con la bitácora como prueba; reintentar no se ofrece', async () => {
  const e = await crearEmpresa('a')
  const agosto = new Date(Date.now() - 70 * DIA)
  const m = await prisma.membership.create({ data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId }, select: { id: true } })
  const i = await cobroAntiguo(e, agosto, { clienteId: e.clienteId, membershipId: m.id })
  await activacionEnBitacora(e.companyId, m.id, mas(agosto, 350))
  // La relación del cobro queda en nulo (onDelete: SetNull): en agosto, antes de la regla que hoy lo impediría.
  await antesDeLaReglaDeOctubre(() => prisma.membership.delete({ where: { id: m.id } }))
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).membershipId, null)

  const r = await conciliar(e.companyId)
  assert.equal(hallazgo(r, 'cobrado-sin-entregar'), undefined, 'ya no grita «cliente esperando»')
  const caso = casoDe(r, i.id)
  assert.ok(caso)
  assert.deepEqual(
    [caso.clave, caso.tipo, caso.acciones],
    ['entrega-sin-registrar', 'REGISTRO_SIN_CERRAR', ['MARCAR_ENTREGADA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']],
    'se activó y se borró: entregado (y facturado) o, si se reembolsó, cerrado sin entregar'
  )
  assert.match(caso.titulo, /^Cliente a · Producto eliminado$/, 'antes decía «Cliente · Compra»')
  assert.match(caso.diagnostico ?? '', /anterior al control de entregas/)
  assert.match(caso.diagnostico ?? '', /bitácora registra la activación del producto unos segundos después/)
  const hechos = Object.fromEntries((caso.hechos ?? []).map((h) => [h.etiqueta, h.texto ?? h.fecha?.toISOString()]))
  assert.equal(hechos['Producto'], 'Ya no existe (se eliminó)')
  assert.equal(hechos['Autorización'], 'AUT-AGO')
  assert.equal(hechos['Evidencia de entrega (bitácora (activación del producto))'], mas(agosto, 350).toISOString())

  const reintento = await reintentarEntregaDeCobro(e.companyId, i.id, actor(e))
  assert.ok(!reintento.ok && /ya se activó/.test(reintento.error), JSON.stringify(reintento))

  const cierre = await marcarCobroEntregado(e.companyId, i.id, actor(e), 'Cobro de agosto, activado al momento según la bitácora.')
  assert.ok(cierre.ok, JSON.stringify(cierre))
  const db = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  assert.equal(db.fulfillmentEstado, 'COMPLETADA')
  assert.equal(db.fulfillmentAt?.getTime(), mas(agosto, 350).getTime(), 'la entrega lleva la fecha de la activación, no la de hoy')
  const venta = await prisma.transaction.findUniqueOrThrow({ where: { pagoIntentoId: i.id } })
  assert.equal(Number(venta.monto), PRECIO)
  assert.equal(venta.createdAt.getTime(), agosto.getTime(), 'la venta cae en el día del cobro')
  assert.match(JSON.stringify(venta.snapshot), /producto eliminado/, 'y no dice «Promoción» de un producto que era una membresía')
  const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.companyId, accion: 'CONCILIACION_ENTREGA_MARCADA' } })
  assert.equal(((log.payload as Record<string, unknown>).evidencia as Record<string, unknown>).fuente, 'BITACORA')
  assert.equal(casoDe(await conciliar(e.companyId), i.id), undefined, 'resuelto')
})

test('B · la membresía se activó con el cobro y HOY está pendiente: ni «Reintentar» ni el barrido le regalan otro periodo', async () => {
  const e = await crearEmpresa('b')
  const agosto = new Date(Date.now() - 70 * DIA)
  // Activada con el cobro, vencida y vuelta a pedir: `pagoConfirmado = false`, como la membresía real de producción.
  const m = await prisma.membership.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId, estado: 'PENDIENTE', pagoConfirmado: false, fechaPago: mas(agosto, 230) },
    select: { id: true },
  })
  const i = await cobroAntiguo(e, agosto, { clienteId: e.clienteId, membershipId: m.id })
  await activacionEnBitacora(e.companyId, m.id, mas(agosto, 430))

  const caso = casoDe(await conciliar(e.companyId), i.id)
  assert.ok(caso)
  assert.deepEqual([caso.tipo, caso.acciones.includes('REINTENTAR_ENTREGA')], ['REGISTRO_SIN_CERRAR', false])

  const r = await reintentarEntregaDeCobro(e.companyId, i.id, actor(e))
  assert.ok(!r.ok, 'el servidor tampoco lo deja aunque alguien llame la acción a mano')
  const sinEntregar = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'OTRO', 'probando el cierre equivocado')
  assert.ok(!sinEntregar.ok && /Marcar entregada/.test(sinEntregar.error), 'un producto que existe y se activó no se cierra como no entregado')
  const barrido = await barridoEntregasDePago({ companyId: e.companyId })
  assert.deepEqual([barrido.revisados, barrido.reintentadas, barrido.siguenEsperando, barrido.avisos], [0, 0, 0, 0], 'ni reintento ni aviso diario')
  const despues = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })
  assert.deepEqual([despues.estado, despues.pagoConfirmado], ['PENDIENTE', false], 'sigue pendiente: el pago de agosto no paga otro mes')
})

test('C · sin producto y sin bitácora: solo «Cerrar sin entregar», con motivo, nota y bitácora; sin venta y para siempre', async () => {
  const e = await crearEmpresa('c')
  const agosto = new Date(Date.now() - 70 * DIA)
  const i = await cobroAntiguo(e, agosto, { clienteId: null, membershipId: null })

  const r = await conciliar(e.companyId)
  const h = hallazgo(r, 'cobro-sin-producto')
  assert.ok(h)
  assert.deepEqual([h.cantidad, h.monto, h.severidad], [1, PRECIO, 'MEDIA'])
  assert.deepEqual(h.casos.map((c) => [c.tipo, c.id, c.acciones]), [['COBRO_SIN_PRODUCTO', i.id, ['CERRAR_SIN_ENTREGAR']]])
  assert.equal(h.casos[0]!.titulo, 'Cliente eliminado · Producto eliminado')
  assert.match(h.casos[0]!.diagnostico ?? '', /reintentar no puede funcionar/)

  const reintento = await reintentarEntregaDeCobro(e.companyId, i.id, actor(e))
  assert.ok(!reintento.ok && /ya no existe/.test(reintento.error))
  const marcar = await marcarCobroEntregado(e.companyId, i.id, actor(e), 'esto no debería cerrarse así')
  assert.ok(!marcar.ok, 'sin evidencia no se da por entregado')

  const sinMotivo = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'INVENTADO', 'una nota suficientemente larga')
  assert.ok(!sinMotivo.ok && /motivo/.test(sinMotivo.error))
  const notaCorta = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'REEMBOLSADO', 'ok')
  assert.ok(!notaCorta.ok && /al menos 10 caracteres/.test(notaCorta.error))
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'PENDIENTE', 'nada cambió')

  const ok = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'PRODUCTO_ELIMINADO', 'Cuenta borrada por el cliente; CardNET sin reembolso.')
  assert.ok(ok.ok, JSON.stringify(ok))
  const db = await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })
  assert.equal(db.fulfillmentEstado, 'DESCARTADA')
  assert.match(db.fulfillmentError ?? '', /^Cerrado sin entregar: /)
  const log = await prisma.auditLog.findMany({ where: { companyId: e.companyId, accion: 'CONCILIACION_ENTREGA_CERRADA_SIN_ENTREGAR' } })
  assert.equal(log.length, 1)
  assert.deepEqual([log[0]!.userId, log[0]!.entidadTipo, log[0]!.entidadId, log[0]!.ipAddress], [e.userId, 'PagoIntento', i.id, '10.0.0.9'])
  const payload = log[0]!.payload as Record<string, unknown>
  assert.deepEqual([payload.motivo, payload.estadoAnterior, payload.situacion], ['PRODUCTO_ELIMINADO', 'PENDIENTE', 'SIN_PRODUCTO'])
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 0, 'cerrar sin entregar no factura')

  const r2 = await conciliar(e.companyId)
  assert.equal(casoDe(r2, i.id), undefined, 'el aviso desaparece porque el caso se cerró, no porque se oculte')
  assert.equal(r2.cuadra, true)
  const otraVez = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'PRODUCTO_ELIMINADO', 'repetir el clic no duplica nada')
  assert.ok(otraVez.ok && /ya estaba cerrado/.test(otraVez.mensaje))
  assert.equal(await prisma.auditLog.count({ where: { companyId: e.companyId, accion: 'CONCILIACION_ENTREGA_CERRADA_SIN_ENTREGAR' } }), 1)
  const reabrir = await reintentarEntrega(i.id)
  assert.ok(!reabrir.ok && /cerró sin entregar/.test(reabrir.error ?? ''), 'nada lo reabre solo')
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'DESCARTADA')
})

test('D · un cliente esperando de verdad también se cierra sin entregar (reembolso) y la otra empresa no puede tocarlo', async () => {
  const e = await crearEmpresa('d')
  const otra = await crearEmpresa('d-otra')
  const haceUnaHora = new Date(Date.now() - 3_600_000)
  const m = await prisma.membership.create({ data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId, estado: 'CANCELADA' }, select: { id: true } })
  const i = await prisma.pagoIntento.create({
    data: {
      companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, estado: 'APROBADO', activadoAt: haceUnaHora,
      canal: 'APP', fulfillmentEstado: 'FALLIDA', fulfillmentError: 'No se puede activar una membresía en estado CANCELADA.', fulfillmentIntentos: 3, updatedAt: haceUnaHora,
    },
    select: { id: true },
  })
  const caso = casoDe(await conciliar(e.companyId), i.id)
  assert.ok(caso)
  assert.deepEqual([caso.tipo, caso.acciones], ['CLIENTE_ESPERANDO', ['REINTENTAR_ENTREGA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']])
  assert.match(caso.diagnostico ?? '', /La entrega falló \(3 intentos\): No se puede activar una membresía en estado CANCELADA\./)

  const ajena = await cerrarCobroSinEntregar(otra.companyId, i.id, actor(otra), 'REEMBOLSADO', 'intento desde otra empresa')
  assert.ok(!ajena.ok && /no encontrado/i.test(ajena.error))

  const ok = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'REEMBOLSADO', 'Reembolsado en CardNET, ref 778899.')
  assert.ok(ok.ok, JSON.stringify(ok))
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).estado, 'CANCELADA', 'no se activa nada')
  const barrido = await barridoEntregasDePago({ companyId: e.companyId })
  assert.deepEqual([barrido.revisados, barrido.siguenEsperando], [0, 0], 'el barrido ya no lo cuenta ni lo avisa')
})

test('F · entregado, borrado y reembolsado: se cierra sin entregar y no deja venta', async () => {
  const e = await crearEmpresa('f')
  const agosto = new Date(Date.now() - 70 * DIA)
  const i = await cobroAntiguo(e, agosto, { clienteId: null, membershipId: null })
  await activacionEnBitacora(e.companyId, 'membresia-borrada', mas(agosto, 300))
  assert.equal(casoDe(await conciliar(e.companyId), i.id)?.tipo, 'REGISTRO_SIN_CERRAR')

  const ok = await cerrarCobroSinEntregar(e.companyId, i.id, actor(e), 'REEMBOLSADO', 'Reembolsado en CardNET al borrar la cuenta.')
  assert.ok(ok.ok, JSON.stringify(ok))
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).fulfillmentEstado, 'DESCARTADA')
  assert.equal(await prisma.transaction.count({ where: { pagoIntentoId: i.id } }), 0)
  const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: e.companyId, accion: 'CONCILIACION_ENTREGA_CERRADA_SIN_ENTREGAR' } })
  assert.equal((log.payload as Record<string, unknown>).situacion, 'REGISTRO_SIN_CERRAR')
})

test('E · un cobro sin producto no toma como prueba la activación de OTRA empresa ni una activación a mano', async () => {
  const e = await crearEmpresa('e')
  const otra = await crearEmpresa('e-otra')
  const agosto = new Date(Date.now() - 70 * DIA)
  const i = await cobroAntiguo(e, agosto, { clienteId: null, membershipId: null })
  await activacionEnBitacora(otra.companyId, 'membresia-de-otra', mas(agosto, 300))
  await activacionEnBitacora(e.companyId, 'activada-a-mano', mas(agosto, 300), e.userId)
  await activacionEnBitacora(e.companyId, 'mucho-despues', mas(agosto, 5 * 60_000))

  const caso = casoDe(await conciliar(e.companyId), i.id)
  assert.equal(caso?.tipo, 'COBRO_SIN_PRODUCTO')
})

test('G · la regla sigue para lo abierto: un cobro nuevo sin membresía ni compra se rechaza; uno ya entregado puede perder su membresía', async () => {
  const e = await crearEmpresa('g')
  await assert.rejects(
    prisma.pagoIntento.create({ data: { companyId: e.companyId, proveedor: 'CARDNET', monto: PRECIO, estado: 'APROBADO' } }),
    /pago_intentos_target_xor_check/,
    'un cobro ABIERTO tiene que decir qué se paga'
  )
  const m = await prisma.membership.create({ data: { companyId: e.companyId, clienteId: e.clienteId, planId: e.planId }, select: { id: true } })
  const i = await prisma.pagoIntento.create({
    data: { companyId: e.companyId, clienteId: e.clienteId, proveedor: 'CARDNET', membershipId: m.id, monto: PRECIO, estado: 'APROBADO', fulfillmentEstado: 'COMPLETADA' },
    select: { id: true },
  })
  // Borrar la cuenta del cliente borra su membresía: el cobro ya entregado se queda sin ella y sin chocar con la regla.
  await prisma.membership.delete({ where: { id: m.id } })
  assert.equal((await prisma.pagoIntento.findUniqueOrThrow({ where: { id: i.id } })).membershipId, null)
})
