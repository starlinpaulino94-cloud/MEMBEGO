/**
 * MODO MANTENIMIENTO — el interruptor que hace posible una restauración.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (auditoría de producción · A-08, Fase 5)
 *
 * Un plan de recuperación que no puede DETENER la aplicación no es un plan.
 *
 * Restaurar una base mientras la aplicación sigue aceptando escrituras produce
 * el peor resultado posible: la restauración devuelve el estado de las 14:00,
 * y encima de él se han ido escribiendo visitas, pagos y canjes de las 14:05
 * en adelante. El resultado no es "los datos viejos" ni "los datos nuevos":
 * es una mezcla que nadie puede desenredar después, porque no queda registro
 * de qué fila vino de dónde. Un cliente puede canjear dos veces el mismo
 * beneficio; una transacción de caja puede existir sin su sesión de caja.
 *
 * Por eso el primer paso de TODOS los runbooks de restauración es encender
 * esto, y el último es apagarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DECISIONES QUE NO SON OBVIAS
 *
 * 1. El pase es su PROPIA variable (`MANTENIMIENTO_PASE`), no `BOOTSTRAP_SECRET`.
 *    El pase viaja en una cookie del navegador de quien opera: es un secreto
 *    que se expone a propósito. Si fuera el mismo que autoriza
 *    /api/bootstrap-superadmin, una extensión de navegador curiosa pasaría de
 *    "puede usar la app durante el mantenimiento" a "puede crear un
 *    superadministrador". El peor caso de que se filtre este pase es que
 *    alguien use la aplicación mientras está cerrada. Eso es aceptable; lo otro
 *    no.
 *
 * 2. Un pase corto se trata como pase AUSENTE (fail-closed). Si alguien pone
 *    `MANTENIMIENTO_PASE=1234` bajo presión, no queremos una puerta que se
 *    abre por fuerza bruta en segundos: queremos que no haya puerta y que la
 *    verificación se haga por otra vía (logs, consultas SQL directas).
 *
 * 3. `/api/health` queda EXENTO. Es lo que mira el monitor de uptime. Si el
 *    mantenimiento lo bloqueara, cada restauración planificada dispararía las
 *    mismas alertas que una caída real — y unas semanas después nadie
 *    distinguiría una de otra. (Hoy además ni siquiera pasa por el proxy: el
 *    `matcher` lo excluye. La exención está aquí igualmente, porque un cambio
 *    futuro en el matcher no debe reabrir el problema en silencio.)
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Cookie que recuerda el pase para no repetirlo en cada navegación. */
export const COOKIE_MANTENIMIENTO = 'membego-mantenimiento'

/** Parámetro de consulta con el que se canjea el pase: `/?pase=…`. */
export const PARAM_MANTENIMIENTO = 'pase'

/** Duración de la cookie de pase: dos horas. Un mantenimiento más largo que
 *  eso ya no es un mantenimiento, es un incidente, y conviene volver a
 *  autenticarse a mano. */
export const HORAS_PASE = 2

/** Longitud mínima del pase para considerarlo utilizable. */
export const LARGO_MINIMO_PASE = 16

/** Rutas que siguen respondiendo con el mantenimiento encendido. */
const EXENTAS = ['/api/health']

export type AccionMantenimiento =
  /** Dejar pasar la petición con normalidad. */
  | 'pasar'
  /** Devolver 503 con la página de mantenimiento. */
  | 'bloquear'
  /** El pase venía en la URL: sembrar la cookie y dejar pasar. */
  | 'abrir'

export interface EntradaMantenimiento {
  /** Valor de `MODO_MANTENIMIENTO`. */
  modo: string | undefined
  /** Valor de `MANTENIMIENTO_PASE`. */
  pase: string | undefined
  path: string
  /** Cookie `membego-mantenimiento` que trae el navegador, si la trae. */
  cookie: string | undefined
  /** Parámetro `?pase=` de la URL, si viene. */
  parametro: string | null
}

/**
 * ¿Está encendido el mantenimiento?
 *
 * Se acepta `true` y `1` para que dé igual cómo lo escriba quien lo enciende a
 * las tres de la mañana. Cualquier otra cosa —incluido el vacío, que es como
 * queda la variable si se "borra" en el panel de Vercel sin eliminarla— es
 * APAGADO. Un modo mantenimiento que se enciende por accidente con un valor
 * raro tiraría el sitio entero.
 */
export function mantenimientoEncendido(modo: string | undefined): boolean {
  const v = (modo ?? '').trim().toLowerCase()
  return v === 'true' || v === '1'
}

/**
 * Comparación en tiempo constante para cadenas.
 *
 * `===` sobre cadenas corta en el primer carácter distinto, lo que filtra
 * cuántos caracteres del pase se acertaron. No es `timingSafeEqual` porque el
 * proxy corre en el runtime edge y `node:crypto` no está disponible ahí.
 *
 * Fuga conocida y aceptada: la LONGITUD del pase. Saber que mide 32 caracteres
 * no ayuda a adivinar cuáles son.
 */
export function igualdadConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

/** Un pase vacío o demasiado corto es un pase que no existe. */
function paseUtilizable(pase: string | undefined): pase is string {
  return typeof pase === 'string' && pase.trim().length >= LARGO_MINIMO_PASE
}

/**
 * Qué hacer con esta petición. Función pura: toda la decisión del modo
 * mantenimiento vive aquí y se prueba en `tests/mantenimiento.test.ts`.
 */
export function decidirMantenimiento(e: EntradaMantenimiento): AccionMantenimiento {
  if (!mantenimientoEncendido(e.modo)) return 'pasar'
  if (EXENTAS.some((r) => e.path === r || e.path.startsWith(`${r}/`))) return 'pasar'

  if (paseUtilizable(e.pase)) {
    const pase = e.pase.trim()
    if (e.parametro && igualdadConstante(e.parametro, pase)) return 'abrir'
    if (e.cookie && igualdadConstante(e.cookie, pase)) return 'pasar'
  }

  return 'bloquear'
}

/**
 * ¿Esta ruta espera JSON?
 *
 * Un fetch de la aplicación que recibe HTML donde esperaba JSON revienta con
 * un error de parseo incomprensible. Con 503 y un JSON pequeño, quien llama
 * —incluida QStash, que reintenta con espera creciente— sabe qué pasó.
 */
export function esRutaDeApi(path: string): boolean {
  return path.startsWith('/api/')
}

/**
 * Página de mantenimiento, en HTML plano y dentro de este archivo.
 *
 * NO es una página de Next. Esto es deliberado: el mantenimiento se enciende
 * justo cuando la aplicación puede no estar en condiciones de renderizar nada
 * —base restaurándose, migración a medias, esquema desfasado—. Una página que
 * necesita que el servidor de React funcione es exactamente la que no
 * funcionará el día que haga falta. Esta cadena la sirve el proxy sin tocar la
 * base de datos, sin Supabase y sin el árbol de componentes.
 */
export function htmlMantenimiento(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Volvemos en unos minutos · MembeGo</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#0b0b0f; color:#f4f4f5; padding:24px; }
  main { max-width:32rem; text-align:center; }
  h1 { font-size:1.5rem; margin:0 0 .75rem; letter-spacing:-.02em; }
  p { margin:0 0 .5rem; line-height:1.6; color:#a1a1aa; }
  .marca { font-size:.75rem; letter-spacing:.18em; text-transform:uppercase;
           color:#71717a; margin-bottom:1.5rem; }
</style>
</head>
<body>
<main>
  <div class="marca">MembeGo</div>
  <h1>Estamos haciendo un mantenimiento</h1>
  <p>El servicio vuelve en unos minutos. No hace falta que hagas nada.</p>
  <p>Si estás en el local, sigue atendiendo con normalidad y registra los
     lavados cuando el sistema vuelva.</p>
</main>
</body>
</html>`
}
