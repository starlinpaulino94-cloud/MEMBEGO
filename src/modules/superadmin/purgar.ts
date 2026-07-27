import { prisma } from '@/lib/prisma'

/**
 * Purga de un Cliente con todas sus dependencias restrictivas, en orden.
 *
 * VIVE APARTE DE `eliminarActions.ts` A PROPÓSITO: aquel archivo es
 * `'use server'`, y en un archivo así CADA export se convierte en un endpoint
 * al que se puede llamar desde el navegador. Exportar desde allí una función
 * que borra un cliente por id habría creado, sin quererlo, un botón de borrado
 * sin autenticación. Aquí es una función normal: solo la puede llamar el
 * servidor, y quien la llama es responsable de haber comprobado el permiso.
 *
 * Las cascadas automáticas del esquema (growth, ratings, notas, ruleta,
 * progresos) y los SetNull (transacciones, eventos de invitación) no necesitan
 * paso propio. Devuelve conteos para dejar rastro de lo borrado.
 */
export async function purgarClienteRow(clienteId: string) {
  const [comprobantes, visitas, qrs, membresias, compras, referidos, refEventos, tickets, vehiculos] =
    await prisma.$transaction([
      prisma.comprobante.deleteMany({ where: { membership: { clienteId } } }),
      prisma.visit.deleteMany({ where: { clienteId } }),
      prisma.qrToken.deleteMany({ where: { clienteId } }),
      prisma.membership.deleteMany({ where: { clienteId } }),
      prisma.productoCompra.deleteMany({ where: { clienteId } }),
      prisma.referido.deleteMany({
        where: { OR: [{ referenteClienteId: clienteId }, { referidoClienteId: clienteId }] },
      }),
      prisma.referralEvent.deleteMany({ where: { clienteId } }),
      prisma.supportTicket.deleteMany({ where: { clienteId } }),
      prisma.vehiculo.deleteMany({ where: { clienteId } }),
    ])
  await prisma.cliente.delete({ where: { id: clienteId } })
  return {
    comprobantes: comprobantes.count,
    visitas: visitas.count,
    qrs: qrs.count,
    membresias: membresias.count,
    compras: compras.count,
    referidos: referidos.count,
    refEventos: refEventos.count,
    tickets: tickets.count,
    vehiculos: vehiculos.count,
  }
}
