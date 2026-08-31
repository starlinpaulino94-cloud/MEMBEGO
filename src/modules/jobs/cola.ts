import { publicar, qstashConfigurado } from '@/lib/jobs/qstash'
import { anotarFallo } from '@/lib/prisma-errors'
import { RUTA_TRABAJOS, RUTA_TRABAJOS_MUERTOS, type CargaTrabajo } from '@/modules/jobs/tipos'

/**
 * ENCOLAR UN TRABAJO — con degradación honesta.
 *
 * Con QStash configurado, el trabajo sale del request y se ejecuta fuera, con
 * reintentos. Sin QStash (desarrollo, previews, o producción mal configurada)
 * NO se pierde: se ejecuta en línea. Es más lento y puede agotar el tiempo de
 * la función con volúmenes grandes, pero perder notificaciones en silencio es
 * peor que tardar.
 *
 * El aviso en consola es deliberadamente ruidoso: en producción, ver esa línea
 * significa que la cola no está puesta y que se está corriendo el riesgo que
 * la cola existe para evitar.
 */
export async function encolar(carga: CargaTrabajo): Promise<'cola' | 'en-linea'> {
  if (qstashConfigurado()) {
    const ok = await publicar(RUTA_TRABAJOS, carga, {
      // Idempotencia: si el cron se dispara dos veces el mismo día, o QStash
      // reintenta una publicación que en realidad sí llegó, la clave repetida
      // se descarta y nadie recibe la notificación dos veces.
      deduplicationId: claveDedup(carga),
      reintentos: 3,
      // Dead letter (Fase 2 de Connect): si los 3 reintentos fracasan, QStash
      // nos devuelve el mensaje difunto y queda en `trabajos_muertos` para
      // reencolarlo desde el panel — antes simplemente desaparecía.
      rutaFallo: RUTA_TRABAJOS_MUERTOS,
    })
    if (ok) return 'cola'
    console.error('[jobs] QStash rechazó la publicación; se ejecuta en línea:', carga.tipo)
    anotarDegradacion(carga, 'publicacion_rechazada')
  } else if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[jobs] QSTASH_TOKEN sin configurar en producción: los trabajos se ejecutan dentro del request. Ver docs/COLAS.md'
    )
    anotarDegradacion(carga, 'sin_configurar')
  }

  const { ejecutarTrabajo } = await import('@/modules/jobs/ejecutor')
  await ejecutarTrabajo(carga)
  return 'en-linea'
}

/**
 * Clave de deduplicación.
 *
 * Incluye el día para las automatizaciones (una vez por empresa y día) y el
 * lote para las notificaciones. NO incluye la hora exacta: si la incluyera,
 * dos disparos del mismo cron con un minuto de diferencia serían claves
 * distintas y la deduplicación no serviría de nada.
 *
 * Las de Fase 4 van por identidad:
 *  · email  → huella del contenido: una publicación repetida del mismo correo
 *    (reintento del emisor) no entrega el recibo dos veces.
 *  · evento → el id del automation_event: cada evento se despacha una vez.
 *  · recompensas → referidoId: una conversión = un trabajo, aunque la misma
 *    persona convierta dos veces.
 */
export function claveDedup(carga: CargaTrabajo): string {
  const dia = new Date().toISOString().slice(0, 10)
  switch (carga.tipo) {
    case 'automatizaciones':
      return `auto:${carga.companyId}:${dia}`
    case 'notificar':
      // Las notificaciones llevan un hash del contenido: dos campañas distintas
      // el mismo día a la misma audiencia SÍ deben salir las dos.
      return `notif:${carga.companyId}:${carga.audiencia}:${carga.desde}:${huella(
        carga.payload.titulo + carga.payload.mensaje
      )}`
    case 'email':
      return `email:${huella(carga.to + carga.subject + (carga.html ?? '') + (carga.text ?? ''))}`
    case 'evento-estrategia':
      return `evt:${carga.eventoId}`
    case 'recompensas-referido':
      return `recomp:${carga.companyId}:${carga.referidoId}`
    case 'campana-dirigida':
      // El lote es la unidad idempotente: cada desplazamiento se procesa una vez.
      return `camp:${carga.campanaId}:${carga.desde}`
  }
}

/**
 * La degradación deja de ser solo una frase en consola: como evento
 * estructurado se puede CONTAR, y «cuántos trabajos corrieron en línea esta
 * semana» es exactamente la pregunta que decide si la cola está bien puesta.
 * (Era deuda ALTA de la Fase 0 de Connect.)
 */
function anotarDegradacion(carga: CargaTrabajo, motivo: string): void {
  import('@/modules/observabilidad/eventos')
    .then(({ registrarEvento }) =>
      registrarEvento({
        dominio: 'cola',
        accion: 'degradacion',
        ok: false,
        motivo,
        companyId: 'companyId' in carga ? (carga.companyId ?? null) : null,
        extra: { tipo: carga.tipo },
      })
    )
    .catch(anotarFallo('jobs:anotar-degradacion', { tipo: carga.tipo }))
}

/** Huella corta y estable de un texto. No es criptográfica ni lo necesita. */
function huella(texto: string): string {
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
