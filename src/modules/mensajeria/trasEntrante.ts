import 'server-only'
import type { Canal } from '@/modules/mensajeria/nucleo'

/**
 * DESPUÉS DE GUARDAR UN ENTRANTE (Meta · Fases 6 y 7): el prospecto nace o
 * se actualiza, y las automatizaciones se enteran.
 *
 * NUNCA LANZA. El mensaje ya está en su conversación; si el CRM o el bus de
 * eventos fallan, el trabajo del webhook no debe reintentarse —volvería a
 * encontrar el mensaje como duplicado y no ganaría nada— ni el fallo debe
 * aparecer como «evento sin procesar». Se anota y se sigue.
 */
export async function trasEntrante(input: {
  companyId: string
  canal: Canal
  conversacionId: string
  contacto: { id: string; clienteId: string | null; nuevo: boolean }
  nombre: string | null
  telefono: string | null
  tipo: string
  texto: string | null
  timestamp: Date
}): Promise<void> {
  try {
    const { registrarProspectoDesdeEntrante } = await import('@/modules/crm/prospectos')
    const prospecto = await registrarProspectoDesdeEntrante({
      companyId: input.companyId,
      contacto: input.contacto,
      conversacionId: input.conversacionId,
      canal: input.canal,
      nombre: input.nombre,
      telefono: input.telefono,
      timestamp: input.timestamp,
    })

    const { emitirMensajeRecibido, emitirProspectoCreado } = await import('@/modules/mensajeria/eventos')
    await emitirMensajeRecibido({
      companyId: input.companyId,
      canal: input.canal,
      conversacionId: input.conversacionId,
      contactoId: input.contacto.id,
      clienteId: input.contacto.clienteId,
      tipo: input.tipo,
      texto: input.texto,
      nombre: input.nombre,
      telefono: input.telefono,
      primero: input.contacto.nuevo,
    })
    if (prospecto?.creado) {
      await emitirProspectoCreado({
        companyId: input.companyId,
        prospectoId: prospecto.id,
        canal: input.canal,
        conversacionId: input.conversacionId,
        contactoId: input.contacto.id,
        nombre: input.nombre,
        telefono: input.telefono,
      })
    }
  } catch (e) {
    console.error('[mensajeria] tras el entrante', e)
  }
}
