/**
 * NÚCLEO PURO DE LOS REINTENTOS de las dos colas de salida.
 *
 * Sin Prisma, sin red y sin `server-only`: aquí vive CUÁNDO se vuelve a
 * intentar una entrega, que es una decisión con consecuencias y por tanto algo
 * que se prueba.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE ESTO VIENE A ARREGLAR
 *
 * Hasta hoy el único que reintentaba era el cron —una vez al día, a las 13:00
 * UTC (`vercel.json`)—. Un receptor que se reiniciaba treinta segundos dejaba
 * al cliente sin su evento hasta el día siguiente, y agotar los ocho intentos
 * llevaba OCHO DÍAS. El outbox garantizaba que no se perdía nada; no que
 * llegara a tiempo, que es lo que de verdad se le promete a quien integra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA ESCALERA Y NO OTRA
 *
 * Los dos fallos que de verdad ocurren piden cosas opuestas:
 *
 *   · un despliegue del receptor, o un pico de latencia → dura segundos, y
 *     esperar una hora para reintentar es tirar el evento a la basura por
 *     nada;
 *   · un dominio caducado, o un error de programación en su endpoint → dura
 *     días, y reintentar cada treinta segundos es golpear a alguien que no
 *     puede responder, y pagarlo nosotros en ejecuciones.
 *
 * La escalera empieza en 30 s (cubre el primero) y termina en 24 h (aguanta el
 * segundo sin castigar a nadie). Los ocho intentos cubren algo más de 33 horas,
 * que es tiempo de sobra para que alguien se dé cuenta un lunes por la mañana
 * de lo que se rompió el domingo por la noche.
 */

/**
 * Intentos totales antes de dar una entrega por muerta.
 *
 * VIVE AQUÍ Y NO EN CADA COLA: estaba declarado por duplicado en
 * `despacho.ts` y en `connect/webhooks.ts` con el mismo valor, que es la forma
 * más cómoda de que un día dejen de tener el mismo valor sin que nadie lo
 * decida.
 */
export const MAX_INTENTOS = 8

/**
 * Espera tras el intento número N (índice N-1), en segundos.
 *
 * Son siete porque el primer intento es inmediato y no se espera para él: con
 * `MAX_INTENTOS = 8`, quedan siete esperas antes del descarte.
 */
export const ESPERAS_S = [
  30, //      tras el 1.º — un despliegue del receptor cabe aquí
  120, //     tras el 2.º — 2 min
  600, //     tras el 3.º — 10 min
  1_800, //   tras el 4.º — 30 min
  7_200, //   tras el 5.º — 2 h
  21_600, //  tras el 6.º — 6 h
  86_400, //  tras el 7.º — 24 h, y el 8.º es el último
] as const

/** Cuánto se desvía la espera de su valor nominal, arriba o abajo. */
const JITTER = 0.2

/**
 * Huella estable de un identificador. No es criptográfica ni lo necesita: solo
 * tiene que repartir, y tiene que dar SIEMPRE lo mismo para el mismo id.
 *
 * Que sea estable no es un detalle: si el jitter fuera aleatorio, dos
 * publicaciones del mismo reintento (la nuestra y un reintento de QStash sobre
 * la publicación) programarían dos esperas distintas, y la clave de
 * deduplicación dejaría de describir el mismo mensaje.
 */
function huella(texto: string): number {
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0
  return h >>> 0
}

/**
 * Segundos que hay que esperar tras `intentos` intentos fallidos, o `null` si
 * ya no hay que esperar nada porque la entrega está muerta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL JITTER NO ES ADORNO
 *
 * Cuando un receptor se cae, TODAS sus entregas fallan en el mismo segundo. Sin
 * dispersión, las mil vuelven a la vez a los 30 s exactos — y lo primero que
 * recibe un servidor que acaba de levantarse es la misma avalancha que quizá lo
 * tumbó. Un ±20 % reparte esa avalancha sobre doce segundos y no cuesta nada.
 */
export function esperaTrasIntento(intentos: number, semilla: string): number | null {
  if (intentos < 1) return ESPERAS_S[0]
  if (intentos >= MAX_INTENTOS) return null

  const base = ESPERAS_S[Math.min(intentos, ESPERAS_S.length) - 1]
  // De la huella se saca un factor en [-1, 1] que depende del id Y del número
  // de intento: si dependiera solo del id, una entrega «rápida» lo sería en
  // todos sus reintentos y otra «lenta» en todos los suyos.
  const desvio = (huella(`${semilla}:${intentos}`) % 2001) / 1000 - 1
  return Math.max(1, Math.round(base * (1 + desvio * JITTER)))
}

/**
 * Momento del próximo intento, o `null` si la entrega ya no se reintenta.
 * `ahora` se pasa para poder probar esto sin tocar el reloj del proceso.
 */
export function proximoIntentoTras(
  intentos: number,
  semilla: string,
  ahora: Date = new Date()
): { fecha: Date; esperaS: number } | null {
  const esperaS = esperaTrasIntento(intentos, semilla)
  if (esperaS === null) return null
  return { fecha: new Date(ahora.getTime() + esperaS * 1_000), esperaS }
}

/** ¿Este intento fue el último? Lo preguntan las dos colas para marcar el descarte. */
export function agotoLosIntentos(intentos: number): boolean {
  return intentos >= MAX_INTENTOS
}

/**
 * Ventana total que cubren los ocho intentos, en horas. Solo para documentar y
 * para que una prueba vigile que nadie alarga la escalera sin darse cuenta de
 * cuánto tiempo queda una entrega viva.
 */
export function ventanaTotalHoras(): number {
  return ESPERAS_S.reduce((a, b) => a + b, 0) / 3_600
}
