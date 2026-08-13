import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'

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

/**
 * ESTADOS DE UNA CAMPAÑA, y por qué son cuatro y no tres.
 *
 * `APLICADA` se escribía SIEMPRE al terminar el reparto, sin mirar el
 * resultado. Si fallaba en las doce empresas, la campaña quedaba en verde
 * diciendo «Aplicada» con un «12 con error» en una insignia pequeña al lado. El
 * estado —lo único que se lee de un vistazo en la lista— decía lo contrario que
 * la realidad.
 *
 * Ahora el estado ES el resultado:
 *  · Ninguna creada  → se queda en BORRADOR. No pasó nada; que no lo parezca.
 *  · Todas creadas   → APLICADA.
 *  · Unas sí, otras no → APLICADA_PARCIAL, que es la verdad y además pide
 *    acción: se vuelve a aplicar y solo se reintentan las que faltan.
 *
 * `estado` es un `String` en el esquema, validado en código: los cuatro valores
 * no necesitan migración.
 */
export const CAMPANA_ESTADOS = [
  'BORRADOR',
  'APLICADA',
  'APLICADA_PARCIAL',
  'ARCHIVADA',
] as const
export type CampanaEstado = (typeof CAMPANA_ESTADOS)[number]

export const CAMPANA_ESTADO_LABELS: Record<CampanaEstado, string> = {
  BORRADOR: 'Borrador',
  APLICADA: 'Aplicada',
  APLICADA_PARCIAL: 'Aplicada con errores',
  ARCHIVADA: 'Archivada',
}

/**
 * El estado que corresponde al resultado de un reparto.
 *
 * `previo` importa: al volver a aplicar una campaña ya APLICADA para incorporar
 * empresas nuevas, si no hay nada pendiente no se crea ninguna copia — y eso no
 * puede devolverla a BORRADOR.
 */
export function estadoTrasAplicar(
  previo: string,
  creadas: number,
  fallos: number
): CampanaEstado {
  const yaEstaba = previo === 'APLICADA' || previo === 'APLICADA_PARCIAL'

  if (creadas > 0) return fallos > 0 ? 'APLICADA_PARCIAL' : 'APLICADA'

  // Ni una sola copia nueva. Marcarla como aplicada era justo el problema.
  if (fallos > 0) {
    // Si ya había copias fuera, la campaña sigue aplicada — pero con fallos.
    // Si no las había, no pasó nada: se queda en borrador.
    return yaEstaba ? 'APLICADA_PARCIAL' : 'BORRADOR'
  }

  // Nada creado y nada fallido: no había pendientes. Se respeta lo que había.
  return yaEstaba ? (previo as CampanaEstado) : 'BORRADOR'
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

/**
 * Campos de la plantilla de una campaña de MEMBRESÍA.
 *
 * `beneficios` y `orden` estaban ausentes, así que cada copia nacía con
 * `beneficios: []` y `orden: 0`: un plan peor que el que cualquiera crea a mano
 * —sin la lista de lo que incluye— y empatado al final de la vitrina con todos
 * los demás.
 */
export interface PlantillaPlan {
  nombre: string
  precio: number
  lavadosIncluidos: number
  esIlimitado?: boolean
  descripcion?: string | null
  /** Uno por línea en el formulario; lista ya separada aquí. */
  beneficios?: string[]
  /** Menor = aparece primero en la vitrina de la empresa. */
  orden?: number
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
      // Tolerante con lo ya guardado: las campañas creadas antes de que la
      // plantilla tuviera estos campos siguen leyéndose sin romperse.
      beneficios: Array.isArray(p.beneficios)
        ? p.beneficios.filter((b): b is string => typeof b === 'string' && b.trim() !== '')
        : [],
      orden: numero(p.orden, 0) ?? 0,
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

export interface ListadoCampanas {
  filas: CampanaResumen[]
  total: number
}

/**
 * El tamaño de página y la forma del filtro viven AQUÍ, no en `campanasFiltros`.
 *
 * Estaban allí y este módulo los importaba, mientras `campanasFiltros`
 * importaba de aquí los estados: un ciclo. TypeScript lo acepta sin rechistar
 * —los tipos se resuelven igual— y revienta en EJECUCIÓN con un
 * «Cannot access 'CAMPANA_ESTADOS' before initialization», que además solo
 * aparece según qué módulo se cargue primero.
 *
 * La dependencia va en un solo sentido: los filtros conocen el dominio, el
 * dominio no conoce los filtros.
 */
export const POR_PAGINA = 25

export interface FiltroCampanas {
  q: string
  /** `todos`, `con-errores`, o uno de `CAMPANA_ESTADOS`. */
  estado: string
  pagina: number
}

/**
 * La lista, filtrada y paginada en la base.
 *
 * `con-errores` no es un estado guardado: es «tiene al menos una empresa
 * participante con error», y se resuelve con un filtro de relación (`some`) en
 * vez de trayendo todo y descartando en memoria. Es la pregunta operativa del
 * módulo —«¿qué quedó a medias?»— y antes había que buscarla a ojo fila por
 * fila.
 */
export async function getCampanasGlobales(
  f: FiltroCampanas = { q: '', estado: 'todos', pagina: 1 }
): Promise<ListadoCampanas> {
  const and: Prisma.CampanaGlobalWhereInput[] = []
  if (f.q) and.push({ nombre: { contains: f.q, mode: 'insensitive' } })
  if (f.estado === 'con-errores') and.push({ participantes: { some: { error: { not: null } } } })
  else if (f.estado !== 'todos') and.push({ estado: f.estado })
  const where: Prisma.CampanaGlobalWhereInput = and.length > 0 ? { AND: and } : {}

  const { campanas, total } = await sinEmpresa(
    'superadmin: listar campañas globales',
    async (tx) => {
      const [campanas, total] = await Promise.all([
        tx.campanaGlobal.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (f.pagina - 1) * POR_PAGINA,
          take: POR_PAGINA,
          include: {
            participantes: {
              select: { aplicadaAt: true, error: true },
            },
          },
        }),
        tx.campanaGlobal.count({ where }),
      ])
      return { campanas, total }
    }
  )
  const filas = campanas.map((c) => ({
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
  return { filas, total }
}

export async function getCampanaGlobal(id: string) {
  return sinEmpresa('superadmin: detalle de campaña global', (tx) =>
    tx.campanaGlobal.findUnique({
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
  )
}
