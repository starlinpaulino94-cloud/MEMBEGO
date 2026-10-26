import { conEmpresa } from '@/lib/tenant'
import type { Prisma } from '@prisma/client'
import type { Paginacion } from '@/lib/paginacion'
import { condicionDeEstadoCatalogo, type VerCatalogo } from './lista'

/** Listado del catálogo con lo que la tabla necesita (sin cargar variantes). */
export async function listadoExcursiones(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.excursion.findMany({
      where: { companyId },
      orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        slug: true,
        tipoItem: true,
        categoria: true,
        moneda: true,
        estado: true,
        createdAt: true,
        variantes: {
          where: { activa: true },
          orderBy: { orden: 'asc' },
          select: { precioAdulto: true },
          take: 1,
        },
        _count: { select: { variantes: true, horarios: true, comboItems: true } },
      },
    })
  )
}

/**
 * El catálogo PAGINADO por el servidor (06 · T-04): el estado, la búsqueda y la página los resuelve la base y devuelve el total
 * real para decir «mostrando N de M». Antes se traían todas las actividades y se filtraban en el navegador.
 */
export async function listarExcursiones(
  companyId: string,
  opciones: { q?: string; ver?: VerCatalogo; paginacion: Pick<Paginacion, 'saltar' | 'tomar'> }
) {
  const { q = '', ver = 'activas', paginacion } = opciones
  const like = { contains: q, mode: 'insensitive' as const }
  const where: Prisma.ExcursionWhereInput = {
    companyId,
    ...condicionDeEstadoCatalogo(ver),
    ...(q ? { OR: [{ nombre: like }, { categoria: like }] } : {}),
  }
  return conEmpresa(companyId, async (tx) => {
    const [filas, total] = await Promise.all([
      tx.excursion.findMany({
        where,
        orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
        skip: paginacion.saltar,
        take: paginacion.tomar,
        select: {
          id: true,
          nombre: true,
          tipoItem: true,
          categoria: true,
          moneda: true,
          estado: true,
          variantes: { where: { activa: true }, orderBy: { orden: 'asc' }, select: { precioAdulto: true }, take: 1 },
          _count: { select: { variantes: true, horarios: true, comboItems: true } },
        },
      }),
      tx.excursion.count({ where }),
    ])
    // Solo si no salió nada: ¿es que no hay actividades, o es que el filtro las esconde?
    const hayAlgunaSinFiltro = filas.length === 0 ? (await tx.excursion.count({ where: { companyId } })) > 0 : true
    return {
      filas: filas.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        tipoItem: e.tipoItem,
        categoria: e.categoria,
        moneda: e.moneda,
        estado: e.estado,
        precioDesde: e.variantes[0] ? Number(e.variantes[0].precioAdulto) : null,
        variantes: e._count.variantes,
        horarios: e._count.horarios,
        enCombo: e._count.comboItems,
      })),
      total,
      hayAlgunaSinFiltro,
    }
  })
}

/** Detalle completo para la pantalla de edición. */
export async function excursionDetalle(companyId: string, excursionId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.excursion.findFirst({
      where: { id: excursionId, companyId },
      include: {
        variantes: { orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }] },
        horarios: { orderBy: { horaSalida: 'asc' } },
        comboItems: {
          include: {
            actividad: {
              select: {
                id: true,
                nombre: true,
                slug: true,
                tipoItem: true,
                portadaUrl: true,
                moneda: true,
                duracionMin: true,
                horaSalida: true,
                horaRegreso: true,
                horarios: {
                  where: { activo: true },
                  select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
                },
              },
            },
          },
          orderBy: { orden: 'asc' },
        },
      },
    })
  )
}

/** Actividades individuales activas elegibles para formar combos. */
export async function actividadesParaCombo(companyId: string, excludeId?: string) {
  const lista = await conEmpresa(companyId, (tx) =>
    tx.excursion.findMany({
      where: {
        companyId,
        tipoItem: { in: ['ACTIVIDAD', 'PASE_DIA'] },
        estado: { not: 'ARCHIVADA' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        nombre: true,
        tipoItem: true,
        categoria: true,
        moneda: true,
        duracionMin: true,
        horaSalida: true,
        horaRegreso: true,
        capacidad: true,
        variantes: {
          where: { activa: true },
          orderBy: { orden: 'asc' },
          take: 1,
          select: { precioAdulto: true, precioNino: true },
        },
        horarios: {
          where: { activo: true },
          select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
        },
      },
      orderBy: { nombre: 'asc' },
    })
  )

  return lista.map((item) => ({
    id: item.id,
    nombre: item.nombre,
    tipoItem: item.tipoItem,
    categoria: item.categoria,
    moneda: item.moneda,
    duracionMin: item.duracionMin,
    horaSalida: item.horaSalida,
    horaRegreso: item.horaRegreso,
    capacidad: item.capacidad,
    precioAdulto: item.variantes[0]?.precioAdulto ? Number(item.variantes[0].precioAdulto) : null,
    precioNino: item.variantes[0]?.precioNino ? Number(item.variantes[0].precioNino) : null,
    horarios: item.horarios.map((h) => ({
      id: h.id,
      horaSalida: h.horaSalida,
      cupo: h.cupo,
      diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
    })),
  }))
}
