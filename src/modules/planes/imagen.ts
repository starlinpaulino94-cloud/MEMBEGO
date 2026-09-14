/**
 * ¿ESTA URL DE IMAGEN DE PLAN ES NUESTRA?
 *
 * El formulario manda la URL en un campo oculto que rellena el componente de
 * subida. Un campo oculto no es una garantía: quien pueda editar planes puede
 * mandar el formulario a mano con cualquier cadena. Y esa cadena termina en un
 * `<img src>` en la pantalla de CADA cliente que mire el plan — un origen
 * ajeno ahí ve la IP y el agente de cada uno de ellos cada vez que abren la
 * app, y puede dejar de responder el día que quiera.
 *
 * Por eso solo se acepta lo que salió de nuestro propio bucket público. No es
 * desconfianza hacia quien administra: es que el daño no recae sobre él.
 *
 * Se comprueba en el SERVIDOR, en `parsePlan`, no aquí en el navegador: el
 * navegador es justo la parte que se puede saltar.
 */

/** Prefijo público del bucket donde viven las imágenes de plan. */
export function prefijoImagenPlan(base = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!base) return null
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/promociones/`
}

const EXTENSIONES = ['.jpg', '.jpeg', '.png', '.webp']

/**
 * `null` si la URL sirve; si no, el motivo, ya redactado para el formulario.
 * Una cadena vacía es válida: significa «sin imagen».
 */
export function validarImagenPlan(
  url: string,
  base = process.env.NEXT_PUBLIC_SUPABASE_URL
): string | null {
  const limpia = url.trim()
  if (!limpia) return null

  const prefijo = prefijoImagenPlan(base)
  // Sin `NEXT_PUBLIC_SUPABASE_URL` no hay con qué comparar. Se rechaza en vez
  // de dejar pasar: fallar abierto aquí sería aceptar cualquier origen justo
  // cuando la configuración está rota.
  if (!prefijo) return 'No se pudo verificar el origen de la imagen.'
  if (!limpia.startsWith(prefijo)) {
    return 'La imagen debe subirse desde el formulario, no pegarse como enlace.'
  }

  const sinParametros = limpia.split('?')[0]!.toLowerCase()
  if (!EXTENSIONES.some((ext) => sinParametros.endsWith(ext))) {
    return 'Formato de imagen no permitido. Usa JPG, PNG o WebP.'
  }
  return null
}
