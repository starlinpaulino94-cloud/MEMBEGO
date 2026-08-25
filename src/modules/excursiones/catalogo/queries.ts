import { conEmpresa } from '@/lib/tenant'

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
        tipoItem: 'ACTIVIDAD',
        estado: { not: 'ARCHIVADA' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        nombre: true,
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
