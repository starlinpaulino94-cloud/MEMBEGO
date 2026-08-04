'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

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
  const destino = '/cliente/planes'
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') {
      return { error: 'Inicia sesión con tu cuenta de cliente.' }
    }

    const companySlug = String(formData.get('companySlug') ?? '').trim()
    if (!companySlug) return { error: 'Empresa no especificada.' }

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

    // ¿Ya tiene cuenta de cliente en esta empresa? Si no, la creamos.
    let cliente = await sinEmpresa('cliente: buscar cuenta en la empresa destino', (tx) =>
      tx.cliente.findUnique({
        where: {
          supabaseId_companyId: { supabaseId: user.supabaseId, companyId: company.id },
        },
        select: { id: true, telefono: true },
      })
    )

    if (!cliente) {
      // Reutiliza nombre/teléfono de una cuenta existente del mismo usuario.
      const previa = await sinEmpresa('cliente: buscar mi cuenta más antigua', (tx) =>
        tx.cliente.findFirst({
          where: { supabaseId: user.supabaseId },
          select: { nombre: true, telefono: true },
          orderBy: { createdAt: 'asc' },
        })
      )
      cliente = await sinEmpresa('cliente: crear cuenta en la empresa destino', (tx) =>
        tx.cliente.create({
          data: {
            companyId: company.id,
            supabaseId: user.supabaseId,
            nombre: previa?.nombre ?? dbUser.name,
            email: user.email,
            telefono: previa?.telefono ?? null,
          },
          select: { id: true, telefono: true },
        })
      )

      // Seguir la empresa (no bloquea si falla).
      await conEmpresa(company.id, (tx) =>
        tx.companyFollow.upsert({
          where: { userId_companyId: { userId: dbUser.id, companyId: company.id } },
          update: {},
          create: { userId: dbUser.id, companyId: company.id },
        })
      ).catch((e) => console.error('[cliente] afiliar auto-follow error:', e))

      await emitirEventoEstrategia({
        companyId: company.id,
        type: 'cliente.registrado',
        subjectId: cliente.id,
        payload: { cliente: { nombre: previa?.nombre ?? dbUser.name, compras: 0, visitas: 0 } },
      })
    }

    // Cambia el contexto activo a esta empresa.
    const admin = createAdminClient()
    await admin.auth.admin.updateUserById(user.supabaseId, {
      app_metadata: {
        role: 'CLIENTE',
        dbUserId: dbUser.id,
        clienteId: cliente.id,
        companyId: company.id,
      },
    })

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
