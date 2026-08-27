/**
 * EXCURSIONES · Catálogo — Queries de BÚSQUEDA PÚBLICA.
 *
 * Extiende public-queries.ts con capacidades de búsqueda cross-empresa,
 * filtros avanzados y paginación. Usa las mismas estructuras de datos
 * (ExcursionPublica, SalidaDisponible) y la lógica de disponibilidad.
 */

import { sinEmpresa } from '@/lib/tenant'
import { calcularDisponibilidad, mapRow, type ExcursionPublica } from './public-queries'

export interface FiltrosExcursion {
  companyId?: string
  query?: string
  fechaDesde?: Date
  fechaHasta?: Date
  soloConStock?: boolean
  excluirFinalizadas?: boolean
  categoria?: string
  pagina?: number
  porPagina?: number
}

export interface ResultadoBusqueda {
  excursiones: ExcursionPublica[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl: string | null }[]
}

/**
 * Empresas que PUEDEN salir en la búsqueda pública.
 *
 * Excluye las marcadas como demo. Es la misma regla del marketplace
 * (`marketplace/queries.ts`: `esDemo: false`, y `if (company.esDemo) return
 * null`), y aquí faltaba: el sembrador de demostración crea una empresa de
 * tours entera —excursiones, vendedores, reservas— y sin este filtro esos
 * datos aparecían en la vitrina pública mezclados con los reales. Datos de
 * demostración mezclados con producción es exactamente lo que no puede pasar.
 *
 * Va con `sinEmpresa` porque la pregunta ES cross-tenant: una vitrina pública
 * enseña la oferta de TODAS las empresas. Mismo precedente que
 * `marketplace/marcaUnica.ts`.
 */
async function empresasVisibles(): Promise<string[]> {
  const rows = await sinEmpresa('excursiones: vitrina pública (empresas visibles)', (tx) =>
    tx.company.findMany({
      where: { isActive: true, esDemo: false },
      select: { id: true },
    })
  )
  return rows.map((r) => r.id)
}

/**
 * Búsqueda principal de excursiones públicas con filtros y paginación.
 */
export async function buscarExcursionesPublicas(filtros: FiltrosExcursion = {}): Promise<ResultadoBusqueda> {
  const {
    companyId,
    query,
    fechaDesde,
    fechaHasta,
    soloConStock = false,
    excluirFinalizadas = true,
    categoria,
    pagina = 1,
    porPagina = 12,
  } = filtros

  const skip = (pagina - 1) * porPagina
  const take = porPagina

  // Construir where base: solo excursiones ACTIVAS de empresas VISIBLES.
  // El filtro de empresa va primero: una excursión activa de una empresa demo
  // (o desactivada) no puede aparecer en la vitrina pública.
  const visibles = await empresasVisibles()
  const whereBase: Record<string, unknown> = {
    estado: 'ACTIVA',
    companyId: companyId && visibles.includes(companyId) ? companyId : { in: visibles },
    ...(categoria ? { categoria } : {}),
  }

  // Búsqueda full-text en nombre, descripción, categoría, ubicación
  if (query?.trim()) {
    const q = query.trim()
    whereBase.OR = [
      { nombre: { contains: q, mode: 'insensitive' } },
      { descripcion: { contains: q, mode: 'insensitive' } },
      { categoria: { contains: q, mode: 'insensitive' } },
      { ubicacion: { contains: q, mode: 'insensitive' } },
    ]
  }

  // Obtener total para paginación
  const total = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.excursion.count({ where: whereBase }))

  // Obtener excursiones con select (sin include company)
  const rows = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.excursion.findMany({
    where: whereBase,
    orderBy: { nombre: 'asc' },
    skip,
    take,
    select: {
      id: true,
      // Se lee después para agrupar por empresa y pintar su logo. Faltaba en
      // el select y el código lo pedía igual: en ejecución habría salido
      // `undefined`, y el mapa de empresas se habría quedado vacío — o sea,
      // resultados de búsqueda sin marca y sin enlace a la empresa.
      companyId: true,
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
      tipoItem: true,
      comboItems: {
        orderBy: { orden: 'asc' },
        select: {
          horaSalida: true,
          permitirSolapamiento: true,
          horarioFijo: true,
          actividad: {
            select: {
              id: true,
              nombre: true,
              tipoItem: true,
              capacidad: true,
              horaSalida: true,
              horaRegreso: true,
              horarios: {
                where: { activo: true },
                select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
              },
            },
          },
        },
      },
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: { id: true, nombre: true, precioAdulto: true, precioNino: true, capacidad: true, orden: true },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
      },
    },
  }))

  // Obtener empresas en bulk
  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true, logoUrl: true },
  }))
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  // Calcular disponibilidad para cada excursión
  const excursionesConDisponibilidad = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        exc.companyId,
        exc.id,
        exc.capacidad,
        exc.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
        exc.horaRegreso,
        exc.horaSalida,
        exc.tipoItem,
        exc.comboItems as any
      )
      const company = companyMap.get(exc.companyId)
      const mapped = mapRow({
        ...exc,
        ...disponibilidad,
        company: company ? { id: company.id, slug: company.slug, name: company.name, logoUrl: company.logoUrl } : null,
      })
      return mapped
    })
  )

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  // Filtrar por stock y finalizadas / atrasadas
  let filtradas = excursionesConDisponibilidad
  if (excluirFinalizadas) {
    filtradas = filtradas.filter(
      (e) => !e.todasFechasPasadas && (e.proximasSalidas || []).some((s) => !s.fechaPasada && new Date(s.fecha) >= hoy)
    )
  }
  if (soloConStock) {
    filtradas = filtradas.filter((e) => !e.agotadaGlobal)
  }

  // Filtrar por fecha de salidas (si se especifica)
  if (fechaDesde || fechaHasta) {
    filtradas = filtradas.filter((exc) => {
      if (exc.proximasSalidas.length === 0) return false
      const primeraSalida = new Date(exc.proximasSalidas[0].fecha)
      const ultimaSalida = new Date(exc.proximasSalidas[exc.proximasSalidas.length - 1].fecha)
      if (fechaDesde && ultimaSalida < fechaDesde) return false
      if (fechaHasta && primeraSalida > fechaHasta) return false
      return true
    })
  }

  // Obtener categorías únicas para filtros
  const categorias = [...new Set(rows.map((r) => r.categoria).filter((c): c is string => !!c))].sort()

  // Obtener empresas para filtros
  const empresas = Array.from(companyMap.values())

  return {
    excursiones: filtradas,
    // El total sale del COUNT en la base, no del largo de esta página.
    //
    // Antes era `filtradas.length` —como mucho `porPagina`— así que
    // `totalPaginas` daba 1 SIEMPRE y no había forma de llegar a la página 2:
    // el resto del catálogo era inalcanzable desde el buscador.
    //
    // Aviso conocido: `filtradas` descarta en memoria las salidas agotadas o
    // pasadas, así que una página puede venir más corta que `porPagina`. Es
    // preferible a no poder pasar de página, y es el mismo compromiso que
    // hace cualquier listado que filtre después de paginar.
    total,
    pagina,
    porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
    categorias,
    empresas,
  }
}

/**
 * Búsqueda simplificada para autocompletar / sugerencias.
 */
export async function sugerenciasExcursiones(texto: string, limite = 5): Promise<Pick<ExcursionPublica, 'id' | 'nombre' | 'slug' | 'categoria'>[]> {
  if (!texto.trim() || texto.length < 2) return []

  const visibles = await empresasVisibles()
  const rows = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.excursion.findMany({
    where: {
      estado: 'ACTIVA',
      companyId: { in: visibles },
      OR: [
        { nombre: { contains: texto, mode: 'insensitive' } },
        { categoria: { contains: texto, mode: 'insensitive' } },
      ],
    },
    orderBy: { nombre: 'asc' },
    take: limite,
    select: {
      id: true,
      nombre: true,
      slug: true,
      categoria: true,
      companyId: true,
    },
  }))

  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true },
  }))
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  return rows.map((r) => {
    const c = companyMap.get(r.companyId)
    return {
      id: r.id,
      nombre: r.nombre,
      slug: r.slug,
      categoria: r.categoria,
      company: c ? { id: c.id, slug: c.slug, name: c.name } : null,
    }
  })
}

/**
 * Excursiones destacadas para homepage / landing.
 */
export async function excursionesDestacadas(limite = 6): Promise<ExcursionPublica[]> {
  const visibles = await empresasVisibles()
  const rows = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.excursion.findMany({
    where: { estado: 'ACTIVA', companyId: { in: visibles } },
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true,
      // Se lee después para agrupar por empresa y pintar su logo. Faltaba en
      // el select y el código lo pedía igual: en ejecución habría salido
      // `undefined`, y el mapa de empresas se habría quedado vacío — o sea,
      // resultados de búsqueda sin marca y sin enlace a la empresa.
      companyId: true,
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
      tipoItem: true,
      comboItems: {
        orderBy: { orden: 'asc' },
        select: {
          horaSalida: true,
          permitirSolapamiento: true,
          horarioFijo: true,
          actividad: {
            select: {
              id: true,
              nombre: true,
              tipoItem: true,
              capacidad: true,
              horaSalida: true,
              horaRegreso: true,
              horarios: {
                where: { activo: true },
                select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
              },
            },
          },
        },
      },
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: { id: true, nombre: true, precioAdulto: true, precioNino: true, capacidad: true, orden: true },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
      },
    },
  }))

  const companyIds = [...new Set(rows.map((r) => r.companyId))]
  const companies = await sinEmpresa('excursiones: vitrina pública', (tx) =>
    tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, slug: true, name: true, logoUrl: true },
  }))
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  const excursionesConDisponibilidad = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        exc.companyId,
        exc.id,
        exc.capacidad,
        exc.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
        exc.horaRegreso,
        exc.horaSalida,
        exc.tipoItem,
        exc.comboItems as any
      )
      const company = companyMap.get(exc.companyId)
      return mapRow({
        ...exc,
        ...disponibilidad,
        company: company ? { id: company.id, slug: company.slug, name: company.name, logoUrl: company.logoUrl } : null,
      })
    })
  )

  return excursionesConDisponibilidad.filter((e) => !e.todasFechasPasadas && !e.agotadaGlobal)
}