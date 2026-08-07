import 'server-only'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'

/**
 * Opciones REALES del constructor visual de segmentos (docs/GEOLOCALIZACION.md
 * §10.1: "los filtros se construyen con información real"). Ciudades y
 * sectores son catálogos globales (lectura abierta); los tipos de vehículo y
 * las sucursales son de la empresa del admin.
 */
export async function opcionesConstructor(companyId: string): Promise<{
  ciudades: { id: string; label: string }[]
  sectores: { id: string; label: string }[]
  tiposVehiculo: { id: string; label: string }[]
  sucursales: { id: string; label: string; radioServicioKm: number }[]
}> {
  const [ciudades, sectores, tiposVehiculo, sucursales] = await Promise.all([
    prisma.city.findMany({
      where: { isOperative: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.sector.findMany({
      where: { isOperative: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, city: { select: { name: true } } },
    }),
    conEmpresa(companyId, (tx) =>
      tx.tipoVehiculo.findMany({
        where: { activo: true },
        orderBy: { orden: 'asc' },
        select: { id: true, nombre: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.sucursal.findMany({
        where: { activa: true },
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true, radioServicioKm: true },
      })
    ),
  ])

  return {
    ciudades: ciudades.map((c) => ({ id: c.id, label: c.name })),
    sectores: sectores.map((s) => ({ id: s.id, label: `${s.city.name} · ${s.name}` })),
    tiposVehiculo: tiposVehiculo.map((t) => ({ id: t.id, label: t.nombre })),
    sucursales: sucursales.map((s) => ({
      id: s.id,
      label: s.nombre,
      radioServicioKm: s.radioServicioKm ?? 3,
    })),
  }
}
