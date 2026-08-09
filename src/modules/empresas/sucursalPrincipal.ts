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
 *    dirección/teléfono/COORDENADAS de la "Sucursal principal" auto-creada
 *    cuando siguen vacíos y la empresa ya los tiene (el registro self-service
 *    captura la dirección DESPUÉS de crear la empresa, en el onboarding).
 *  - Nunca sobreescribe datos que el admin haya editado a mano.
 *  - Nunca lanza: un fallo aquí no debe romper el flujo que lo llamó.
 *
 * LAS COORDENADAS SON LO QUE HACE VISIBLE A LA EMPRESA EN EL MAPA, y hasta
 * ahora no se copiaban. `Company.latitud/longitud` y `Sucursal.latitud/longitud`
 * son campos distintos: el dueño colocaba el pin en su perfil, se guardaba en
 * la empresa, y la sucursal principal se quedaba en null. Como "Cerca de mí"
 * consulta SUCURSALES y exige `latitud IS NOT NULL`, el negocio no aparecía
 * nunca — sin error, sin aviso y sin nada que el admin pudiera hacer desde esa
 * pantalla. Marcar el punto exacto en el perfil ahora sí llega al mapa.
 */

export const SUCURSAL_PRINCIPAL_NOMBRE = 'Sucursal principal'

/**
 * El punto de la empresa, solo si está COMPLETO.
 *
 * Media coordenada no ubica nada, y copiarla dejaría la sucursal en un estado
 * que el mapa descarta igual (`latitud IS NOT NULL AND longitud IS NOT NULL`)
 * pero que ya no se puede volver a completar: la condición `OR [latitud null,
 * longitud null]` sí lo recogería, pero con un valor a medias en la base es más
 * difícil ver qué pasó. Todo o nada.
 */
export function puntoDeEmpresa(
  latitud: number | null | undefined,
  longitud: number | null | undefined
): { latitud: number; longitud: number } | null {
  if (typeof latitud !== 'number' || !Number.isFinite(latitud)) return null
  if (typeof longitud !== 'number' || !Number.isFinite(longitud)) return null
  if (latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) return null
  return { latitud, longitud }
}

export async function ensureSucursalPrincipal(companyId: string): Promise<void> {
  try {
    await conEmpresa(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          direccion: true,
          ciudad: true,
          telefono: true,
          latitud: true,
          longitud: true,
        },
      })
      if (!company) return

      const direccion =
        [company.direccion, company.ciudad].filter(Boolean).join(', ') || null

      const punto = puntoDeEmpresa(company.latitud, company.longitud)

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
            ...(punto ?? {}),
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
      if (punto) {
        // `OR` y no `latitud: null` a secas: una sucursal con media coordenada
        // guardada por cualquier vía tampoco sale en el mapa, así que también
        // hay que completarla. Quien ya tenga su punto puesto no se toca — el
        // admin con varias sucursales las coloca en /admin/sucursales.
        await tx.sucursal.updateMany({
          where: {
            companyId,
            nombre: SUCURSAL_PRINCIPAL_NOMBRE,
            OR: [{ latitud: null }, { longitud: null }],
          },
          data: punto,
        })
      }
    })
  } catch (e) {
    console.error('[sucursal-principal]', e)
  }
}
