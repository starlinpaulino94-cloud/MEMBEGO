/** El flujo directo con PAN/CVV fue sustituido por CardNET tokenizado. */
export function cardnetDirectoRetirado(): Response {
  return Response.json(
    {
      error: 'CARDNET_DIRECTO_RETIRADO',
      mensaje: 'Este flujo de pago ya no está disponible. Actualiza la página para usar el pago tokenizado.',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
