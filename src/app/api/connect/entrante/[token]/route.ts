import { NextResponse, type NextRequest } from 'next/server'
import { createRateLimiter } from '@/lib/rate-limit'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import {
  anotarRecepcion,
  resolverEntrante,
} from '@/modules/connect/entrantes'
import {
  MAX_CUERPO_BYTES,
  MENSAJE_RECHAZO,
  aceptarCuerpo,
  nombreDeEvento,
  partirToken,
} from '@/modules/connect/entrantesNucleo'

export const dynamic = 'force-dynamic'

/**
 * WEBHOOK ENTRANTE (hallazgo B-1): que algo de fuera avise hacia dentro.
 *
 * Es la ruta MÁS EXPUESTA de todo el módulo: pública por necesidad —la llama la
 * herramienta de un tercero—, sin sesión, y escribe en la base. Lo que la hace
 * segura son cuatro cosas, y ninguna sobra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1 · EL TOKEN NO ELIGE LA EMPRESA, LA DESCUBRE
 *
 * No hay ningún `companyId` en la petición. La empresa sale de resolver el
 * token, así que no existe un parámetro que manipular: es la misma propiedad
 * que hace seguras las claves de API de empresa.
 *
 * 2 · LO QUE ENTRA VA MARCADO COMO ENTRANTE
 *
 * El evento es SIEMPRE `entrante.<slug>`. Quien tenga la URL no puede inventar
 * una visita ni una compra, así que una URL filtrada en la configuración de una
 * herramienta ajena no otorga beneficios ni ensucia los satélites de nadie.
 *
 * 3 · EL LÍMITE SE CUENTA ANTES DE COMPROBAR EL SECRETO
 *
 * Verificar el hash cuesta (scrypt, a propósito). Si el freno fuera después,
 * probar tokens al azar saldría gratis y además nos costaría CPU a nosotros.
 * Es el mismo orden que la guardia de la API v1.
 *
 * 4 · EL CUERPO SE LEE CON TOPE
 *
 * 64 KB. Sin tope, un solo POST de cincuenta megas se guarda entero en el
 * payload del evento y viaja después por todo el bus.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN PAUSADO RESPONDE 200
 *
 * Una herramienta que recibe un error se pone a reintentar y a llenar de
 * avisos de fallo el panel de su dueño — por algo que la empresa apagó a
 * propósito. Se acepta, no se emite, y se dice en el cuerpo de la respuesta.
 * Un token que NO existe sí es un 404: ahí no hay nada que respetar.
 */

/**
 * Por token, no por IP: la herramienta que llama suele vivir en una plataforma
 * serverless cuya IP cambia en cada invocación, así que limitar por IP no
 * limitaría nada. Generoso —un tope de caudal, no de uso normal— y suficiente
 * para que un bucle roto del otro lado no nos llene la tabla de eventos.
 */
const limite = createRateLimiter({
  interval: 60_000,
  maxRequests: 120,
  name: 'connect-entrante',
})

/** Sobre quién se aplica el freno cuando el token ni siquiera tiene forma. */
const limitePorIp = createRateLimiter({
  interval: 60_000,
  maxRequests: 60,
  name: 'connect-entrante-anon',
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  // El freno va ANTES de tocar la base y antes de verificar nada: ver (3).
  // Se frena por el PREFIJO PÚBLICO del token, aunque todavía no sepamos si vale
  // —es justo el caso que hay que frenar, alguien probando—. Se usa el prefijo y
  // no `slice(0,20)`: aquél metía 3 caracteres del SECRETO en la clave del
  // limitador, así que dos intentos contra el mismo endpoint con secretos
  // distintos caían en cubos distintos y el freno por token no los agregaba. El
  // prefijo es la parte pública; un token malformado cae a un cubo acotado.
  const clave = partirToken(token)?.prefijo ?? token.slice(0, 16)
  if (!(await limite(`entrante:${clave}`))) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (ip && !(await limitePorIp(`entrante-ip:${ip}`))) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  // El tope ANTES de leer: `Content-Length` lo manda quien llama y puede
  // mentir, pero si dice la verdad ahorra descargar cincuenta megas para
  // tirarlos. Quien mienta se topa con el tope real al medir el cuerpo.
  const declarado = Number(req.headers.get('content-length') ?? 0)
  if (declarado > MAX_CUERPO_BYTES) {
    return NextResponse.json({ error: MENSAJE_RECHAZO.demasiado_grande }, { status: 413 })
  }

  const entrante = await resolverEntrante(token)
  // El mismo 404 para «no existe» y «el secreto no cuadra»: distinguirlos le
  // confirmaría a quien prueba que ese prefijo existe.
  if (!entrante) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const crudo = await req.text().catch(() => '')
  const cuerpo = aceptarCuerpo(crudo)
  if (!cuerpo.ok) {
    const status = cuerpo.motivo === 'demasiado_grande' ? 413 : 400
    return NextResponse.json({ error: MENSAJE_RECHAZO[cuerpo.motivo] }, { status })
  }

  if (entrante.estado !== 'ACTIVE') {
    return NextResponse.json({ accepted: false, reason: 'paused' })
  }

  const evento = nombreDeEvento(entrante.slug)
  // `emitirEventoEstrategia` nunca lanza: persiste el evento y encola su
  // despacho. Que la automatización de destino falle no puede convertirse en un
  // error para quien nos avisó — él ya hizo su parte.
  await emitirEventoEstrategia({
    companyId: entrante.companyId,
    type: evento,
    payload: cuerpo.datos,
  })
  anotarRecepcion(entrante.id, entrante.companyId)

  // Se devuelve el nombre del evento a propósito: es lo que hay que poner en la
  // automatización que lo escuche, y tenerlo en la respuesta ahorra volver al
  // panel a buscarlo.
  return NextResponse.json({ accepted: true, event: evento })
}

/**
 * Un GET a la URL contesta qué es esto, sin decir de quién.
 *
 * Existe porque es lo primero que hace cualquiera al pegar una URL: abrirla en
 * el navegador. Un 404 seco ahí manda a soporte a alguien que lo estaba
 * haciendo bien. No se resuelve el token ni se toca la base: es una frase fija.
 */
export function GET() {
  return NextResponse.json(
    {
      error: 'Use POST with a JSON object body.',
      docs: '/admin/integraciones/desarrolladores',
    },
    { status: 405 }
  )
}
