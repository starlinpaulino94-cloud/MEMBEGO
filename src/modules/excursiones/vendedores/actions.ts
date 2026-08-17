'use server'

/**
 * EXCURSIONES · Vendedores — acciones. Crear un vendedor genera EN EL MISMO
 * ACTO sus tres identificadores (§10): código comercial estable, enlace único
 * global y —derivado del enlace— su QR. Nunca se borra un vendedor: se
 * desactiva y su histórico permanece (§99).
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { generarCodigo } from '@/lib/codes'
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
}

const CAMPOS = ['nombre', 'apellido', 'telefono', 'whatsapp', 'email', 'documento', 'direccion', 'tipo', 'supervisorId']

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
