/**
 * El payload del ticket (lo que imprimen el escáner, la caja, Facturas y el
 * comprobante del cliente) construido desde una Transaction.
 *
 * Vive fuera de `actions.ts` ('use server') para que lo puedan usar los
 * caminos sin sesión de panel: el comprobante que el propio cliente abre
 * desde «Mis pagos» (web) o desde la app por un enlace firmado.
 */

import type { TransactionRecord } from '@/lib/transactions'
import type {
  ReceiptTemplateConfig,
  ReceiptTransaccionInfo,
  ReceiptEmpresaInfo,
} from '@/lib/receipts'

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

export interface EmpresaDelTicket {
  name: string
  direccion: string | null
  telefono: string | null
  website: string | null
  logoUrl: string | null
  zonaHoraria: string
}

export function construirTicketPayload(
  t: TransactionRecord,
  company: EmpresaDelTicket,
  plantilla: { config: unknown } | null
): TicketPayload {
  const s = t.snapshot
  const lineasRaw = Array.isArray(s.lineas) ? (s.lineas as Record<string, unknown>[]) : []
  return {
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
  }
}
