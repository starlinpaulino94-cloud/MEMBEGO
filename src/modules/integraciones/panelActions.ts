'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { plural } from '@/lib/plural'
import { reintentarPendientes } from '@/modules/integraciones/despacho'
import { auditarIntegracion } from '@/modules/integraciones/auditoria'
import { revivirFallidos, sondearWebhook, type ResultadoSonda } from '@/modules/integraciones/panel'

/**
 * Acciones del panel de integraciones. Solo SUPERADMIN: tocan una URL externa
 * y mueven la cola de eventos de todos los sistemas conectados.
 *
 * Guard NO-redirect (devuelven error en el estado, no `redirect`): una server
 * action se despacha por su id desde cualquier path, así que el gate del
 * middleware no la protege — la comprobación tiene que estar aquí dentro.
 *
 * Las tres dejan línea en la bitácora. Son las acciones del superadmin que más
 * salen del sistema —peticiones al dominio de un tercero, eventos de todas las
 * empresas puestos en movimiento— y hasta ahora no registraban nada.
 */

/** El usuario si es superadmin; null si no. Se necesita su id para la bitácora. */
async function superadmin(): Promise<{ dbUserId: string | null } | null> {
  const user = await getUser()
  if (user?.metadata.role !== 'SUPERADMIN') return null
  return { dbUserId: user.metadata.dbUserId ?? null }
}

export interface SondaState {
  error?: string
  resultado?: ResultadoSonda
}

export async function sondearWebhookAction(
  _prev: SondaState,
  formData: FormData
): Promise<SondaState> {
  const quien = await superadmin()
  if (!quien) return { error: 'No autorizado.' }
  const sistemaId = String(formData.get('sistemaId') ?? '')
  if (!sistemaId) return { error: 'Falta el sistema.' }

  const res = await sondearWebhook(sistemaId)
  if ('error' in res) return { error: res.error }

  /**
   * Se guarda el VEREDICTO, no el cuerpo de la respuesta.
   *
   * El cuerpo de un satélite puede traer cualquier cosa —una traza con nombres
   * de clientes, una página de error con datos de sesión— y la bitácora es
   * consultable desde Auditoría por más gente que este panel. El código, el
   * titular y la gravedad bastan para reconstruir «el martes respondía 404 y el
   * jueves ya no», que es para lo que sirve tener historial. El cuerpo crudo
   * sigue en pantalla, ahí y en ese momento, para reenviárselo a su equipo.
   */
  await auditarIntegracion('INTEGRACION_SONDEADA', sistemaId, quien.dbUserId, {
    url: res.url,
    status: res.post.status,
    statusGet: res.get.status,
    titulo: res.diagnostico.titulo,
    gravedad: res.diagnostico.gravedad,
  })
  revalidatePath('/superadmin/integraciones')

  return { resultado: res }
}

export interface ReintentoState {
  error?: string
  mensaje?: string
}

/**
 * Fuerza el reenvío de la cola sin esperar al cron diario. Es la acción que
 * cierra el ciclo: el equipo del satélite arregla su ruta y aquí mismo se
 * comprueba, en vez de esperar a las 5 de la mañana para saber si sirvió.
 */
export async function reintentarPendientesAction(
  _prev: ReintentoState,
  formData: FormData
): Promise<ReintentoState> {
  const quien = await superadmin()
  if (!quien) return { error: 'No autorizado.' }

  // Los FALLIDO solo se reviven si se pide: revivirlos siempre convertiría un
  // botón de "reintentar" en un bucle infinito sobre eventos muertos.
  const sistemaId = String(formData.get('sistemaId') ?? '')
  if (!sistemaId) return { error: 'Falta el sistema.' }
  const revivir = formData.get('revivir') === '1'
  let revividos = 0
  if (revivir) {
    revividos = await revivirFallidos(sistemaId)
    await auditarIntegracion('INTEGRACION_REENCOLADA', sistemaId, quien.dbUserId, { revividos })
  }

  /**
   * EL REINTENTO ES DE ESTE SISTEMA, no de todos.
   *
   * El botón vive en la tarjeta de un satélite concreto y llamaba sin acotar:
   * pulsarlo en el del restaurante despachaba también la cola del car wash, que
   * podía estar encolada precisamente porque ESE otro estaba caído. Y el «12
   * entregados» de vuelta mezclaba los de todos, así que ni siquiera servía
   * para saber si lo que se acababa de arreglar funcionaba.
   */
  const { enviados, fallidos } = await reintentarPendientes(100, sistemaId)
  await auditarIntegracion('INTEGRACION_REINTENTADA', sistemaId, quien.dbUserId, {
    enviados,
    agotados: fallidos,
  })
  revalidatePath('/superadmin/integraciones')

  const partes = [
    revividos > 0 ? `${plural(revividos, 'evento devuelto', 'eventos devueltos')} a la cola` : '',
    plural(enviados, 'entregado', 'entregados'),
    fallidos > 0 ? `${plural(fallidos, 'agotó', 'agotaron')} sus intentos` : '',
  ].filter(Boolean)

  return { mensaje: partes.join(' · ') }
}
