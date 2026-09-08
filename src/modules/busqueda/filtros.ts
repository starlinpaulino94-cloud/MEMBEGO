import type { Prisma } from '@prisma/client'

export const EMPRESA_PUBLICA = { isActive: true, isPublished: true, esDemo: false } satisfies Prisma.CompanyWhereInput

export function filtrosPromociones(terminos: readonly string[], ahora: Date): Prisma.PromocionWhereInput {
  return {
    activo: true, archivada: false, visibilidad: 'publica', company: EMPRESA_PUBLICA,
    publicadaEn: { lte: ahora }, vigenciaDesde: { lte: ahora },
    AND: [{ OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gt: ahora } }] }],
    OR: terminos.flatMap((term): Prisma.PromocionWhereInput[] => [
      { titulo: { contains: term, mode: 'insensitive' } },
      { descripcion: { contains: term, mode: 'insensitive' } },
      { tags: { has: term } },
    ]),
  }
}

export function filtrosEmpresas(terminos: readonly string[]): Prisma.CompanyWhereInput {
  return { ...EMPRESA_PUBLICA, OR: terminos.flatMap((term): Prisma.CompanyWhereInput[] => [
    { name: { contains: term, mode: 'insensitive' } },
    { description: { contains: term, mode: 'insensitive' } },
    { type: { contains: term, mode: 'insensitive' } },
    { ciudad: { contains: term, mode: 'insensitive' } },
    { provincia: { contains: term, mode: 'insensitive' } },
    { slug: { contains: term, mode: 'insensitive' } },
  ]) }
}

export function textoExcursiones(terminos: readonly string[]): Prisma.ExcursionWhereInput[] {
  return terminos.flatMap((term): Prisma.ExcursionWhereInput[] => [
    { nombre: { contains: term, mode: 'insensitive' } },
    { descripcion: { contains: term, mode: 'insensitive' } },
    { categoria: { contains: term, mode: 'insensitive' } },
    { ubicacion: { contains: term, mode: 'insensitive' } },
  ])
}
