'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import { requireAdminUser, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { slugDisponible } from '@/modules/promociones/slug'
import { notificarSeguidoresEmpresa } from '@/modules/notificaciones/service'
import { esTipoValido, esVisibilidadValida } from '@/lib/promociones'
import {
  syncCreate, syncUpdate, syncStatusChange, syncDelete, syncDuplicate,
  type LegacyPromoData,
} from '@/modules/promociones/bridge'

export interface PromocionState {
  error?: string
  success?: boolean
}

/** Campos de Promociones 2.0 compartidos entre crear y actualizar. */
function parsePromocion(formData: FormData): { error: string } | {
  // Share Engine: textos propios al compartir (persistidos aparte).
  share: { shareTitulo: string | null; shareDescripcion: string | null }
  data: {
    titulo: string
    descripcion: string
    imagenUrl: string | null
    tipo: string
    descuento: number | null
    codigo: string | null
    visibilidad: string
    vigenciaDesde: Date
    vigenciaHasta: Date | null
    maxCanjes: number | null
    prioridad: number
    campanaId: string | null
    // Fase E5: venta como producto comercial
    esComprable: boolean
    precio: number | null
    usosPorCompra: number
    limitePorCliente: number | null
    beneficioVigenciaDias: number | null
    beneficioVigenciaHasta: Date | null
    diasPermitidos: number[]
    horaDesde: string | null
    horaHasta: string | null
  }
} {
  const titulo = String(formData.get('titulo') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const imagenUrl = String(formData.get('imagenUrl') ?? '').trim() || null
  const tipo = String(formData.get('tipo') ?? 'general').trim()
  const codigo = String(formData.get('codigo') ?? '').trim() || null
  // Share Engine: textos propios al compartir (vacío = usar título/descripción).
  const shareTitulo = String(formData.get('shareTitulo') ?? '').trim().slice(0, 120) || null
  const shareDescripcion = String(formData.get('shareDescripcion') ?? '').trim().slice(0, 200) || null
  const visibilidad = String(formData.get('visibilidad') ?? 'publica').trim()
  const campanaRaw = String(formData.get('campanaId') ?? '').trim()
  const campanaId = campanaRaw && campanaRaw !== 'none' ? campanaRaw : null

  const descuentoRaw = String(formData.get('descuento') ?? '').trim()
  const descuento = descuentoRaw ? Number(descuentoRaw) : null
  const maxCanjesRaw = String(formData.get('maxCanjes') ?? '').trim()
  const maxCanjes = maxCanjesRaw ? Number(maxCanjesRaw) : null
  const prioridadRaw = String(formData.get('prioridad') ?? '').trim()
  const prioridad = prioridadRaw ? Number(prioridadRaw) : 0

  const desdeRaw = String(formData.get('vigenciaDesde') ?? '').trim()
  const hastaRaw = String(formData.get('vigenciaHasta') ?? '').trim()
  const vigenciaDesde = desdeRaw ? new Date(desdeRaw) : new Date()
  const vigenciaHasta = hastaRaw ? new Date(hastaRaw) : null

  if (!titulo || !descripcion) {
    return { error: 'Título y descripción son obligatorios.' }
  }
  if (!esTipoValido(tipo)) return { error: 'Tipo de promoción inválido.' }
  if (!esVisibilidadValida(visibilidad)) return { error: 'Visibilidad inválida.' }
  if (descuento != null && (Number.isNaN(descuento) || descuento < 0)) {
    return { error: 'El descuento no es válido.' }
  }
  if (maxCanjes != null && (Number.isNaN(maxCanjes) || maxCanjes < 1)) {
    return { error: 'El límite de canjes debe ser mayor a 0.' }
  }
  if (Number.isNaN(prioridad)) return { error: 'La prioridad no es válida.' }
  if (vigenciaHasta && vigenciaHasta <= vigenciaDesde) {
    return { error: 'La fecha de fin debe ser posterior a la de inicio.' }
  }

  // ── Fase E5: venta como producto comercial ─────────────────────────────────
  const esComprable = String(formData.get('esComprable') ?? 'false') === 'true'
  const precioRaw = String(formData.get('precio') ?? '').trim()
  const precio = precioRaw ? Number(precioRaw) : null
  const usosRaw = String(formData.get('usosPorCompra') ?? '').trim()
  const usosPorCompra = usosRaw ? Number(usosRaw) : 1
  const limiteClienteRaw = String(formData.get('limitePorCliente') ?? '').trim()
  const limitePorCliente = limiteClienteRaw ? Number(limiteClienteRaw) : null
  const benefDiasRaw = String(formData.get('beneficioVigenciaDias') ?? '').trim()
  const beneficioVigenciaDias = benefDiasRaw ? Number(benefDiasRaw) : null
  const benefHastaRaw = String(formData.get('beneficioVigenciaHasta') ?? '').trim()
  const beneficioVigenciaHasta = benefHastaRaw ? new Date(benefHastaRaw) : null
  const diasPermitidos = formData
    .getAll('diasPermitidos')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const horaRe = /^([01]\d|2[0-3]):[0-5]\d$/
  const horaDesdeRaw = String(formData.get('horaDesde') ?? '').trim()
  const horaHastaRaw = String(formData.get('horaHasta') ?? '').trim()
  const horaDesde = horaRe.test(horaDesdeRaw) ? horaDesdeRaw : null
  const horaHasta = horaRe.test(horaHastaRaw) ? horaHastaRaw : null

  if (esComprable) {
    if (precio == null || Number.isNaN(precio) || precio < 0) {
      return { error: 'Indica el precio de venta (0 = gratis).' }
    }
    if (Number.isNaN(usosPorCompra) || usosPorCompra < 1) {
      return { error: 'Los usos por compra deben ser al menos 1.' }
    }
    if (limitePorCliente != null && (Number.isNaN(limitePorCliente) || limitePorCliente < 1)) {
      return { error: 'El límite por cliente debe ser al menos 1 (o vacío para sin límite).' }
    }
    if (beneficioVigenciaDias != null && (Number.isNaN(beneficioVigenciaDias) || beneficioVigenciaDias < 1)) {
      return { error: 'La vigencia del beneficio debe ser al menos 1 día.' }
    }
    if (beneficioVigenciaHasta && Number.isNaN(beneficioVigenciaHasta.getTime())) {
      return { error: 'La fecha fija de vigencia no es válida.' }
    }
    if (horaDesde && horaHasta && horaHasta <= horaDesde) {
      return { error: 'El horario "hasta" debe ser posterior al "desde".' }
    }
  }

  return {
    share: { shareTitulo, shareDescripcion },
    data: {
      titulo,
      descripcion,
      imagenUrl,
      tipo,
      descuento,
      codigo,
      visibilidad,
      vigenciaDesde,
      vigenciaHasta,
      maxCanjes,
      prioridad,
      campanaId,
      esComprable,
      precio: esComprable ? precio : null,
      usosPorCompra: esComprable ? usosPorCompra : 1,
      limitePorCliente: esComprable ? limitePorCliente : null,
      beneficioVigenciaDias: esComprable ? beneficioVigenciaDias : null,
      beneficioVigenciaHasta: esComprable ? beneficioVigenciaHasta : null,
      diasPermitidos: esComprable ? diasPermitidos : [],
      horaDesde: esComprable ? horaDesde : null,
      horaHasta: esComprable ? horaHasta : null,
    },
  }
}

function toBridgeData(d: {
  titulo: string; descripcion: string; imagenUrl?: string | null;
  tipo: string; descuento?: number | null; codigo?: string | null;
  visibilidad: string; vigenciaDesde: Date; vigenciaHasta?: Date | null;
  maxCanjes?: number | null; prioridad: number; campanaId?: string | null;
}): LegacyPromoData {
  return {
    titulo: d.titulo,
    descripcion: d.descripcion,
    imagenUrl: d.imagenUrl ?? null,
    tipo: d.tipo,
    descuento: d.descuento ?? null,
    codigo: d.codigo ?? null,
    visibilidad: d.visibilidad,
    vigenciaDesde: d.vigenciaDesde,
    vigenciaHasta: d.vigenciaHasta ?? null,
    maxCanjes: d.maxCanjes ?? null,
    prioridad: d.prioridad,
    campanaId: d.campanaId ?? null,
  }
}

/**
 * Share Engine: persiste los textos de compartición en un update APARTE y
 * defensivo — si la columna shareConfig aún no existe (migración 20260757
 * pendiente), crear/editar la promoción sigue funcionando y solo se pierde
 * la personalización.
 */
async function guardarShareConfig(
  id: string,
  companyId: string,
  share: { shareTitulo: string | null; shareDescripcion: string | null }
) {
  const config =
    share.shareTitulo || share.shareDescripcion
      ? { ogTitulo: share.shareTitulo, ogDescripcion: share.shareDescripcion }
      : Prisma.DbNull
  await conEmpresa(companyId, (tx) =>
    tx.promocion
      .update({ where: { id }, data: { shareConfig: config } })
      .catch((e) => console.error('[promocion] shareConfig:', e))
  )
}

/**
 * Slug público libre dentro de la empresa.
 *
 * Se calcula UNA VEZ, al crear (o la primera vez que se edita una promoción
 * vieja que aún no lo tiene). Nunca se recalcula al cambiar el título: un
 * enlace ya compartido por WhatsApp seguiría circulando y moriría.
 */
async function asignarSlug(companyId: string, titulo: string): Promise<string> {
  const existentes = await conEmpresa(companyId, (tx) =>
    tx.promocion
      .findMany({
        where: { companyId, slug: { not: null } },
        select: { slug: true },
      })
      .catch(() => [] as { slug: string | null }[])
  )
  return slugDisponible(
    titulo,
    existentes.map((p) => p.slug ?? '').filter(Boolean)
  )
}

/** Valida que la campaña exista y pertenezca a la empresa. */
async function validarCampana(
  campanaId: string | null,
  companyId: string
): Promise<string | null> {
  if (!campanaId) return null
  const campana = await conEmpresa(companyId, (tx) =>
    tx.campana.findUnique({
      where: { id: campanaId },
      select: { companyId: true },
    })
  )
  if (!campana || campana.companyId !== companyId) return 'Campaña inválida.'
  return null
}

function revalidatePromos() {
  revalidatePath('/admin/promociones')
  revalidatePath('/superadmin/operaciones')
  revalidatePath('/cliente/promociones')
  revalidatePath('/promociones')
  revalidatePath('/')
  // Invalida la caché del marketplace público al instante (punto 2 Enterprise).
  revalidateTag('marketplace', 'max')
}

/** Devuelve la promo solo si pertenece a la empresa del usuario (o superadmin). */
async function promoDeMiEmpresa(id: string, user: NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>) {
  const promo = await sinEmpresa('promoción por id sin conocer la empresa', (tx) =>
    tx.promocion.findUnique({
      where: { id },
      select: { id: true, companyId: true, titulo: true, activo: true, archivada: true, slug: true },
    })
  )
  if (!promo) return null
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    promo.companyId !== user.metadata.companyId
  ) {
    return null
  }
  return promo
}

export async function crearPromocion(
  _prev: PromocionState,
  formData: FormData
): Promise<PromocionState> {
  const user = await requireSection('promociones', 'crear')
  if (!user) return { error: 'No autorizado.' }

  const companyId =
    // Superadmin: companyId del form o, si no viene, la empresa ACTIVA del
    // selector del panel. Staff: siempre la de su sesión.
    (await resolveCompanyId(user, formData)) ?? ''
  if (!companyId) return { error: 'Empresa requerida.' }

  const parsed = parsePromocion(formData)
  if ('error' in parsed) return { error: parsed.error }

  const campanaError = await validarCampana(parsed.data.campanaId, companyId)
  if (campanaError) return { error: campanaError }

  try {
    // Carrera posible: dos personas creando la misma promoción a la vez leen
    // los mismos slugs ocupados. El índice único es el árbitro; si choca, se
    // desempata con una marca de tiempo en vez de fallarle al usuario.
    const slug = await asignarSlug(companyId, parsed.data.titulo)
    const legacy = await conEmpresa(companyId, (tx) =>
      tx.promocion
        .create({ data: { companyId, ...parsed.data, slug } })
        .catch(async (e) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return tx.promocion.create({
              data: {
                companyId,
                ...parsed.data,
                slug: `${slug.slice(0, 50)}-${Date.now().toString(36)}`,
              },
            })
          }
          throw e
        })
    )
    await guardarShareConfig(legacy.id, companyId, parsed.share)

    await syncCreate(
      legacy.id, companyId,
      toBridgeData(parsed.data),
      user.metadata.dbUserId,
    )

    await notificarSeguidoresEmpresa(companyId, {
      tipo: 'PROMOCION_NUEVA',
      titulo: '¡Nueva promoción disponible!',
      mensaje: parsed.data.titulo,
      href: '/cliente/promociones',
    })

    revalidatePromos()
    return { success: true }
  } catch (e) {
    console.error('[promocion]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarPromocion(
  _prev: PromocionState,
  formData: FormData
): Promise<PromocionState> {
  const user = await requireSection('promociones', 'editar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Promoción no especificada.' }

  const parsed = parsePromocion(formData)
  if ('error' in parsed) return { error: parsed.error }

  const activo = formData.get('activo') !== 'false'

  try {
    const promo = await promoDeMiEmpresa(id, user)
    if (!promo) return { error: 'Promoción no encontrada.' }

    const campanaError = await validarCampana(parsed.data.campanaId, promo.companyId)
    if (campanaError) return { error: campanaError }

    // El slug NO se recalcula con el título: solo se rellena si la promoción
    // viene de antes de los enlaces con nombre y aún no tiene uno.
    const slug = promo.slug
      ? undefined
      : await asignarSlug(promo.companyId, parsed.data.titulo)

    await conEmpresa(promo.companyId, (tx) =>
      tx.promocion.update({
        where: { id },
        data: { ...parsed.data, activo, ...(slug ? { slug } : {}) },
      })
    )
    await guardarShareConfig(id, promo.companyId, parsed.share)

    await syncUpdate(id, promo.companyId, toBridgeData(parsed.data), user.metadata.dbUserId)
    if (activo !== promo.activo) {
      await syncStatusChange(id, promo.companyId, activo, promo.archivada ?? false, parsed.data.titulo, user.metadata.dbUserId)
    }

    revalidatePromos()
    return { success: true }
  } catch (e) {
    console.error('[promocion]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarPromocion(
  _prev: PromocionState,
  formData: FormData
): Promise<PromocionState> {
  const user = await requireSection('promociones', 'eliminar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  try {
    const promo = await promoDeMiEmpresa(id, user)
    if (!promo) return { error: 'Promoción no encontrada.' }

    await syncDelete(promo.id, promo.companyId, promo.titulo)
    await conEmpresa(promo.companyId, (tx) => tx.promocion.delete({ where: { id } }))

    revalidatePromos()
    return { success: true }
  } catch (e) {
    console.error('[promocion]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/** Pausa (activo=false) o reanuda (activo=true) una promoción. */
export async function alternarPausaPromocion(
  _prev: PromocionState,
  formData: FormData
): Promise<PromocionState> {
  const user = await requireSection('promociones', 'pausar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  try {
    const promo = await promoDeMiEmpresa(id, user)
    if (!promo) return { error: 'Promoción no encontrada.' }

    const newActivo = !promo.activo
    await conEmpresa(promo.companyId, (tx) =>
      tx.promocion.update({
        where: { id },
        data: { activo: newActivo },
      })
    )

    await syncStatusChange(id, promo.companyId, newActivo, promo.archivada ?? false, promo.titulo, user.metadata.dbUserId)

    revalidatePromos()
    return { success: true }
  } catch (e) {
    console.error('[promocion] pausar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/** Duplica una promoción como borrador pausado "(Copia)". */
export async function duplicarPromocion(
  _prev: PromocionState,
  formData: FormData
): Promise<PromocionState> {
  const user = await requireSection('promociones', 'duplicar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  try {
    const promo = await promoDeMiEmpresa(id, user)
    if (!promo) return { error: 'Promoción no encontrada.' }

    const original = await conEmpresa(promo.companyId, (tx) =>
      tx.promocion.findUniqueOrThrow({ where: { id } })
    )
    const tituloCopia = `${original.titulo} (Copia)`
    const slugCopia = await asignarSlug(original.companyId, tituloCopia)
    const copy = await conEmpresa(promo.companyId, (tx) =>
      tx.promocion.create({
        data: {
          companyId: original.companyId,
          titulo: tituloCopia,
          slug: slugCopia,
          descripcion: original.descripcion,
          imagenUrl: original.imagenUrl,
          tipo: original.tipo,
          descuento: original.descuento,
          codigo: original.codigo,
          visibilidad: original.visibilidad,
          vigenciaDesde: original.vigenciaDesde,
          vigenciaHasta: original.vigenciaHasta,
          maxCanjes: original.maxCanjes,
          prioridad: original.prioridad,
          campanaId: original.campanaId,
          tags: original.tags,
          activo: false,
        },
      })
    )

    await syncDuplicate(
      id, copy.id, original.companyId,
      toBridgeData({
        titulo: copy.titulo,
        descripcion: copy.descripcion,
        imagenUrl: copy.imagenUrl,
        tipo: copy.tipo,
        descuento: copy.descuento,
        codigo: copy.codigo,
        visibilidad: copy.visibilidad,
        vigenciaDesde: copy.vigenciaDesde,
        vigenciaHasta: copy.vigenciaHasta,
        maxCanjes: copy.maxCanjes,
        prioridad: copy.prioridad,
        campanaId: copy.campanaId,
      }),
      user.metadata.dbUserId,
    )

    revalidatePromos()
    return { success: true }
  } catch (e) {
    console.error('[promocion] duplicar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/** Archiva (o restaura) una promoción: sale de todos los listados. */
export async function alternarArchivoPromocion(
  _prev: PromocionState,
  formData: FormData
): Promise<PromocionState> {
  const user = await requireSection('promociones', 'archivar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  try {
    const promo = await promoDeMiEmpresa(id, user)
    if (!promo) return { error: 'Promoción no encontrada.' }

    const newArchivada = !promo.archivada
    const newActivo = newArchivada ? false : promo.activo
    await conEmpresa(promo.companyId, (tx) =>
      tx.promocion.update({
        where: { id },
        data: { archivada: newArchivada, ...(promo.archivada ? {} : { activo: false }) },
      })
    )

    await syncStatusChange(id, promo.companyId, newActivo, newArchivada, promo.titulo, user.metadata.dbUserId)

    revalidatePromos()
    return { success: true }
  } catch (e) {
    console.error('[promocion] archivar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
