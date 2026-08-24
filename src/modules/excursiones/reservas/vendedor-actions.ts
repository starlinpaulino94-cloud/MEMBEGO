'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario } from '@/modules/excursiones/panel/queries'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { calcularTotales, numeroReserva, validarReserva } from './nucleo'
import { sincronizarEstadoAgotada } from '../catalogo/actions'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { randomBytes } from 'crypto'

export interface ReservaVendedorState {
  error?: string
  success?: string
  reservaId?: string
}

export async function crearReservaVendedor(
  _prev: ReservaVendedorState,
  formData: FormData
): Promise<ReservaVendedorState> {
  try {
    const user = await requireRole(['VENDEDOR'])
    const vendedor = user.metadata.dbUserId ? await vendedorDeUsuario(user.metadata.dbUserId) : null
    if (!vendedor) return { error: 'No autorizado.' }

    const companyId = vendedor.companyId
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')
    const clienteNombre = String(formData.get('clienteNombre') ?? '').trim()
    const clienteEmail = String(formData.get('clienteEmail') ?? '').trim().toLowerCase()

    if (!clienteNombre || !clienteEmail || !excursionId || !varianteId) {
      return { error: 'Faltan datos requeridos.' }
    }

    const v = validarReserva({
      fecha: String(formData.get('fecha') ?? ''),
      hora: String(formData.get('hora') ?? ''),
      adultos: String(formData.get('adultos') ?? '0'),
      ninos: String(formData.get('ninos') ?? '0'),
      descuento: '0',
      notas: String(formData.get('notas') ?? ''),
      canal: 'VENDEDOR',
      voucherAgencia: String(formData.get('voucherAgencia') ?? ''),
      hotelRecogida: String(formData.get('hotelRecogida') ?? ''),
      lobbyRecogida: String(formData.get('lobbyRecogida') ?? ''),
      horaRecogida: String(formData.get('horaRecogida') ?? ''),
      habitacion: String(formData.get('habitacion') ?? ''),
    })
    if (!v.ok) return { error: v.error }

    const excursion = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId },
        select: {
          id: true,
          nombre: true,
          moneda: true,
          impuestoPct: true,
          variantes: {
            where: { id: varianteId, activa: true },
            select: { id: true, precioAdulto: true, precioNino: true },
          },
        },
      })
    )
    if (!excursion || excursion.variantes.length === 0) {
      return { error: 'La excursión o la opción seleccionada no está disponible.' }
    }

    const variante = excursion.variantes[0]
    const totales = calcularTotales({
      precioAdulto: variante.precioAdulto.toNumber(),
      precioNino: variante.precioNino?.toNumber(),
      impuestoPct: excursion.impuestoPct?.toNumber() ?? 0,
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      descuentoFijo: 0,
    })

    // Auto-provisión de cuenta
    const supabaseAdmin = createAdminClient()
    let targetClienteId: string
    let targetUserId: string

    // 1. Verificar si el usuario ya existe por email
    let userRow = await prisma.user.findUnique({ where: { email: clienteEmail } })
    
    if (userRow) {
      targetUserId = userRow.id
      // Verificar si ya tiene perfil de cliente en esta empresa
      let clienteRow = await prisma.cliente.findUnique({
        where: { supabaseId_companyId: { supabaseId: userRow.supabaseId, companyId } }
      })
      
      if (clienteRow) {
        targetClienteId = clienteRow.id
      } else {
        // Crear perfil de cliente para el usuario existente
        const nuevoCliente = await conEmpresa(companyId, tx => 
          tx.cliente.create({
            data: {
              companyId,
              email: clienteEmail,
              nombre: clienteNombre,
              supabaseId: userRow!.supabaseId,
            }
          })
        )
        targetClienteId = nuevoCliente.id
      }
    } else {
      // 2. Usuario no existe, aprovisionar
      const password = randomBytes(12).toString('base64')
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: clienteEmail,
        password: password,
        email_confirm: true,
        user_metadata: { role: 'CLIENTE', source: 'vendor_provisioning', name: clienteNombre }
      })

      if (authErr || !authData.user) {
        console.error('[excursiones] crearReservaVendedor/authErr', authErr)
        return { error: 'No se pudo aprovisionar la cuenta del cliente.' }
      }

      await ensureEmailIdentity(authData.user.id, clienteEmail)
      
      const createdUser = await prisma.user.create({
        data: {
          email: clienteEmail,
          supabaseId: authData.user.id,
          role: 'CLIENTE',
          name: clienteNombre,
        }
      })
      targetUserId = createdUser.id

      const nuevoCliente = await conEmpresa(companyId, tx => 
        tx.cliente.create({
          data: {
            companyId,
            email: clienteEmail,
            nombre: clienteNombre,
            supabaseId: createdUser.supabaseId,
          }
        })
      )
      targetClienteId = nuevoCliente.id

      // 3. Enviar correo de bienvenida con usuario y contraseña
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'
      await sendEmail({
        to: clienteEmail,
        subject: '¡Tu cuenta en MembeGo está lista!',
        companyId,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>¡Hola ${clienteNombre}!</h2>
            <p>Se ha creado tu cuenta para que puedas gestionar tus reservas.</p>
            <div style="background-color: #f4f4f5; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0 0 8px 0;"><strong>Usuario:</strong> ${clienteEmail}</p>
              <p style="margin: 0;"><strong>Contraseña:</strong> ${password}</p>
            </div>
            <p>
              <a href="${siteUrl}/login" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Iniciar Sesión
              </a>
            </p>
            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              Te recomendamos cambiar tu contraseña una vez hayas iniciado sesión por primera vez.
            </p>
          </div>
        `
      })
    }

    // 4. Crear Reserva
    const anio = v.datos.fecha.getUTCFullYear()
    const prefijo = excursion.nombre.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'E') || 'EXC'

    const reserva = await conEmpresa(companyId, async (tx) => {
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
              numero: numeroReserva(prefijo, anio, intento),
              clienteId: targetClienteId,
              vendedorId: vendedor.id,
              excursionId,
              varianteId,
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
              canal: 'VENDEDOR',
              notas: v.datos.notas,
              voucherAgencia: v.datos.voucherAgencia,
              hotelRecogida: v.datos.hotelRecogida,
              lobbyRecogida: v.datos.lobbyRecogida,
              horaRecogida: v.datos.horaRecogida,
              habitacion: v.datos.habitacion,
              creadaPorId: user.metadata.dbUserId ?? null,
              pasajeros: {
                createMany: {
                  data: [
                    ...Array.from({ length: v.datos.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
                    ...Array.from({ length: v.datos.ninos }, () => ({ companyId, tipo: 'NINO' })),
                  ],
                },
              },
            },
            select: { id: true, numero: true },
          })
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_numero')
    })

    // 5. Atribución
    await conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.create({
        data: {
          companyId,
          vendedorId: vendedor.id,
          clienteId: targetClienteId,
          etapa: 'RESERVA',
        },
      })
    ).catch(anotarFallo('excursiones:crearReservaVendedor:atribucion'))

    // 6. Auditoría y sincronización
    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ReservaExc',
          entidadId: reserva.id,
          payload: { tipo: 'RESERVA_CREADA_POR_VENDEDOR', vendedorId: vendedor.id },
          ...meta,
        },
      })
    ).catch(anotarFallo('excursiones:crearReservaVendedor:auditLog'))

    await sincronizarEstadoAgotada(companyId, excursionId)
    revalidatePath('/vendedor/reservas')

    return { success: `Reserva ${reserva.numero} creada exitosamente.`, reservaId: reserva.id }
  } catch (e) {
    anotarFallo('excursiones:crearReservaVendedor')(e)
    return { error: 'Ocurrió un error inesperado al procesar la reserva.' }
  }
}
