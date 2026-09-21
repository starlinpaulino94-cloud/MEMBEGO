import 'server-only'
import { conEmpresa } from '@/lib/tenant'

/**
 * ─── Google Calendar · el evento de una cita ─────────────────────────────────
 *
 * Las dos operaciones del ciclo de vida del evento de una cita, en UN sitio:
 * llevarla a la agenda al confirmarse —venga de donde venga la confirmación— y
 * quitarla al cancelarse, la cancele quien la cancele (el panel, el cliente o la
 * API pública). Best-effort las dos: la cita ya cambió de estado y está
 * guardada; que Google esté caído no puede deshacerlo ni devolver un error a
 * quien la cambió — el fallo queda en la salud de la conexión, que es donde se
 * mira.
 *
 * Vive FUERA de `actions.ts` (que es `'use server'`) a propósito: en un archivo
 * así cada export es un endpoint del navegador, y estas no deben serlo. Aquí son
 * funciones normales, solo invocables desde el servidor, y así las comparten la
 * acción del panel y la cancelación de la API sin duplicarse.
 *
 * La importación del conector es dinámica para no cargar su cliente HTTP en cada
 * acción de citas que no lo necesita.
 */
export interface CitaParaGoogle {
  id: string
  companyId: string
  googleEventId: string | null
  inicio: Date
  duracionMin: number
  servicio: string | null
  clienteNombre: string | null
  tz: string
}

export async function llevarCitaAGoogle(cita: CitaParaGoogle): Promise<void> {
  // Con id guardado no se vuelve a crear: primera línea de defensa contra el
  // duplicado (la segunda es el id determinista, que Google rechaza con 409).
  if (cita.googleEventId) return
  const { tz } = cita
  try {
    const { crearEventoCalendario } = await import('@/modules/connect/googleCalendar')
    const res = await crearEventoCalendario({
      companyId: cita.companyId,
      citaId: cita.id,
      evento: {
        titulo: `${cita.servicio ?? 'Cita'} · ${cita.clienteNombre ?? 'Cliente'}`,
        descripcion: 'Cita confirmada desde MembeGo.',
        inicio: cita.inicio,
        fin: new Date(cita.inicio.getTime() + cita.duracionMin * 60_000),
        zonaHoraria: tz,
      },
    })
    if (!res.ok || !res.eventoId) return
    const eventoId = res.eventoId
    // El id se guarda para poder borrarlo al cancelar y no crearlo dos veces.
    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({ where: { id: cita.id }, data: { googleEventId: eventoId } })
    )
  } catch (e) {
    console.error('[citas] no se pudo crear el evento en Google:', e)
  }
}

export async function quitarCitaDeGoogle(
  cita: Pick<CitaParaGoogle, 'id' | 'companyId' | 'googleEventId'>
): Promise<void> {
  if (!cita.googleEventId) return
  try {
    const { eliminarEventoCalendario } = await import('@/modules/connect/googleCalendar')
    const res = await eliminarEventoCalendario({
      companyId: cita.companyId,
      eventoId: cita.googleEventId,
    })
    if (!res.ok) return
    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({ where: { id: cita.id }, data: { googleEventId: null } })
    )
  } catch (e) {
    console.error('[citas] no se pudo quitar el evento de Google:', e)
  }
}
