'use server'

/**
 * Acciones del Transaction & Receipt Engine (Fase E4) para el panel.
 * - Consulta de una transacción por código TX-… o por QR usado (escáner).
 * - Payload del ticket para imprimir/reimprimir (empresa + plantilla + datos).
 * - Registro auditado de impresiones/reimpresiones (COPIA #N con motivo).
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { ADMIN_ROLES, SCANNER_ROLES } from '@/types'
import {
  getByCodigo,
  getById,
  registrarImpresionRecibo,
  type TransactionDetalle,
} from '@/lib/transactions'
import { DEFAULT_BLOCK_ORDER } from '@/lib/receipts'
import type {
  ReceiptBlockId,
  ReceiptTemplateConfig,
  ReceiptTransaccionInfo,
  ReceiptEmpresaInfo,
} from '@/lib/receipts'
import { anotarFallo } from '@/lib/prisma-errors'

// ── Info serializable para la pantalla "Historial del QR" ────────────────────

export interface TransaccionScanInfo {
  id: string
  codigo: string
  ticketNumero: string
  estado: string
  fecha: string
  cliente: string | null
  vehiculo: string | null
  empresa: string | null
  sucursal: string | null
  servicio: string | null
  beneficio: string | null
  promocion: string | null
  membresia: string | null
  empleado: string | null
  caja: string | null
  observaciones: string | null
  /** Si fue cancelada/revertida: cuándo y por qué. */
  cancelacion: { fecha: string; motivo: string | null } | null
  reversion: { fecha: string; motivo: string | null } | null
  impresiones: number
  errorDetalle: string | null
}

function toScanInfo(t: TransactionDetalle): TransaccionScanInfo {
  const s = t.snapshot
  const transCancel = t.transiciones.find((x) => x.hacia === 'CANCELLED')
  const transRevert = t.transiciones.find((x) => x.hacia === 'REVERTED')
  return {
    id: t.id,
    codigo: t.codigo,
    ticketNumero: t.ticketNumero,
    estado: t.estado,
    fecha: t.createdAt.toISOString(),
    cliente: (s.cliente as string) ?? null,
    vehiculo: (s.vehiculo as string) ?? null,
    empresa: (s.empresa as string) ?? null,
    sucursal: (s.sucursal as string) ?? null,
    servicio: (s.servicio as string) ?? null,
    beneficio: (s.beneficio as string) ?? null,
    promocion: (s.promocion as string) ?? null,
    membresia: (s.membresia as string) ?? (s.plan as string) ?? null,
    empleado: (s.empleado as string) ?? null,
    caja: t.caja,
    observaciones: t.resultado,
    cancelacion:
      t.cancelledAt || transCancel
        ? {
            fecha: (t.cancelledAt ?? transCancel!.createdAt).toISOString(),
            motivo: transCancel?.motivo ?? null,
          }
        : null,
    reversion:
      t.revertedAt || transRevert
        ? {
            fecha: (t.revertedAt ?? transRevert!.createdAt).toISOString(),
            motivo: transRevert?.motivo ?? null,
          }
        : null,
    impresiones: t.impresiones.length,
    errorDetalle: t.errorDetalle,
  }
}

/** ¿Puede este usuario ver transacciones de esta empresa? */
function autorizado(user: NonNullable<Awaited<ReturnType<typeof getUser>>>, companyId: string) {
  return (
    user.metadata.role === 'SUPERADMIN' ||
    !user.metadata.companyId ||
    user.metadata.companyId === companyId
  )
}

export async function consultarTransaccionPorCodigo(
  codigo: string
): Promise<{ error?: string; transaccion?: TransaccionScanInfo }> {
  const user = await getUser()
  if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
    return { error: 'No autorizado.' }
  }
  const t = await sinEmpresa('transacciones: buscar por código (lookup global)', (tx) =>
    getByCodigo(codigo, tx)
  )
  if (!t) return { error: 'No existe ninguna transacción con ese código.' }
  if (!autorizado(user, t.companyId)) {
    return { error: 'Esta transacción pertenece a otra empresa.' }
  }
  return { transaccion: toScanInfo(t) }
}

// ── Ticket (impresión / reimpresión) ─────────────────────────────────────────

/** Línea estructurada de una venta (factura): cantidad × precio − descuento. */
export interface FacturaLinea {
  descripcion: string
  cantidad: number
  precioUnitario: number
  descuento: number
  total: number
}

export interface TicketPayload {
  empresa: ReceiptEmpresaInfo
  template: ReceiptTemplateConfig
  transaccion: Omit<ReceiptTransaccionInfo, 'fecha'> & { fecha: string }
  timeZone: string
  transactionId: string
  /** Factura: líneas estructuradas y método de pago (ventas de caja). */
  lineas: FacturaLinea[]
  metodoPago: string | null
  /** true = comprobante de entrega (regalo/beneficio sin valor comercial). */
  esEntrega: boolean
}

export async function obtenerTicket(
  transactionId: string
): Promise<{ error?: string; ticket?: TicketPayload }> {
  const user = await getUser()
  if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
    return { error: 'No autorizado.' }
  }
  const t = await sinEmpresa('transacciones: buscar transacción por id', (tx) =>
    getById(transactionId, tx)
  )
  if (!t) return { error: 'Transacción no encontrada.' }
  if (!autorizado(user, t.companyId)) {
    return { error: 'Esta transacción pertenece a otra empresa.' }
  }

  const [company, plantilla] = await conEmpresa(t.companyId, (tx) =>
    Promise.all([
      tx.company.findUnique({
        where: { id: t.companyId },
        select: {
          name: true, direccion: true, telefono: true, website: true,
          logoUrl: true, zonaHoraria: true,
        },
      }),
      tx.receiptTemplate.findUnique({ where: { companyId: t.companyId } }),
    ])
  )
  if (!company) return { error: 'Empresa no encontrada.' }

  const s = t.snapshot
  const lineasRaw = Array.isArray(s.lineas) ? (s.lineas as Record<string, unknown>[]) : []
  return {
    ticket: {
      transactionId: t.id,
      timeZone: company.zonaHoraria,
      esEntrega: s.esEntrega === true,
      lineas: lineasRaw.map((l) => ({
        descripcion: String(l.descripcion ?? ''),
        cantidad: Number(l.cantidad ?? 1),
        precioUnitario: Number(l.precioUnitario ?? 0),
        descuento: Number(l.descuento ?? 0),
        total: Number(l.total ?? 0),
      })),
      metodoPago: (s.metodoCobroLabel as string) ?? null,
      empresa: {
        nombre: company.name,
        sucursal: (s.sucursal as string) ?? null,
        direccion: company.direccion,
        telefono: company.telefono,
        web: company.website,
        logoUrl: company.logoUrl,
      },
      template: (plantilla?.config ?? {}) as ReceiptTemplateConfig,
      transaccion: {
        codigo: t.codigo,
        ticketNumero: t.ticketNumero,
        fecha: t.createdAt.toISOString(),
        caja: t.caja,
        empleado: (s.empleado as string) ?? null,
        cliente: (s.cliente as string) ?? null,
        vehiculo: (s.vehiculo as string) ?? null,
        placa: (s.placa as string) ?? null,
        membresia: (s.membresia as string) ?? null,
        plan: (s.plan as string) ?? null,
        nivel: (s.nivel as string) ?? null,
        puntos: (s.puntos as number) ?? null,
        servicio: (s.servicio as string) ?? null,
        promocion: (s.promocion as string) ?? null,
        beneficio: (s.beneficio as string) ?? null,
        descuento: (s.descuento as string) ?? null,
        subtotal: (s.subtotal as string) ?? null,
        total: (s.total as string) ?? null,
        restantes: (s.restantes as number | 'ilimitado') ?? null,
        observaciones: t.resultado,
        promosActivas: (s.promosActivas as string[]) ?? [],
        metodoPago: (s.metodoCobroLabel as string) ?? null,
        referenciaPago: (s.referenciaPago as string) ?? null,
      },
    },
  }
}

export async function registrarImpresionTx(
  transactionId: string,
  motivo?: string
): Promise<{ error?: string; numero?: number; esCopia?: boolean }> {
  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
      return { error: 'No autorizado.' }
    }
    const t = await sinEmpresa('transacciones: buscar transacción por id', (tx) =>
      tx.transaction.findUnique({
        where: { id: transactionId },
        select: { companyId: true },
      })
    )
    if (!t) return { error: 'Transacción no encontrada.' }
    if (!autorizado(user, t.companyId)) return { error: 'No autorizado.' }

    const { numero, esCopia } = await conEmpresa(t.companyId, (tx) =>
      registrarImpresionRecibo(
        transactionId,
        {
          empleadoId: user.metadata.dbUserId ?? null,
          motivo: motivo?.trim() || null,
        },
        tx
      )
    )

    const meta = await getRequestMeta()
    await conEmpresa(t.companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId: t.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'COMPROBANTE_IMPRESO',
          entidadTipo: 'Transaction',
          entidadId: transactionId,
          payload: { numero, esCopia, motivo: motivo ?? null },
          ...meta,
        },
      })
    ).catch(anotarFallo('transacciones:auditLog.create'))

    return { numero, esCopia }
  } catch {
    return { error: 'No se pudo registrar la impresión.' }
  }
}

// ── Anulación / devolución de una transacción (Fase 4) ───────────────────────

/**
 * Anula (contablemente) una transacción APLICADA: la pasa a CANCELLED con un
 * motivo obligatorio, registra la transición y deja auditoría. Al quedar fuera
 * de APPLIED, deja de sumar en cierres, cuadres y reportes. Solo admin de la
 * misma empresa. NO revierte automáticamente efectos de negocio (p. ej. la
 * activación de una membresía): esa corrección es una acción aparte.
 */
export async function anularTransaccion(
  transactionId: string,
  motivo: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const user = await getUser()
    if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
      return { error: 'No autorizado.' }
    }
    const motivoLimpio = motivo.trim()
    if (motivoLimpio.length < 3) return { error: 'Indica el motivo de la anulación.' }

    const t = await sinEmpresa('transacciones: buscar transacción por id', (tx) =>
      tx.transaction.findUnique({
        where: { id: transactionId },
        select: { companyId: true, estado: true },
      })
    )
    if (!t) return { error: 'Transacción no encontrada.' }
    if (!autorizado(user, t.companyId)) return { error: 'No autorizado.' }
    if (t.estado !== 'APPLIED') {
      return { error: 'Solo se pueden anular transacciones aplicadas.' }
    }

    // Guard atómico: solo anula si sigue APPLIED (evita doble anulación).
    const res = await conEmpresa(t.companyId, async (tx) => {
      const upd = await tx.transaction.updateMany({
        where: { id: transactionId, estado: 'APPLIED' },
        data: { estado: 'CANCELLED', cancelledAt: new Date() },
      })
      if (upd.count === 0) return null
      await tx.transactionTransicion.create({
        data: {
          transactionId,
          desde: 'APPLIED',
          hacia: 'CANCELLED',
          motivo: motivoLimpio.slice(0, 300),
          userId: user.metadata.dbUserId ?? null,
        },
      })
      return true
    })
    if (res === null) return { error: 'La transacción ya no está aplicada.' }

    const meta = await getRequestMeta()
    await conEmpresa(t.companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId: t.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'TRANSACCION_ANULADA',
          entidadTipo: 'Transaction',
          entidadId: transactionId,
          payload: { motivo: motivoLimpio },
          ...meta,
        },
      })
    ).catch(anotarFallo('transacciones:auditLog.create'))

    revalidatePath('/admin/registros')
    revalidatePath('/admin/facturas')
    return { success: true }
  } catch (e) {
    console.error('[transacciones] anularTransaccion:', e)
    return { error: 'No se pudo anular la transacción.' }
  }
}

/**
 * Anulación MASIVA: pasa a CANCELLED todas las transacciones APLICADAS de un
 * cliente (limpieza de cuentas de PRUEBA / corrección contable). Dejan de
 * sumar en ganancias, cierres, cuadres y reportes al instante. Nada se
 * elimina: cada transacción conserva su historial, se registra la transición
 * con el motivo y queda un AuditLog con el total anulado.
 */
export async function anularTransaccionesCliente(
  clienteId: string,
  motivo: string
): Promise<{ error?: string; success?: boolean; anuladas?: number }> {
  try {
    const user = await getUser()
    if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
      return { error: 'No autorizado.' }
    }
    const motivoLimpio = motivo.trim()
    if (motivoLimpio.length < 3) return { error: 'Indica el motivo de la anulación.' }

    const cliente = await sinEmpresa('transacciones: buscar cliente por id', (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: { companyId: true, nombre: true },
      })
    )
    if (!cliente) return { error: 'Cliente no encontrado.' }
    if (!autorizado(user, cliente.companyId)) return { error: 'No autorizado.' }

    // Guard atómico por fila: solo cambia lo que sigue APPLIED.
    const { anuladas, ids } = await conEmpresa(cliente.companyId, async (tx) => {
      const aplicadas = await tx.transaction.findMany({
        where: { clienteId, companyId: cliente.companyId, estado: 'APPLIED' },
        select: { id: true },
      })
      if (aplicadas.length === 0) return { anuladas: 0, ids: [] as string[] }
      const upd = await tx.transaction.updateMany({
        where: { id: { in: aplicadas.map((t) => t.id) }, estado: 'APPLIED' },
        data: { estado: 'CANCELLED', cancelledAt: new Date() },
      })
      return { anuladas: upd.count, ids: aplicadas.map((t) => t.id) }
    })
    if (ids.length === 0) return { success: true, anuladas: 0 }

    await conEmpresa(cliente.companyId, (tx) =>
      tx.transactionTransicion.createMany({
        data: ids.map((id) => ({
          transactionId: id,
          desde: 'APPLIED' as const,
          hacia: 'CANCELLED' as const,
          motivo: motivoLimpio.slice(0, 300),
          userId: user.metadata.dbUserId ?? null,
        })),
      })
    ).catch((e) => console.error('[transacciones] transiciones masivas:', e))

    const meta = await getRequestMeta()
    await conEmpresa(cliente.companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId: cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'TRANSACCION_ANULADA',
          entidadTipo: 'Cliente',
          entidadId: clienteId,
          payload: { motivo: motivoLimpio, anuladas, masiva: true, cliente: cliente.nombre },
          ...meta,
        },
      })
    ).catch(anotarFallo('transacciones:auditLog.create'))

    revalidatePath('/admin/registros')
    revalidatePath('/admin/facturas')
    revalidatePath(`/admin/clientes/${clienteId}`)
    return { success: true, anuladas }
  } catch (e) {
    console.error('[transacciones] anularTransaccionesCliente:', e)
    return { error: 'No se pudieron anular las transacciones.' }
  }
}

// ── Plantilla del comprobante por empresa (personalizable sin código) ─────────

const MAX_TEXTO = 200

function texto(v: unknown, max = MAX_TEXTO): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t || undefined
}

/** Whitelist + saneo del config recibido del cliente. */
function sanitizarPlantilla(raw: ReceiptTemplateConfig): ReceiptTemplateConfig {
  const bloquesValidos = new Set<ReceiptBlockId>(DEFAULT_BLOCK_ORDER)
  const blockOrder = Array.isArray(raw.blockOrder)
    ? (raw.blockOrder.filter(
        (b, i, arr) => bloquesValidos.has(b) && arr.indexOf(b) === i
      ) as ReceiptBlockId[])
    : undefined

  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)

  return {
    paperWidthMm: raw.paperWidthMm === 58 ? 58 : raw.paperWidthMm === 80 ? 80 : undefined,
    blockOrder: blockOrder && blockOrder.length > 0 ? blockOrder : undefined,
    mostrarLogo: bool(raw.mostrarLogo),
    rnc: texto(raw.rnc, 40),
    lineasEncabezado: Array.isArray(raw.lineasEncabezado)
      ? raw.lineasEncabezado
          .map((l) => texto(l, 80))
          .filter((l): l is string => Boolean(l))
          .slice(0, 4)
      : undefined,
    mostrarVehiculo: bool(raw.mostrarVehiculo),
    mostrarPuntos: bool(raw.mostrarPuntos),
    mostrarNivel: bool(raw.mostrarNivel),
    mostrarPromocion: bool(raw.mostrarPromocion),
    mostrarBeneficio: bool(raw.mostrarBeneficio),
    mostrarTotales: bool(raw.mostrarTotales),
    mostrarQr: bool(raw.mostrarQr),
    mensajePie: texto(raw.mensajePie),
    web: texto(raw.web, 100),
    redes: texto(raw.redes),
    politicas: texto(raw.politicas, 300),
    proximaVisita: texto(raw.proximaVisita),
    mostrarPromosActivas: bool(raw.mostrarPromosActivas),
  }
}

export async function guardarPlantillaRecibo(
  companyId: string,
  config: ReceiptTemplateConfig
): Promise<{ error?: string; success?: boolean }> {
  try {
    const user = await getUser()
    if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
      return { error: 'No autorizado.' }
    }
    if (!autorizado(user, companyId)) return { error: 'No autorizado para esta empresa.' }

    const limpio = sanitizarPlantilla(config ?? {})
    // Solo se persisten las claves definidas (lo demás usa el default).
    const data = JSON.parse(JSON.stringify(limpio)) as Prisma.InputJsonObject

    await conEmpresa(companyId, (tx) =>
      tx.receiptTemplate.upsert({
        where: { companyId },
        create: { companyId, config: data },
        update: { config: data },
      })
    )

    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'PLANTILLA_RECIBO_ACTUALIZADA',
          entidadTipo: 'ReceiptTemplate',
          entidadId: companyId,
          payload: data,
          ...meta,
        },
      })
    ).catch(anotarFallo('transacciones:auditLog.create'))

    revalidatePath('/admin/perfil')
    return { success: true }
  } catch (e) {
    console.error('[transacciones] guardarPlantillaRecibo:', e)
    return { error: 'No se pudo guardar la plantilla del comprobante.' }
  }
}
