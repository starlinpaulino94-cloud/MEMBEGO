import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearAcuerdo, crearOrden, generarLotes, moverAcuerdo, moverOrden, registrarEnmienda } from '../../src/modules/supply/procurement'
import { asignar } from '../../src/modules/supply/asignaciones'
import { entregar } from '../../src/modules/supply/distribucion'
import { emitirDerecho } from '../../src/modules/supply/derechos'
import { abrirSesionQr, resolverNonce } from '../../src/modules/supply/qr'
import { redimir, reversarRedencion } from '../../src/modules/supply/redencion'
import { abrirVentaEnTx, entregarVenta, marcarVentaPagadaEnTx } from '../../src/modules/supply/ventas'
import { confirmarPago, registrarPago, saldoDeProveedor } from '../../src/modules/supply/finanzas'
import { aplicarDeposito, registrarDeposito } from '../../src/modules/supply/depositos'
import { registrarFactura } from '../../src/modules/supply/facturas'
import { crearCuentaPorCobrarEnTx, crearCuentaPorPagarEnTx } from '../../src/modules/supply/cuentas'
import { calcularLiquidacion, moverLiquidacion, pagarLiquidacion } from '../../src/modules/supply/liquidaciones'
import { abrirConciliacion, cerrarConciliacion, moverDiscrepancia } from '../../src/modules/supply/conciliacion-proveedor'
import { registrarProveedorExterno, convertirProveedorEnEmpresa } from '../../src/modules/supply/proveedores'

/**
 * MEMBEGO SUPPLY · LOS CATORCE CASOS OBLIGATORIOS, contra PostgreSQL de verdad
 * (auditoría 2026-09, §29).
 *
 * Se ejecutan con `npm run test:db` (tsx --conditions react-server) sobre la
 * base de `DATABASE_URL`: en CI, una base recién migrada en el trabajo
 * «Esquema»; en local, cualquier base con `prisma migrate deploy`.
 *
 * Cada caso construye sobre el anterior a propósito: es la cadena
 * Proveedor → Acuerdo → Compra → Lote → Asignación → Entitlement → QR →
 * Redención → Ledger → Liquidación → Conciliación del encargo, recorrida de
 * punta a punta y no por trozos.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const inicio = new Date(ahora.getTime() - DIA)
const t0 = new Date(ahora.getTime() - 60_000)

const ctx = {
  proveedorId: '',
  creadorId: '',
  aprobadorId: '',
  sucursalId: '',
  clientes: [] as string[],
  acuerdoId: '',
  ordenId: '',
  loteId: '',
  loteFefoId: '',
  asignacionId: '',
  voucherId: '',
  redencionId: '',
  ventaId: '',
  cuentaVentaId: '',
  depositoId: '',
  liquidacionId: '',
}

async function lote(id: string) {
  const l = await prisma.supplyLote.findUniqueOrThrow({
    where: { id },
    select: { compradas: true, disponibles: true, asignadas: true, retenidas: true, emitidas: true, redimidas: true, cerradas: true },
  })
  assert.equal(
    l.disponibles + l.asignadas + l.retenidas + l.emitidas + l.redimidas + l.cerradas,
    l.compradas,
    'invariante del ledger: las seis cubetas suman lo comprado'
  )
  return l
}

async function acuerdoCompleto(d: { finAt: Date; cantidad: number; costo: number; item: string }) {
  const { id } = await crearAcuerdo({
    proveedorId: ctx.proveedorId,
    tipo: 'ON_DEMAND',
    modeloComercial: 'COMPRA_UNIDAD_COMPLETA',
    modalidadPago: 'PAGO_POR_REDENCION',
    politicaSobrante: 'EXPIRAR',
    itemNombre: d.item,
    cantidad: d.cantidad,
    costoUnitario: d.costo,
    precioReferencia: d.costo * 2,
    inicioAt: inicio,
    finAt: d.finAt,
    plazoPagoDias: 15,
    frecuenciaCorte: 'QUINCENAL',
    creadoPorId: ctx.creadorId,
  })
  await moverAcuerdo(id, 'PENDIENTE_APROBACION')
  await moverAcuerdo(id, 'APROBADO', ctx.aprobadorId)
  await moverAcuerdo(id, 'ACTIVO')
  const orden = await crearOrden({
    acuerdoId: id,
    lineas: [{ itemNombre: d.item, cantidad: d.cantidad, costoUnitario: d.costo }],
    creadoPorId: ctx.creadorId,
  })
  await moverOrden(orden.id, 'PENDIENTE_APROBACION', ctx.creadorId)
  await moverOrden(orden.id, 'APROBADA', ctx.aprobadorId)
  await moverOrden(orden.id, 'CONFIRMADA', ctx.aprobadorId)
  const lotes = await generarLotes(orden.id, ctx.aprobadorId)
  assert.equal(lotes.length, 1)
  return { acuerdoId: id, ordenId: orden.id, loteId: lotes[0]!.id }
}

before(async () => {
  const empresa = await prisma.company.create({
    data: {
      name: `Proveedor de prueba ${sufijo}`,
      slug: `prueba-supply-${sufijo}`,
      type: 'restaurante',
      capacidades: { overrides: { MEMBEGO_SUPPLIER: true } },
    },
    select: { id: true },
  })
  ctx.proveedorId = empresa.id
  const [creador, aprobador] = await Promise.all([
    prisma.user.create({ data: { supabaseId: `sb-creador-${sufijo}`, email: `creador-${sufijo}@prueba.test`, name: 'Creador', role: 'SUPERADMIN' }, select: { id: true } }),
    prisma.user.create({ data: { supabaseId: `sb-aprobador-${sufijo}`, email: `aprobador-${sufijo}@prueba.test`, name: 'Aprobador', role: 'SUPERADMIN' }, select: { id: true } }),
  ])
  ctx.creadorId = creador.id
  ctx.aprobadorId = aprobador.id
  const sucursal = await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Principal' }, select: { id: true } })
  ctx.sucursalId = sucursal.id
  for (let i = 0; i < 5; i++) {
    const c = await prisma.cliente.create({
      data: { companyId: empresa.id, supabaseId: `sb-cliente-${i}-${sufijo}`, nombre: `Cliente ${i}`, email: `cliente-${i}-${sufijo}@prueba.test` },
      select: { id: true },
    })
    ctx.clientes.push(c.id)
  }
})

// ── 1 · Compra de 1.000 unidades ────────────────────────────────────────────

test('1 · comprar 1.000 unidades crea un lote de 1.000 disponibles y la versión 1 del acuerdo', async () => {
  const r = await acuerdoCompleto({ finAt: new Date(ahora.getTime() + 60 * DIA), cantidad: 1000, costo: 300, item: 'Pizza grande' })
  Object.assign(ctx, r)
  const l = await lote(ctx.loteId)
  assert.equal(l.compradas, 1000)
  assert.equal(l.disponibles, 1000)
  const versiones = await prisma.supplyAcuerdoVersion.count({ where: { acuerdoId: ctx.acuerdoId } })
  assert.equal(versiones, 1, 'aprobar crea la primera versión')
})

// ── 2 · Asignación de 100 ───────────────────────────────────────────────────

test('2 · asignar 100 a una campaña deja 900 disponibles y 100 asignadas', async () => {
  const a = await asignar({ loteId: ctx.loteId, destinoTipo: 'CAMPANA', etiqueta: `Campaña ${sufijo}`, cantidad: 100, creadoPorId: ctx.creadorId })
  ctx.asignacionId = a.id
  const l = await lote(ctx.loteId)
  assert.equal(l.disponibles, 900)
  assert.equal(l.asignadas, 100)
})

// ── 3 · Entitlement ─────────────────────────────────────────────────────────

test('3 · entregar a un cliente emite un derecho con voucher: 99 asignadas, 1 emitida', async () => {
  const r = await entregar({ clienteId: ctx.clientes[0]!, destino: 'CAMPANA', asignacionId: ctx.asignacionId, referencia: 'prueba', actorId: ctx.creadorId })
  assert.ok(r.ok, r.ok ? '' : r.mensaje)
  ctx.voucherId = r.voucherId
  const l = await lote(ctx.loteId)
  assert.equal(l.asignadas, 99)
  assert.equal(l.emitidas, 1)
  const derecho = await prisma.supplyDerecho.findFirst({ where: { vouchers: { some: { id: r.voucherId } } }, select: { estado: true, clienteId: true } })
  assert.equal(derecho?.estado, 'ACTIVO')
  assert.equal(derecho?.clienteId, ctx.clientes[0])
})

// ── 4 · Redención por QR ────────────────────────────────────────────────────

test('4 · el QR se resuelve en el servidor y la redención mueve la unidad y asienta lo devengado', async () => {
  const sesion = await abrirSesionQr(ctx.voucherId, ctx.clientes[0]!, ctx.sucursalId, 'prueba/1.0')
  const res = await resolverNonce(sesion.nonce)
  assert.ok(res.ok && res.voucherId === ctx.voucherId)
  const r = await redimir({ voucherId: ctx.voucherId, proveedorId: ctx.proveedorId, sucursalId: ctx.sucursalId, empleadoId: ctx.creadorId, sesionQrId: res.ok ? res.sesionId : null, dispositivo: 'prueba/1.0', claveIdempotencia: `red-${sufijo}-1` })
  assert.ok(r.ok, r.ok ? '' : r.mensaje)
  ctx.redencionId = r.redencion.redencionId
  const l = await lote(ctx.loteId)
  assert.equal(l.emitidas, 0)
  assert.equal(l.redimidas, 1)
  const asiento = await prisma.supplyAsientoFinanciero.findFirst({ where: { redencionId: ctx.redencionId, tipo: 'REDENCION_POR_PAGAR' } })
  assert.equal(Number(asiento?.monto), 300)
  const mov = await prisma.supplyMovimiento.findFirst({ where: { loteId: ctx.loteId, destino: 'REDIMIDO' }, orderBy: { createdAt: 'desc' } })
  assert.ok(mov && typeof mov.saldoAntes === 'object' && typeof mov.saldoDespues === 'object', 'el movimiento guarda saldo antes y después')
  const consumido = await prisma.supplyQrSesion.findUnique({ where: { id: sesion.id }, select: { consumidoAt: true, consumidoDispositivo: true } })
  assert.ok(consumido?.consumidoAt)
  assert.equal(consumido?.consumidoDispositivo, 'prueba/1.0')
})

// ── 5 · Doble redención ─────────────────────────────────────────────────────

test('5 · redimir el mismo voucher otra vez falla y el QR consumido no vuelve a resolverse', async () => {
  const r = await redimir({ voucherId: ctx.voucherId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId, claveIdempotencia: `red-${sufijo}-1b` })
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.motivo, 'YA_UTILIZADO')
  const l = await lote(ctx.loteId)
  assert.equal(l.redimidas, 1)
})

// ── 6 · Vencido ─────────────────────────────────────────────────────────────

test('6 · un voucher vencido no se redime', async () => {
  const e = await emitirDerecho({ loteId: ctx.loteId, clienteId: ctx.clientes[1]!, origen: 'REGALO', actorId: ctx.creadorId })
  assert.ok(e.ok)
  const ayer = new Date(ahora.getTime() - DIA)
  await prisma.supplyVoucher.update({ where: { id: e.derecho.voucherId }, data: { vigenteHasta: ayer } })
  await prisma.supplyDerecho.update({ where: { id: e.derecho.derechoId }, data: { vencAt: ayer } })
  const r = await redimir({ voucherId: e.derecho.voucherId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId })
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.motivo, 'VENCIDO')
  await assert.rejects(() => abrirSesionQr(e.derecho.voucherId, ctx.clientes[1]!), /venció|no está disponible/)
})

// ── 7 · FEFO ────────────────────────────────────────────────────────────────

test('7 · con dos lotes, FEFO elige el que vence antes', async () => {
  const r = await acuerdoCompleto({ finAt: new Date(ahora.getTime() + 10 * DIA), cantidad: 50, costo: 250, item: 'Pizza grande' })
  ctx.loteFefoId = r.loteId
  const e = await entregar({ clienteId: ctx.clientes[2]!, destino: 'REGALO', proveedorId: ctx.proveedorId, item: 'Pizza grande', actorId: ctx.creadorId })
  assert.ok(e.ok, e.ok ? '' : e.mensaje)
  assert.equal(e.loteId, ctx.loteFefoId, 'el lote que vence en 10 días va antes que el de 60')
  const l = await lote(ctx.loteFefoId)
  assert.equal(l.emitidas, 1)
})

// ── 8 · Venta sin precompra → cuenta por pagar ──────────────────────────────

test('8 · una venta a comisión entregada crea la cuenta por pagar por el neto y no toca ningún lote', async () => {
  const { id: acuerdoComision } = await crearAcuerdo({
    proveedorId: ctx.proveedorId,
    tipo: 'ON_DEMAND',
    modeloComercial: 'COMISION',
    modalidadPago: 'PAGO_POR_REDENCION',
    politicaSobrante: 'EXPIRAR',
    itemNombre: 'Combo familiar',
    cantidad: 50,
    costoUnitario: 0,
    precioReferencia: 500,
    comisionPorcentaje: 20,
    inicioAt: inicio,
    finAt: new Date(ahora.getTime() + 30 * DIA),
    creadoPorId: ctx.creadorId,
  })
  await moverAcuerdo(acuerdoComision, 'PENDIENTE_APROBACION')
  await moverAcuerdo(acuerdoComision, 'APROBADO', ctx.aprobadorId)
  await moverAcuerdo(acuerdoComision, 'ACTIVO')

  const antes = await lote(ctx.loteId)
  const venta = await sinEmpresa('prueba: abrir venta', (tx) => abrirVentaEnTx(tx, { acuerdoId: acuerdoComision, clienteId: ctx.clientes[0]!, cantidad: 2 }))
  assert.ok(venta.ok, venta.ok ? '' : venta.mensaje)
  ctx.ventaId = venta.ventaId
  assert.equal(venta.montoBruto, 1000)

  // Sin pagar no se entrega.
  const sinPagar = await entregarVenta({ ventaId: ctx.ventaId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId })
  assert.equal(sinPagar.ok, false)

  await sinEmpresa('prueba: pagar venta', (tx) => marcarVentaPagadaEnTx(tx, ctx.ventaId))
  const entrega = await entregarVenta({ ventaId: ctx.ventaId, proveedorId: ctx.proveedorId, sucursalId: ctx.sucursalId, empleadoId: ctx.creadorId })
  assert.ok(entrega.ok, entrega.ok ? '' : entrega.mensaje)
  assert.equal(entrega.montoProveedor, 800)
  ctx.cuentaVentaId = entrega.cuentaPorPagarId

  const cxp = await prisma.supplyCuentaPorPagar.findUniqueOrThrow({ where: { id: entrega.cuentaPorPagarId } })
  assert.equal(cxp.origen, 'VENTA_DIRECTA')
  assert.equal(Number(cxp.montoBruto), 1000)
  assert.equal(Number(cxp.comision), 200)
  assert.equal(Number(cxp.montoNeto), 800)
  assert.equal(cxp.estado, 'ABIERTA')
  const asiento = await prisma.supplyAsientoFinanciero.findFirst({ where: { tipo: 'CUENTA_POR_PAGAR', referencia: cxp.codigo } })
  assert.equal(Number(asiento?.monto), 800)

  const despues = await lote(ctx.loteId)
  assert.deepEqual(despues, antes, 'la venta sin precompra no mezcla con los lotes')

  // La segunda entrega es idempotente: no nace otra cuenta.
  const otra = await entregarVenta({ ventaId: ctx.ventaId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId })
  assert.ok(!otra.ok || otra.reutilizada)
  assert.equal(await prisma.supplyCuentaPorPagar.count({ where: { ventaId: ctx.ventaId } }), 1)
})

// ── 9 · Depósito de 100.000, aplicar 20.000 ─────────────────────────────────

test('9 · un depósito de 100.000 al que se aplican 20.000 queda con 80.000 y no asienta dos veces', async () => {
  const dep = await registrarDeposito({ proveedorId: ctx.proveedorId, acuerdoId: ctx.acuerdoId, monto: 100_000, referencia: `DEP-${sufijo}`, registradoPorId: ctx.creadorId })
  ctx.depositoId = dep.id
  let d = await prisma.supplyDeposito.findUniqueOrThrow({ where: { id: dep.id } })
  assert.equal(d.estado, 'PENDIENTE')

  const saldoAntes = (await sinEmpresa('prueba', (tx) => saldoDeProveedor(tx, ctx.proveedorId))).saldoPorPagar
  await confirmarPago(dep.pagoId, ctx.aprobadorId)
  d = await prisma.supplyDeposito.findUniqueOrThrow({ where: { id: dep.id } })
  assert.equal(d.estado, 'ABIERTO')
  const saldoTrasDeposito = (await sinEmpresa('prueba', (tx) => saldoDeProveedor(tx, ctx.proveedorId))).saldoPorPagar
  assert.equal(Math.round(saldoAntes - saldoTrasDeposito), 100_000, 'depositar es pagar por adelantado: baja lo que se le debe')

  const cuenta = await sinEmpresa('prueba: cuenta manual', (tx) =>
    crearCuentaPorPagarEnTx(tx, { proveedorId: ctx.proveedorId, acuerdoId: ctx.acuerdoId, origen: 'MANUAL', descripcion: 'Consumo de la semana', montoBruto: 20_000, creadoPorId: ctx.creadorId })
  )
  const asientosAntes = await prisma.supplyAsientoFinanciero.count({ where: { proveedorId: ctx.proveedorId } })
  const ap = await aplicarDeposito(dep.id, cuenta.id, 20_000, ctx.creadorId)
  assert.equal(ap.saldoAntes, 100_000)
  assert.equal(ap.saldoDespues, 80_000)
  const asientosDespues = await prisma.supplyAsientoFinanciero.count({ where: { proveedorId: ctx.proveedorId } })
  assert.equal(asientosDespues, asientosAntes, 'aplicar un depósito no escribe asiento: el neteo ya está en el ledger')

  d = await prisma.supplyDeposito.findUniqueOrThrow({ where: { id: dep.id } })
  assert.equal(Number(d.montoAplicado), 20_000)
  assert.equal(d.estado, 'PARCIALMENTE_APLICADO')
  const c = await prisma.supplyCuentaPorPagar.findUniqueOrThrow({ where: { id: cuenta.id } })
  assert.equal(c.estado, 'SALDADA')
  const mov = await prisma.supplyDepositoMovimiento.findFirst({ where: { depositoId: dep.id, tipo: 'APLICACION' } })
  assert.equal(Number(mov?.saldoAntes), 100_000)
  assert.equal(Number(mov?.saldoDespues), 80_000)
  assert.equal(mov?.cuentaPorPagarId, cuenta.id)
})

// ── 10 · Factura pagada por fuera ───────────────────────────────────────────

test('10 · una factura pagada con transferencia directa deja el depósito intacto', async () => {
  const f = await registrarFactura({ proveedorId: ctx.proveedorId, acuerdoId: ctx.acuerdoId, numero: `B0100${sufijo}`, fechaEmision: ahora, subtotal: 5_000, impuestos: 0, registradoPorId: ctx.creadorId })
  const factura = await prisma.supplyFacturaProveedor.findUniqueOrThrow({ where: { id: f.id }, include: { cuentaPorPagar: true } })
  assert.equal(factura.estado, 'REGISTRADA')
  assert.ok(factura.cuentaPorPagar)

  const pago = await registrarPago({ acuerdoId: ctx.acuerdoId, tipo: 'LIQUIDACION_FINAL', monto: 5_000, cuentaPorPagarId: factura.cuentaPorPagar!.id, referencia: `TRF-${sufijo}`, registradoPorId: ctx.creadorId })
  await confirmarPago(pago.id, ctx.aprobadorId)

  const cuenta = await prisma.supplyCuentaPorPagar.findUniqueOrThrow({ where: { id: factura.cuentaPorPagar!.id } })
  assert.equal(cuenta.estado, 'SALDADA')
  const facturaDespues = await prisma.supplyFacturaProveedor.findUniqueOrThrow({ where: { id: f.id } })
  assert.equal(facturaDespues.estado, 'PAGADA')
  assert.equal(Number(facturaDespues.montoSaldado), 5_000)

  const d = await prisma.supplyDeposito.findUniqueOrThrow({ where: { id: ctx.depositoId } })
  assert.equal(Number(d.montoAplicado), 20_000, 'el depósito no se tocó')
  assert.equal(Number(d.montoOriginal) - Number(d.montoAplicado) - Number(d.montoDevuelto), 80_000)
})

// ── 11 · Liquidación de varias operaciones ──────────────────────────────────

test('11 · la liquidación netea redención, ventas, CxP y CxC; el snapshot no cambia si el acuerdo cambia después', async () => {
  await sinEmpresa('prueba: cuentas', async (tx) => {
    await crearCuentaPorPagarEnTx(tx, { proveedorId: ctx.proveedorId, acuerdoId: ctx.acuerdoId, origen: 'AJUSTE', descripcion: 'Ajuste acordado', montoBruto: 1_000, creadoPorId: ctx.creadorId })
    await crearCuentaPorCobrarEnTx(tx, { proveedorId: ctx.proveedorId, acuerdoId: ctx.acuerdoId, origen: 'PENALIZACION', descripcion: 'Penalización por retraso', monto: 300, creadoPorId: ctx.creadorId })
  })
  const hasta = new Date(Date.now() + 60_000)
  const liq = await calcularLiquidacion({ proveedorId: ctx.proveedorId, desde: t0, hasta, aplicarDeposito: false, calculadaPorId: ctx.creadorId })
  ctx.liquidacionId = liq.id
  // Redención 300 + venta 800 + ajuste 1.000 − penalización 300.
  assert.equal(liq.netoLiquidar, 1_800)
  const lineas = await prisma.supplyLiquidacionLinea.findMany({ where: { liquidacionId: liq.id } })
  assert.ok(lineas.some((l) => l.tipo === 'REDENCION' && l.redencionId === ctx.redencionId))
  assert.ok(lineas.some((l) => l.tipo === 'CUENTA_POR_PAGAR' && l.cuentaPorPagarId === ctx.cuentaVentaId))
  assert.ok(lineas.some((l) => l.tipo === 'CUENTA_POR_COBRAR' && Number(l.monto) === -300))

  // Quien calcula no aprueba.
  await assert.rejects(() => moverLiquidacion(liq.id, 'APROBADA', ctx.creadorId), /aprob/i)
  await moverLiquidacion(liq.id, 'APROBADA', ctx.aprobadorId)

  // El acuerdo cambia DESPUÉS: nueva versión, mismo corte.
  await registrarEnmienda({ acuerdoId: ctx.acuerdoId, campo: 'COSTO', motivo: 'Nuevo precio negociado', antes: { costoUnitario: 300 }, despues: { costoUnitario: 350 }, nuevoCostoUnitario: 350, aprobadoPorId: ctx.aprobadorId })
  const acuerdo = await prisma.supplyAcuerdo.findUniqueOrThrow({ where: { id: ctx.acuerdoId }, select: { version: true, costoUnitario: true } })
  assert.equal(acuerdo.version, 2)
  assert.equal(Number(acuerdo.costoUnitario), 350)
  const l1 = await prisma.supplyLiquidacion.findUniqueOrThrow({ where: { id: liq.id } })
  assert.equal(Number(l1.netoLiquidar), 1_800, 'el snapshot histórico no se altera')

  const pagada = await pagarLiquidacion(liq.id, { metodo: 'Transferencia', referencia: `LIQ-${sufijo}`, actorId: ctx.aprobadorId })
  assert.equal(pagada.netoLiquidar, 1_800)
  assert.ok(pagada.pagoId)
  const l2 = await prisma.supplyLiquidacion.findUniqueOrThrow({ where: { id: liq.id } })
  assert.equal(l2.estado, 'PAGADA')
  const cxpVenta = await prisma.supplyCuentaPorPagar.findUniqueOrThrow({ where: { id: ctx.cuentaVentaId } })
  assert.equal(cxpVenta.estado, 'SALDADA')
  assert.equal(cxpVenta.liquidacionId, liq.id)
  // Pagar dos veces no pasa.
  await assert.rejects(() => pagarLiquidacion(liq.id, { actorId: ctx.aprobadorId }))
  // Un segundo corte del mismo período no vuelve a reclamar nada.
  const otra = await calcularLiquidacion({ proveedorId: ctx.proveedorId, desde: t0, hasta: new Date(Date.now() + 120_000), aplicarDeposito: false, calculadaPorId: ctx.creadorId })
  assert.equal(otra.lineas, 0)
  assert.equal(otra.netoLiquidar, 0)
  await moverLiquidacion(otra.id, 'CANCELADA', ctx.aprobadorId, 'Corte vacío de prueba')
})

// ── 12 · Conciliación con discrepancia ──────────────────────────────────────

test('12 · el proveedor declara menos redenciones: nace una discrepancia que se investiga, resuelve y aprueba', async () => {
  const c = await abrirConciliacion({
    proveedorId: ctx.proveedorId,
    liquidacionId: ctx.liquidacionId,
    desde: t0,
    hasta: new Date(Date.now() + 60_000),
    proveedorRedenciones: 0,
    proveedorMonto: 0,
    proveedorVentas: 1,
    proveedorVentasMonto: 800,
    creadoPorId: ctx.creadorId,
  })
  assert.ok(c.discrepancias >= 1)
  const disc = await prisma.supplyDiscrepancia.findMany({ where: { conciliacionId: c.id } })
  const faltante = disc.find((d) => d.tipo === 'MISSING_REDEMPTION')
  assert.ok(faltante, 'Membego registró una redención que el proveedor no declaró')

  // No se cierra con discrepancias vivas.
  await assert.rejects(() => cerrarConciliacion(c.id, ctx.aprobadorId))

  for (const d of disc) {
    await moverDiscrepancia(d.id, 'EN_INVESTIGACION', { actorId: ctx.creadorId })
    await moverDiscrepancia(d.id, 'RESUELTA', { resolucion: 'El proveedor confirmó por teléfono.', actorId: ctx.creadorId })
    await moverDiscrepancia(d.id, 'APROBADA', { actorId: ctx.aprobadorId })
  }
  await cerrarConciliacion(c.id, ctx.aprobadorId)
  const cerrada = await prisma.supplyConciliacion.findUniqueOrThrow({ where: { id: c.id } })
  assert.equal(cerrada.estado, 'CERRADA')
  const liq = await prisma.supplyLiquidacion.findUniqueOrThrow({ where: { id: ctx.liquidacionId } })
  assert.equal(liq.estado, 'CONCILIADA', 'cerrar la conciliación concilia la liquidación pagada')
})

// ── 13 · Reversión ──────────────────────────────────────────────────────────

test('13 · reversar una redención devuelve la unidad al cliente y contrarresta el asiento', async () => {
  const e = await emitirDerecho({ loteId: ctx.loteId, clienteId: ctx.clientes[3]!, origen: 'REGALO', actorId: ctx.creadorId })
  assert.ok(e.ok)
  const r = await redimir({ voucherId: e.derecho.voucherId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId })
  assert.ok(r.ok)
  const antes = await lote(ctx.loteId)
  await reversarRedencion(r.redencion.redencionId, 'Se registró por error', ctx.aprobadorId)
  const despues = await lote(ctx.loteId)
  assert.equal(despues.redimidas, antes.redimidas - 1)
  assert.equal(despues.emitidas, antes.emitidas + 1)
  const reversa = await prisma.supplyAsientoFinanciero.findFirst({ where: { redencionId: r.redencion.redencionId, tipo: 'REVERSA' } })
  assert.equal(Number(reversa?.monto), -300)
  const original = await prisma.supplyAsientoFinanciero.count({ where: { redencionId: r.redencion.redencionId } })
  assert.equal(original, 2, 'el asiento original no se borra: se contrarresta')
})

// ── 14 · Concurrencia ───────────────────────────────────────────────────────

test('14 · dos redenciones concurrentes del mismo voucher: solo una gana', async () => {
  const e = await emitirDerecho({ loteId: ctx.loteId, clienteId: ctx.clientes[4]!, origen: 'REGALO', actorId: ctx.creadorId })
  assert.ok(e.ok)
  const intento = (n: number) =>
    redimir({ voucherId: e.derecho.voucherId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId, claveIdempotencia: `carrera-${sufijo}-${n}` }).then(
      (r) => ({ ok: r.ok, reutilizada: r.ok ? r.redencion.reutilizada : false }),
      () => ({ ok: false, reutilizada: false })
    )
  const resultados = await Promise.all([intento(1), intento(2), intento(3)])
  const ganadoras = resultados.filter((r) => r.ok && !r.reutilizada)
  assert.equal(ganadoras.length, 1, JSON.stringify(resultados))
  const redenciones = await prisma.supplyRedencion.count({ where: { voucherId: e.derecho.voucherId } })
  assert.equal(redenciones, 1)
  await lote(ctx.loteId)
})

test('14b · dos entregas concurrentes de la misma venta crean una sola cuenta por pagar', async () => {
  const acuerdo = await prisma.supplyVentaDirecta.findUniqueOrThrow({ where: { id: ctx.ventaId }, select: { acuerdoId: true } })
  const venta = await sinEmpresa('prueba: otra venta', (tx) => abrirVentaEnTx(tx, { acuerdoId: acuerdo.acuerdoId, clienteId: ctx.clientes[1]!, cantidad: 1 }))
  assert.ok(venta.ok)
  await sinEmpresa('prueba: pagar', (tx) => marcarVentaPagadaEnTx(tx, venta.ventaId))
  const intento = () => entregarVenta({ ventaId: venta.ventaId, proveedorId: ctx.proveedorId, empleadoId: ctx.creadorId }).then((r) => r.ok && !r.reutilizada, () => false)
  const res = await Promise.all([intento(), intento(), intento()])
  assert.equal(res.filter(Boolean).length, 1)
  assert.equal(await prisma.supplyCuentaPorPagar.count({ where: { ventaId: venta.ventaId } }), 1)
})

// ── Extra · proveedor externo → registrado sin perder historial ─────────────

test('proveedor externo: se registra, se contrata y se convierte conservando el mismo id', async () => {
  const ext = await registrarProveedorExterno({ nombre: `Panadería externa ${sufijo}`, rnc: '1-01-00000-1' }, ctx.creadorId)
  const otra = await registrarProveedorExterno({ nombre: `PANADERÍA EXTERNA ${sufijo}` }, ctx.creadorId)
  assert.equal(otra.companyId, ext.companyId, 'el mismo nombre no crea dos proveedores')
  const empresa = await prisma.company.findUniqueOrThrow({ where: { id: ext.companyId }, select: { isActive: true, supplyPerfilProveedor: { select: { origen: true } } } })
  assert.equal(empresa.isActive, false)
  assert.equal(empresa.supplyPerfilProveedor?.origen, 'EXTERNA')
  const { id } = await crearAcuerdo({
    proveedorId: ext.companyId, tipo: 'ON_DEMAND', modeloComercial: 'COMPRA_UNIDAD_COMPLETA', modalidadPago: 'PREPAGO_TOTAL', politicaSobrante: 'EXPIRAR',
    itemNombre: 'Pan', cantidad: 10, costoUnitario: 50, inicioAt: inicio, finAt: new Date(ahora.getTime() + 30 * DIA), creadoPorId: ctx.creadorId,
  })
  await convertirProveedorEnEmpresa(ext.companyId)
  const despues = await prisma.company.findUniqueOrThrow({ where: { id: ext.companyId }, select: { isActive: true, supplyPerfilProveedor: { select: { origen: true, convertidoAt: true } }, supplyAcuerdos: { select: { id: true } } } })
  assert.equal(despues.isActive, true)
  assert.equal(despues.supplyPerfilProveedor?.origen, 'REGISTRADA')
  assert.ok(despues.supplyPerfilProveedor?.convertidoAt)
  assert.ok(despues.supplyAcuerdos.some((a) => a.id === id), 'el acuerdo sigue colgando de la misma empresa')
})
