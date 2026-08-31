'use server'

/**
 * EXCURSIONES · Vendedores — acciones. Crear un vendedor genera EN EL MISMO
 * ACTO sus tres identificadores (§10): código comercial estable, enlace único
 * global y —derivado del enlace— su QR. Nunca se borra un vendedor: se
 * desactiva y su histórico permanece (§99).
 */

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { generarCodigo } from '@/lib/codes'
import { sendEmail } from '@/lib/email'
import { correoAccesoVendedor } from '@/lib/email/plantillas-excursiones'
import {
  ESTADOS_VENDEDOR,
  codigoVendedor,
  prefijoDeEmpresa,
  validarVendedor,
  urlDeEnlace,
  urlDeQr,
  type EstadoVendedor,
} from './nucleo'

export interface VendedorActionState {
  error?: string
  success?: string
  /** Recién creado: lo que la pantalla de éxito enseña de inmediato (§67). */
  creado?: { vendedorId: string; codigo: string; enlaceUrl: string; qrUrl: string }
  /** Acceso recién dado: se enseña UNA vez y no se vuelve a poder consultar. */
  acceso?: { correo: string; passwordTemporal: string }
}

const CAMPOS = [
  'nombre',
  'apellido',
  'telefono',
  'whatsapp',
  'email',
  'documento',
  'direccion',
  'tipo',
  'supervisorId',
  'razonSocial',
  'rnc',
  'diasCredito',
  'limiteCredito',
  'emailFacturacion',
  'prefijoVoucher',
  'modeloComercial',
]

async function auditar(companyId: string, userId: string | null, entidadId: string, payload: Record<string, unknown>) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'Vendedor',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:vendedores:auditLog'))
}

/** ADMIN · Crear vendedor con código + enlace (y con eso, su QR). */
export async function crearVendedor(
  _prev: VendedorActionState,
  formData: FormData
): Promise<VendedorActionState> {
  try {
    const user = await requireSection('excursiones', 'vendedor_crear')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const v = validarVendedor(Object.fromEntries(CAMPOS.map((c) => [c, String(formData.get(c) ?? '')])))
    if (!v.ok) return { error: v.error }

    // Prevención de duplicados (§52): mismo teléfono = mismo vendedor.
    const duplicado = await conEmpresa(companyId, (tx) =>
      tx.vendedor.findFirst({
        where: { companyId, telefono: v.datos.telefono, estado: { not: 'INACTIVO' } },
        select: { nombre: true, codigo: true },
      })
    )
    if (duplicado) {
      return { error: `Ese teléfono ya es de ${duplicado.nombre} (${duplicado.codigo}).` }
    }

    // El supervisor (si viene) debe ser un vendedor de ESTA empresa.
    if (v.datos.supervisorId) {
      const sup = await conEmpresa(companyId, (tx) =>
        tx.vendedor.findFirst({ where: { id: v.datos.supervisorId!, companyId }, select: { id: true } })
      )
      if (!sup) return { error: 'El supervisor elegido no existe en tu empresa.' }
    }

    const empresa = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({ where: { id: companyId }, select: { name: true } })
    )
    const prefijo = prefijoDeEmpresa(empresa?.name ?? '')

    // Código correlativo por empresa con reintento ante la carrera (el índice
    // único companyId+codigo es el árbitro); el enlace es único GLOBAL y
    // aleatorio — no depende de nombres (§10).
    const creado = await conEmpresa(companyId, async (tx) => {
      let intento = (await tx.vendedor.count({ where: { companyId } })) + 1
      for (let i = 0; i < 5; i++) {
        try {
          return await tx.vendedor.create({
            data: {
              companyId,
              codigo: codigoVendedor(prefijo, intento),
              ...v.datos,
              enlaces: {
                create: { companyId, slug: generarCodigo(10).toLowerCase() },
              },
            },
            select: { id: true, codigo: true, nombre: true, enlaces: { select: { slug: true }, take: 1 } },
          })
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_codigo')
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, creado.id, {
      tipo: 'VENDEDOR_CREADO',
      nombre: creado.nombre,
      codigo: creado.codigo,
    })
    revalidatePath('/admin/excursiones/vendedores')
    return {
      success: 'Vendedor creado.',
      creado: {
        vendedorId: creado.id,
        codigo: creado.codigo,
        enlaceUrl: urlDeEnlace(creado.enlaces[0]?.slug ?? ''),
        qrUrl: urlDeQr(creado.enlaces[0]?.slug ?? ''),
      },
    }
  } catch (e) {
    console.error('[excursiones] crearVendedor:', e)
    return { error: 'No se pudo crear el vendedor. Intenta de nuevo.' }
  }
}

/** ADMIN · Actualizar datos del vendedor. */
export async function actualizarVendedor(
  _prev: VendedorActionState,
  formData: FormData
): Promise<VendedorActionState> {
  try {
    const user = await requireSection('excursiones', 'vendedor_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const vendedorId = String(formData.get('vendedorId') ?? '')

    const v = validarVendedor(Object.fromEntries(CAMPOS.map((c) => [c, String(formData.get(c) ?? '')])))
    if (!v.ok) return { error: v.error }
    if (v.datos.supervisorId === vendedorId) {
      return { error: 'Un vendedor no puede ser su propio supervisor.' }
    }

    // Prevención de duplicados (§52): mismo teléfono = mismo vendedor.
    if (v.datos.telefono) {
      const duplicado = await conEmpresa(companyId, (tx) =>
        tx.vendedor.findFirst({
          where: { companyId, telefono: v.datos.telefono!, estado: { not: 'INACTIVO' }, NOT: { id: vendedorId } },
          select: { nombre: true, codigo: true },
        })
      )
      if (duplicado) {
        return { error: `Ese teléfono ya es de ${duplicado.nombre} (${duplicado.codigo}).` }
      }
    }

    const upd = await conEmpresa(companyId, (tx) =>
      tx.vendedor.updateMany({ where: { id: vendedorId, companyId }, data: v.datos })
    )
    if (upd.count === 0) return { error: 'Vendedor no encontrado.' }

    await auditar(companyId, user.metadata.dbUserId ?? null, vendedorId, { tipo: 'VENDEDOR_ACTUALIZADO' })
    revalidatePath('/admin/excursiones/vendedores')
    revalidatePath(`/admin/excursiones/vendedores/${vendedorId}`)
    return { success: 'Cambios guardados.' }
  } catch (e) {
    console.error('[excursiones] actualizarVendedor:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

/** ADMIN · Activar / suspender / desactivar (jamás borrar, §99). */
export async function cambiarEstadoVendedor(
  _prev: VendedorActionState,
  formData: FormData
): Promise<VendedorActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoVendedor
    if (!(ESTADOS_VENDEDOR as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const funcion = estado === 'ACTIVO' ? 'vendedor_editar' : 'vendedor_desactivar'
    const user = await requireSection('excursiones', funcion)
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const vendedorId = String(formData.get('vendedorId') ?? '')

    const upd = await conEmpresa(companyId, (tx) =>
      tx.vendedor.updateMany({ where: { id: vendedorId, companyId }, data: { estado } })
    )
    if (upd.count === 0) return { error: 'Vendedor no encontrado.' }

    // Suspendido/inactivo: su enlace deja de captar (el redirect lo respeta).
    await conEmpresa(companyId, (tx) =>
      tx.vendedorEnlace.updateMany({
        where: { vendedorId, companyId },
        data: { activo: estado === 'ACTIVO' },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, vendedorId, {
      tipo: 'VENDEDOR_ESTADO',
      estado,
    })
    revalidatePath('/admin/excursiones/vendedores')
    revalidatePath(`/admin/excursiones/vendedores/${vendedorId}`)
    return { success: `Vendedor ${estado.toLowerCase()}.` }
  } catch (e) {
    console.error('[excursiones] estadoVendedor:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

/**
 * ADMIN · Darle al vendedor acceso a SU panel (`/vendedor`).
 *
 * Crea una cuenta con rol VENDEDOR, que por construcción no alcanza el panel
 * de la empresa ni el escáner: la protección de rutas solo le abre `/vendedor`.
 * Por eso un hotel o un taxista pueden entrar sin ver tus clientes.
 *
 * Se envía un correo con un enlace para establecer su contraseña propia.
 * El token es válido 24 horas.
 */
export async function darAccesoVendedor(
  _prev: VendedorActionState,
  formData: FormData
): Promise<VendedorActionState> {
  let supabaseId: string | null = null
  let dbUserId: string | null = null
  let companyId: string | null = null
  const supabase = createAdminClient()
  try {
    const user = await requireSection('excursiones', 'vendedor_acceso')
    if (!user) return { error: 'No autorizado.' }
    companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const cid = companyId
    const vendedorId = String(formData.get('vendedorId') ?? '')
    const correo = String(formData.get('correo') ?? '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(correo)) {
      return { error: 'Escribe un correo válido: es con lo que va a entrar.' }
    }

    const vendedor = await conEmpresa(cid, (tx) =>
      tx.vendedor.findFirst({
        where: { id: vendedorId, companyId: cid },
        select: { id: true, nombre: true, apellido: true, codigo: true, userId: true, estado: true },
      })
    )
    if (!vendedor) return { error: 'Vendedor no encontrado.' }
    if (vendedor.userId) return { error: 'Este vendedor ya tiene acceso a su panel.' }
    if (vendedor.estado !== 'ACTIVO') {
      return { error: 'Solo un vendedor activo puede tener acceso a su panel.' }
    }

    // Un correo ya usado en MembeGo pertenece a otra cuenta: darle acceso aquí
    // le cambiaría el rol y podría dejarlo fuera de la suya.
    const existente = await sinEmpresa('excursiones: correo ya registrado', (tx) =>
      tx.user.findFirst({ where: { email: correo }, select: { id: true } })
    )
    if (existente) {
      return { error: 'Ese correo ya tiene una cuenta en MembeGo. Usa otro para el vendedor.' }
    }

    const passwordTemporal = randomBytes(9).toString('base64url').replace(/[-_]/g, 'a').slice(0, 12)
    const nombreCompleto = `${vendedor.nombre} ${vendedor.apellido ?? ''}`.trim()
    const { data: creado, error: errorAuth } = await supabase.auth.admin.createUser({
      email: correo,
      password: passwordTemporal,
      email_confirm: true,
      user_metadata: { name: nombreCompleto },
    })
    if (errorAuth || !creado.user) {
      return { error: 'No se pudo crear la cuenta del vendedor. Intenta de nuevo.' }
    }
    supabaseId = creado.user.id
    await ensureEmailIdentity(supabaseId, correo)

    const idSupabase = supabaseId
    const dbUser = await conEmpresa(cid, (tx) =>
      tx.user.create({
        data: {
          supabaseId: idSupabase,
          email: correo,
          name: nombreCompleto,
          role: 'VENDEDOR',
          companyId: cid,
        },
        select: { id: true },
      })
    )
    dbUserId = dbUser.id
    await conEmpresa(cid, (tx) =>
      tx.vendedor.updateMany({ where: { id: vendedor.id, companyId: cid }, data: { userId: dbUser.id } })
    )
    await supabase.auth.admin.updateUserById(idSupabase, {
      app_metadata: { role: 'VENDEDOR', dbUserId: dbUser.id, companyId: cid },
    })

    // Token + email: no bloquean el acceso. Si fallan, el vendedor ya puede entrar
    // y establecer contraseña después.
    try {
      const token = randomBytes(32).toString('hex')
      const expira = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await conEmpresa(cid, (tx) =>
        tx.user.update({
          where: { id: dbUser.id },
          data: { establecerContrasenaToken: token, establecerContrasenaExpira: expira },
        })
      )

      const html = correoAccesoVendedor({
        nombre: nombreCompleto,
        email: correo,
        token,
        urlBase: process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000',
      })
      await sendEmail({ to: correo, subject: 'Establece tu contraseña - MembeGo', html })
    } catch (emailErr) {
      console.error('[excursiones] darAccesoVendedor — token/email (no bloquea):', emailErr)
    }

    await auditar(cid, user.metadata.dbUserId ?? null, vendedor.id, {
      tipo: 'VENDEDOR_ACCESO_CREADO',
      codigo: vendedor.codigo,
      correo,
    })
    revalidatePath(`/admin/excursiones/vendedores/${vendedor.id}`)
    return { success: 'Acceso otorgado. Se ha enviado un email con las instrucciones.' }
  } catch (e) {
    console.error('[excursiones] darAccesoVendedor:', e)
    // Rollback: desvincular vendedor, borrar DB user y Supabase user.
    const vendedorIdRollback = String(formData.get('vendedorId') ?? '')
    if (vendedorIdRollback && companyId) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedor.updateMany({ where: { id: vendedorIdRollback, companyId }, data: { userId: null } })
      ).catch(anotarFallo('excursiones:acceso-rollback-vendedor'))
    }
    if (dbUserId && companyId) {
      await conEmpresa(companyId, (tx) =>
        tx.user.delete({ where: { id: dbUserId! } }).catch(anotarFallo('excursiones:acceso-rollback-db'))
      ).catch(anotarFallo('excursiones:acceso-rollback-tx'))
    }
    if (supabaseId) {
      await supabase.auth.admin.deleteUser(supabaseId).catch(anotarFallo('excursiones:acceso-rollback'))
    }
    return { error: 'No se pudo dar el acceso. Intenta de nuevo.' }
  }
}

/**
 * ADMIN · Quitarle el acceso al panel. La cuenta se desvincula del vendedor y
 * queda sin empresa: no puede entrar a ningún panel. El vendedor y todo su
 * histórico siguen intactos (§99).
 */
export async function quitarAccesoVendedor(
  _prev: VendedorActionState,
  formData: FormData
): Promise<VendedorActionState> {
  try {
    const user = await requireSection('excursiones', 'vendedor_acceso')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const vendedorId = String(formData.get('vendedorId') ?? '')

    const vendedor = await conEmpresa(companyId, (tx) =>
      tx.vendedor.findFirst({
        where: { id: vendedorId, companyId },
        select: { id: true, codigo: true, userId: true },
      })
    )
    if (!vendedor?.userId) return { error: 'Este vendedor no tiene acceso que quitar.' }

    const cuenta = await conEmpresa(companyId, (tx) =>
      tx.user.findFirst({
        where: { id: vendedor.userId!, companyId, role: 'VENDEDOR' },
        select: { id: true, supabaseId: true },
      })
    )
    await conEmpresa(companyId, (tx) =>
      tx.vendedor.updateMany({ where: { id: vendedor.id, companyId }, data: { userId: null } })
    )
    if (cuenta) {
      // La cuenta sobrevive para que la auditoría siga apuntando a alguien,
      // pero sin empresa no entra a ningún panel.
      await conEmpresa(companyId, (tx) =>
        tx.user.updateMany({ where: { id: cuenta.id }, data: { companyId: null } })
      )
      await createAdminClient()
        .auth.admin.updateUserById(cuenta.supabaseId, {
          app_metadata: { role: 'VENDEDOR', dbUserId: cuenta.id, companyId: null },
        })
        .catch((err) => {
          console.error('[excursiones] quitarAcceso: Supabase metadata update failed', err)
        })
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, vendedor.id, {
      tipo: 'VENDEDOR_ACCESO_RETIRADO',
      codigo: vendedor.codigo,
    })
    revalidatePath(`/admin/excursiones/vendedores/${vendedor.id}`)
    return { success: 'Acceso retirado.' }
  } catch (e) {
    console.error('[excursiones] quitarAccesoVendedor:', e)
    return { error: 'No se pudo quitar el acceso.' }
  }
}

/**
 * PUBLIC · Establecer contraseña propia del vendedor.
 *
 * Valida el token recibido por correo (válido 24 h), actualiza la contraseña
 * en Supabase Auth y limpia el token para que no se reutilice.
 */
export async function establecerContrasenaVendedor(
  token: string,
  password: string
): Promise<{ success?: string; error?: string }> {
  try {
    const user = await sinEmpresa('establecer-contrasena', (tx) =>
      tx.user.findFirst({
        where: { establecerContrasenaToken: token },
        select: { id: true, supabaseId: true, establecerContrasenaExpira: true },
      })
    )

    if (!user) {
      return { error: 'Token inválido. Solicita un nuevo enlace de acceso.' }
    }

    if (!user.establecerContrasenaExpira || user.establecerContrasenaExpira < new Date()) {
      return { error: 'El enlace ha expirado. Solicita un nuevo enlace de acceso.' }
    }

    const supabase = createAdminClient()
    const { error } = await supabase.auth.admin.updateUserById(user.supabaseId, {
      password: password,
    })

    if (error) {
      console.error('[excursiones] establecerContrasenaVendedor:', error)
      return { error: 'No se pudo actualizar la contraseña. Intenta de nuevo.' }
    }

    await sinEmpresa('establecer-contrasena:limpiar-token', (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { establecerContrasenaToken: null, establecerContrasenaExpira: null },
      })
    )

    return { success: 'Contraseña establecida. Ahora puedes iniciar sesión.' }
  } catch (e) {
    console.error('[excursiones] establecerContrasenaVendedor:', e)
    return { error: 'Error al procesar la solicitud. Intenta de nuevo.' }
  }
}
