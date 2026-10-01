'use server'

import { revalidatePath } from 'next/cache'
import type { SupplyV2BenefitFunding, SupplyV2BenefitScope, SupplyV2BenefitValueType } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, entero, fecha, fechaFinDeDia, texto, type EstadoAccion } from './actions-util'
import {
  aprobarBeneficioEnTx,
  asignarBeneficioEnTx,
  cancelarAsignacionEnTx,
  cancelarBeneficioEnTx,
  crearBeneficioEnTx,
  pausarBeneficioEnTx,
  reanudarBeneficioEnTx,
  reversarAplicacionBeneficioEnTx,
  type BeneficioCreado,
} from './benefits/service'
import { FUNDINGS, SCOPES, VALUE_TYPES } from './benefits/domain'
import { buscarClientesParaBeneficio } from './benefits/queries'
import { RUTA_BENEFICIOS, RUTA_BENEFICIOS_CLIENTE } from './core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · server actions de BENEFICIOS (§29–§30, §34).
 *
 * Mismo contrato que el resto: GUARDIA (permiso de plataforma) → REGLA (en
 * `benefits/service`, dentro de UNA transacción, con bitácora) → `{ error }`
 * o `{ success }`. Aquí no hay reglas de negocio: solo leer el formulario.
 *
 * Los permisos están separados a propósito (§34): crear no es aprobar y
 * aprobar no es asignar. La segregación (quien crea no aprueba) la impone el
 * dominio, no la pantalla.
 */

function refrescarBeneficios(id?: string): void {
  revalidatePath(RUTA_BENEFICIOS)
  if (id) revalidatePath(`${RUTA_BENEFICIOS}/${id}`)
  revalidatePath(RUTA_BENEFICIOS_CLIENTE)
}

export async function crearBeneficioAction(_prev: EstadoAccion<BeneficioCreado>, fd: FormData): Promise<EstadoAccion<BeneficioCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const funding = texto(fd, 'funding', 20) as SupplyV2BenefitFunding
    const valueType = texto(fd, 'valueType', 20) as SupplyV2BenefitValueType
    const scope = texto(fd, 'scope', 20) as SupplyV2BenefitScope
    if (!FUNDINGS.includes(funding)) return { error: 'Indica quién financia el beneficio.' }
    if (!VALUE_TYPES.includes(valueType)) return { error: 'Indica si es un importe fijo o un porcentaje.' }
    if (!SCOPES.includes(scope)) return { error: 'Indica a qué aplica el beneficio.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo vale el beneficio.' }
    const creado = await sinEmpresa('Supply 2.0: alta de un beneficio', (tx) =>
      crearBeneficioEnTx(
        tx,
        {
          name: texto(fd, 'name', 120),
          description: texto(fd, 'description', 1000) || null,
          objective: texto(fd, 'objective', 300) || null,
          funding,
          valueType,
          membegoValue: texto(fd, 'membegoValue', 20) || null,
          supplierValue: texto(fd, 'supplierValue', 20) || null,
          maxMembegoAmount: texto(fd, 'maxMembegoAmount', 20) || null,
          maxSupplierAmount: texto(fd, 'maxSupplierAmount', 20) || null,
          scope,
          offerId: texto(fd, 'offerId', 60) || null,
          catalogItemId: texto(fd, 'catalogItemId', 60) || null,
          supplierId: texto(fd, 'supplierId', 60) || null,
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
          perCustomerLimit: entero(fd, 'perCustomerLimit') ?? 1,
          requiresAssignment: texto(fd, 'requiresAssignment', 5) !== 'no',
          combinable: false,
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
    )
    refrescarBeneficios(creado.id)
    return { success: `Beneficio ${creado.code} creado como borrador. Otra persona autorizada lo aprueba para que empiece a valer.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError<BeneficioCreado>(e, 'crearBeneficio')
  }
}

export async function aprobarBeneficioAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply 2.0: aprobar un beneficio', (tx) => aprobarBeneficioEnTx(tx, id, ctx))
    refrescarBeneficios(id)
    return { success: r.repetido ? 'Este beneficio ya estaba activo.' : `Beneficio ${r.code} activo: ya se puede asignar y usar.`, id }
  } catch (e) {
    return comoError(e, 'aprobarBeneficio')
  }
}

export async function pausarBeneficioAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: pausar un beneficio', (tx) => pausarBeneficioEnTx(tx, id, ctx))
    refrescarBeneficios(id)
    return { success: 'Beneficio pausado: no se puede usar en compras nuevas. Las reservas en curso siguen vivas.', id }
  } catch (e) {
    return comoError(e, 'pausarBeneficio')
  }
}

export async function reanudarBeneficioAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: reanudar un beneficio', (tx) => reanudarBeneficioEnTx(tx, id, ctx))
    refrescarBeneficios(id)
    return { success: 'Beneficio activo otra vez.', id }
  } catch (e) {
    return comoError(e, 'reanudarBeneficio')
  }
}

export async function cancelarBeneficioAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_CANCEL')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se cancela el beneficio.' }
    await sinEmpresa('Supply 2.0: cancelar un beneficio', (tx) => cancelarBeneficioEnTx(tx, id, motivo, ctx))
    refrescarBeneficios(id)
    return { success: 'Beneficio cancelado. Lo ya aplicado queda aplicado; las asignaciones disponibles se cancelaron.', id }
  } catch (e) {
    return comoError(e, 'cancelarBeneficio')
  }
}

export async function asignarBeneficioAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_ASSIGN')
    const ctx = await contextoDeAuditoria(actor)
    const customerId = texto(fd, 'customerId', 60)
    if (!customerId) return { error: 'Elige el cliente que recibe el beneficio.' }
    const r = await sinEmpresa('Supply 2.0: asignar un beneficio a un cliente', (tx) =>
      asignarBeneficioEnTx(tx, { benefitId: id, customerId, usesAllowed: entero(fd, 'usesAllowed'), expiresAt: fechaFinDeDia(fd, 'expiresAt'), note: texto(fd, 'note', 500) || null }, ctx)
    )
    refrescarBeneficios(id)
    return { success: r.repetida ? 'Este cliente ya tenía el beneficio asignado.' : 'Beneficio asignado: el cliente ya lo ve en su cuenta.', id: r.id }
  } catch (e) {
    return comoError(e, 'asignarBeneficio')
  }
}

export async function cancelarAsignacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const grantId = texto(fd, 'customerBenefitId', 60)
  const benefitId = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_CANCEL')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se retira el beneficio a este cliente.' }
    await sinEmpresa('Supply 2.0: cancelar la asignación de un beneficio', (tx) => cancelarAsignacionEnTx(tx, grantId, motivo, ctx))
    refrescarBeneficios(benefitId)
    return { success: 'Asignación cancelada.', id: grantId }
  } catch (e) {
    return comoError(e, 'cancelarAsignacion')
  }
}

export async function reversarAplicacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const reservationId = texto(fd, 'reservationId', 60)
  const benefitId = texto(fd, 'benefitId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_CANCEL')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se reversa la aplicación.' }
    await sinEmpresa('Supply 2.0: reversar la aplicación de un beneficio', (tx) => reversarAplicacionBeneficioEnTx(tx, reservationId, motivo, ctx))
    refrescarBeneficios(benefitId)
    return { success: 'Aplicación reversada: el subsidio vuelve al presupuesto y el uso a la asignación.', id: reservationId }
  } catch (e) {
    return comoError(e, 'reversarAplicacion')
  }
}

/** Buscador de clientes del formulario de asignación (§10). */
export async function buscarClientesBeneficioAction(query: string): Promise<{ id: string; nombre: string; email: string }[]> {
  await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_ASSIGN')
  return buscarClientesParaBeneficio(query)
}
