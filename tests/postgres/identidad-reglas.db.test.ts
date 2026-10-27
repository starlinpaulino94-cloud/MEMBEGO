/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 5 · las reglas por función, contra PostgreSQL real y el Didit falso.
 *
 * La regla del pago a un proveedor de Supply, de punta a punta: el equipo la enciende, el pago se frena hasta que quien
 * aceptó el contrato del proveedor esté verificado, y se libera solo cuando lo está. Cada prueba falla si vuelve el
 * defecto que cierra:
 *
 *   1 · alguien que no es del equipo cambia una regla, o una operación inventada (una compra) entra en la tabla;
 *   2 · un cambio sin motivo, sin asiento, o una regla que se enciende con la verificación apagada;
 *   3 · el estado de serie frena un pago (la regla nace apagada);
 *   4 · el pago sale sin que la persona que obliga al proveedor esté verificada, o se frena sin explicar a quién pedírselo;
 *   5 · «primer pago» frena el segundo, o «todos» deja de frenarlo;
 *   6 · una regla encendida frena un pago estando la verificación apagada;
 *   7 · el panel enseña ceros inventados o deja que otro rol lo lea;
 *   8 · quien verifica desde el portal vuelve a la pantalla equivocada, o su aviso lleva a una pantalla que no es suya.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { SupplyV2Error } from '../../src/modules/supply-v2/core/errores'
import { crearProveedorExternoEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { confirmarPagoProveedorEnTx, crearPagoEnTx } from '../../src/modules/supply-v2/finance/payments'
import {
  ErrorDeIdentidad,
  cambiarInterruptorDeIdentidad,
  cambiarReglaDeIdentidad,
  leerReglasDeIdentidad,
  revocarVerificacion,
  type ActorDeIdentidad,
} from '../../src/modules/identidad/identidad'
import { TEXTO_VERSION_BIOMETRIA, TEXTO_VERSION_TRANSFERENCIA } from '../../src/modules/identidad/identidadConsentimientosCore'
import { iniciarVerificacionDePersona, type QuienEs } from '../../src/modules/identidad/identidadPuerta'
import { recibirAvisoDeProveedor } from '../../src/modules/identidad/eventos'
import { reglasDeLaPlataforma, cambiarReglaComoStaff } from '../../src/modules/identidad/staff'
import { DiditFalso, crearAvisoFirmado } from './_helpers/didit-falso'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const API_KEY = `clave-didit-sintetica-${sufijo}`
const SECRETO = `secreto-webhook-sintetico-${sufijo}`.padEnd(32, 'x')
const PEPPER = `pepper-de-prueba-${sufijo}-`.padEnd(40, 'x')
const avisoFirmado = crearAvisoFirmado(SECRETO)
const WEB = { canal: 'web' as const, ip: '190.80.12.5', userAgent: 'prueba-reglas' }
const TODOS = { IDENTIDAD_BIOMETRIA: TEXTO_VERSION_BIOMETRIA, IDENTIDAD_TRANSFERENCIA_INTERNACIONAL: TEXTO_VERSION_TRANSFERENCIA }
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'prueba' })

const VARIABLES = ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const
const anterior: Record<string, string | undefined> = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
const fetchOriginal = globalThis.fetch
let staff: ActorDeIdentidad
let finanzas: string
let dd: DiditFalso
let empresaId: string

before(async () => {
  process.env.IDENTIDAD_CLAVES_MAESTRAS = `1:${randomBytes(32).toString('base64')}`
  process.env.IDENTIDAD_PEPPER_DEDUPE = PEPPER
  process.env.DIDIT_API_KEY = API_KEY
  process.env.DIDIT_WORKFLOW_ID = '11111111-0000-0000-0000-000000000001'
  process.env.DIDIT_WEBHOOK_SECRET = SECRETO
  process.env.RESEND_API_KEY = 're_prueba_sintetica'
  dd = new DiditFalso(sufijo)
  globalThis.fetch = dd.manejar as typeof fetch
  const u = await prisma.user.create({ data: { supabaseId: `sb-reg-staff-${sufijo}`, email: `staff-reg-${sufijo}@prueba.test`, name: `Equipo ${sufijo}`, role: 'SUPERADMIN' }, select: { id: true } })
  staff = { userId: u.id, rol: 'SUPERADMIN' }
  finanzas = u.id
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Pruebas automáticas de las reglas con datos sintéticos.' })
  empresaId = (await prisma.company.create({ data: { name: `Proveedor ${sufijo}`, slug: `proveedor-reg-${sufijo}`, type: 'restaurante' }, select: { id: true } })).id
  await prisma.identidadRegla.deleteMany({})
})
after(async () => {
  globalThis.fetch = fetchOriginal
  await prisma.identidadRegla.deleteMany({})
  await prisma.identidadInterruptor.updateMany({ where: { clave: 'VERIFICACION_IDENTIDAD' }, data: { enabled: false } })
  for (const v of VARIABLES) {
    if (anterior[v] === undefined) delete process.env[v]
    else process.env[v] = anterior[v]
  }
})

let n = 0
async function persona(etiqueta = 'p', rol: 'CLIENTE' | 'ADMINISTRADOR' = 'CLIENTE'): Promise<QuienEs & { email: string }> {
  const k = n++
  const u = await prisma.user.create({
    data: {
      supabaseId: `sb-reg-${etiqueta}-${sufijo}-${k}`,
      email: `reg-${etiqueta}-${sufijo}-${k}@prueba.test`,
      name: `Persona ${etiqueta} ${k}`,
      role: rol,
      ...(rol === 'ADMINISTRADOR' ? { companyId: empresaId } : {}),
    },
    select: { id: true, supabaseId: true, email: true },
  })
  return { userId: u.id, supabaseId: u.supabaseId, email: u.email }
}
const recibir = async (a: ReturnType<typeof avisoFirmado>) => {
  const r = await recibirAvisoDeProveedor({ proveedor: 'didit', cuerpoCrudo: a.cuerpoCrudo, cabeceras: a.cabeceras })
  if (r.despues) await r.despues()
}
/** Verifica de verdad a una persona por el camino completo (con el Didit falso). */
async function verificar(q: QuienEs, origenWeb?: 'cliente' | 'proveedor') {
  const r = await iniciarVerificacionDePersona(q, { aceptados: TODOS, origenWeb }, WEB)
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) throw new Error('no inició')
  await recibir(avisoFirmado(dd.aprobar(r.intentoId, { cedula: `006-${sufijo}-${n++}` })))
  return r.intentoId
}
/** Un proveedor con (o sin) representante: quien aceptó su contrato. */
async function proveedor(representanteId: string | null) {
  const p = await sinEmpresa('prueba', (tx) => crearProveedorExternoEnTx(tx, { commercialName: `Proveedor reglas ${sufijo} ${n++}` }, como(finanzas)))
  if (representanteId) await prisma.supplyV2Supplier.update({ where: { id: p.id }, data: { termsAcceptedById: representanteId, termsAcceptedAt: new Date() } })
  return p.id
}
/** Un pago PENDIENTE (un anticipo, que no pide facturas) listo para confirmar. */
async function pagoPendiente(supplierId: string) {
  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId, method: 'BANK_TRANSFER', amount: 1000, asDeposit: true, reference: `REF-${sufijo}-${n++}` }, como(finanzas)))
  return p.id
}
const confirmar = (pagoId: string) => sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, pagoId, como(finanzas)))
const estadoPago = async (id: string) => (await prisma.supplyV2SupplierPayment.findUniqueOrThrow({ where: { id } })).status
const bloqueo = (e: unknown) => e instanceof SupplyV2Error && e.codigo === 'IDENTIDAD_DEL_REPRESENTANTE'
const regla = (alcance: 'primer_pago' | 'todos' = 'primer_pago', activa = true) =>
  cambiarReglaDeIdentidad(staff, { operacion: 'PAGO_A_PROVEEDOR', activa, alcance, motivo: 'Prueba automática de la regla del pago a proveedores.' })
const asientos = () => prisma.auditLog.findMany({ where: { accion: 'IDENTIDAD_REGLA_CAMBIADA' as never, entidadId: 'PAGO_A_PROVEEDOR' }, orderBy: { createdAt: 'asc' } })

// ── 1 · Quién y qué ─────────────────────────────────────────────────────────

test('1 · SOLO EL EQUIPO cambia una regla, y solo sobre las operaciones del catálogo: una compra no entra ni por fuera del servicio', async () => {
  const admin = await persona('admin', 'ADMINISTRADOR')
  const cliente = await persona('cli')
  const entrada = { operacion: 'PAGO_A_PROVEEDOR', activa: true, alcance: 'primer_pago', motivo: 'Prueba' }
  for (const actor of [{ userId: admin.userId, rol: 'ADMINISTRADOR' }, { userId: cliente.userId, rol: 'CLIENTE' }, { userId: '', rol: 'SUPERADMIN' }, { userId: staff.userId, rol: 'INVENTADO' }]) {
    await assert.rejects(() => cambiarReglaDeIdentidad(actor, entrada), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
    await assert.rejects(() => cambiarReglaComoStaff(actor, entrada), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
    await assert.rejects(() => reglasDeLaPlataforma(actor), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'no_autorizado')
  }
  for (const operacion of ['COMPRA_MEMBRESIA', 'RENOVACION', 'CHECK_IN_QR', 'pago_a_proveedor', '']) {
    await assert.rejects(() => cambiarReglaDeIdentidad(staff, { ...entrada, operacion }), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'regla_invalida', operacion)
  }
  await assert.rejects(() => cambiarReglaDeIdentidad(staff, { ...entrada, alcance: 'siempre' }), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'regla_invalida')
  // La segunda barrera: ni escribiendo directo en la tabla entra una operación que no es del catálogo.
  await assert.rejects(() => prisma.identidadRegla.create({ data: { operacion: 'COMPRA_MEMBRESIA', activa: true, reason: 'x' } }))
  await assert.rejects(() => prisma.identidadRegla.create({ data: { operacion: 'PAGO_A_PROVEEDOR', activa: true, alcance: 'siempre', reason: 'x' } }))
  assert.equal(await prisma.identidadRegla.count(), 0, 'nada se guardó')
})

test('2 · TODO CAMBIO LLEVA MOTIVO Y ASIENTO; encender exige la verificación encendida; apagar no', async () => {
  const entrada = { operacion: 'PAGO_A_PROVEEDOR', activa: true, alcance: 'primer_pago', motivo: '   ' }
  await assert.rejects(() => cambiarReglaDeIdentidad(staff, entrada), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'motivo_requerido')
  // Con la verificación apagada no se enciende una regla que nadie podría cumplir.
  await cambiarInterruptorDeIdentidad(staff, { encendido: false, motivo: 'Prueba: verificación apagada.' })
  await assert.rejects(() => regla('primer_pago', true), (e) => e instanceof ErrorDeIdentidad && e.codigo === 'falta_configuracion')
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Prueba: verificación encendida.' })

  const previos = (await asientos()).length // la bitácora de la base de pruebas se conserva entre corridas
  await regla('primer_pago', true)
  await regla('todos', true)
  await regla('todos', false)
  const filas = (await asientos()).slice(previos)
  assert.equal(filas.length, 3)
  assert.ok(filas.every((f) => f.userId === staff.userId))
  const ultimo = filas[2]!.payload as Record<string, unknown>
  assert.equal(ultimo.operacion, 'PAGO_A_PROVEEDOR')
  assert.equal(ultimo.activa, false)
  assert.equal(ultimo.estadoAnterior, 'activa:todos')
  assert.match(String(ultimo.motivo), /Prueba automática/)
  // El asiento no lleva nada de nadie: ni correos, ni nombres, ni documentos.
  assert.doesNotMatch(JSON.stringify(filas.map((f) => f.payload)), /@|cédula|cedula|selfie/i)
  // Apagar siempre se puede (aun con la verificación apagada): es la salida de emergencia.
  await regla('todos', true)
  await cambiarInterruptorDeIdentidad(staff, { encendido: false, motivo: 'Prueba: apagada con la regla encendida.' })
  await regla('todos', false)
  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Prueba: vuelve a encenderse.' })
  const [r] = await leerReglasDeIdentidad()
  assert.deepEqual({ operacion: r!.operacion, activa: r!.activa, alcance: r!.alcance }, { operacion: 'PAGO_A_PROVEEDOR', activa: false, alcance: 'todos' })
  await prisma.identidadRegla.deleteMany({})
})

// ── 3 · El estado de serie ──────────────────────────────────────────────────

test('3 · DE SERIE NO SE FRENA NADA: sin regla, el pago a un proveedor sale aunque su representante no exista o no esté verificado', async () => {
  assert.equal(await prisma.identidadRegla.count(), 0)
  const sinRep = await pagoPendiente(await proveedor(null))
  await confirmar(sinRep)
  assert.equal(await estadoPago(sinRep), 'CONFIRMED')
  const noVerificado = await persona('rep-no')
  const conRep = await pagoPendiente(await proveedor(noVerificado.userId))
  await confirmar(conRep)
  assert.equal(await estadoPago(conRep), 'CONFIRMED')
  // Con la regla apagada de forma explícita, lo mismo.
  await regla('todos', false)
  const otro = await pagoPendiente(await proveedor(noVerificado.userId))
  await confirmar(otro)
  assert.equal(await estadoPago(otro), 'CONFIRMED')
  await prisma.identidadRegla.deleteMany({})
})

// ── 4 · La regla encendida ──────────────────────────────────────────────────

test('4 · REGLA ENCENDIDA: el pago se frena mientras quien aceptó el contrato no esté verificado, dice a quién pedírselo, y sale cuando lo está', async () => {
  await regla('primer_pago')
  const rep = await persona('rep')
  const supplierId = await proveedor(rep.userId)
  const pagoId = await pagoPendiente(supplierId)

  await assert.rejects(
    () => confirmar(pagoId),
    (e) => {
      assert.ok(bloqueo(e))
      assert.match((e as Error).message, new RegExp(rep.email.replace(/[.+]/g, '\\$&')))
      assert.match((e as Error).message, /Verificación de identidad/)
      return true
    }
  )
  assert.equal(await estadoPago(pagoId), 'PENDING', 'el pago sigue pendiente: no salió dinero')
  assert.equal(await prisma.supplyV2PaymentApplication.count({ where: { paymentId: pagoId } }), 0)

  await verificar(rep, 'proveedor')
  await confirmar(pagoId)
  assert.equal(await estadoPago(pagoId), 'CONFIRMED')

  // Sin nadie que haya aceptado el contrato: se frena también, y se dice que no hay a quién pedírselo.
  const huerfano = await pagoPendiente(await proveedor(null))
  await assert.rejects(() => confirmar(huerfano), (e) => bloqueo(e) && /no tiene a nadie que haya aceptado su contrato/.test((e as Error).message))
  assert.equal(await estadoPago(huerfano), 'PENDING')

  // Repetir una confirmación que ya salió no vuelve a preguntar nada (es idempotente).
  const repetida = await confirmar(pagoId)
  assert.equal(repetida.repetido, true)
  await prisma.identidadRegla.deleteMany({})
})

test('4b · UNA VERIFICACIÓN QUE SOLO ES DE CONTACTO, VENCIDA O RETIRADA NO CUENTA', async () => {
  await regla('todos')
  const rep = await persona('rep-ret')
  const supplierId = await proveedor(rep.userId)
  await verificar(rep)
  const p1 = await pagoPendiente(supplierId)
  await confirmar(p1)
  assert.equal(await estadoPago(p1), 'CONFIRMED')

  await revocarVerificacion(staff, rep.userId, 'Prueba: se retira la verificación.')
  const p2 = await pagoPendiente(supplierId)
  await assert.rejects(() => confirmar(p2), (e) => bloqueo(e) && /retirada/.test((e as Error).message))

  // Se vence: la fecha de expiración pasó.
  await verificar(rep)
  await prisma.identidadVerificacion.update({ where: { userId: rep.userId }, data: { expiraEn: new Date(Date.now() - 86_400_000) } })
  await assert.rejects(() => confirmar(p2), (e) => bloqueo(e))
  assert.equal(await estadoPago(p2), 'PENDING')

  // Nivel de contacto: no es una verificación de la persona.
  await prisma.identidadVerificacion.update({ where: { userId: rep.userId }, data: { nivel: 'contacto', expiraEn: new Date(Date.now() + 86_400_000) } })
  await assert.rejects(() => confirmar(p2), (e) => bloqueo(e) && /documento/.test((e as Error).message))
  await prisma.identidadRegla.deleteMany({})
})

// ── 5 · El alcance ──────────────────────────────────────────────────────────

test('5 · «PRIMER PAGO» solo frena el primero; «TODOS» frena cada uno', async () => {
  const rep = await persona('rep-alc')
  const supplierId = await proveedor(rep.userId)
  await verificar(rep)
  await regla('primer_pago')
  const primero = await pagoPendiente(supplierId)
  await confirmar(primero)
  assert.equal(await estadoPago(primero), 'CONFIRMED')

  // La verificación se retira: con «primer pago», el segundo ya no pregunta; con «todos», sí.
  await revocarVerificacion(staff, rep.userId, 'Prueba: retirada tras el primer pago.')
  const segundo = await pagoPendiente(supplierId)
  await confirmar(segundo)
  assert.equal(await estadoPago(segundo), 'CONFIRMED', 'solo el primer pago pedía identidad')

  await regla('todos')
  const tercero = await pagoPendiente(supplierId)
  await assert.rejects(() => confirmar(tercero), bloqueo)
  assert.equal(await estadoPago(tercero), 'PENDING')

  // Dos pagos pendientes del mismo proveedor nuevo: ninguno sale sin la identidad (el «primero» es el primero CONFIRMADO).
  await regla('primer_pago')
  const rep2 = await persona('rep-alc2')
  const nuevo = await proveedor(rep2.userId)
  const a = await pagoPendiente(nuevo)
  const b = await pagoPendiente(nuevo)
  await assert.rejects(() => confirmar(a), bloqueo)
  await assert.rejects(() => confirmar(b), bloqueo)
  await prisma.identidadRegla.deleteMany({})
})

// ── 6 · La verificación apagada ─────────────────────────────────────────────

test('6 · CON LA VERIFICACIÓN APAGADA la regla no frena nada, y el panel lo dice (en pausa); al volver, frena', async () => {
  await regla('todos')
  const rep = await persona('rep-off')
  const supplierId = await proveedor(rep.userId)
  const pagoId = await pagoPendiente(supplierId)
  await assert.rejects(() => confirmar(pagoId), bloqueo)

  await cambiarInterruptorDeIdentidad(staff, { encendido: false, motivo: 'Prueba: el proveedor de verificación está caído.' })
  const enPausa = await reglasDeLaPlataforma(staff)
  assert.equal(enPausa.compuerta.habilitada, false)
  assert.deepEqual(enPausa.reglas.map((r) => [r.operacion, r.activa, r.suspendidaPorLaCompuerta]), [['PAGO_A_PROVEEDOR', true, true]])
  await confirmar(pagoId)
  assert.equal(await estadoPago(pagoId), 'CONFIRMED', 'la verificación apagada no frena un pago')

  await cambiarInterruptorDeIdentidad(staff, { encendido: true, motivo: 'Prueba: el proveedor vuelve.' })
  const otro = await pagoPendiente(supplierId)
  await assert.rejects(() => confirmar(otro), bloqueo)
  await prisma.identidadRegla.deleteMany({})
})

// ── 7 · El panel ────────────────────────────────────────────────────────────

test('7 · EL PANEL enseña cada regla con su estado, el catálogo de lo que no pide nunca y los proveedores de hoy, sin inventar ceros', async () => {
  const verificado = await persona('rep-pan-ok')
  await verificar(verificado)
  const sinVerificar = await persona('rep-pan-no')
  const antes = await reglasDeLaPlataforma(staff)
  await proveedor(verificado.userId)
  await proveedor(sinVerificar.userId)
  await proveedor(null)
  const despues = await reglasDeLaPlataforma(staff)
  assert.ok(antes.proveedores && despues.proveedores)
  assert.equal(despues.proveedores!.activos - antes.proveedores!.activos, 3)
  assert.equal(despues.proveedores!.representanteVerificado - antes.proveedores!.representanteVerificado, 1)
  assert.equal(despues.proveedores!.representanteSinVerificar - antes.proveedores!.representanteSinVerificar, 1)
  assert.equal(despues.proveedores!.sinRepresentante - antes.proveedores!.sinRepresentante, 1)
  assert.ok(despues.nuncaPide.some((t) => /membresía/i.test(t)) && despues.nuncaPide.some((t) => /QR/.test(t)))
  assert.equal(despues.reglas.length, 1)
  assert.deepEqual(
    { activa: despues.reglas[0]!.activa, alcance: despues.reglas[0]!.alcance, cambiadoAt: despues.reglas[0]!.cambiadoAt },
    { activa: false, alcance: 'primer_pago', cambiadoAt: null },
    'sin fila: apagada y sin fecha de cambio'
  )
})

// ── 8 · El camino de quien trabaja en el portal ─────────────────────────────

test('8 · QUIEN VERIFICA DESDE EL PORTAL DEL PROVEEDOR vuelve al portal, y su aviso lo lleva allí; un cliente sigue en la suya', async () => {
  const rep = await persona('rep-portal', 'ADMINISTRADOR')
  const r = await iniciarVerificacionDePersona(rep, { aceptados: TODOS, origenWeb: 'proveedor' }, WEB)
  assert.equal(r.ok, true, JSON.stringify(r))
  if (!r.ok) return
  const sesion = dd.sesionDe(r.intentoId)
  assert.match(sesion.callback, /\/admin\/supply\/identidad\?/)
  assert.match(sesion.callback, /identidad=retorno/)

  await recibir(avisoFirmado(dd.aprobar(r.intentoId, { cedula: `006-${sufijo}-portal` })))
  const aviso = (await prisma.notificacion.findMany({ where: { userId: rep.userId } })).find((x) => x.tipo === 'IDENTIDAD_VERIFICADA')
  assert.ok(aviso, 'se le avisó del resultado')
  assert.equal(aviso!.href, '/admin/supply/identidad')

  const cliente = await persona('cli-portal')
  const c = await iniciarVerificacionDePersona(cliente, { aceptados: TODOS }, WEB)
  assert.equal(c.ok, true, JSON.stringify(c))
  if (!c.ok) return
  assert.match(dd.sesionDe(c.intentoId).callback, /\/cliente\/identidad\?/)
  await recibir(avisoFirmado(dd.aprobar(c.intentoId, { cedula: `006-${sufijo}-cli` })))
  const avisoCliente = (await prisma.notificacion.findMany({ where: { userId: cliente.userId } })).find((x) => x.tipo === 'IDENTIDAD_VERIFICADA')
  assert.equal(avisoCliente!.href, '/cliente/identidad')
})
