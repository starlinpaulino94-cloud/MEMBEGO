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
        _count: { select: { variantes: true, horarios: true } },
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
      },
    })
  )
}
