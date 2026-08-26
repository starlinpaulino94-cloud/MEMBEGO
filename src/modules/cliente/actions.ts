'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  companyIdPorSlug,
  excursionesPublicas,
  calcularDisponibilidad,
  type SalidaDisponible,
} from '@/modules/excursiones/catalogo/public-queries'
import { asegurarClienteEnEmpresa } from '@/modules/cliente/afiliacion'
import { cookies } from 'next/headers'
import { VENDEDOR_COOKIE } from '@/modules/excursiones/atribucion/registrar'

export interface ClienteActionState {
  error?: string
  success?: boolean
}

/**
 * Lista todas las empresas donde el usuario logueado tiene una cuenta de
 * cliente. Siempre usa el supabaseId de la sesión (nunca uno recibido como
 * argumento) para no exponer datos de otros usuarios.
 */
export async function getClienteCompanies() {
  const user = await getUser()
  if (!user) return []
  // select explícito (nunca include completo): un include de `company` trae
  // TODAS sus columnas y cualquier columna aún no migrada en producción
  // rompería esta query — que corre en cada navegación del cliente.
  return sinEmpresa('cliente: listar mis empresas (cuentas cross-tenant)', (tx) =>
    tx.cliente.findMany({
      where: { supabaseId: user.supabaseId },
      select: {
        id: true,
        companyId: true,
        company: { select: { id: true, name: true, logoUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
  )
}

/**
 * Cambia el contexto de empresa activo del cliente (app_metadata.clienteId/companyId).
 * Requiere que ya exista un registro Cliente del usuario en esa empresa.
 */
export async function switchCompany(companyId: string): Promise<ClienteActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') {
      return { error: 'No autorizado.' }
    }

    const cliente = await sinEmpresa('cliente: verificar cuenta en la empresa destino', (tx) =>
      tx.cliente.findUnique({
        where: { supabaseId_companyId: { supabaseId: user.supabaseId, companyId } },
      })
    )
    if (!cliente) {
      return { error: 'No tienes una cuenta en esa empresa.' }
    }

    const dbUser = await sinEmpresa('cliente: buscar mi user por supabaseId', (tx) =>
      tx.user.findUnique({
        where: { supabaseId: user.supabaseId },
      })
    )

    const admin = createAdminClient()
    await admin.auth.admin.updateUserById(user.supabaseId, {
      app_metadata: {
        role: 'CLIENTE',
        dbUserId: dbUser?.id ?? user.metadata.dbUserId,
        clienteId: cliente.id,
        companyId: cliente.companyId,
      },
    })

    // Acotado al destino: las páginas del cliente son dinámicas y el
    // redirect fuerza render fresco; la purga global ('/','layout')
    // invalidaba también las páginas públicas ISR.
    revalidatePath('/mis-membresias')
  } catch (e) {
    console.error('[cliente] switchCompany error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
  // Fuera del try: redirect() lanza NEXT_REDIRECT y el catch lo convertía
  // en "error inesperado" aunque el cambio de empresa ya estaba aplicado.
  redirect('/mis-membresias')
}

export interface AfiliacionState {
  error?: string
}

/**
 * Afilia al cliente logueado a OTRA empresa sin volver a registrarse.
 * Un mismo usuario (User/supabaseId) puede tener una cuenta de Cliente por
 * empresa; esta acción crea la que falte, la sigue, cambia el contexto activo
 * y lo lleva a elegir su membresía. Si ya es miembro, solo cambia el contexto.
 */
export async function afiliarmeAEmpresa(
  _prev: AfiliacionState,
  formData: FormData
): Promise<AfiliacionState> {
  // Determinar redirect: si vino por enlace de vendedor o la empresa tiene excursiones, ir allí; si no, a planes
  let destino = '/cliente/planes'
  const companySlug = String(formData.get('companySlug') ?? '').trim()
  const enlaceSlug = String(formData.get('enlaceSlug') ?? '').trim() || null
  if (companySlug) {
    if (enlaceSlug) {
      destino = `/empresas/${companySlug}/excursiones?e=${encodeURIComponent(enlaceSlug)}`
    } else {
      const cid = await companyIdPorSlug(companySlug)
      if (cid) {
        const exc = await excursionesPublicas(cid)
        if (exc.length > 0) destino = `/empresas/${companySlug}/excursiones`
      }
    }
  }
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') {
      return { error: 'Inicia sesión con tu cuenta de cliente.' }
    }

    const company = await sinEmpresa('cliente: buscar empresa por slug', (tx) =>
      tx.company.findUnique({
        where: { slug: companySlug },
        select: { id: true, isActive: true },
      })
    )
    if (!company || !company.isActive) {
      return { error: 'Empresa no encontrada o no disponible.' }
    }

    const dbUser = await sinEmpresa('cliente: buscar mi user por supabaseId', (tx) =>
      tx.user.findUnique({
        where: { supabaseId: user.supabaseId },
        select: { id: true, name: true },
      })
    )
    if (!dbUser) return { error: 'No se encontró tu cuenta.' }

    // Usar la función centralizada que también maneja atribución de vendedor
    const resultado = await asegurarClienteEnEmpresa(user.supabaseId, user.email, company.id, enlaceSlug)
    if ('error' in resultado) return { error: resultado.error }

    const clienteId = resultado.clienteId

    // Cambia el contexto activo a esta empresa.
    const admin = createAdminClient()
    await admin.auth.admin.updateUserById(user.supabaseId, {
      app_metadata: {
        role: 'CLIENTE',
        dbUserId: dbUser.id,
        clienteId,
        companyId: company.id,
      },
    })

    // Consumir cookie de atribución (un solo uso)
    if (enlaceSlug) {
      try {
        const store = await cookies()
        store.delete(VENDEDOR_COOKIE)
      } catch {
        /* ignore */
      }
    }

    revalidatePath('/', 'layout')
  } catch (e) {
    console.error('[cliente] afiliarmeAEmpresa error:', e)
    return { error: 'No se pudo completar. Intenta de nuevo.' }
  }
  // El redirect va fuera del try: lanza NEXT_REDIRECT y no debe capturarse.
  redirect(destino)
}

/** Update the logged-in cliente's nombre and telefono. */
export async function actualizarPerfil(
  _prev: ClienteActionState,
  formData: FormData
): Promise<ClienteActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'No autorizado.' }
    }

    const nombre = String(formData.get('nombre') ?? '').trim()
    const telefono = String(formData.get('telefono') ?? '').trim()

    if (!nombre) return { error: 'El nombre es obligatorio.' }

    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }
    const clienteId = user.metadata.clienteId
    await conEmpresa(companyId, (tx) =>
      tx.cliente.update({
        where: { id: clienteId },
        data: { nombre, telefono: telefono || null },
      })
    )

    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/dashboard')
    return { success: true }
  } catch (e) {
    console.error('[cliente] actualizarPerfil error:', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Forma REAL de lo que devuelve `buscarUnificado`.
 *
 * Antes esta interfaz describía otra cosa —`moneda` y `empresa` en las
 * promociones, y sin `empresas`— y las dos pantallas que la consumen la
 * esquivaban con `as any[]`. Un tipo que nadie puede usar no protege nada:
 * describe lo que se devuelve, para que el compilador vuelva a servir.
 */
export interface EmpresaResumen {
  id: string
  slug: string
  name: string
  logoUrl: string | null
}

export interface BuscadorUnificadoResult {
  promociones: Array<{
    id: string
    titulo: string
    slug: string | null
    descripcion: string
    precio: number | null
    tipo: string
    descuento: number | null
    codigo: string | null
    vigenciaDesde: Date
    vigenciaHasta: Date | null
    imagenUrl: string | null
    isFeatured: boolean
    viewCount: number
    shareCount: number
    tags: string[]
    createdAt: Date
    company: EmpresaResumen
  }>
  excursiones: Array<{
    id: string
    nombre: string
    slug: string
    descripcion: string | null
    portadaUrl: string | null
    categoria: string | null
    moneda: string
    duracionMin: number | null
    ubicacion: string | null
    precioDesde: number | null
    empresa: EmpresaResumen
    agotadaGlobal: boolean
    todasFechasPasadas: boolean
    cupoDisponible: number | null
    proximasSalidas: SalidaDisponible[]
  }>
  /** Empresas que coinciden con el texto. Puede faltar en las salidas vacías. */
  empresas?: Array<
    EmpresaResumen & {
      type: string
      bannerUrl: string | null
      ciudad: string | null
      descripcion: string | null
      totalMembersCount: number
      activePromotionsCount: number
      isFeatured: boolean
      desdePlan: { nombre: string; precio: number } | null
    }
  >
}

/**
 * Búsqueda unificada: busca en promociones y excursiones simultáneamente.
 * Prioriza promociones en los resultados.
 */
export async function buscarUnificado(
  query: string
): Promise<BuscadorUnificadoResult | { error: string }> {
  if (!query.trim()) {
    return { promociones: [], excursiones: [] }
  }

  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') {
      return { promociones: [], excursiones: [] }
    }

    const supabaseId = user.supabaseId
    const q = query.trim()

    // Buscar en promociones (públicas + privadas de las empresas del usuario) y empresas
    const [promocionesPublicas, promocionesMias, rawEmpresas] = await Promise.all([
      sinEmpresa('buscador: promociones públicas', (tx) =>
        tx.promocion.findMany({
          where: {
            visibilidad: 'publica',
            activo: true,
            OR: [
              { titulo: { contains: q, mode: 'insensitive' } },
              { descripcion: { contains: q, mode: 'insensitive' } },
              { tags: { hasSome: [q] } },
            ],
          },
          select: {
            id: true,
            titulo: true,
            slug: true,
            descripcion: true,
            precio: true,
            tipo: true,
            descuento: true,
            codigo: true,
            vigenciaDesde: true,
            vigenciaHasta: true,
            imagenUrl: true,
            isFeatured: true,
            viewCount: true,
            shareCount: true,
            createdAt: true,
            tags: true,
            company: { select: { id: true, slug: true, name: true, logoUrl: true, moneda: true } },
          },
          take: 12,
        }),
      ),
      sinEmpresa('buscador: promociones en mis empresas', (tx) =>
        tx.promocion.findMany({
          where: {
            visibilidad: 'publica',
            activo: true,
            company: {
              clientes: {
                some: { supabaseId },
              },
            },
            OR: [
              { titulo: { contains: q, mode: 'insensitive' } },
              { descripcion: { contains: q, mode: 'insensitive' } },
              { tags: { hasSome: [q] } },
            ],
          },
          select: {
            id: true,
            titulo: true,
            slug: true,
            descripcion: true,
            precio: true,
            tipo: true,
            descuento: true,
            codigo: true,
            vigenciaDesde: true,
            vigenciaHasta: true,
            imagenUrl: true,
            isFeatured: true,
            viewCount: true,
            shareCount: true,
            createdAt: true,
            tags: true,
            company: { select: { id: true, slug: true, name: true, logoUrl: true, moneda: true } },
          },
          take: 12,
        }),
      ),
      sinEmpresa('buscador: empresas', (tx) =>
        tx.company.findMany({
          where: {
            isActive: true,
            isPublished: true,
            esDemo: false,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { type: { contains: q, mode: 'insensitive' } },
              { ciudad: { contains: q, mode: 'insensitive' } },
              { provincia: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            name: true,
            slug: true,
            type: true,
            description: true,
            logoUrl: true,
            bannerUrl: true,
            ciudad: true,
            totalMembersCount: true,
            activePromotionsCount: true,
            isFeatured: true,
            // OJO: los campos de `Plan` están en español (nombre/precio/
            // activo), no en inglés como los de `Company`. El esquema mezcla
            // los dos idiomas según la época en que nació cada modelo.
            plans: {
              where: { activo: true },
              orderBy: { precio: 'asc' },
              select: { nombre: true, precio: true },
              take: 1,
            },
          },
          take: 12,
        })
      ),
    ])

    const empresasMapped = rawEmpresas.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      type: c.type,
      logoUrl: c.logoUrl,
      bannerUrl: c.bannerUrl,
      ciudad: c.ciudad,
      descripcion: c.description,
      totalMembersCount: c.totalMembersCount,
      activePromotionsCount: c.activePromotionsCount,
      isFeatured: c.isFeatured,
      desdePlan: c.plans[0] ? { nombre: c.plans[0].nombre, precio: Number(c.plans[0].precio) } : null,
    }))

    // Combinar y deduplicar promociones
    const promocionesMap = new Map<string, typeof promocionesPublicas[0]>()
    for (const p of [...promocionesPublicas, ...promocionesMias]) {
      if (!promocionesMap.has(p.id)) promocionesMap.set(p.id, p)
    }
    const promociones = Array.from(promocionesMap.values()).slice(0, 12)

    // Obtener empresas donde el usuario es cliente
    const clienteIds = await sinEmpresa('buscador: mis fichas', (tx) =>
      tx.cliente.findMany({
        where: { supabaseId },
        select: { companyId: true },
      })
    )
    const companyIds = clienteIds.map((c) => c.companyId)

    // Empresas que pueden salir en la parte PÚBLICA del buscador.
    //
    // Antes esto era `company: { isActive: true, isPublished: true }` dentro
    // del `where` de la excursión, o sea una relación Prisma hacia el núcleo.
    // El módulo no la tiene a propósito (ver la convención en
    // prisma/schema/excursiones.prisma), así que la visibilidad se resuelve en
    // una consulta aparte y viaja como lista de ids.
    //
    // Se añade `esDemo: false`, que faltaba: la empresa de demostración tiene
    // excursiones sembradas y no puede aparecer en un buscador público.
    const empresasVisiblesIds = (
      await sinEmpresa('buscador: empresas visibles al público', (tx) =>
        tx.company.findMany({
          where: { isActive: true, isPublished: true, esDemo: false },
          select: { id: true },
        })
      )
    ).map((c) => c.id)

    // Buscar en excursiones (públicas + de las empresas donde el usuario es cliente)
    const [excursionesPublicas, excursionesMias] = await Promise.all([
      sinEmpresa('buscador: excursiones públicas', (tx) =>
        tx.excursion.findMany({
          where: {
            estado: 'ACTIVA',
            companyId: { in: empresasVisiblesIds },
            OR: [
              { nombre: { contains: q, mode: 'insensitive' } },
              { descripcion: { contains: q, mode: 'insensitive' } },
              { categoria: { contains: q, mode: 'insensitive' } },
              { ubicacion: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            nombre: true,
            slug: true,
            descripcion: true,
            portadaUrl: true,
            categoria: true,
            moneda: true,
            duracionMin: true,
            ubicacion: true,
            capacidad: true,
            horaSalida: true,
            horaRegreso: true,
            // Solo el id de la empresa. La ficha se resuelve APARTE, en bloque:
            // hacia el núcleo el módulo guarda el id plano, sin @relation
            // (convención escrita en prisma/schema/excursiones.prisma).
            companyId: true,
            tipoItem: true,
            comboItems: {
              orderBy: { orden: 'asc' },
              select: {
                horaSalida: true,
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
              select: { precioAdulto: true },
              take: 1,
            },
            horarios: {
              where: { activo: true },
              orderBy: { horaSalida: 'asc' },
              select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
            },
          },
          take: 16,
        })
      ),
      companyIds.length > 0
        ? sinEmpresa('buscador: excursiones en mis empresas', (tx) =>
            tx.excursion.findMany({
              where: {
                companyId: { in: companyIds },
                estado: 'ACTIVA',
                OR: [
                  { nombre: { contains: q, mode: 'insensitive' } },
                  { descripcion: { contains: q, mode: 'insensitive' } },
                  { categoria: { contains: q, mode: 'insensitive' } },
                  { ubicacion: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: {
                id: true,
                nombre: true,
                slug: true,
                descripcion: true,
                portadaUrl: true,
                categoria: true,
                moneda: true,
                duracionMin: true,
                ubicacion: true,
                capacidad: true,
                horaSalida: true,
                horaRegreso: true,
                // Igual que arriba: id plano, la ficha se resuelve aparte.
                companyId: true,
                tipoItem: true,
                comboItems: {
                  orderBy: { orden: 'asc' },
                  select: {
                    horaSalida: true,
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
                  select: { precioAdulto: true },
                  take: 1,
                },
                horarios: {
                  where: { activo: true },
                  orderBy: { horaSalida: 'asc' },
                  select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
                },
              },
              take: 16,
            })
          )
        : Promise.resolve([]),
    ])

    const excursionesMap = new Map<string, typeof excursionesPublicas[0]>()
    for (const e of [...excursionesPublicas, ...excursionesMias]) {
      if (!excursionesMap.has(e.id)) excursionesMap.set(e.id, e)
    }
    const rawExcursiones = Array.from(excursionesMap.values()).slice(0, 16)

    // Fichas de empresa en BLOQUE, por id. Es el precedente del módulo
    // (`catalogo/search-queries.ts` hace lo mismo): una consulta para todas en
    // vez de un `include` por fila.
    const idsDeEmpresa = [...new Set(rawExcursiones.map((e) => e.companyId))]
    const fichasEmpresa = await sinEmpresa('buscador: fichas de empresa de las excursiones', (tx) =>
      tx.company.findMany({
        where: { id: { in: idsDeEmpresa } },
        select: { id: true, slug: true, name: true, logoUrl: true, moneda: true },
      })
    )
    const empresaPorId = new Map(fichasEmpresa.map((c) => [c.id, c]))

    // Calcular disponibilidad real y filtrar estrictamente las atrasadas/finalizadas
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    const excursionesConInfo = (
      await Promise.all(
        rawExcursiones.map(async (exc) => {
          const empresa = empresaPorId.get(exc.companyId)
          // Sin ficha de empresa no hay tarjeta que pintar (nombre, logo, enlace).
          // Se descarta aquí en vez de devolver un hueco que cada pantalla
          // tendría que esquivar por su cuenta.
          if (!empresa) return null
          const disponibilidad = await calcularDisponibilidad(
            exc.companyId,
            exc.id,
            exc.capacidad,
            // `diasSemana` es JSON en el esquema (evoluciona sin migrar); el
            // cálculo lo trata como number[]. Mismo casteo que los demás
            // llamadores de `calcularDisponibilidad`.
            exc.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
            exc.horaRegreso,
            exc.horaSalida,
            exc.tipoItem,
            exc.comboItems as any
          )

          // Salidas futuras válidas no pasadas
          const salidasFuturas = (disponibilidad.proximasSalidas || []).filter(
            (s) => !s.fechaPasada
          )

          // Excluir si todas las fechas pasaron o no tiene salidas futuras vigentes
          if (disponibilidad.todasFechasPasadas || salidasFuturas.length === 0) {
            return null
          }

          return {
            id: exc.id,
            nombre: exc.nombre,
            slug: exc.slug,
            descripcion: exc.descripcion,
            portadaUrl: exc.portadaUrl,
            categoria: exc.categoria,
            duracionMin: exc.duracionMin,
            ubicacion: exc.ubicacion,
            precioDesde: exc.variantes[0]?.precioAdulto ? Number(exc.variantes[0].precioAdulto) : null,
            agotadaGlobal: disponibilidad.agotadaGlobal,
            todasFechasPasadas: false,
            cupoDisponible: salidasFuturas[0]?.cupoDisponible ?? null,
            proximasSalidas: salidasFuturas,
            // La moneda de la excursión manda; la de la empresa es el respaldo.
            // La moneda de la excursión manda; la de la empresa es el respaldo.
            moneda: exc.moneda ?? empresa.moneda ?? 'DOP',
            empresa: {
              id: empresa.id,
              slug: empresa.slug,
              name: empresa.name,
              logoUrl: empresa.logoUrl,
            },
          }
        })
      )
    )
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .slice(0, 12)

    return {
      promociones: promociones.map((p) => ({
        id: p.id,
        titulo: p.titulo,
        slug: p.slug,
        descripcion: p.descripcion || '',
        precio: p.precio ? Number(p.precio) : null,
        tipo: p.tipo,
        descuento: p.descuento ? Number(p.descuento) : null,
        codigo: p.codigo,
        vigenciaDesde: p.vigenciaDesde,
        vigenciaHasta: p.vigenciaHasta,
        imagenUrl: p.imagenUrl,
        isFeatured: p.isFeatured,
        viewCount: p.viewCount,
        shareCount: p.shareCount,
        tags: p.tags,
        createdAt: p.createdAt,
        company: {
          id: p.company.id,
          slug: p.company.slug,
          name: p.company.name,
          logoUrl: p.company.logoUrl,
        },
      })),
      excursiones: excursionesConInfo,
      empresas: empresasMapped,
    }
  } catch (e) {
    console.error('[buscador] buscarUnificado error:', e)
    return { error: 'Error al buscar. Intenta de nuevo.' }
  }
}
