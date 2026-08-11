import type { Prisma } from '@prisma/client'

/**
 * Filtro del directorio de clientes — UNA definición, dos consumidores.
 *
 * La pantalla y su exportación tienen que buscar exactamente lo mismo. Si cada
 * una construye su propio `where`, la primera vez que alguien añada un filtro
 * a la pantalla el CSV se quedará atrás y nadie se enterará hasta que un
 * informe cuadre mal.
 *
 * Puro (sin Prisma en ejecución, solo su tipo): se importa desde el servidor y
 * desde las rutas de exportación sin arrastrar nada.
 */
export function whereClientes(
  companyId: string | null | undefined,
  busqueda: string
): Prisma.ClienteWhereInput {
  const q = (busqueda ?? '').trim()
  return {
    // La búsqueda se ancla SIEMPRE a la empresa: el término lo escribe el
    // usuario, pero el `companyId` no es negociable ni viaja por la URL.
    ...(companyId ? { companyId } : {}),
    ...(q
      ? {
          OR: [
            { nombre: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { telefono: { contains: q } },
          ],
        }
      : {}),
  }
}
