import { conEmpresa } from '@/lib/tenant'

/**
 * Sucursal principal automática.
 *
 * La mayoría de las empresas tiene UN solo local: sin una sucursal creada, la
 * Caja del empleado no puede abrirse ni cobrar (y el cliente que elige "pagar
 * en la sucursal" no ve un destino concreto). Este helper garantiza que toda
 * empresa tenga al menos una sucursal, creada con los datos que el dueño
 * registró (dirección, ciudad y teléfono de la empresa).
 *
 * Idempotente y silencioso:
 *  - Si la empresa ya tiene sucursales, no crea nada; solo completa la
 *    dirección/teléfono de la "Sucursal principal" auto-creada cuando siguen
 *    vacíos y la empresa ya los tiene (el registro self-service captura la
 *    dirección DESPUÉS de crear la empresa, en el onboarding).
 *  - Nunca sobreescribe datos que el admin haya editado a mano.
 *  - Nunca lanza: un fallo aquí no debe romper el flujo que lo llamó.
 */

export const SUCURSAL_PRINCIPAL_NOMBRE = 'Sucursal principal'

export async function ensureSucursalPrincipal(companyId: string): Promise<void> {
  try {
    await conEmpresa(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { direccion: true, ciudad: true, telefono: true },
      })
      if (!company) return

      const direccion =
        [company.direccion, company.ciudad].filter(Boolean).join(', ') || null

      const existente = await tx.sucursal.findFirst({
        where: { companyId },
        select: { id: true },
      })

      if (!existente) {
        await tx.sucursal.create({
          data: {
            companyId,
            nombre: SUCURSAL_PRINCIPAL_NOMBRE,
            direccion,
            telefono: company.telefono,
          },
        })
        return
      }

      // Completar SOLO campos vacíos de la sucursal auto-creada.
      if (direccion) {
        await tx.sucursal.updateMany({
          where: { companyId, nombre: SUCURSAL_PRINCIPAL_NOMBRE, direccion: null },
          data: { direccion },
        })
      }
      if (company.telefono) {
        await tx.sucursal.updateMany({
          where: { companyId, nombre: SUCURSAL_PRINCIPAL_NOMBRE, telefono: null },
          data: { telefono: company.telefono },
        })
      }
    })
  } catch (e) {
    console.error('[sucursal-principal]', e)
  }
}
