/**
 * Escapado de texto para incrustarlo en HTML.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ VIVE AQUÍ Y NO EN CADA MÓDULO
 *
 * El fallo que evita es siempre el mismo: texto que escribe un usuario acaba
 * dentro de un `html:` de correo. Y ya había DOS copias distintas en el
 * repositorio, que es peor que ninguna:
 *
 *   · `modules/admin/invitacionActions.ts` cubría `< > &`.
 *   · `components/geo/MapaCercaDeMi.tsx` cubría además las comillas.
 *
 * La primera basta para el contenido de una etiqueta y NO basta para un
 * atributo — y esa diferencia no se ve al leer la plantilla, que es
 * exactamente cuando importa. Con una sola función, la duda desaparece:
 * escapa siempre lo suficiente para los dos sitios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO ES
 *
 * No es un saneador de HTML: no acepta marcas y quita las peligrosas. Convierte
 * TODO en texto literal. Si algún día hay que dejar pasar marcas del usuario,
 * eso pide una librería de saneado, no un parámetro más en esta función.
 */

/**
 * Convierte `valor` en algo que se puede pegar tanto en el contenido de una
 * etiqueta como dentro de un atributo entrecomillado.
 *
 * El `&` se reemplaza PRIMERO a propósito: si fuera después, reescribiría las
 * entidades que acaban de crear los otros reemplazos y `<` terminaría como
 * `&amp;lt;`, que se ve en pantalla como `&lt;` en vez de `<`.
 */
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
