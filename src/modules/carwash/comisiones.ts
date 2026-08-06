import { conEmpresa } from '@/lib/tenant'

/**
 * App Car Wash · Fase 2 — COMISIONES POR LAVADOR.
 *
 * POR QUÉ SE CONGELA Y NO SE CALCULA AL CONSULTAR:
 * la comisión se guarda como una fila propia al ENTREGAR el vehículo. Si se
 * recalculara al abrir la pantalla, subir mañana la comisión del detallado
 * reescribiría lo que ya se le debía a la gente por trabajos de la semana
 * pasada. Eso no se ve en un log: se ve en la nómina, y se discute con quien
 * lavó el carro.
 *
 * ENCENDER EL MÓDULO NO MUEVE DINERO. Un servicio sin tarifa de comisión paga
 * cero. Hasta que alguien llene las tarifas en el catálogo, todo devenga cero
 * — deliberado: nadie se encuentra una nómina inventada por haber probado una
 * capacidad.
 */

export const COMISION_ESTADOS = ['PENDIENTE', 'PAGADA', 'ANULADA'] as const
export type ComisionEstado = (typeof COMISION_ESTADOS)[number]

export const COMISION_ESTADO_LABELS: Record<ComisionEstado, string> = {
  PENDIENTE: 'Por pagar',
  PAGADA: 'Pagada',
  ANULADA: 'Anulada',
}

export interface LineaComisionable {
  nombre: string
  precio: number
  cantidad: number
  comisionPorcentaje: number | null
  comisionMonto: number | null
}

export interface CalculoComision {
  base: number
  monto: number
  detalle: string
}

/**
 * Calcula la comisión de una orden a partir de sus líneas.
 *
 * Regla por línea: si hay porcentaje se usa ese sobre el precio COBRADO; si no,
 * el monto fijo por unidad. Ambos nulos = esa línea no paga. Se prefiere el
 * porcentaje porque es lo que un dueño ajusta primero, y tener los dos activos
 * a la vez en una misma línea sería ambiguo.
 *
 * Función pura: se puede probar sin base de datos, que es justo lo que uno
 * quiere de la aritmética que termina en un sobre de pago.
 */
export function calcularComision(lineas: LineaComisionable[]): CalculoComision {
  let base = 0
  let monto = 0
  const partes: string[] = []

  for (const l of lineas) {
    const totalLinea = l.precio * l.cantidad
    base += totalLinea
    if (l.comisionPorcentaje != null && l.comisionPorcentaje > 0) {
      const c = redondear(totalLinea * (l.comisionPorcentaje / 100))
      monto += c
      partes.push(`${l.nombre} ${l.comisionPorcentaje}% = ${c.toFixed(2)}`)
    } else if (l.comisionMonto != null && l.comisionMonto > 0) {
      const c = redondear(l.comisionMonto * l.cantidad)
      monto += c
      partes.push(`${l.nombre} ${l.cantidad}×${l.comisionMonto.toFixed(2)} = ${c.toFixed(2)}`)
    }
  }

  return {
    base: redondear(base),
    monto: redondear(monto),
    detalle: partes.join(' · ') || 'Sin servicios con comisión configurada',
  }
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Devenga la comisión de una entrada de cola ya entregada.
 *
 * IDEMPOTENTE por el `@@unique([colaId, userId])`: entregar dos veces el mismo
 * vehículo (doble clic, reintento tras un error de red) no paga dos veces.
 * Se apoya en la restricción de la base de datos y no en un `findFirst` previo,
 * porque entre el findFirst y el create cabe otra petición.
 *
 * Devuelve null cuando no hay nada que devengar: sin lavador asignado, sin
 * líneas, o la comisión da cero.
 */
export async function devengarComision(
  companyId: string,
  colaId: string
): Promise<{ monto: number } | null> {
  try {
    const cola = await conEmpresa(companyId, (tx) =>
      tx.colaVehiculo.findFirst({
        where: { id: colaId, companyId },
        select: {
          atendidoPorId: true,
          servicios: {
            select: {
              nombre: true,
              precio: true,
              cantidad: true,
              servicio: { select: { comisionPorcentaje: true, comisionMonto: true } },
            },
          },
        },
      })
    )
    // Sin lavador asignado no hay a quién pagarle. No es un error: muchos
    // negocios no asignan al inicio, y forzarlo trabaría la entrega.
    if (!cola?.atendidoPorId || cola.servicios.length === 0) return null
    // A const: dentro del closure de conEmpresa se pierde el estrechamiento.
    const atendidoPorId = cola.atendidoPorId

    const calculo = calcularComision(
      cola.servicios.map((s) => ({
        nombre: s.nombre,
        precio: Number(s.precio),
        cantidad: s.cantidad,
        comisionPorcentaje:
          s.servicio?.comisionPorcentaje == null ? null : Number(s.servicio.comisionPorcentaje),
        comisionMonto: s.servicio?.comisionMonto == null ? null : Number(s.servicio.comisionMonto),
      }))
    )
    if (calculo.monto <= 0) return null

    await conEmpresa(companyId, (tx) =>
      tx.comision.create({
        data: {
          companyId,
          colaId,
          userId: atendidoPorId,
          base: calculo.base,
          monto: calculo.monto,
          detalle: calculo.detalle,
        },
      })
    )
    return { monto: calculo.monto }
  } catch {
    // Choque con el unique (ya devengada) o tabla sin migrar. En ninguno de los
    // dos casos se puede tumbar la entrega del vehículo: el cliente está
    // esperando su llave.
    return null
  }
}

export interface ComisionFila {
  id: string
  fecha: Date
  lavador: string
  placa: string | null
  base: number
  monto: number
  detalle: string | null
  estado: string
  loteRef: string | null
}

export interface ResumenLavador {
  userId: string
  nombre: string
  vehiculos: number
  pendiente: number
  pagado: number
}

export interface PanelComisiones {
  filas: ComisionFila[]
  porLavador: ResumenLavador[]
  totales: { pendiente: number; pagado: number; vehiculos: number }
  /** Servicios sin tarifa: sin esto el módulo devenga cero y parece roto. */
  serviciosSinTarifa: number
}

/**
 * Panel de comisiones del período. `null` = migración sin correr.
 */
export async function getPanelComisiones(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<PanelComisiones | null> {
  try {
    const [filas, serviciosSinTarifa] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.comision.findMany({
          where: { companyId, createdAt: { gte: desde, lte: hasta } },
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: {
            id: true,
            createdAt: true,
            base: true,
            monto: true,
            detalle: true,
            estado: true,
            loteRef: true,
            user: { select: { id: true, name: true, email: true } },
            cola: { select: { placa: true, vehiculo: { select: { placa: true } } } },
          },
        }),
        tx.servicio.count({
          where: {
            companyId,
            activo: true,
            comisionPorcentaje: null,
            comisionMonto: null,
          },
        }),
      ])
    )

    const porLavador = new Map<string, ResumenLavador>()
    let pendiente = 0
    let pagado = 0

    for (const f of filas) {
      const monto = Number(f.monto)
      const nombre = f.user.name || f.user.email || 'Sin nombre'
      const acc = porLavador.get(f.user.id) ?? {
        userId: f.user.id,
        nombre,
        vehiculos: 0,
        pendiente: 0,
        pagado: 0,
      }
      acc.vehiculos += 1
      if (f.estado === 'PAGADA') {
        acc.pagado += monto
        pagado += monto
      } else if (f.estado === 'PENDIENTE') {
        acc.pendiente += monto
        pendiente += monto
      }
      porLavador.set(f.user.id, acc)
    }

    return {
      filas: filas.map((f) => ({
        id: f.id,
        fecha: f.createdAt,
        lavador: f.user.name || f.user.email || 'Sin nombre',
        placa: f.cola.placa ?? f.cola.vehiculo?.placa ?? null,
        base: Number(f.base),
        monto: Number(f.monto),
        detalle: f.detalle,
        estado: f.estado,
        loteRef: f.loteRef,
      })),
      porLavador: [...porLavador.values()].sort((a, b) => b.pendiente - a.pendiente),
      totales: { pendiente: redondear(pendiente), pagado: redondear(pagado), vehiculos: filas.length },
      serviciosSinTarifa,
    }
  } catch {
    return null
  }
}
