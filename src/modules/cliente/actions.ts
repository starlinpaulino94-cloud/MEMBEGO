'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { companyIdPorSlug, excursionesPublicas, calcularDisponibilidad } from '@/modules/excursiones/catalogo/public-queries'
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
  // Determinar redirect: si la empresa tiene excursiones, ir allí; si no, a planes
  let destino = '/cliente/planes'
  const companySlug = String(formData.get('companySlug') ?? '').trim()
  const enlaceSlug = String(formData.get('enlaceSlug') ?? '').trim() || null
  if (companySlug) {
    const cid = await companyIdPorSlug(companySlug)
    if (cid) {
      const exc = await excursionesPublicas(cid)
      if (exc.length > 0) destino = `/empresas/${companySlug}/excursiones`
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

export interface BuscadorUnificadoResult {
  promociones: Array<{
    id: string
    titulo: string
    precio: number | null
    moneda: string
    empresa: { id: string; slug: string; name: string; logoUrl: string | null }
    tipo: string
    imagenUrl: string | null
  }>
  excursiones: Array<{
    id: string
    nombre: string
    slug: string
    portadaUrl: string | null
    categoria: string | null
    moneda: string
    duracionMin: number | null
    ubicacion: string | null
    precioDesde: number | null
    empresa: { id: string; slug: string; name: string; logoUrl: string | null }
    agotadaGlobal: boolean
    todasFechasPasadas: boolean
  }>
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
            plans: {
              where: { isActive: true },
              orderBy: { price: 'asc' },
              select: { name: true, price: true },
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
      desdePlan: c.plans[0] ? { nombre: c.plans[0].name, precio: Number(c.plans[0].price) } : null,
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

    // Buscar en excursiones (públicas + de las empresas donde el usuario es cliente)
    const [excursionesPublicas, excursionesMias] = await Promise.all([
      sinEmpresa('buscador: excursiones públicas', (tx) =>
        tx.excursion.findMany({
          where: {
            estado: 'ACTIVA',
            company: { isActive: true, isPublished: true },
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
            companyId: true,
            company: { select: { id: true, slug: true, name: true, logoUrl: true, moneda: true } },
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
                companyId: true,
                company: { select: { id: true, slug: true, name: true, logoUrl: true, moneda: true } },
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

    // Calcular disponibilidad real y filtrar estrictamente las atrasadas/finalizadas
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    const excursionesConInfo = (
      await Promise.all(
        rawExcursiones.map(async (exc) => {
          const disponibilidad = await calcularDisponibilidad(
            exc.companyId,
            exc.id,
            exc.capacidad,
            exc.horarios,
            exc.horaRegreso,
            exc.horaSalida
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
            moneda: exc.company.moneda,
            empresa: {
              id: exc.company.id,
              slug: exc.company.slug,
              name: exc.company.name,
              logoUrl: exc.company.logoUrl,
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
