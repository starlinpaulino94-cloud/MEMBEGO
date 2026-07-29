import { type NextRequest } from 'next/server'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * RETORNO DEL RETO 3DS — puente entre la pantalla del banco y nuestra página.
 *
 * CardNET deja al cliente aquí DESPUÉS del reto (OTP del banco). Este retorno
 * ocurre DENTRO de un iframe: la página de compra (la "ventana padre") sigue
 * viva con los datos de tarjeta EN MEMORIA. El trabajo de esta ruta es uno
 * solo: avisarle a esa ventana padre "el reto terminó, sigue" con
 * `postMessage`.
 *
 * NO cobra aquí. El cobro lo hace la ventana padre llamando a
 * `/api/pagos/cardnet/completar` con la tarjeta que guardó — porque el cobro
 * necesita el PAN/CVV, y este servidor no los tiene ni los quiere tener.
 *
 * En el momento de este retorno el iframe ya volvió a NUESTRO dominio (CardNET
 * redirige aquí), así que es del mismo origen que la ventana padre y el
 * `postMessage` con nuestro origen funciona.
 *
 * Acepta GET y POST porque la pasarela puede volver por cualquiera de los dos.
 * Lo único que se lee es el `rd` que pusimos al iniciar (nuestro id de intento),
 * para que la ventana padre confirme que es su propio pago.
 */

function leer(params: URLSearchParams | FormData, claves: string[]): string {
  for (const c of claves) {
    const v = params.get(c)
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function paginaPuente(rd: string, threeDS: string): Response {
  // El origen al que se envía el mensaje es el nuestro: la ventana padre
  // comprueba `event.origin` antes de creerle. El script es mínimo y no toca
  // datos sensibles (no hay tarjeta aquí).
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Procesando…</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#334">
<p>Verificando con tu banco…</p>
<script>
(function(){
  var msg = { tipo: 'cardnet-reto-listo', rd: ${JSON.stringify(rd)}, threeDSServerTransID: ${JSON.stringify(threeDS)} };
  var destino = ${JSON.stringify(base || '*')};
  try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, destino); } catch (e) {}
  // Si por alguna razón esto NO está en un iframe (el cliente abrió el reto en
  // una pestaña), lo mandamos a su historial de pagos, que refleja el estado.
  setTimeout(function(){ if (window.top === window.self) { window.location.href = '/cliente/pagos'; } }, 800);
})();
</script>
</body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

const RD = ['rd', 'RD']
const TDS = ['threeDSServerTransID', 'threeDsServerTransId', 'transId', 'TransID']

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  return paginaPuente(leer(p, RD), leer(p, TDS))
}

export async function POST(req: NextRequest) {
  try {
    const tipo = req.headers.get('content-type') ?? ''
    if (tipo.includes('application/json')) {
      const cuerpo = (await req.json()) as Record<string, unknown>
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(cuerpo)) p.set(k, String(v))
      return paginaPuente(leer(p, RD), leer(p, TDS))
    }
    const form = await req.formData()
    return paginaPuente(leer(form, RD), leer(form, TDS))
  } catch (e) {
    logErrorBd('pagos:cardnet:retorno:cuerpo', e)
    // Aun sin poder leer el cuerpo, la ventana padre tiene sus propios handles;
    // se le avisa igual para que intente completar.
    return paginaPuente('', '')
  }
}
