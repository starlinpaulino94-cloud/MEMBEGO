import { prisma } from '@/lib/prisma'

/**
 * CATÁLOGO DEL OFICIO (App Car Wash · Fase 1).
 *
 * Tres piezas que faltaban y que se explican juntas:
 *
 *  · TIPO DE VEHÍCULO — la dimensión ausente. Sin ella, "esto cuesta distinto
 *    según el carro" solo podía expresarse duplicando el producto y
 *    escribiéndolo en el nombre ("PLAN SILVER (SUV PEQ)").
 *  · SERVICIO — lo que el negocio vende suelto. Antes solo existían planes
 *    (recurrentes) y promociones (descuentos): faltaba el producto en sí.
 *  · BAHÍA — el puesto de trabajo. La pregunta central de una pista es cuál
 *    está libre, y no había dónde responderla.
 *
 * Todo es POR EMPRESA y nace vacío: una empresa sin catálogo configurado
 * sigue operando exactamente como antes.
 */

// ── Tipos de vehículo ───────────────────────────────────────────────────────

export interface TipoVehiculoItem {
  id: string
  nombre: string
  orden: number
  activo: boolean
  /** Cuántos servicios tienen precio definido para este tipo. */
  serviciosConPrecio: number
}

export async function getTiposVehiculo(companyId: string): Promise<TipoVehiculoItem[]> {
  const tipos = await prisma.tipoVehiculo.findMany({
    where: { companyId },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    include: { _count: { select: { precios: true } } },
  })
  return tipos.map((t) => ({
    id: t.id,
    nombre: t.nombre,
    orden: t.orden,
    activo: t.activo,
    serviciosConPrecio: t._count.precios,
  }))
}

/** Tipos activos, para selectores. */
export async function getTiposVehiculoActivos(companyId: string) {
  return prisma.tipoVehiculo.findMany({
    where: { companyId, activo: true },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: { id: true, nombre: true },
  })
}

// ── Servicios y precios ─────────────────────────────────────────────────────

export interface ServicioItem {
  id: string
  nombre: string
  descripcion: string | null
  categoria: string | null
  duracionMin: number
  esAdicional: boolean
  orden: number
  activo: boolean
  /** Precio por tipo de vehículo: tipoVehiculoId → monto. */
  precios: Record<string, number>
}

export async function getServicios(companyId: string): Promise<ServicioItem[]> {
  const servicios = await prisma.servicio.findMany({
    where: { companyId },
    orderBy: [{ esAdicional: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
    include: { precios: { select: { tipoVehiculoId: true, precio: true } } },
  })
  return servicios.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    descripcion: s.descripcion,
    categoria: s.categoria,
    duracionMin: s.duracionMin,
    esAdicional: s.esAdicional,
    orden: s.orden,
    activo: s.activo,
    precios: Object.fromEntries(s.precios.map((p) => [p.tipoVehiculoId, Number(p.precio)])),
  }))
}

/**
 * Servicios cobrables para un tipo de vehículo concreto: solo los que tienen
 * precio definido para ese tipo. Es lo que se ofrece al recibir un carro.
 */
export async function getServiciosParaTipo(companyId: string, tipoVehiculoId: string) {
  const precios = await prisma.servicioPrecio.findMany({
    where: { tipoVehiculoId, servicio: { companyId, activo: true } },
    include: {
      servicio: {
        select: {
          id: true,
          nombre: true,
          categoria: true,
          duracionMin: true,
          esAdicional: true,
          orden: true,
        },
      },
    },
  })
  return precios
    .map((p) => ({
      servicioId: p.servicio.id,
      nombre: p.servicio.nombre,
      categoria: p.servicio.categoria,
      duracionMin: p.servicio.duracionMin,
      esAdicional: p.servicio.esAdicional,
      orden: p.servicio.orden,
      precio: Number(p.precio),
    }))
    .sort(
      (a, b) =>
        Number(a.esAdicional) - Number(b.esAdicional) ||
        a.orden - b.orden ||
        a.nombre.localeCompare(b.nombre)
    )
}

// ── Bahías ──────────────────────────────────────────────────────────────────

export interface BahiaItem {
  id: string
  nombre: string
  orden: number
  activa: boolean
  sucursalNombre: string | null
}

export async function getBahias(companyId: string): Promise<BahiaItem[]> {
  const bahias = await prisma.bahia.findMany({
    where: { companyId },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    include: { sucursal: { select: { nombre: true } } },
  })
  return bahias.map((b) => ({
    id: b.id,
    nombre: b.nombre,
    orden: b.orden,
    activa: b.activa,
    sucursalNombre: b.sucursal?.nombre ?? null,
  }))
}

// ── Estado del catálogo (para avisar si falta configurarlo) ─────────────────

export interface EstadoCatalogo {
  tipos: number
  servicios: number
  bahias: number
  /** Pares (servicio activo × tipo activo) sin precio: huecos de tarifa. */
  preciosFaltantes: number
  listo: boolean
}

/**
 * Resumen de qué falta configurar. La pista puede operar sin catálogo, pero
 * sin él no hay cobro por servicio ni tiempos esperados: conviene decirlo
 * claro en vez de mostrar pantallas vacías sin explicación.
 */
export async function getEstadoCatalogo(companyId: string): Promise<EstadoCatalogo> {
  const [tipos, servicios, bahias, precios] = await Promise.all([
    prisma.tipoVehiculo.count({ where: { companyId, activo: true } }),
    prisma.servicio.count({ where: { companyId, activo: true } }),
    prisma.bahia.count({ where: { companyId, activa: true } }),
    prisma.servicioPrecio.count({
      where: { servicio: { companyId, activo: true }, tipoVehiculo: { companyId, activo: true } },
    }),
  ])
  return {
    tipos,
    servicios,
    bahias,
    preciosFaltantes: Math.max(0, tipos * servicios - precios),
    listo: tipos > 0 && servicios > 0 && precios > 0,
  }
}
