/**
 * EXCURSIONES · Catálogo — Queries PÚBLICAS (sin RLS admin).
 *
 * Estas queries leyeron excursiones activas para clientes y visitantes.
 * No usan conEmpresa (RLS) porque el contexto público no tiene company_id
 * en el JWT — se resuelve el companyId desde el slug de la empresa.
 */

import { prisma } from '@/lib/prisma'
import type { Decimal } from '@prisma/client/runtime/library'

/** Convierte Decimal a number de forma segura (Prisma devuelve Decimal para campos Decimal). */
function toNum(d: Decimal | null): number | null {
  return d == null ? null : Number(d)
}

/** Convierte los Decimal de una fila de Prisma a number para el tipo ExcursionPublica. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): ExcursionPublica {
  return {
    ...r,
    impuestoPct: toNum(r.impuestoPct as unknown as Decimal | null),
    variantes: r.variantes.map((v: (typeof r.variantes)[number]) => ({
      ...v,
      precioAdulto: Number(v.precioAdulto),
      precioNino: toNum(v.precioNino as unknown as Decimal | null),
    })),
  }
}

export interface ExcursionPublica {
  id: string
  nombre: string
  slug: string
  descripcion: string | null
  portadaUrl: string | null
  galeria: unknown
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: string
  impuestoPct: number | null
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
  variantes: {
    id: string
    nombre: string
    precioAdulto: number
    precioNino: number | null
    capacidad: number | null
    orden: number
  }[]
  horarios: {
    id: string
    diasSemana: number[]
    horaSalida: string
    cupo: number | null
  }[]
}

/** Excursiones ACTIVAS de una empresa, para listados públicos. */
export async function excursionesPublicas(companyId: string): Promise<ExcursionPublica[]> {
  const rows = await prisma.excursion.findMany({
    where: { companyId, estado: 'ACTIVA' },
    orderBy: { nombre: 'asc' },
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: {
          id: true,
          nombre: true,
          precioAdulto: true,
          precioNino: true,
          capacidad: true,
          orden: true,
        },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: {
          id: true,
          diasSemana: true,
          horaSalida: true,
          cupo: true,
        },
      },
    },
  })
  // Prisma devuelve Decimal para campos Decimal; convertir a number.
  return rows.map(mapRow)
}

/** Detalle de una excursión pública por slug. */
export async function excursionPublica(
  companyId: string,
  slug: string
): Promise<ExcursionPublica | null> {
  const row = await prisma.excursion.findFirst({
    where: { companyId, slug, estado: 'ACTIVA' },
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: {
          id: true,
          nombre: true,
          precioAdulto: true,
          precioNino: true,
          capacidad: true,
          orden: true,
        },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: {
          id: true,
          diasSemana: true,
          horaSalida: true,
          cupo: true,
        },
      },
    },
  })
  return row ? mapRow(row) : null
}

/** Reserva de una excursión por ID (para páginas de confirmación). */
export async function excursionPorId(
  companyId: string,
  excursionId: string
): Promise<ExcursionPublica | null> {
  const row = await prisma.excursion.findFirst({
    where: { id: excursionId, companyId, estado: 'ACTIVA' },
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: {
          id: true,
          nombre: true,
          precioAdulto: true,
          precioNino: true,
          capacidad: true,
          orden: true,
        },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: {
          id: true,
          diasSemana: true,
          horaSalida: true,
          cupo: true,
        },
      },
    },
  })
  return row ? mapRow(row) : null
}

/** companyId desde slug de empresa (para resolver en páginas públicas). */
export async function companyIdPorSlug(slug: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { slug },
    select: { id: true },
  })
  return company?.id ?? null
}
