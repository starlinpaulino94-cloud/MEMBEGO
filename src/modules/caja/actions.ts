'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth/guards'
import { SCANNER_ROLES } from '@/types'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { activarMembresia } from '@/modules/pagos/activacion'
import { activarCompraPromocion } from '@/modules/pagos/activacionCompra'
import { crearTransaccionAplicada } from '@/lib/transactions/application/transaction-service'
import { crearNotificacion } from '@/modules/notificaciones/service'
import {
  getCierreReporte,
  getReporteEmpleadoDia,
  hoyLocal,
  type CierreReporte,
  type ReporteEmpleadoDia,
} from '@/modules/caja/queries'
import { calcularArqueo, etiquetaArqueo } from '@/modules/caja/arqueo'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Caja (POS) · acciones del turno: abrir, cerrar (con arqueo) y cobrar.
 *
 * Reglas de seguridad:
 *  - Solo staff con acceso al escáner (SCANNER_ROLES) y de la MISMA empresa.
 *  - No se cobra con la caja cerrada.
 *  - Anti doble-cobro: la activación es atómica y rechaza estados ya activos.
 *  - Nada se elimina: sesiones, transacciones y auditoría son permanentes.
 */

export interface CajaActionState {
  error?: string
  success?: boolean
  /** Mensaje de éxito para la UI (ej. código de la transacción). */
  detalle?: string
}

async function staffAutorizado() {
  const user = await requireRole(SCANNER_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return null
  // Plataforma modular · E4: la capacidad POS_CAJA manda en el SERVIDOR, no
  // solo escondiendo el módulo del menú. Es fail-open (empresa sin configurar
  // = caja disponible, como siempre), así que apagarla es una decisión
  // explícita del superadmin.
  const { tieneCapacidad } = await import('@/modules/capacidades/resolver')
  if (!(await tieneCapacidad(companyId, 'POS_CAJA'))) return null
  const userId = user.metadata.dbUserId ?? null
  // Documento comercial: SIEMPRE el nombre del empleado, nunca su correo.
  const nombre = userId
    ? ((await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ??
      user.email ??
      null)
    : (user.email ?? null)
  return { user, companyId, userId, nombre }
}

/**
 * Reporte de cierre de una sesión (para imprimir/reimprimir desde la UI).
 * Solo staff de la misma empresa. No muta nada.
 */
export async function obtenerCierre(
  cajaSesionId: string
): Promise<{ error?: string; cierre?: CierreReporte }> {
  const auth = await staffAutorizado()
  if (!auth) return { error: 'No autorizado.' }
  const cierre = await getCierreReporte(cajaSesionId, auth.companyId)
  if (!cierre) return { error: 'Cierre no encontrado.' }
  return { cierre }
}

/**
 * Cuadre del día del empleado autenticado (G5): TODOS sus cobros del día, con o
 * sin caja abierta, incluidas las transferencias confirmadas desde el panel.
 * `fecha` opcional en formato YYYY-MM-DD (por defecto, hoy en la zona de la
 * empresa). Solo staff de la misma empresa; no muta nada.
 */
export async function obtenerReporteDia(
  fecha?: string
): Promise<{ error?: string; reporte?: ReporteEmpleadoDia }> {
  const auth = await staffAutorizado()
  if (!auth) return { error: 'No autorizado.' }
  if (!auth.userId) return { error: 'Tu usuario no está vinculado a un empleado.' }

  const empresa = await prisma.company.findUnique({
    where: { id: auth.companyId },
    select: { zonaHoraria: true },
  })
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '') ? (fecha as string) : hoyLocal(timeZone)

  const reporte = await getReporteEmpleadoDia(
    auth.companyId,
    auth.userId,
    auth.nombre ?? 'Empleado',
    dia,
    timeZone
  )
  return { reporte }
}

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export async function abrirCaja(
  _prev: CajaActionState,
  formData: FormData
): Promise<CajaActionState> {
  const auth = await staffAutorizado()
  if (!auth) return { error: 'No autorizado.' }
  if (!(await formSubmitLimiter(`caja:${auth.userId}`))) {
    return { error: 'Demasiados intentos. Espera un momento.' }
  }

  const sucursalId = String(formData.get('sucursalId') ?? '').trim()
  const balanceInicial = num(formData.get('balanceInicial')) ?? 0
  const turno = String(formData.get('turno') ?? '').trim() || null
  if (!sucursalId) return { error: 'Selecciona la sucursal.' }
  if (balanceInicial < 0) return { error: 'El balance inicial no puede ser negativo.' }

  const sucursal = await prisma.sucursal.findFirst({
    where: { id: sucursalId, companyId: auth.companyId, activa: true },
    select: { id: true, nombre: true },
  })
  if (!sucursal) return { error: 'Sucursal no válida.' }

  const yaAbierta = await prisma.cajaSesion.findFirst({
    where: { sucursalId, estado: 'ABIERTA' },
    select: { id: true },
  })
  if (yaAbierta) return { error: 'Esta sucursal ya tiene una caja abierta. Ciérrala antes de abrir otra.' }

  const meta = await getRequestMeta()
  const sesion = await prisma.cajaSesion.create({
    data: {
      companyId: auth.companyId,
      sucursalId,
      abiertaPorId: auth.userId!,
      turno,
      balanceInicial,
    },
    select: { id: true },
  })

  await prisma.auditLog.create({
    data: {
      companyId: auth.companyId,
      userId: auth.userId,
      accion: 'CAJA_ABIERTA',
      entidadTipo: 'CajaSesion',
      entidadId: sesion.id,
      payload: { sucursal: sucursal.nombre, balanceInicial, turno },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  revalidatePath('/empleado/caja')
  return { success: true, detalle: `Caja abierta en ${sucursal.nombre}.` }
}

export async function cerrarCaja(
  _prev: CajaActionState,
  formData: FormData
): Promise<CajaActionState> {
  const auth = await staffAutorizado()
  if (!auth) return { error: 'No autorizado.' }

  const cajaSesionId = String(formData.get('cajaSesionId') ?? '').trim()
  const balanceFinal = num(formData.get('balanceFinal'))
  const observaciones = String(formData.get('observaciones') ?? '').trim() || null
  if (!cajaSesionId) return { error: 'Sesión no especificada.' }
  if (balanceFinal == null || balanceFinal < 0) {
    return { error: 'Indica el efectivo contado al cerrar.' }
  }

  const sesion = await prisma.cajaSesion.findFirst({
    where: { id: cajaSesionId, companyId: auth.companyId, estado: 'ABIERTA' },
    select: { id: true, balanceInicial: true, sucursal: { select: { nombre: true } } },
  })
  if (!sesion) return { error: 'La caja ya está cerrada o no existe.' }

  // Arqueo: esperado = inicial + cobros en efectivo + entradas − salidas.
  const [efectivo, entradas, salidas] = await Promise.all([
    prisma.transaction.aggregate({
      where: { cajaSesionId, estado: 'APPLIED', metodoCobro: 'EFECTIVO' },
      _sum: { monto: true },
    }),
    prisma.movimientoCaja.aggregate({
      where: { cajaSesionId, tipo: 'ENTRADA' },
      _sum: { monto: true },
    }),
    prisma.movimientoCaja.aggregate({
      where: { cajaSesionId, tipo: 'SALIDA' },
      _sum: { monto: true },
    }),
  ])
  // La cuenta vive en `arqueo.ts` (pura, cubierta por tests/caja.test.ts).
  const { balanceEsperado, diferencia } = calcularArqueo({
    balanceInicial: Number(sesion.balanceInicial),
    cobrosEfectivo: Number(efectivo._sum.monto ?? 0),
    entradas: Number(entradas._sum.monto ?? 0),
    salidas: Number(salidas._sum.monto ?? 0),
    balanceFinal,
  })

  const meta = await getRequestMeta()
  // Guard atómico: solo cierra si sigue ABIERTA (dos cierres concurrentes → uno gana).
  const cerrada = await prisma.cajaSesion.updateMany({
    where: { id: cajaSesionId, estado: 'ABIERTA' },
    data: {
      estado: 'CERRADA',
      cerradaPorId: auth.userId,
      cerradaAt: new Date(),
      balanceFinal,
      balanceEsperado,
      diferencia,
      observaciones,
    },
  })
  if (cerrada.count === 0) return { error: 'La caja ya fue cerrada.' }

  await prisma.auditLog.create({
    data: {
      companyId: auth.companyId,
      userId: auth.userId,
      accion: 'CAJA_CERRADA',
      entidadTipo: 'CajaSesion',
      entidadId: cajaSesionId,
      payload: {
        sucursal: sesion.sucursal.nombre,
        balanceFinal,
        balanceEsperado,
        diferencia,
        observaciones,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  revalidatePath('/empleado/caja')
  const signo = etiquetaArqueo(diferencia)
  return { success: true, detalle: `Caja cerrada (${signo}).` }
}

/**
 * Movimiento de efectivo intra-turno (G9): entrada (aporte de fondo) o salida
 * (retiro, gasto, pago a proveedor). Requiere caja ABIERTA de la empresa.
 * Afecta el arqueo al cerrar. Nada se elimina; queda auditado.
 */
export async function registrarMovimientoCaja(
  _prev: CajaActionState,
  formData: FormData
): Promise<CajaActionState> {
  const auth = await staffAutorizado()
  if (!auth) return { error: 'No autorizado.' }
  if (!(await formSubmitLimiter(`movcaja:${auth.userId}`))) {
    return { error: 'Demasiados intentos. Espera un momento.' }
  }

  const cajaSesionId = String(formData.get('cajaSesionId') ?? '').trim()
  const tipo = String(formData.get('tipo') ?? '').trim()
  const monto = num(formData.get('monto'))
  const concepto = String(formData.get('concepto') ?? '').trim()

  if (!cajaSesionId) return { error: 'Sesión no especificada.' }
  if (!['ENTRADA', 'SALIDA'].includes(tipo)) return { error: 'Tipo de movimiento no válido.' }
  if (monto == null || monto <= 0) return { error: 'Indica un monto mayor que cero.' }
  if (!concepto) return { error: 'Describe el concepto del movimiento.' }

  const sesion = await prisma.cajaSesion.findFirst({
    where: { id: cajaSesionId, companyId: auth.companyId, estado: 'ABIERTA' },
    select: { id: true },
  })
  if (!sesion) return { error: 'La caja está cerrada: ábrela para registrar movimientos.' }

  const mov = await prisma.movimientoCaja.create({
    data: {
      companyId: auth.companyId,
      cajaSesionId,
      tipo: tipo as 'ENTRADA' | 'SALIDA',
      monto,
      concepto: concepto.slice(0, 200),
      registradoPorId: auth.userId,
      registradoPor: auth.nombre,
    },
    select: { id: true },
  })

  const meta = await getRequestMeta()
  await prisma.auditLog
    .create({
      data: {
        companyId: auth.companyId,
        userId: auth.userId,
        accion: 'CAJA_MOVIMIENTO',
        entidadTipo: 'MovimientoCaja',
        entidadId: mov.id,
        payload: { cajaSesionId, tipo, monto, concepto },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    })
    .catch(anotarFallo('caja:auditoria'))

  revalidatePath('/empleado/caja')
  const etiqueta = tipo === 'ENTRADA' ? 'Entrada' : 'Salida'
  return { success: true, detalle: `${etiqueta} registrada: RD$${monto.toFixed(2)}.` }
}

export async function cobrarOrden(
  _prev: CajaActionState,
  formData: FormData
): Promise<CajaActionState> {
  const auth = await staffAutorizado()
  if (!auth) return { error: 'No autorizado.' }
  if (!(await formSubmitLimiter(`cobro:${auth.userId}`))) {
    return { error: 'Demasiados intentos. Espera un momento.' }
  }

  const cajaSesionId = String(formData.get('cajaSesionId') ?? '').trim()
  const ordenTipo = String(formData.get('ordenTipo') ?? '').trim()
  const ordenId = String(formData.get('ordenId') ?? '').trim()
  const metodoCobro = String(formData.get('metodoCobro') ?? '').trim()
  const observaciones = String(formData.get('observaciones') ?? '').trim() || null

  // Pago MIXTO (Fase 4 · opcional): parte en efectivo + parte en transferencia
  // en un solo cobro. Se registra como una transacción POR CADA parte (misma
  // orden, mismo momento): así el arqueo, el cierre Z y los reportes por
  // método cuadran sin reglas especiales.
  const esMixto = metodoCobro === 'MIXTO'
  const montoEfectivo = Math.round((num(formData.get('montoEfectivo')) ?? 0) * 100) / 100
  const montoTransferencia =
    Math.round((num(formData.get('montoTransferencia')) ?? 0) * 100) / 100

  if (!cajaSesionId || !ordenId) return { error: 'Datos incompletos.' }
  if (!['MEMBRESIA', 'PROMOCION'].includes(ordenTipo)) return { error: 'Tipo de orden no válido.' }
  if (!['EFECTIVO', 'TRANSFERENCIA', 'OTRO', 'MIXTO'].includes(metodoCobro)) {
    return { error: 'Selecciona la forma de pago.' }
  }

  /** Valida las partes del pago mixto contra el total REAL de la orden. */
  const validarMixto = (total: number): string | null => {
    if (!esMixto) return null
    if (total <= 0) return 'Esta orden no tiene monto por cobrar: usa un método simple.'
    if (montoEfectivo <= 0 || montoTransferencia <= 0) {
      return 'En el pago mixto, el efectivo y la transferencia deben ser mayores que cero.'
    }
    if (Math.abs(montoEfectivo + montoTransferencia - total) > 0.009) {
      return `Las dos partes deben sumar RD$${total.toFixed(2)}.`
    }
    return null
  }

  // La caja debe estar ABIERTA y ser de la empresa del empleado.
  const sesion = await prisma.cajaSesion.findFirst({
    where: { id: cajaSesionId, companyId: auth.companyId, estado: 'ABIERTA' },
    select: { id: true, sucursalId: true, sucursal: { select: { nombre: true } } },
  })
  if (!sesion) return { error: 'La caja está cerrada: ábrela para poder cobrar.' }

  const meta = await getRequestMeta()
  const metaAct = { ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null }

  let clienteId: string
  let clienteNombre: string
  let clienteUserId: string | null = null
  let detalle: string
  let monto: number
  let membershipId: string | null = null

  if (ordenTipo === 'MEMBRESIA') {
    const m = await prisma.membership.findFirst({
      where: { id: ordenId, cliente: { companyId: auth.companyId } },
      include: {
        cliente: { select: { id: true, nombre: true, supabaseId: true } },
        plan: { select: { nombre: true, precio: true } },
        planSolicitado: { select: { nombre: true, precio: true } },
      },
    })
    if (!m) return { error: 'Orden no encontrada.' }
    const esCambio = m.estado === 'ACTIVA' && m.planIdSolicitado != null
    if (m.estado === 'ACTIVA' && !esCambio) return { error: 'Esta membresía ya está activa (cobro duplicado).' }

    const plan = esCambio ? m.planSolicitado : m.plan
    const descuento = m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0
    monto = Math.max(0, Number(plan?.precio ?? 0) - descuento)
    clienteId = m.cliente.id
    clienteNombre = m.cliente.nombre
    detalle = `${esCambio ? 'Cambio a ' : 'Plan '}${plan?.nombre ?? ''}`.trim()
    membershipId = m.id

    const errMixto = validarMixto(monto)
    if (errMixto) return { error: errMixto }

    // Activación (punto único): genera QR, aplica cambio de plan y registra
    // el historial. Rechaza estados no activables → anti doble-cobro.
    const res = await activarMembresia(m.id, auth.userId, metaAct)
    if (!res.ok) return { error: res.error }

    const u = await prisma.user.findUnique({ where: { supabaseId: res.supabaseId }, select: { id: true } })
    clienteUserId = u?.id ?? null
  } else {
    const c = await prisma.productoCompra.findFirst({
      where: { id: ordenId, companyId: auth.companyId },
      include: {
        cliente: { select: { id: true, nombre: true, supabaseId: true } },
        promocion: { select: { titulo: true, precio: true } },
      },
    })
    if (!c) return { error: 'Orden no encontrada.' }
    if (c.estado === 'ACTIVA') return { error: 'Esta compra ya está activa (cobro duplicado).' }

    monto = Number(c.precioCongelado ?? c.promocion?.precio ?? 0)
    clienteId = c.cliente.id
    clienteNombre = c.cliente.nombre
    detalle = `Promoción ${c.promocion?.titulo ?? ''}`.trim()

    const errMixto = validarMixto(monto)
    if (errMixto) return { error: errMixto }

    const res = await activarCompraPromocion(c.id, auth.userId, metaAct, {
      motivo: `Cobro en caja (${metodoCobro.toLowerCase()})`,
    })
    if (!res.ok) return { error: res.error }

    const u = await prisma.user.findUnique({
      where: { supabaseId: c.cliente.supabaseId ?? '' },
      select: { id: true },
    })
    clienteUserId = u?.id ?? null
  }

  // Transacciones de venta: historial permanente del cobro (quién, dónde,
  // caja, método, monto, observaciones) con ticket y código TX únicos. En el
  // pago MIXTO se crea UNA por parte (efectivo y transferencia): cada una
  // suma en su método, así que el arqueo y los reportes cuadran solos.
  const METODO_ETIQUETA: Record<string, string> = {
    EFECTIVO: 'Efectivo',
    TRANSFERENCIA: 'Transferencia',
    OTRO: 'Otro',
  }
  const partes: { metodo: 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO'; monto: number }[] = esMixto
    ? [
        { metodo: 'EFECTIVO', monto: montoEfectivo },
        { metodo: 'TRANSFERENCIA', monto: montoTransferencia },
      ]
    : [{ metodo: metodoCobro as 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO', monto }]

  const txs: { codigo: string; ticketNumero: string }[] = []
  let refMixto: string | null = null
  for (const [i, parte] of partes.entries()) {
    const etiquetaMetodo = esMixto
      ? `${METODO_ETIQUETA[parte.metodo]} (pago mixto ${i + 1}/${partes.length})`
      : METODO_ETIQUETA[parte.metodo]
    const tx = await crearTransaccionAplicada(prisma, {
      tipo: 'SALE',
      companyId: auth.companyId,
      sucursalId: sesion.sucursalId,
      clienteId,
      empleadoId: auth.userId,
      caja: sesion.sucursal.nombre,
      cajaSesionId: sesion.id,
      monto: parte.monto,
      metodoCobro: parte.metodo,
      membershipId,
      snapshot: {
        detalle,
        cliente: clienteNombre,
        empleado: auth.nombre,
        sucursal: sesion.sucursal.nombre,
        servicio: detalle,
        ordenTipo,
        ordenId,
        observaciones,
        // Factura: líneas estructuradas + totales (consultables e imprimibles).
        lineas: [
          {
            descripcion: detalle,
            cantidad: 1,
            precioUnitario: parte.monto,
            descuento: 0,
            total: parte.monto,
          },
        ],
        subtotal: parte.monto.toFixed(2),
        total: parte.monto.toFixed(2),
        metodoCobroLabel: etiquetaMetodo,
        // Trazabilidad del cobro dividido: total real y referencia cruzada
        // al comprobante de la otra parte.
        ...(esMixto
          ? {
              pagoMixto: true,
              pagoMixtoTotal: monto.toFixed(2),
              ...(refMixto ? { pagoMixtoRef: refMixto } : {}),
            }
          : {}),
      },
      auditoria: { ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      resultado: observaciones,
      userId: auth.userId,
    })
    refMixto = refMixto ?? tx.codigo
    txs.push(tx)
  }

  await prisma.auditLog.create({
    data: {
      companyId: auth.companyId,
      userId: auth.userId,
      accion: 'COBRO_REGISTRADO',
      entidadTipo: ordenTipo === 'MEMBRESIA' ? 'Membership' : 'ProductoCompra',
      entidadId: ordenId,
      payload: {
        codigo: txs.map((t) => t.codigo).join(' + '),
        monto,
        metodoCobro,
        ...(esMixto ? { montoEfectivo, montoTransferencia } : {}),
        detalle,
        cajaSesionId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  })

  // Aviso al cliente: su pago quedó confirmado y el beneficio activo.
  if (clienteUserId) {
    await crearNotificacion({
      userId: clienteUserId,
      tipo: 'PAGO_APROBADO',
      titulo: 'Pago recibido en sucursal',
      mensaje: `Recibimos tu pago de RD$${monto.toLocaleString('es-DO')} (${detalle}). ¡Ya está activo!`,
      href: ordenTipo === 'MEMBRESIA' ? `/membresia/${ordenId}` : `/cliente/mis-promociones/${ordenId}`,
    }).catch(anotarFallo('caja:notificacion-pago'))
  }

  revalidatePath('/empleado/caja')
  return {
    success: true,
    detalle: esMixto
      ? `Cobro mixto registrado · ${txs.map((t) => t.codigo).join(' + ')} (efectivo RD$${montoEfectivo.toFixed(2)} + transferencia RD$${montoTransferencia.toFixed(2)}).`
      : `Cobro registrado · ${txs[0].codigo} (ticket ${txs[0].ticketNumero}).`,
  }
}
