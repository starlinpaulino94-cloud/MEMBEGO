'use server'

/**
 * Solicitudes de alta de empresa — acciones de servidor.
 *
 * Dos mundos en un archivo, con guardas opuestas:
 *  · `enviarSolicitudEmpresa` es PÚBLICA (el negocio aún no tiene cuenta):
 *    rate limit por IP, validación estricta del núcleo y subida de imágenes
 *    con el cliente admin (el navegador jamás toca el storage directo).
 *  · El resto es SOLO SUPERADMIN: revisar, anotar, cambiar estado y crear la
 *    empresa con un clic a partir de lo que el negocio llenó.
 */

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sinEmpresa, conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { registerLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { sendEmail } from '@/lib/email'
import { uniqueFileName } from '@/lib/storage'
import { anotarFallo } from '@/lib/prisma-errors'
import { ensureSucursalPrincipal } from '@/modules/empresas/sucursalPrincipal'
import { verticalValido } from '@/modules/empresas/verticales'
import {
  validarDatosSolicitud,
  horarioComoTexto,
  extensionDeMime,
  VERTICAL_POR_TIPO,
  IMG_TIPOS_PERMITIDOS,
  IMG_MAX_BYTES,
  ESTADOS_SOLICITUD,
  type EstadoSolicitud,
  type ImagenSolicitud,
} from './nucleo'

/** Mismo bucket público que las promociones: cero pasos extra en Supabase. */
const BUCKET = 'promociones'
const MAX_PROMOS_CON_IMAGEN = 10

// ─────────────────────────────────────────────────────────────────────────────
// PÚBLICA · el negocio envía su solicitud
// ─────────────────────────────────────────────────────────────────────────────

export interface EnviarSolicitudState {
  error?: string
  success?: boolean
}

export async function enviarSolicitudEmpresa(
  _prev: EnviarSolicitudState,
  formData: FormData
): Promise<EnviarSolicitudState> {
  const meta = await getRequestMeta()
  if (!(await registerLimiter(meta.ipAddress ?? 'unknown'))) {
    return { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }
  }

  // 1 · El formulario viaja como JSON en un campo; los archivos, aparte.
  let crudo: unknown
  try {
    crudo = JSON.parse(String(formData.get('datos') ?? ''))
  } catch {
    return { error: 'El formulario llegó dañado. Recarga la página e intenta de nuevo.' }
  }
  const v = validarDatosSolicitud(crudo)
  if (!v.ok) return { error: v.error }
  const datos = v.datos

  // 2 · Adjuntos: logo, portada y una imagen por promoción. Se validan ANTES
  //    de subir nada — o entran todos, o no se sube ninguno.
  const adjuntos: { clave: string; tipo: ImagenSolicitud['tipo']; promoIndice?: number; file: File }[] = []
  const logo = formData.get('logo')
  if (logo instanceof File && logo.size > 0) adjuntos.push({ clave: 'logo', tipo: 'logo', file: logo })
  const portada = formData.get('portada')
  if (portada instanceof File && portada.size > 0) adjuntos.push({ clave: 'portada', tipo: 'portada', file: portada })
  for (let i = 0; i < Math.min(datos.promos.length, MAX_PROMOS_CON_IMAGEN); i++) {
    const f = formData.get(`promo_${i}`)
    if (f instanceof File && f.size > 0) adjuntos.push({ clave: `promo_${i}`, tipo: 'promo', promoIndice: i, file: f })
  }
  for (const a of adjuntos) {
    if (!(IMG_TIPOS_PERMITIDOS as readonly string[]).includes(a.file.type)) {
      return { error: `La imagen de ${a.clave === 'logo' ? 'logo' : a.clave === 'portada' ? 'portada' : 'promoción'} debe ser JPG, PNG o WebP.` }
    }
    if (a.file.size > IMG_MAX_BYTES) {
      return { error: `Una imagen pesa más de 5 MB (${a.clave}). Redúcela e intenta de nuevo.` }
    }
  }

  // 3 · Subida con el cliente admin, bajo un prefijo propio de esta solicitud.
  const supabase = createAdminClient()
  const carpeta = `solicitudes/${Date.now()}-${randomBytes(4).toString('hex')}`
  const imagenes: ImagenSolicitud[] = []
  for (const a of adjuntos) {
    const path = `${carpeta}/${a.clave}-${uniqueFileName(extensionDeMime(a.file.type))}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(await a.file.arrayBuffer()), { contentType: a.file.type })
    if (error) {
      console.error('[solicitudes] subir imagen:', error.message)
      return { error: 'No se pudo subir una de las imágenes. Intenta de nuevo.' }
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    imagenes.push({ tipo: a.tipo, ...(a.promoIndice !== undefined ? { promoIndice: a.promoIndice } : {}), url: data.publicUrl, path })
  }

  // 4 · La fila. JSON.parse(JSON.stringify()) no hace falta: datos ya es plano.
  try {
    await sinEmpresa('solicitud de alta de empresa (formulario público)', (tx) =>
      tx.solicitudEmpresa.create({
        data: {
          nombreNegocio: datos.negocio.nombre,
          tipoNegocio: datos.negocio.tipo === 'Otro' && datos.negocio.tipoOtro ? `Otro: ${datos.negocio.tipoOtro}` : datos.negocio.tipo,
          contactoCorreo: datos.negocio.correo,
          // Los tipos del núcleo no tienen index signature; el JSON es plano.
          datos: datos as unknown as Prisma.InputJsonValue,
          imagenes: imagenes as unknown as Prisma.InputJsonValue,
          ipAddress: meta.ipAddress ?? null,
        },
      })
    )
  } catch (e) {
    console.error('[solicitudes] crear:', e)
    return {
      error:
        'No se pudo guardar tu solicitud. Si acabas de instalar esta versión, corre la migración 20260813_solicitudes_empresa.',
    }
  }

  // 5 · Aviso a los superadmins (best-effort: su fallo no daña la solicitud).
  sinEmpresa('solicitudes: correos de superadmin para avisar', (tx) =>
    tx.user.findMany({ where: { role: 'SUPERADMIN' }, select: { email: true } })
  )
    .then((admins) =>
      Promise.all(
        admins
          .map((a) => a.email)
          .filter((e): e is string => !!e)
          .map((to) =>
            sendEmail({
              to,
              subject: `Nueva solicitud de empresa: ${datos.negocio.nombre}`,
              text: `${datos.negocio.nombre} (${datos.negocio.tipo}) llenó el formulario de alta.\n\nContacto: ${datos.admin.nombre} · ${datos.admin.telefono} · ${datos.admin.correo}\n\nRevísala en el panel: /superadmin/solicitudes`,
            })
          )
      )
    )
    .catch(anotarFallo('solicitudes:avisoSuperadmin'))

  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPERADMIN · revisar y convertir
// ─────────────────────────────────────────────────────────────────────────────

async function requireSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

export interface SolicitudAccionState {
  error?: string
  success?: string
}

export async function cambiarEstadoSolicitud(
  _prev: SolicitudAccionState,
  formData: FormData
): Promise<SolicitudAccionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede administrar solicitudes.' }
  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '') as EstadoSolicitud
  if (!id || !(ESTADOS_SOLICITUD as readonly string[]).includes(estado)) {
    return { error: 'Estado no reconocido.' }
  }
  // CREADA solo la pone la creación real de la empresa: marcarla a mano
  // dejaría una solicitud "creada" sin empresa detrás.
  if (estado === 'CREADA') return { error: 'Para marcarla como creada, usa «Crear empresa».' }
  try {
    await prisma.solicitudEmpresa.update({ where: { id }, data: { estado } })
    revalidatePath('/superadmin/solicitudes')
    revalidatePath(`/superadmin/solicitudes/${id}`)
    return { success: 'Estado actualizado.' }
  } catch (e) {
    console.error('[solicitudes] estado:', e)
    return { error: 'No se pudo actualizar el estado.' }
  }
}

export async function guardarNotasSolicitud(
  _prev: SolicitudAccionState,
  formData: FormData
): Promise<SolicitudAccionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede administrar solicitudes.' }
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Solicitud no especificada.' }
  const notas = String(formData.get('notas') ?? '').trim().slice(0, 5000)
  try {
    await prisma.solicitudEmpresa.update({ where: { id }, data: { notasInternas: notas || null } })
    revalidatePath(`/superadmin/solicitudes/${id}`)
    return { success: 'Notas guardadas.' }
  } catch (e) {
    console.error('[solicitudes] notas:', e)
    return { error: 'No se pudieron guardar las notas.' }
  }
}

export interface CrearDesdeSolicitudState {
  error?: string
  /** Se muestra UNA sola vez: el superadmin se la entrega al dueño. */
  credenciales?: { correo: string; passwordTemporal: string }
  companySlug?: string
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function slugUnico(nombre: string): Promise<string> {
  const base = slugify(nombre) || 'empresa'
  let slug = base
  let n = 1
  while (
    await sinEmpresa('solicitudes: comprobar slug (catálogo global)', (tx) =>
      tx.company.findUnique({ where: { slug }, select: { id: true } })
    )
  ) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

/**
 * Crea la EMPRESA y la CUENTA del administrador a partir de la solicitud.
 *
 * Qué queda hecho: empresa con su perfil (tipo/vertical, descripción,
 * contacto, dirección, horario, color, logo y portada si se adjuntaron,
 * enlace de Google Maps), su sucursal principal, y el administrador con una
 * contraseña temporal que se enseña UNA vez. La empresa nace SIN publicar:
 * los planes y promociones que pidió quedan a la vista en la solicitud como
 * checklist para configurarlos en su panel antes de publicar.
 */
export async function crearEmpresaDesdeSolicitud(
  _prev: CrearDesdeSolicitudState,
  formData: FormData
): Promise<CrearDesdeSolicitudState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede crear empresas.' }
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Solicitud no especificada.' }

  const solicitud = await prisma.solicitudEmpresa.findUnique({ where: { id } })
  if (!solicitud) return { error: 'Solicitud no encontrada.' }
  if (solicitud.estado === 'CREADA' && solicitud.companyId) {
    return { error: 'Esta solicitud ya tiene su empresa creada.' }
  }

  const v = validarDatosSolicitud(solicitud.datos)
  if (!v.ok) return { error: `La solicitud está incompleta: ${v.error}` }
  const datos = v.datos
  const imagenes = (Array.isArray(solicitud.imagenes) ? solicitud.imagenes : []) as unknown as ImagenSolicitud[]
  const logoUrl = imagenes.find((i) => i.tipo === 'logo')?.url ?? null
  const bannerUrl = imagenes.find((i) => i.tipo === 'portada')?.url ?? null

  // La cuenta del administrador se enlaza por correo: si ya existe una cuenta
  // con ese correo, el superadmin debe decidir a mano (no se pisa una cuenta).
  const correoAdmin = datos.admin.correo
  const yaExiste = await sinEmpresa('solicitudes: buscar cuenta del admin por correo', (tx) =>
    tx.user.findUnique({ where: { email: correoAdmin }, select: { id: true } })
  )
  if (yaExiste) {
    return {
      error: `Ya existe una cuenta con ${correoAdmin}. Crea la empresa desde «Empresas → Nueva» usando la opción de cuenta existente, y marca esta solicitud en las notas.`,
    }
  }

  const supabase = createAdminClient()
  let companyId: string | null = null
  let supabaseId: string | null = null
  try {
    const codigoVertical = await verticalValido(VERTICAL_POR_TIPO[datos.negocio.tipo] ?? null)
    const slug = await slugUnico(datos.negocio.nombre)
    const company = await sinEmpresa('solicitudes: crear la empresa aprobada', (tx) =>
      tx.company.create({
        data: {
          name: datos.negocio.nombre,
          slug,
          type: codigoVertical ?? (datos.negocio.tipoOtro || 'otro'),
          ...(codigoVertical ? { tipoNegocioCodigo: codigoVertical } : {}),
          description: datos.negocio.descripcion,
          email: datos.negocio.correo,
          telefono: datos.negocio.telefono,
          direccion: datos.ubicacion.direccion,
          ciudad: datos.ubicacion.ciudad,
          website: datos.negocio.web ?? null,
          googleMapsUrl: datos.ubicacion.maps ?? null,
          horario: horarioComoTexto(datos.horario) || null,
          colorPrimario: datos.marca.color ?? null,
          logoUrl,
          bannerUrl,
          isActive: true,
          // Sin publicar: primero se configuran planes y promociones.
          isPublished: false,
        },
      })
    )
    companyId = company.id
    await ensureSucursalPrincipal(company.id)

    // Contraseña temporal legible (se entrega por WhatsApp y se cambia al entrar).
    const passwordTemporal = randomBytes(9).toString('base64url').replace(/[-_]/g, 'a').slice(0, 12)
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: correoAdmin,
      password: passwordTemporal,
      email_confirm: true,
      user_metadata: { name: datos.admin.nombre },
    })
    if (createError || !created.user) {
      throw new Error(createError?.message ?? 'No se pudo crear la cuenta del administrador.')
    }
    supabaseId = created.user.id
    await ensureEmailIdentity(supabaseId, correoAdmin)

    const idEmpresa = company.id
    const idSupabase = supabaseId
    const dbUser = await conEmpresa(idEmpresa, (tx) =>
      tx.user.create({
        data: {
          supabaseId: idSupabase,
          email: correoAdmin,
          name: datos.admin.nombre,
          role: 'ADMINISTRADOR',
          companyId: idEmpresa,
        },
      })
    )
    await supabase.auth.admin.updateUserById(supabaseId, {
      app_metadata: { role: 'ADMINISTRADOR', dbUserId: dbUser.id, companyId: idEmpresa },
    })

    await prisma.solicitudEmpresa.update({
      where: { id },
      data: { estado: 'CREADA', companyId: idEmpresa },
    })

    const meta = await getRequestMeta()
    await conEmpresa(idEmpresa, (tx) =>
      tx.auditLog.create({
        data: {
          companyId: idEmpresa,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Company',
          entidadId: idEmpresa,
          payload: { tipo: 'EMPRESA_CREADA_DESDE_SOLICITUD', solicitudId: id },
          ...meta,
        },
      })
    ).catch(anotarFallo('solicitudes:auditLog'))

    revalidatePath('/superadmin/solicitudes')
    revalidatePath(`/superadmin/solicitudes/${id}`)
    revalidatePath('/superadmin/empresas')
    return { companySlug: slug, credenciales: { correo: correoAdmin, passwordTemporal } }
  } catch (e) {
    console.error('[solicitudes] crear empresa:', e)
    // Rollback: no dejar empresa sin administrador ni cuenta huérfana.
    if (supabaseId) {
      await supabase.auth.admin.deleteUser(supabaseId).catch(anotarFallo('solicitudes:rollback-auth'))
    }
    if (companyId) {
      const idEmpresa = companyId
      await conEmpresa(idEmpresa, (tx) => tx.company.delete({ where: { id: idEmpresa } })).catch(
        anotarFallo('solicitudes:rollback-company')
      )
    }
    return { error: 'No se pudo crear la empresa. Revisa los datos e intenta de nuevo.' }
  }
}
