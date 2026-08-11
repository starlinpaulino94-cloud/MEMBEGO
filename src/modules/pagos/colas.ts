import type { Prisma } from '@prisma/client'

/**
 * COLAS DE PAGO · una sola definición para todo el panel.
 *
 * Existía dos veces. `/admin/pagos` contaba «por validar» como transferencias
 * con comprobante + cambios de plan + compras en validación + cobros en
 * sucursal; el Resumen lo contaba como membresías en PENDIENTE o
 * PENDIENTE_PAGO. No se parecen: PENDIENTE es «pidió el plan y nunca pagó»,
 * donde no hay NADA que validar, y en cambio al Resumen se le escapaban los
 * cambios de plan y las compras, que sí hay que validar.
 *
 * El resultado se veía en pantalla: el Resumen decía «7 pagos por validar» con
 * un botón que llevaba a una pantalla que decía «0 pagos por validar». Un aviso
 * urgente que lleva a un sitio vacío no se corrige leyéndolo mejor: la segunda
 * vez que pasa, el administrador deja de creerse el panel entero.
 *
 * Aquí vive el criterio. Las dos pantallas lo consumen; ninguna lo reescribe.
 */

/**
 * Un pago iniciado EN EL LOCAL: el cliente eligió pagar en caja. Se reconoce
 * por su referencia POS, por la sucursal que eligió o por un método presencial.
 *
 * Antes esto se decidía en memoria sobre las primeras 500 filas traídas, así
 * que a partir de la 501 el recuento de la pestaña era falso sin avisar. Como
 * condición de base de datos, cuenta siempre todas.
 */
const PRESENCIAL: Prisma.MembershipWhereInput[] = [
  { referencia: { not: null } },
  { sucursalPagoId: { not: null } },
  { metodoPago: { is: { tipo: 'PRESENCIAL' } } },
]

const PRESENCIAL_COMPRA: Prisma.ProductoCompraWhereInput[] = [
  { referencia: { not: null } },
  { sucursalPagoId: { not: null } },
  { metodoPago: { is: { tipo: 'PRESENCIAL' } } },
]

/** Filtro de empresa; null/undefined = plataforma completa (superadmin). */
function deEmpresa(companyId: string | null | undefined) {
  return companyId ? { companyId } : {}
}

// ── Las cuatro colas que SÍ hay que validar ─────────────────────────────────

/** Transferencias con comprobante enviado, esperando visto bueno. */
export function whereTransferencias(companyId: string | null | undefined): Prisma.MembershipWhereInput {
  return { estado: 'PENDIENTE_PAGO', ...deEmpresa(companyId) }
}

/** Cambio de plan solicitado sobre una membresía que sigue activa. */
export function whereCambiosDePlan(companyId: string | null | undefined): Prisma.MembershipWhereInput {
  return { estado: 'ACTIVA', planIdSolicitado: { not: null }, ...deEmpresa(companyId) }
}

/** Compras de promociones esperando validación del pago. */
export function whereComprasEnValidacion(
  companyId: string | null | undefined
): Prisma.ProductoCompraWhereInput {
  return { estado: 'EN_VALIDACION', ...deEmpresa(companyId) }
}

/** Membresías que el cliente vino a pagar al local y nadie ha cobrado aún. */
export function whereMembresiasEnSucursal(
  companyId: string | null | undefined
): Prisma.MembershipWhereInput {
  return { estado: 'PENDIENTE', ...deEmpresa(companyId), OR: PRESENCIAL }
}

/** Lo mismo para las compras de promociones. */
export function whereComprasEnSucursal(
  companyId: string | null | undefined
): Prisma.ProductoCompraWhereInput {
  return {
    estado: { in: ['SOLICITADA', 'PENDIENTE_PAGO'] },
    ...deEmpresa(companyId),
    OR: PRESENCIAL_COMPRA,
  }
}

// ── La cola que NO es de validar: seguimiento ───────────────────────────────
//
// Empezaron un pago y no lo terminaron: eligieron transferencia y no mandaron
// el comprobante, o se lo rechazaron y no volvieron a intentarlo. Aquí no hay
// nada que aprobar — hay alguien a quien llamar. Por eso no suma en «por
// validar»: mezclarlas fue el origen de la contradicción.

export function whereMembresiasSinCompletar(
  companyId: string | null | undefined
): Prisma.MembershipWhereInput {
  return {
    ...deEmpresa(companyId),
    OR: [
      { estado: 'RECHAZADA' },
      { estado: 'PENDIENTE', NOT: { OR: PRESENCIAL } },
    ],
  }
}

export function whereComprasSinCompletar(
  companyId: string | null | undefined
): Prisma.ProductoCompraWhereInput {
  return {
    ...deEmpresa(companyId),
    OR: [
      { estado: 'RECHAZADA' },
      { estado: { in: ['SOLICITADA', 'PENDIENTE_PAGO'] }, NOT: { OR: PRESENCIAL_COMPRA } },
    ],
  }
}
