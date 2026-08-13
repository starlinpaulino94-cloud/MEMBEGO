'use server'

/**
 * Plataforma modular · E4 — administración de capacidades por empresa.
 * SOLO el superadmin edita (el admin de la empresa las ve reflejadas en su
 * launchpad/shell). Guarda ÚNICAMENTE los overrides que difieren del paquete
 * base de la categoría: así, si mañana el paquete base cambia, las empresas
 * sin override lo heredan solo.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import {
  CAPACIDADES,
  CATEGORIAS,
  CAPACIDADES_BASE,
  MODULOS_CLIENTE,
  capacidadesDeEmpresa,
  categoriaDeEmpresa,
  type Capacidad,
  type CategoriaNegocio,
  type ModuloCliente,
  type VisibilidadModulo,
} from './catalogo'
import { CAPACIDADES_TAG } from './resolver'
import { anotarFallo } from '@/lib/prisma-errors'

export interface CapacidadesActionState {
  error?: string
  success?: string
}

export async function guardarCapacidades(
  _prev: CapacidadesActionState,
  formData: FormData
): Promise<CapacidadesActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'SUPERADMIN') {
      return { error: 'Solo el superadmin puede administrar capacidades.' }
    }

    const companyId = String(formData.get('companyId') ?? '').trim()
    if (!companyId) return { error: 'Empresa no especificada.' }
    const company = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        // `tipoNegocioCodigo` y `capacidades`: la categoría derivada tiene que
        // salir de LO MISMO que muestra la pantalla. Derivarla solo del `type`
        // hacía que la decisión de «¿hace falta fijar la categoría?» se tomara
        // sobre la información equivocada.
        select: { id: true, name: true, type: true, tipoNegocioCodigo: true, capacidades: true },
      })
    )
    if (!company) return { error: 'Empresa no encontrada.' }

    // Categoría elegida (o la derivada del type si no se cambia).
    const categoriaRaw = String(formData.get('categoria') ?? '').trim()
    const categoria: CategoriaNegocio = (CATEGORIAS as readonly string[]).includes(categoriaRaw)
      ? (categoriaRaw as CategoriaNegocio)
      : categoriaDeEmpresa(company)

    // Toggles del formulario → overrides SOLO donde difieren del paquete base.
    const base = new Set(CAPACIDADES_BASE[categoria])
    const overrides: Partial<Record<Capacidad, boolean>> = {}
    for (const cap of CAPACIDADES) {
      const encendida = formData.get(`cap_${cap}`) === 'on'
      if (encendida !== base.has(cap)) overrides[cap] = encendida
    }

    // Visibilidad de los módulos del cliente. AUTO no se guarda: es la
    // ausencia de decisión, y guardarla congelaría el criterio automático el
    // día que cambie.
    const modulosCliente: Partial<Record<ModuloCliente, VisibilidadModulo>> = {}
    for (const modulo of MODULOS_CLIENTE) {
      const valor = String(formData.get(`mod_${modulo}`) ?? 'AUTO')
      if (valor === 'MOSTRAR' || valor === 'OCULTAR') modulosCliente[modulo] = valor
    }

    const derivada = categoriaDeEmpresa(company)
    const config = {
      ...(categoria !== derivada ? { categoria } : {}),
      ...(Object.keys(overrides).length ? { overrides } : {}),
      ...(Object.keys(modulosCliente).length ? { modulosCliente } : {}),
    }

    /**
     * QUÉ CAMBIÓ, no cuál es el estado final.
     *
     * La bitácora guardaba `overrides` y `modulosCliente` completos: para saber
     * si alguien había apagado las citas de un negocio había que comparar dos
     * líneas a mano. Y lo hacía como `NOTA_INTERNA` con un subtipo, así que
     * tampoco se podía filtrar por acción — que es como se busca cuando
     * preguntan «¿quién le apagó esto a este negocio?».
     */
    const antesActivas = capacidadesDeEmpresa(company).activas
    const despuesActivas = new Set(base)
    for (const [cap, on] of Object.entries(overrides)) {
      if (on) despuesActivas.add(cap as Capacidad)
      else despuesActivas.delete(cap as Capacidad)
    }
    const encendidas = [...despuesActivas].filter((c) => !antesActivas.has(c)).sort()
    const apagadas = [...antesActivas].filter((c) => !despuesActivas.has(c)).sort()
    const categoriaAntes = categoriaDeEmpresa(company)

    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { capacidades: Object.keys(config).length ? config : Prisma.DbNull },
      })
    )
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'CAPACIDADES_ACTUALIZADAS',
          entidadTipo: 'Company',
          entidadId: companyId,
          payload: {
            empresa: company.name,
            // `antes`/`despues` los pinta la bitácora como «X → Y» sin abrir el
            // payload, así que el cambio de categoría se lee desde la lista.
            ...(categoriaAntes !== categoria
              ? { antes: categoriaAntes, despues: categoria }
              : { categoria }),
            encendidas,
            apagadas,
            modulosCliente,
          },
          ...meta,
        },
      })
    ).catch(anotarFallo('capacidades:auditLog.create'))

    // El resolutor está cacheado por tag: los cambios aplican de inmediato.
    revalidateTag(CAPACIDADES_TAG, 'max')
    revalidatePath('/superadmin/capacidades')
    // El launchpad ya no existe; las capacidades siguen decidiendo qué módulos
    // están encendidos, así que se refresca el panel entero.
    revalidatePath('/admin', 'layout')
    revalidatePath('/admin/app/carwash')
    revalidatePath('/admin/aplicaciones/capacidades')
    return { success: `Capacidades de ${company.name} guardadas.` }
  } catch (e) {
    console.error('[capacidades] guardar:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260758_capacidades en la base de datos.',
    }
  }
}
