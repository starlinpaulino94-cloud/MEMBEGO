/**
 * Traduce el error de Supabase Storage a un mensaje que diga QUÉ falló.
 *
 * «No se pudo subir la imagen. Intenta de nuevo.» servía para todo: bucket
 * inexistente, clave de servicio caducada, formato rechazado por el bucket o
 * archivo demasiado grande. El administrador reintentaba sin poder arreglar
 * nada, porque la causa solo salía en el log del servidor. Aquí cada causa
 * conocida recibe su frase; lo desconocido conserva el mensaje genérico.
 *
 * No filtra nada sensible: los mensajes de Storage describen el bucket o la
 * petición, nunca datos de otra empresa.
 */
export function mensajeDeStorage(error: unknown, opciones: { maxMb: number }): string {
  const texto = (
    typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : ''
  ).toLowerCase()

  if (/bucket not found|bucket .* does not exist/.test(texto)) {
    return 'El almacenamiento de imágenes no está configurado (falta el bucket «promociones»). Avisa al administrador de la plataforma.'
  }
  if (/mime ?type .*not supported|invalid mime|mime type is not allowed/.test(texto)) {
    return 'El almacenamiento rechazó el formato. Usa JPG, PNG o WebP.'
  }
  if (/exceeded the maximum allowed size|payload too large|too large|entity too large|413/.test(texto)) {
    return `La imagen no puede superar ${opciones.maxMb} MB.`
  }
  if (/jwt|invalid signature|signature verification|unauthorized|invalid token|401|403|not authorized/.test(texto)) {
    return 'El servidor no tiene acceso al almacenamiento (clave de servicio de Supabase no válida). Avisa al administrador de la plataforma.'
  }
  if (/already exists|duplicate|resource already exists/.test(texto)) {
    return 'Ya existe un archivo con ese nombre. Intenta de nuevo.'
  }
  if (/fetch failed|network|econn|timed? ?out|failed to fetch|load failed/.test(texto)) {
    return 'No se pudo conectar con el almacenamiento. Revisa tu conexión e intenta de nuevo.'
  }
  return 'No se pudo subir la imagen. Intenta de nuevo.'
}
