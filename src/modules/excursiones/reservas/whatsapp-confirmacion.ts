import { enviarWhatsapp, type ResultadoEnvio } from '@/modules/connect/whatsapp'

type InputConfirmacion = {
  companyId: string
  telefono: string
  nombreCliente: string
  numeroReserva: string
  nombreExcursion: string
  fecha: string
  hora: string
  pasajeros: number
  total: number
  moneda: string
}

function construirTextoConfirmacion(i: Omit<InputConfirmacion, 'companyId' | 'telefono' | 'nombreCliente'>): string {
  return (
    `✅ Reserva confirmada: ${i.numeroReserva}\n` +
    `🎯 ${i.nombreExcursion}\n` +
    `📅 ${i.fecha} a las ${i.hora}\n` +
    `👥 ${i.pasajeros} pasajero(s)\n` +
    `💰 ${i.moneda} ${i.total}\n\n` +
    `Tu pase de acceso está en tu correo. ¡Te esperamos! 🌴`
  )
}

export async function enviarConfirmacionReservaWhatsApp(input: InputConfirmacion): Promise<ResultadoEnvio> {
  try {
    const texto = construirTextoConfirmacion({
      numeroReserva: input.numeroReserva,
      nombreExcursion: input.nombreExcursion,
      fecha: input.fecha,
      hora: input.hora,
      pasajeros: input.pasajeros,
      total: input.total,
      moneda: input.moneda,
    })

    return await enviarWhatsapp({
      companyId: input.companyId,
      telefono: input.telefono,
      texto,
    })
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : 'error_desconocido' }
  }
}
