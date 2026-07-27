import { prisma } from '@/lib/prisma'

/**
 * CAMPAÑAS GLOBALES — marketing conjunto entre empresas, definido por el
 * superadmin una sola vez.
 *
 * CÓMO FUNCIONA: la campaña es una PLANTILLA. Al aplicarla, se GENERA una
 * promoción o un plan REAL dentro de cada empresa participante. Cada empresa
 * lo ve como propio, lo puede pausar o ajustar, y todos los motores que ya
 * existen (canje, QR, caja, facturación, reportes) funcionan sin cambios.
 *
 * POR QUÉ ASÍ Y NO CON UNA FILA "GLOBAL": todo el sistema asume UNA empresa
 * dueña por fila (`companyId`). Una promoción sin dueño obligaría a tocar las
 * 33 consultas de promociones, el canje, la caja y los reportes — justo el
 * núcleo que las reglas del proyecto prohíben reescribir. Este módulo NO toca
 * nada existente: solo crea filas normales.
 */

export const CAMPANA_TIPOS = ['PROMOCION', 'PLAN'] as const
export type CampanaTipo = (typeof CAMPANA_TIPOS)[number]

export const CAMPANA_TIPO_LABELS: Record<CampanaTipo, string> = {
  PROMOCION: 'Promoción / oferta',
  PLAN: 'Membresía (plan)',
}

export const CAMPANA_ESTADOS = ['BORRADOR', 'APLICADA', 'ARCHIVADA'] as const
export type CampanaEstado = (typeof CAMPANA_ESTADOS)[number]

export const CAMPANA_ESTADO_LABELS: Record<CampanaEstado, string> = {
  BORRADOR: 'Borrador',
  APLICADA: 'Aplicada',
  ARCHIVADA: 'Archivada',
}

/** Campos de la plantilla de una campaña de PROMOCIÓN. */
export interface PlantillaPromocion {
  titulo: string
  descripcion: string
  tipo: string
  descuento?: number | null
  imagenUrl?: string | null
  vigenciaHasta?: string | null
  esComprable?: boolean
  precio?: number | null
  usosPorCompra?: number
}

/** Campos de la plantilla de una campaña de MEMBRESÍA. */
export interface PlantillaPlan {
  nombre: string
  precio: number
  lavadosIncluidos: number
  esIlimitado?: boolean
  descripcion?: string | null
  vigenciaDias?: number
  condiciones?: string | null
}

export type Plantilla = PlantillaPromocion | PlantillaPlan

/** Normaliza la plantilla guardada (tolerante a JSON viejo o corrupto). */
export function leerPlantilla(tipo: CampanaTipo, raw: unknown): Plantilla {
  const p = (raw ?? {}) as Record<string, unknown>
  const texto = (v: unknown, def = '') => (typeof v === 'string' ? v : def)
  const numero = (v: unknown, def: number | null = null) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : def
  }

  if (tipo === 'PLAN') {
    return {
      nombre: texto(p.nombre, 'Plan'),
      precio: numero(p.precio, 0) ?? 0,
      lavadosIncluidos: numero(p.lavadosIncluidos, 0) ?? 0,
      esIlimitado: p.esIlimitado === true,
      descripcion: texto(p.descripcion) || null,
      vigenciaDias: numero(p.vigenciaDias, 30) ?? 30,
      condiciones: texto(p.condiciones) || null,
    }
  }
  return {
    titulo: texto(p.titulo, 'Promoción'),
    descripcion: texto(p.descripcion),
    tipo: texto(p.tipo, 'general'),
    descuento: numero(p.descuento),
    imagenUrl: texto(p.imagenUrl) || null,
    vigenciaHasta: texto(p.vigenciaHasta) || null,
    esComprable: p.esComprable === true,
    precio: numero(p.precio),
    usosPorCompra: numero(p.usosPorCompra, 1) ?? 1,
  }
}

export interface CampanaResumen {
  id: string
  nombre: string
  tipo: string
  estado: string
  descripcion: string | null
  todasLasEmpresas: boolean
  aplicadaAt: Date | null
  createdAt: Date
  /** Empresas participantes y cuántas ya recibieron su copia. */
  totalEmpresas: number
  aplicadas: number
  conError: number
}

export async function getCampanasGlobales(): Promise<CampanaResumen[]> {
  const campanas = await prisma.campanaGlobal.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      participantes: {
        select: { aplicadaAt: true, error: true },
      },
    },
  })
  return campanas.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    tipo: c.tipo,
    estado: c.estado,
    descripcion: c.descripcion,
    todasLasEmpresas: c.todasLasEmpresas,
    aplicadaAt: c.aplicadaAt,
    createdAt: c.createdAt,
    totalEmpresas: c.participantes.length,
    aplicadas: c.participantes.filter((p) => p.aplicadaAt != null).length,
    conError: c.participantes.filter((p) => p.error != null).length,
  }))
}

export async function getCampanaGlobal(id: string) {
  return prisma.campanaGlobal.findUnique({
    where: { id },
    include: {
      creadaPor: { select: { name: true, email: true } },
      participantes: {
        include: { company: { select: { id: true, name: true, isActive: true } } },
        orderBy: { createdAt: 'asc' },
      },
      pasos: {
        include: { company: { select: { id: true, name: true } } },
        orderBy: { orden: 'asc' },
      },
    },
  })
}
