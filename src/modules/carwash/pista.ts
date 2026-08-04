import { conEmpresa } from '@/lib/tenant'
import { COLA_ACTIVOS } from './cola'

/**
 * LA CABINA (App Car Wash · Fase 1) — el estado de la pista AHORA.
 *
 * Reemplaza los contadores de cierre de día que tenía la portada
 * ("citas de hoy: 0") por lo que un encargado necesita a media jornada:
 * qué bahía está ocupada y con qué, quién lleva más tiempo esperando, y
 * cuánto lleva cada vehículo. En un car wash el tiempo ES el costo.
 */

export interface VehiculoEnPista {
  id: string
  placa: string | null
  descripcion: string | null
  estado: string
  /** Minutos desde que entró a la cola (espera) o desde que arrancó (servicio). */
  minutos: number
  tipoVehiculo: string | null
  /** Servicios que lleva, ya congelados en la orden. */
  servicios: string[]
  /** Suma de las líneas de servicio. */
  total: number
  /** Minutos estimados según el catálogo; null si no hay servicios cargados. */
  estimado: number | null
  atendidoPor: string | null
  clienteNombre: string | null
}

export interface BahiaEnPista {
  id: string
  nombre: string
  ocupadaPor: VehiculoEnPista | null
}

export interface EstadoPista {
  bahias: BahiaEnPista[]
  /** En espera, del que más lleva al que menos. */
  esperando: VehiculoEnPista[]
  /** En servicio pero sin bahía asignada (o sin bahías configuradas). */
  enServicioSinBahia: VehiculoEnPista[]
  listos: VehiculoEnPista[]
  hoy: { atendidos: number; ingresos: number; tiempoMedioMin: number | null }
}

function minutosDesde(d: Date | null | undefined, ahora: number): number {
  if (!d) return 0
  return Math.max(0, Math.round((ahora - d.getTime()) / 60000))
}

type FilaCola = {
  id: string
  placa: string | null
  descripcion: string | null
  estado: string
  createdAt: Date
  inicioAt: Date | null
  bahiaId: string | null
  tipoVehiculo: { nombre: string } | null
  atendidoPor: { name: string | null } | null
  cliente: { nombre: string } | null
  servicios: { nombre: string; precio: unknown; cantidad: number; servicio: { duracionMin: number } }[]
}

function aVehiculo(c: FilaCola, ahora: number): VehiculoEnPista {
  // En espera se cuenta desde que llegó; en servicio, desde que arrancó.
  const referencia = c.estado === 'EN_ESPERA' ? c.createdAt : (c.inicioAt ?? c.createdAt)
  const total = c.servicios.reduce((s, l) => s + Number(l.precio) * l.cantidad, 0)
  const estimado = c.servicios.length
    ? c.servicios.reduce((s, l) => s + l.servicio.duracionMin * l.cantidad, 0)
    : null
  return {
    id: c.id,
    placa: c.placa,
    descripcion: c.descripcion,
    estado: c.estado,
    minutos: minutosDesde(referencia, ahora),
    tipoVehiculo: c.tipoVehiculo?.nombre ?? null,
    servicios: c.servicios.map((l) => l.nombre),
    total,
    estimado,
    atendidoPor: c.atendidoPor?.name ?? null,
    clienteNombre: c.cliente?.nombre ?? null,
  }
}

/**
 * Estado completo de la pista. Tolerante a que la migración de la Fase 1 no
 * esté aplicada: en ese caso devuelve la pista vacía en vez de reventar.
 */
export async function getEstadoPista(
  companyId: string,
  inicioDia: Date
): Promise<EstadoPista | null> {
  try {
    const ahora = Date.now()

    const [bahias, enPista, cerradosHoy] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.bahia.findMany({
          where: { companyId, activa: true },
          orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
          select: { id: true, nombre: true },
        }),
        tx.colaVehiculo.findMany({
          where: { companyId, estado: { in: COLA_ACTIVOS } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            placa: true,
            descripcion: true,
            estado: true,
            createdAt: true,
            inicioAt: true,
            bahiaId: true,
            tipoVehiculo: { select: { nombre: true } },
            atendidoPor: { select: { name: true } },
            cliente: { select: { nombre: true } },
            servicios: {
              select: {
                nombre: true,
                precio: true,
                cantidad: true,
                servicio: { select: { duracionMin: true } },
              },
            },
          },
        }),
        tx.colaVehiculo.findMany({
          where: { companyId, estado: 'ENTREGADO', entregadoAt: { gte: inicioDia } },
          select: {
            inicioAt: true,
            entregadoAt: true,
            servicios: { select: { precio: true, cantidad: true } },
          },
        }),
      ])
    )

    const porId = new Map(enPista.map((c) => [c.id, aVehiculo(c as FilaCola, ahora)]))

    const bahiasEnPista: BahiaEnPista[] = bahias.map((b) => {
      const ocupante = enPista.find((c) => c.bahiaId === b.id && c.estado === 'EN_SERVICIO')
      return { id: b.id, nombre: b.nombre, ocupadaPor: ocupante ? porId.get(ocupante.id)! : null }
    })

    const esperando = enPista
      .filter((c) => c.estado === 'EN_ESPERA')
      .map((c) => porId.get(c.id)!)
      .sort((a, b) => b.minutos - a.minutos)

    const enServicioSinBahia = enPista
      .filter((c) => c.estado === 'EN_SERVICIO' && !bahias.some((b) => b.id === c.bahiaId))
      .map((c) => porId.get(c.id)!)

    const listos = enPista.filter((c) => c.estado === 'LISTO').map((c) => porId.get(c.id)!)

    const ingresos = cerradosHoy.reduce(
      (s, c) => s + c.servicios.reduce((t, l) => t + Number(l.precio) * l.cantidad, 0),
      0
    )
    const duraciones = cerradosHoy
      .filter((c) => c.inicioAt && c.entregadoAt)
      .map((c) => (c.entregadoAt!.getTime() - c.inicioAt!.getTime()) / 60000)
    const tiempoMedioMin = duraciones.length
      ? Math.round(duraciones.reduce((a, b) => a + b, 0) / duraciones.length)
      : null

    return {
      bahias: bahiasEnPista,
      esperando,
      enServicioSinBahia,
      listos,
      hoy: { atendidos: cerradosHoy.length, ingresos, tiempoMedioMin },
    }
  } catch (e) {
    // Migración 20260762 sin aplicar: la app no debe caerse por eso.
    console.error('[carwash pista] estado:', e)
    return null
  }
}
