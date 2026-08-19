'use server'

/**
 * EXCURSIONES · Reservas — acción del CLIENTE.
 *
 * Variante simplificada de crearReserva (admin): el cliente se reserva
 * directamente sin intermediación de un vendedor. El precio se lee del
 * catálogo en el servidor, nunca del formulario.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  calcularTotales,
  numeroReserva,
  validarReserva,
} from './nucleo'

export interface ReservaClienteState {
  error?: string
  success?: string
  reservaId?: string
  numero?: string
}

/** CLIENTE · Crear reserva directa (sin vendedor). */
export async function reservarExcursion(
  _prev: ReservaClienteState,
  formData: FormData
): Promise<ReservaClienteState> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Debes iniciar sesión para reservar.' }

    const companyId = String(formData.get('companyId') ?? '')
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')
    if (!companyId || !excursionId) {
      return { error: 'Faltan datos de la excursión.' }
    }

    // Resolver el clienteId del usuario autenticado.
    const cliente = await prisma.cliente.findFirst({
      where: { supabaseId: user.supabaseId, companyId },
      select: { id: true, nombre: true },
    })
    if (!cliente) {
      return { error: 'No se encontró tu perfil de cliente para esta empresa.' }
    }

    const v = validarReserva({
      fecha: String(formData.get('fecha') ?? ''),
      hora: String(formData.get('hora') ?? ''),
      adultos: String(formData.get('adultos') ?? '0'),
      ninos: String(formData.get('ninos') ?? '0'),
      descuento: '0',
      notas: String(formData.get('notas') ?? ''),
      canal: 'ONLINE',
    })
    if (!v.ok) return { error: v.error }

    // Precios del catálogo, nunca del formulario.
    const excursion = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId, estado: 'ACTIVA' },
        select: {
          id: true,
          nombre: true,
          moneda: true,
          impuestoPct: true,
          variantes: {
            where: { activa: true },
            select: { id: true, nombre: true, precioAdulto: true, precioNino: true },
            orderBy: { orden: 'asc' },
          },
        },
      })
    )
    if (!excursion) return { error: 'Esa excursión no está disponible.' }

    const variante =
      excursion.variantes.find((x) => x.id === varianteId) ?? excursion.variantes[0]
    if (!variante) return { error: 'Esa excursión no tiene variantes activas.' }

    const totales = calcularTotales({
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      precioAdulto: Number(variante.precioAdulto),
      precioNino: variante.precioNino != null ? Number(variante.precioNino) : null,
      descuento: 0,
      impuestoPct: excursion.impuestoPct != null ? Number(excursion.impuestoPct) : null,
    })

    const anio = v.datos.fecha.getUTCFullYear()

    const creada = await conEmpresa(companyId, async (tx) => {
      const desde = new Date(Date.UTC(anio, 0, 1))
      const hasta = new Date(Date.UTC(anio + 1, 0, 1))
      let intento =
        (await tx.reservaExc.count({
          where: { companyId, fecha: { gte: desde, lt: hasta } },
        })) + 1

      for (let i = 0; i < 5; i++) {
        try {
          return await tx.reservaExc.create({
            data: {
              companyId,
              numero: numeroReserva('EXC', anio, intento),
              clienteId: cliente.id,
              excursionId: excursion.id,
              varianteId: variante.id,
              fecha: v.datos.fecha,
              hora: v.datos.hora,
              adultos: v.datos.adultos,
              ninos: v.datos.ninos,
              subtotal: totales.subtotal,
              descuento: totales.descuento,
              impuestos: totales.impuestos,
              total: totales.total,
              moneda: excursion.moneda,
              estado: 'PENDIENTE',
              canal: 'ONLINE',
              notas: v.datos.notas,
              pasajeros: {
                createMany: {
                  data: [
                    ...Array.from({ length: v.datos.adultos }, () => ({
                      companyId,
                      tipo: 'ADULTO',
                    })),
                    ...Array.from({ length: v.datos.ninos }, () => ({
                      companyId,
                      tipo: 'NINO',
                    })),
                  ],
                },
              },
            },
            select: { id: true, numero: true },
          })
        } catch (e: unknown) {
          if (
            e instanceof Error &&
            e.message.includes('Unique constraint') &&
            e.message.includes('numero')
          ) {
            intento++
            continue
          }
          throw e
        }
      }
      throw new Error('No se pudo generar el número de reserva tras varios intentos.')
    })

    revalidatePath('/cliente/excursiones')

    return {
      success: 'Reserva creada. Puedes gestionar tu pago desde tu cuenta.',
      reservaId: creada.id,
      numero: creada.numero,
    }
  } catch (e) {
    anotarFallo('excursiones:reservarExcursion')(e)
    return { error: 'Error al crear la reserva. Intenta de nuevo.' }
  }
}
