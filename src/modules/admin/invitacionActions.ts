'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { registerLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { escaparHtml } from '@/lib/html'
import { encolarEmail } from '@/modules/jobs/emisiones'
import { getAppUrl, SITE_NAME } from '@/lib/site'
import { TERMS_VERSION } from '@/lib/legal'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { FULL_ADMIN_ROLES, INVITABLE_ROLES, type AppRole } from '@/types'
import { anotarFallo } from '@/lib/prisma-errors'

export interface InvitacionState {
  error?: string
  success?: boolean
}

const DIAS_VALIDEZ = 7

// El escapado vive en `@/lib/html`: esta copia cubría `<>&` pero no las
// comillas, y el nombre de empresa acaba pegado a plantillas con atributos.

/** Solo los administradores plenos con empresa pueden invitar. */
async function requireOwner() {
  const user = await getUser()
  if (!user || !user.metadata.companyId) return null
  if (!FULL_ADMIN_ROLES.includes(user.metadata.role)) return null
  return user
}

/** Invitaciones PENDIENTES de una empresa (para el panel de equipo). */
/**
 * Invitaciones pendientes, con `caducada` ya resuelto.
 *
 * El estado 'PENDIENTE' no se limpia solo: una invitación cuya fecha ya pasó
 * sigue en la lista y no sirve para nada. Sin decirlo, el admin no sabe si
 * tiene que reenviarla y acaba llegando "no me llegó nada" a soporte.
 *
 * El cálculo vive aquí y no en la página a propósito: `Date.now()` dentro de
 * un componente es impuro —el mismo árbol daría resultados distintos según
 * cuándo se evalúe— y el compilador de React lo rechaza. La capa de datos es
 * además donde corresponde: si algo sabe cuándo caduca una invitación, es
 * quien la consulta.
 */
export async function listInvitacionesPendientes(companyId: string) {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.invitacion.findMany({
      where: { companyId, estado: 'PENDIENTE' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, rol: true, expiraEn: true },
    })
  )
  const ahora = Date.now()
  return filas.map((inv) => ({ ...inv, caducada: inv.expiraEn.getTime() <= ahora }))
}

export async function invitarMiembro(
  _prev: InvitacionState,
  formData: FormData
): Promise<InvitacionState> {
  const owner = await requireOwner()
  if (!owner || !owner.metadata.companyId) {
    return { error: 'No tienes permiso para invitar miembros.' }
  }
  const companyId = owner.metadata.companyId

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const rol = String(formData.get('rol') ?? '') as AppRole

  if (!/.+@.+\..+/.test(email)) return { error: 'El correo no es válido.' }
  if (!INVITABLE_ROLES.includes(rol)) return { error: 'Rol no válido.' }

  // Ya es miembro de esta empresa.
  const existingUser = await sinEmpresa('uniqueness de email al invitar', (tx) =>
    tx.user.findUnique({ where: { email } })
  )
  if (existingUser?.companyId === companyId) {
    return { error: 'Esa persona ya pertenece a tu equipo.' }
  }
  if (existingUser) {
    // El usuario ya tiene cuenta en otra empresa/rol: el flujo de aceptación
    // (que crea la cuenta) no aplica. Se resuelve manualmente por ahora.
    return { error: 'Ese correo ya tiene una cuenta en MembeGo. Pídele que use otro correo o contáctanos.' }
  }

  // Reutiliza una invitación pendiente para el mismo correo (reenvío).
  const pendiente = await conEmpresa(companyId, (tx) =>
    tx.invitacion.findFirst({
      where: { companyId, email, estado: 'PENDIENTE' },
    })
  )

  const expiraEn = new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000)

  const invitacion = pendiente
    ? await conEmpresa(companyId, (tx) =>
        tx.invitacion.update({
          where: { id: pendiente.id },
          data: { rol, expiraEn },
        })
      )
    : await conEmpresa(companyId, (tx) =>
        tx.invitacion.create({
          data: {
            companyId,
            email,
            rol,
            expiraEn,
            invitadoPor: owner.metadata.dbUserId || null,
          },
        })
      )

  const company = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    })
  )

  const nombreEmpresa = company?.name ?? 'Una empresa'
  const nombreSeguro = escaparHtml(nombreEmpresa)
  const url = `${getAppUrl()}/invitacion/${invitacion.token}`
  await encolarEmail({
    to: email,
    subject: `Te invitaron a ${nombreEmpresa}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0f172a">
        <h1 style="font-size:20px;margin:0 0 8px">Únete al equipo</h1>
        <p style="font-size:15px;line-height:1.5;color:#334155;margin:0 0 24px">
          ${nombreSeguro} te invitó a su equipo en ${SITE_NAME}. Crea tu
          cuenta para empezar:
        </p>
        <a href="${url}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px">Aceptar invitación</a>
        <p style="font-size:12px;color:#94a3b8;margin:24px 0 0">La invitación expira en ${DIAS_VALIDEZ} días. Si no la esperabas, ignora este correo.</p>
      </div>`,
    text: `${nombreEmpresa} te invitó a su equipo en ${SITE_NAME}. Acepta aquí: ${url}`,
  })

  revalidatePath('/admin/empleados')
  return { success: true }
}

export async function cancelarInvitacion(id: string): Promise<InvitacionState> {
  const owner = await requireOwner()
  if (!owner || !owner.metadata.companyId) {
    return { error: 'No autorizado.' }
  }
  const inv = await sinEmpresa('invitación por id sin conocer la empresa', (tx) =>
    tx.invitacion.findUnique({ where: { id } })
  )
  if (!inv || inv.companyId !== owner.metadata.companyId) {
    return { error: 'Invitación no encontrada.' }
  }
  await conEmpresa(inv.companyId, (tx) =>
    tx.invitacion.update({
      where: { id },
      data: { estado: 'CANCELADA' },
    })
  )
  revalidatePath('/admin/empleados')
  return { success: true }
}

/**
 * Acepta una invitación: crea la cuenta del miembro con el rol asignado. El
 * enlace del correo hace las veces de verificación, así que la cuenta se crea
 * confirmada. Solo cubre correos SIN cuenta previa (validado al invitar).
 */
export async function aceptarInvitacion(
  _prev: InvitacionState,
  formData: FormData
): Promise<InvitacionState> {
  const { ipAddress } = await getRequestMeta()
  if (!(await registerLimiter(ipAddress ?? 'unknown'))) {
    return { error: 'Demasiados intentos. Espera unos minutos.' }
  }

  const token = String(formData.get('token') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const aceptaTerminos = formData.get('terminos') === 'on'

  if (!token || !nombre || !password) {
    return { error: 'Completa todos los campos.' }
  }
  if (password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres.' }
  }
  if (!aceptaTerminos) {
    return { error: 'Debes aceptar los términos y la política de privacidad.' }
  }

  const invitacion = await sinEmpresa('invitación por token al aceptar', (tx) =>
    tx.invitacion.findUnique({ where: { token } })
  )
  if (!invitacion || invitacion.estado !== 'PENDIENTE') {
    return { error: 'La invitación no es válida o ya fue usada.' }
  }
  if (invitacion.expiraEn <= new Date()) {
    await conEmpresa(invitacion.companyId, (tx) =>
      tx.invitacion
        .update({ where: { id: invitacion.id }, data: { estado: 'EXPIRADA' } })
        .catch(anotarFallo('admin:invitacion.update'))
    )
    return { error: 'La invitación expiró. Pide una nueva.' }
  }

  const email = invitacion.email
  const existing = await sinEmpresa('uniqueness de email al aceptar', (tx) =>
    tx.user.findUnique({ where: { email } })
  )
  if (existing) {
    return { error: 'Ese correo ya tiene una cuenta. Inicia sesión.' }
  }

  const admin = createAdminClient()
  let supabaseId: string | null = null
  let dbUserId: string | null = null
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // el enlace de invitación verifica el correo
      user_metadata: { name: nombre },
    })
    if (createError || !created.user) {
      if (createError?.message?.toLowerCase().includes('already')) {
        return { error: 'Ese correo ya tiene una cuenta. Inicia sesión.' }
      }
      return { error: 'No se pudo crear la cuenta.' }
    }
    supabaseId = created.user.id
    await ensureEmailIdentity(supabaseId, email)

    const now = new Date()
    const sid = supabaseId
    const dbUser = await conEmpresa(invitacion.companyId, (tx) =>
      tx.user.create({
        data: {
          supabaseId: sid,
          email,
          name: nombre,
          role: invitacion.rol,
          companyId: invitacion.companyId,
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
        },
      })
    )
    dbUserId = dbUser.id

    await admin.auth.admin.updateUserById(sid, {
      app_metadata: {
        role: invitacion.rol,
        dbUserId: dbUser.id,
        companyId: invitacion.companyId,
      },
    })

    await conEmpresa(invitacion.companyId, (tx) =>
      tx.invitacion.update({
        where: { id: invitacion.id },
        data: { estado: 'ACEPTADA', aceptadaEn: now },
      })
    )
  } catch (e) {
    console.error('[invitacion] aceptar:', e)
    // Rollback completo: sin esto quedaría una fila User huérfana (con
    // supabaseId de un usuario ya borrado) que bloquea para siempre el
    // reintento (el chequeo de "correo ya registrado" la encontraría).
    if (dbUserId) {
      const uid = dbUserId
      await sinEmpresa('rollback: borrar usuario creado', (tx) =>
        tx.user.delete({ where: { id: uid } }).catch(anotarFallo('admin:user.delete'))
      )
    }
    if (supabaseId) {
      await admin.auth.admin.deleteUser(supabaseId).catch(anotarFallo('admin:user.delete'))
    }
    return { error: 'No se pudo completar el registro. Intenta de nuevo.' }
  }

  // Fuera del try: redirect lanza NEXT_REDIRECT.
  redirect('/login?registered=equipo')
}
