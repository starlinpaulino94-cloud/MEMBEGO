/**
 * MEMBEGO SUPPLY · cuánto vive un QR dinámico.
 *
 * Vive aparte de `qr.ts` porque ese módulo es `server-only` y la cuenta atrás
 * la pinta el navegador. Un solo número en un solo sitio: si el servidor
 * caduca a los cinco minutos y la pantalla cuenta diez, la persona enseña un
 * código muerto y cree que el sitio falló.
 */
export const MINUTOS_QR = 5
