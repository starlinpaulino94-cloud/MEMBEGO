import { prisma } from '@/lib/prisma'

/**
 * App Car Wash · Fase 2 — CUENTAS CORPORATIVAS (flotillas).
 *
 * EL PROBLEMA QUE RESUELVE: una empresa que manda 40 camionetas no paga
 * camioneta por camioneta en caja. Firma el servicio y paga a fin de mes contra
 * un solo RNC. Sin esto, el negocio o pierde ese cliente o lo lleva en un
 * cuaderno — que es lo que pasa hoy.
 *
 * LA PLACA ES LA LLAVE. El encargado no tiene delante un `Cliente` ni una
 * ficha de vehículo: tiene una placa. Por eso `CuentaVehiculo` se indexa por
 * placa normalizada, y el enlace a la ficha (`vehiculoId`) es opcional.
 *
 * TOLERANTE A MIGRACIÓN SIN CORRER: todas las lecturas caen a vacío/null si
 * las tablas no existen todavía. La pista sigue funcionando sin flotas.
 */

export const CARGO_ESTADOS = ['PENDIENTE', 'FACTURADO', 'PAGADO', 'ANULADO'] as const
export type CargoEstado = (typeof CARGO_ESTADOS)[number]

export const CARGO_ESTADO_LABELS: Record<CargoEstado, string> = {
  PENDIENTE: 'Por facturar',
  FACTURADO: 'Facturado',
  PAGADO: 'Pagado',
  ANULADO: 'Anulado',
}

/**
 * Normaliza una placa para compararla: mayúsculas y sin espacios ni guiones.
 *
 * Se aplica AL GUARDAR y AL BUSCAR, siempre por el mismo camino. Si solo se
 * aplicara en uno de los dos, "A123456" no encontraría a "a-123 456" y el
 * vehículo de la flota se cobraría en caja como si fuera de la calle.
 */
export function normalizarPlaca(placa: string): string {
  return placa.trim().toUpperCase().replace(/[\s-]/g, '')
}

export interface CuentaResumen {
  id: string
  nombre: string
  rnc: string | null
  contacto: string | null
  telefono: string | null
  activa: boolean
  limiteCredito: number | null
  diasCredito: number
  vehiculos: number
  /** Deuda viva: cargos PENDIENTE + FACTURADO. */
  saldo: number
  /** Cargos aún sin facturar. */
  porFacturar: number
  /** true = el saldo pasó del límite acordado. */
  excedeLimite: boolean
}

/**
 * Listado de cuentas con su deuda viva.
 * `null` = la migración 20260764 todavía no se corrió (distinto de "no hay
 * flotas"): la pantalla lo dice en vez de fingir que está vacío.
 */
export async function getCuentas(companyId: string): Promise<CuentaResumen[] | null> {
  try {
    const cuentas = await prisma.cuentaCorporativa.findMany({
      where: { companyId },
      orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        rnc: true,
        contacto: true,
        telefono: true,
        activa: true,
        limiteCredito: true,
        diasCredito: true,
        _count: { select: { vehiculos: { where: { activo: true } } } },
      },
    })
    if (cuentas.length === 0) return []

    // Un solo groupBy para todas las cuentas: sumar por cuenta con una consulta
    // por fila convertiría la pantalla en N+1 con 30 flotas.
    const saldos = await prisma.cargoCuenta.groupBy({
      by: ['cuentaId', 'estado'],
      where: { cuentaId: { in: cuentas.map((c) => c.id) } },
      _sum: { monto: true },
    })

    return cuentas.map((c) => {
      const filas = saldos.filter((s) => s.cuentaId === c.id)
      const suma = (estado: string) =>
        Number(filas.find((f) => f.estado === estado)?._sum.monto ?? 0)
      const porFacturar = suma('PENDIENTE')
      const saldo = porFacturar + suma('FACTURADO')
      const limite = c.limiteCredito == null ? null : Number(c.limiteCredito)
      return {
        id: c.id,
        nombre: c.nombre,
        rnc: c.rnc,
        contacto: c.contacto,
        telefono: c.telefono,
        activa: c.activa,
        limiteCredito: limite,
        diasCredito: c.diasCredito,
        vehiculos: c._count.vehiculos,
        saldo,
        porFacturar,
        excedeLimite: limite != null && limite > 0 && saldo > limite,
      }
    })
  } catch {
    // La tabla no existe todavía. Se distingue del vacío legítimo.
    return null
  }
}

export interface CuentaDetalle {
  id: string
  nombre: string
  rnc: string | null
  contacto: string | null
  telefono: string | null
  email: string | null
  notas: string | null
  activa: boolean
  limiteCredito: number | null
  diasCredito: number
  vehiculos: { id: string; placa: string; alias: string | null; activo: boolean }[]
  cargos: {
    id: string
    fecha: Date
    concepto: string
    placa: string | null
    monto: number
    estado: string
    corteRef: string | null
  }[]
  totales: { porFacturar: number; facturado: number; pagado: number; saldo: number }
}

/** Estado de cuenta de una flota. Devuelve null si no es de esta empresa. */
export async function getCuentaDetalle(
  companyId: string,
  cuentaId: string
): Promise<CuentaDetalle | null> {
  try {
    const c = await prisma.cuentaCorporativa.findFirst({
      where: { id: cuentaId, companyId },
      include: {
        vehiculos: {
          orderBy: [{ activo: 'desc' }, { placa: 'asc' }],
          select: { id: true, placa: true, alias: true, activo: true },
        },
        cargos: {
          orderBy: { createdAt: 'desc' },
          take: 300,
          select: {
            id: true,
            createdAt: true,
            concepto: true,
            placa: true,
            monto: true,
            estado: true,
            corteRef: true,
          },
        },
      },
    })
    if (!c) return null

    const porEstado = await prisma.cargoCuenta.groupBy({
      by: ['estado'],
      where: { cuentaId },
      _sum: { monto: true },
    })
    const suma = (e: string) => Number(porEstado.find((x) => x.estado === e)?._sum.monto ?? 0)
    const porFacturar = suma('PENDIENTE')
    const facturado = suma('FACTURADO')

    return {
      id: c.id,
      nombre: c.nombre,
      rnc: c.rnc,
      contacto: c.contacto,
      telefono: c.telefono,
      email: c.email,
      notas: c.notas,
      activa: c.activa,
      limiteCredito: c.limiteCredito == null ? null : Number(c.limiteCredito),
      diasCredito: c.diasCredito,
      vehiculos: c.vehiculos,
      cargos: c.cargos.map((x) => ({
        id: x.id,
        fecha: x.createdAt,
        concepto: x.concepto,
        placa: x.placa,
        monto: Number(x.monto),
        estado: x.estado,
        corteRef: x.corteRef,
      })),
      totales: {
        porFacturar,
        facturado,
        pagado: suma('PAGADO'),
        // Deuda viva: lo pagado ya no se debe, lo anulado nunca se debió.
        saldo: porFacturar + facturado,
      },
    }
  } catch {
    return null
  }
}

/**
 * ¿Esta placa pertenece a una flota activa? Es la pregunta que se hace al
 * entregar un vehículo para decidir si se cobra en caja o se carga a la cuenta.
 */
export async function cuentaDeLaPlaca(
  companyId: string,
  placa: string | null | undefined
): Promise<{ cuentaId: string; nombre: string } | null> {
  if (!placa?.trim()) return null
  try {
    const fila = await prisma.cuentaVehiculo.findFirst({
      where: {
        placa: normalizarPlaca(placa),
        activo: true,
        cuenta: { companyId, activa: true },
      },
      select: { cuenta: { select: { id: true, nombre: true } } },
    })
    return fila ? { cuentaId: fila.cuenta.id, nombre: fila.cuenta.nombre } : null
  } catch {
    return null
  }
}
