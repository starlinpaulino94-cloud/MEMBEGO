import { randomUUID } from 'node:crypto'
import { prisma } from '../src/lib/prisma'

/**
 * Datos DEMO para el proyecto de desarrollo (NO producción).
 * Idempotente: cada sección se salta si ya existen registros demo.
 * Uso: npx tsx scripts/demo-datos.ts
 */

const DEMO = 'demo'

async function main() {
  const cartown = await prisma.company.findUnique({ where: { slug: 'cartown' } })
  const tonis = await prisma.company.findUnique({ where: { slug: 'tonis' } })
  if (!cartown || !tonis) throw new Error('Faltan empresas del seed base')
  const sucursal = await prisma.sucursal.findFirst({ where: { companyId: cartown.id } })
  const cliente = await prisma.cliente.findFirst({ where: { email: 'cliente@membego.com' } })
  const empleado = await prisma.user.findUnique({ where: { email: 'empleado.cartown@membego.com' } })
  const adminCartown = await prisma.user.findUnique({ where: { email: 'admin.cartown@membego.com' } })
  const membership = await prisma.membership.findFirst({ where: { clienteId: cliente?.id } })
  if (!sucursal || !cliente || !empleado || !membership) throw new Error('Falta seed base (corre db:seed primero)')

  const resumen: string[] = []
  const skip = (s: string) => resumen.push(s + ': ya existía, omitido')
  const ok = (s: string) => resumen.push(s)

  const dia = 24 * 3600 * 1000
  const ahora = new Date()

  // 1. Visitas (historial del cliente) + comprobante
  if ((await prisma.visit.count({ where: { clienteId: cliente.id } })) === 0) {
    for (let i = 5; i >= 1; i--) {
      await prisma.visit.create({
        data: {
          clienteId: cliente.id,
          membershipId: membership.id,
          servicio: i % 2 ? 'Lavado Premium' : 'Lavado Express',
          createdAt: new Date(ahora.getTime() - i * 3 * dia),
        } as never,
      })
    }
    ok('Visitas: 5 en el historial')
  } else skip('Visitas')
  const visita = await prisma.visit.findFirst({ where: { clienteId: cliente.id } })
  if (visita && !(await prisma.comprobante.findFirst({ where: { visitId: visita.id } }))) {
    await prisma.comprobante.create({
      data: { visitId: visita.id, membershipId: membership.id, numero: 'DEMO-001' } as never,
    })
    ok('Comprobantes: 1')
  } else skip('Comprobantes')

  // 2. Servicio carwash
  if ((await prisma.servicio.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.servicio.create({ data: { companyId: cartown.id, nombre: 'Lavado Premium' } as never })
    await prisma.servicio.create({ data: { companyId: cartown.id, nombre: 'Lavado Express' } as never })
    ok('Servicios: 2')
  } else skip('Servicios')

  // 3. Promociones / motor de promociones / programa de referidos
  if ((await prisma.promocion.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.promocion.create({
      data: { companyId: cartown.id, titulo: '2x1 en Lavado Premium (demo)', descripcion: 'Lunes y martes, presentando tu QR.' } as never,
    })
    ok('Promociones: 1')
  } else skip('Promociones')
  if ((await prisma.promotion.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.promotion.create({ data: { companyId: cartown.id, nombre: 'Puntos x2 demo' } as never })
    ok('Motor Promotions: 1')
  } else skip('Motor Promotions')
  if ((await prisma.referralProgram.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.referralProgram.create({
      data: { companyId: cartown.id, nombre: 'Refiere y gana demo', type: 'BOTH' } as never,
    })
    ok('Programas de referido: 1')
  } else skip('Programas de referido')

  // Segundo cliente demo (sin Auth: no puede loguearse, sirve para referidos)
  let cliente2 = await prisma.cliente.findFirst({ where: { email: 'demo.referido@membego.com' } })
  if (!cliente2) {
    cliente2 = await prisma.cliente.create({
      data: { companyId: cartown.id, supabaseId: 'demo-' + randomUUID(), nombre: 'Ana Referida', email: 'demo.referido@membego.com' },
    })
    ok('Cliente demo extra: 1 (sin login)')
  }
  if ((await prisma.referido.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.referido.create({
      data: { companyId: cartown.id, referenteClienteId: cliente.id, referidoClienteId: cliente2.id },
    })
    ok('Referidos: 1')
  } else skip('Referidos')

  // 4. Excursión + reserva + vendedor + meta
  let excursion = await prisma.excursion.findUnique({ where: { companyId_slug: { companyId: tonis.id, slug: 'demo-aventura-santiago' } } }).catch(() => null)
  if (!excursion) {
    excursion = await prisma.excursion.create({
      data: { companyId: tonis.id, nombre: 'Aventura Santiago Demo', slug: 'demo-aventura-santiago' } as never,
    })
    ok('Excursiones: 1')
  } else skip('Excursiones')
  if ((await prisma.reservaExc.count({ where: { companyId: tonis.id } })) === 0 && excursion) {
    await prisma.reservaExc.create({
      data: {
        companyId: tonis.id, numero: 'RES-DEMO-001', clienteId: cliente.id,
        excursionId: excursion.id, fecha: new Date(ahora.getTime() + 7 * dia),
        subtotal: 2500, total: 2500, estado: 'CONFIRMADA',
      } as never,
    })
    ok('Reservas: 1 confirmada')
  } else skip('Reservas')
  if ((await prisma.vendedor.count({ where: { companyId: tonis.id } })) === 0) {
    await prisma.vendedor.create({ data: { companyId: tonis.id, nombre: 'Vendedor Demo', codigo: 'VEND-001' } as never })
    ok('Vendedores: 1')
  } else skip('Vendedores')
  if ((await prisma.vendedorMeta.count({ where: { companyId: tonis.id } })) === 0) {
    await prisma.vendedorMeta.create({ data: { companyId: tonis.id, periodo: 'MENSUAL' } as never })
    ok('Metas de vendedor: 1')
  } else skip('Metas de vendedor')

  // 5. Campañas: marketing + campaña + oferta privada + ruleta + invitación
  if ((await prisma.marketingCampaign.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.marketingCampaign.create({
      data: {
        companyId: cartown.id, titulo: 'Flash Sale fin de semana', descripcion: 'Demo de campaña flash.',
        fechaInicio: ahora, fechaFin: new Date(ahora.getTime() + 3 * dia), diasSemana: [5, 6, 0],
      } as never,
    })
    ok('Campañas marketing: 1')
  } else skip('Campañas marketing')
  if ((await prisma.campana.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.campana.create({ data: { companyId: cartown.id, nombre: 'Verano Demo 2026' } as never })
    ok('Campañas: 1')
  } else skip('Campañas')
  if ((await prisma.ofertaPrivada.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.ofertaPrivada.create({
      data: { companyId: cartown.id, codigo: 'VIP-DEMO-20', titulo: '20% clientes VIP (demo)' } as never,
    })
    ok('Ofertas privadas: 1')
  } else skip('Ofertas privadas')
  if ((await prisma.ruletaPremio.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.ruletaPremio.create({ data: { companyId: cartown.id, nombre: 'Lavado gratis' } as never })
    await prisma.ruletaPremio.create({ data: { companyId: cartown.id, nombre: 'Descuento 10%' } as never })
    ok('Premios ruleta: 2')
  } else skip('Premios ruleta')
  if ((await prisma.ruletaJugada.count({ where: { clienteId: cliente.id } })) === 0) {
    await prisma.ruletaJugada.create({
      data: { companyId: cartown.id, clienteId: cliente.id, costoPuntos: 100, premioNombre: 'Lavado gratis' } as never,
    })
    ok('Jugadas ruleta: 1')
  } else skip('Jugadas ruleta')
  if ((await prisma.invitacion.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.invitacion.create({
      data: { companyId: cartown.id, email: 'futuro.empleado@membego.com', rol: 'EMPLEADO', expiraEn: new Date(ahora.getTime() + 7 * dia) } as never,
    })
    ok('Invitaciones: 1')
  } else skip('Invitaciones')

  // 6. Regalos + gift card
  if ((await prisma.regalo.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.regalo.create({
      data: { companyId: cartown.id, tipo: 'TRANSFERENCIA_USOS', remitenteId: cliente.id, expiraAt: new Date(ahora.getTime() + 30 * dia) } as never,
    })
    ok('Regalos: 1')
  } else skip('Regalos')
  if ((await prisma.giftCard.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.giftCard.create({
      data: { companyId: cartown.id, codigo: 'GC-DEMO-100', monto: 1000, saldo: 1000, compradorClienteId: cliente.id } as never,
    })
    ok('Gift cards: 1')
  } else skip('Gift cards')

  // 7. Ticket de soporte + mensajes
  let ticket = await prisma.supportTicket.findFirst({ where: { companyId: cartown.id } })
  if (!ticket) {
    ticket = await prisma.supportTicket.create({
      data: { companyId: cartown.id, clienteId: cliente.id, asunto: 'Duda con mi membresía (demo)' } as never,
    })
    await prisma.ticketMensaje.create({
      data: { ticketId: ticket.id, autorTipo: 'CLIENTE', autorNombre: 'Pedro Cliente', cuerpo: 'Hola, ¿cuántos lavados me quedan?' } as never,
    })
    await prisma.ticketMensaje.create({
      data: { ticketId: ticket.id, autorTipo: 'ADMIN', autorNombre: 'Carlos Lavado', cuerpo: 'Hola Pedro, te quedan lavados según tu plan activo. ¡Te esperamos!' } as never,
    })
    ok('Tickets: 1 con 2 mensajes')
  } else skip('Tickets')

  // 8. Caja: sesión abierta + movimientos
  let sesion = await prisma.cajaSesion.findFirst({ where: { companyId: cartown.id, estado: 'ABIERTA' } }).catch(() =>
    prisma.cajaSesion.findFirst({ where: { companyId: cartown.id } }),
  )
  if (!sesion) {
    sesion = await prisma.cajaSesion.create({
      data: { companyId: cartown.id, sucursalId: sucursal.id, abiertaPorId: empleado.id } as never,
    })
    await prisma.movimientoCaja.create({
      data: { companyId: cartown.id, cajaSesionId: sesion.id, tipo: 'ENTRADA', monto: 5000, concepto: 'Apertura demo' } as never,
    })
    await prisma.movimientoCaja.create({
      data: { companyId: cartown.id, cajaSesionId: sesion.id, tipo: 'ENTRADA', monto: 1500, concepto: 'Venta membresía demo' } as never,
    })
    await prisma.movimientoCaja.create({
      data: { companyId: cartown.id, cajaSesionId: sesion.id, tipo: 'SALIDA', monto: 800, concepto: 'Compra insumos demo' } as never,
    })
    ok('Caja: sesión abierta + 3 movimientos')
  } else skip('Caja')

  // 9. Cita
  if ((await prisma.cita.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.cita.create({
      data: { companyId: cartown.id, clienteId: cliente.id, inicio: new Date(ahora.getTime() + 2 * dia), duracionMin: 60, estado: 'CONFIRMADA' } as never,
    })
    ok('Citas: 1 confirmada')
  } else skip('Citas')

  // 10. Contenido: post + rating + follow extra
  if ((await prisma.companyPost.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.companyPost.create({
      data: { companyId: cartown.id, tipo: 'NOTICIA', titulo: 'Nuevo horario de fin de semana', contenido: 'Ahora abrimos los domingos de 9am a 2pm.' } as never,
    })
    ok('Posts: 1')
  } else skip('Posts')
  if ((await prisma.companyRating.count({ where: { companyId: cartown.id } })) === 0) {
    await prisma.companyRating.create({
      data: { companyId: cartown.id, clienteId: cliente.id, rating: 5 } as never,
    })
    ok('Ratings: 1 (5 estrellas)')
  } else skip('Ratings')

  // 11. Notificaciones
  if (adminCartown && (await prisma.notificacion.count({ where: { userId: adminCartown.id } })) === 0) {
    await prisma.notificacion.create({
      data: { userId: adminCartown.id, tipo: 'NUEVO_COMPROBANTE', titulo: 'Comprobante demo', mensaje: 'Se subió un comprobante de prueba.' } as never,
    })
    await prisma.notificacion.create({
      data: { userId: adminCartown.id, tipo: 'SISTEMA', titulo: 'Datos demo listos', mensaje: 'Se cargaron los datos de demostración.' } as never,
    })
    ok('Notificaciones: 2')
  } else skip('Notificaciones')

  console.log('\n📋 Datos demo:')
  for (const r of resumen) console.log('   ' + r)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ demo-datos falló:', e)
  await prisma.$disconnect()
  process.exit(1)
})
