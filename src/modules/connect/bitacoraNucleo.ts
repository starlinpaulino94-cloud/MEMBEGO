/**
 * EL VOCABULARIO DE LA BITÁCORA, en sus DOS idiomas (Connect · Fase 11).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ DOS Y NO UNO
 *
 * El mismo hecho le interesa a dos personas por razones distintas:
 *
 *   La dueña del negocio quiere saber QUÉ PASÓ CON SU CUENTA.
 *     «Conectaste WhatsApp» · «WhatsApp dejó de responder»
 *
 *   Quien integra quiere saber QUÉ HIZO EL SISTEMA, con su nombre exacto,
 *   para poder buscarlo, correlacionarlo y reportarlo.
 *     `credencial.guardada` · `conexion.fallo` · nivel WARN
 *
 * Antes había un solo texto, escrito a medio camino, que no servía del todo a
 * ninguna de las dos. Ahora el registro es el mismo —una sola tabla, un solo
 * apunte— y lo que cambia es la traducción según quién mire.
 *
 * Módulo PURO: sin `server-only`, sin Prisma. Se prueba entero.
 */

/**
 * Los eventos que el módulo emite. Vocabulario estable: estos strings viajan a
 * la base y NO se renombran a la ligera — un renombre deja huérfanos todos los
 * apuntes históricos, que seguirían guardando el nombre viejo.
 */
export const EVENTOS_CONECTOR = [
  'clave_api.creada',
  'clave_api.revocada',
  'webhook.suscrito',
  'webhook.apagado_por_fallos',
  'conexion.creada',
  'conexion.reiniciada',
  'conexion.desconectada',
  'conexion.configurada',
  'conexion.fallo',
  'credencial.guardada',
  'credencial.eliminada',
  'credencial.ilegible',
] as const

export type EventoConector = (typeof EVENTOS_CONECTOR)[number]

/**
 * IDIOMA TÉCNICO · para /desarrolladores/registros.
 *
 * Describe la operación del sistema. Va acompañado del código del evento y del
 * nivel, que es lo que hace falta para buscar en un incidente.
 */
const TECNICO: Record<EventoConector, string> = {
  'clave_api.creada': 'Se creó una clave de API',
  'clave_api.revocada': 'Se revocó una clave de API',
  'webhook.suscrito': 'Se creó una suscripción de webhook',
  'webhook.apagado_por_fallos': 'Una suscripción se apagó tras fallos consecutivos',
  'conexion.creada': 'Se inició una conexión',
  'conexion.reiniciada': 'Se reinició una conexión',
  'conexion.desconectada': 'Se desconectó una aplicación y se borraron sus credenciales',
  'conexion.configurada': 'Se completó el alta y se guardó la configuración',
  'conexion.fallo': 'Una llamada al proveedor falló',
  'credencial.guardada': 'Se guardó una credencial sellada',
  'credencial.eliminada': 'Se eliminó una credencial',
  'credencial.ilegible': 'Una credencial no se pudo descifrar',
}

/**
 * IDIOMA DE NEGOCIO · para el historial de cada integración.
 *
 * Habla de LA CUENTA de la empresa, no del sistema. Sin niveles, sin códigos,
 * sin la palabra «credencial»: quien lee esto quiere saber si su WhatsApp
 * funciona, no cómo lo guardamos.
 *
 * `null` = este evento NO se le enseña a la empresa. No es censura: son
 * apuntes internos que solo añadirían ruido a un historial que se lee para
 * responder «¿qué le pasó a mi conexión?». El apunte sigue existiendo y sigue
 * viéndose entero en la pantalla de desarrolladores.
 */
const NEGOCIO: Record<EventoConector, string | null> = {
  'clave_api.creada': null,
  'clave_api.revocada': null,
  'webhook.suscrito': null,
  'webhook.apagado_por_fallos': null,
  'conexion.creada': 'Empezaste a conectar esta aplicación',
  'conexion.reiniciada': 'Volviste a empezar la conexión',
  'conexion.desconectada': 'Desconectaste esta aplicación',
  'conexion.configurada': 'Terminaste de configurarla y quedó lista',
  'conexion.fallo': 'No pudimos usar esta aplicación',
  'credencial.guardada': 'Se guardó tu acceso, cifrado',
  'credencial.eliminada': 'Se borró tu acceso guardado',
  'credencial.ilegible': 'Tu acceso guardado dejó de ser válido',
}

function conocido(evento: string): evento is EventoConector {
  return (EVENTOS_CONECTOR as readonly string[]).includes(evento)
}

/**
 * Texto técnico. Un evento sin traducción se devuelve TAL CUAL: es preferible
 * una línea rara a una línea que falta — quien depura prefiere ver el código
 * crudo antes que un hueco.
 */
export function textoTecnico(evento: string): string {
  return conocido(evento) ? TECNICO[evento] : evento
}

/**
 * Texto de negocio, o null si este evento no se le enseña a la empresa.
 *
 * Un evento DESCONOCIDO devuelve null a propósito, y aquí la asimetría con
 * `textoTecnico` es deliberada: enseñarle `oauth.refresh.fallo` a la dueña de
 * un salón no le dice nada y la asusta. Si merece contarse, se le añade su
 * frase aquí.
 */
export function textoNegocio(evento: string): string | null {
  return conocido(evento) ? NEGOCIO[evento] : null
}
