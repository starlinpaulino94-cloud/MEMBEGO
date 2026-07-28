import { NextResponse, type NextRequest } from 'next/server'
import { verificarFirma } from '@/lib/jobs/qstash'
import { ejecutarTrabajo } from '@/modules/jobs/ejecutor'
import type { CargaTrabajo } from '@/modules/jobs/tipos'

export const dynamic = 'force-dynamic'
// 300 s: los trabajos son lotes acotados, pero un lote de 1.000 filas sobre una
// base fría puede tardar. Requiere plan Pro de Vercel; en Hobby se recorta a 60
// y el lote sigue cabiendo — solo se encadena antes.
export const maxDuration = 300

/**
 * EJECUTOR DE TRABAJOS EN SEGUNDO PLANO (auditoría · C-06 y C-07).
 *
 * Este endpoint es PÚBLICO por necesidad —QStash lo llama desde fuera— y hace
 * escrituras masivas. Por eso lo primero que ocurre aquí es verificar la firma:
 *
 *  · La firma es un JWT que QStash calcula sobre el CUERPO del mensaje. No basta
 *    con tener el secreto: hay que tener el mensaje exacto. Cambiar el
 *    `companyId` de la petición invalida la firma.
 *  · Se lee el cuerpo como TEXTO CRUDO y se verifica antes de parsearlo. Si se
 *    parseara primero y se re-serializara para comprobar el hash, cualquier
 *    diferencia de formato (espacios, orden de claves) rompería la
 *    verificación de mensajes legítimos.
 *
 * Sin `QSTASH_CURRENT_SIGNING_KEY` configurada el endpoint responde 503 y no
 * ejecuta nada: prefiero que la cola no funcione a que funcione sin firmar.
 */
export async function POST(request: NextRequest) {
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY) {
    return NextResponse.json(
      { error: 'Cola no configurada en este entorno.' },
      { status: 503 }
    )
  }

  const cuerpoCrudo = await request.text()
  const firma = request.headers.get('upstash-signature')
  if (!verificarFirma(firma, cuerpoCrudo)) {
    return NextResponse.json({ error: 'Firma no válida.' }, { status: 401 })
  }

  let carga: CargaTrabajo
  try {
    carga = JSON.parse(cuerpoCrudo) as CargaTrabajo
  } catch {
    // 400 y no 500: un cuerpo ilegible no mejora con reintentos, y QStash solo
    // reintenta ante 5xx. Devolver 500 aquí sería reintentar basura cuatro
    // veces.
    return NextResponse.json({ error: 'Cuerpo no válido.' }, { status: 400 })
  }

  if (carga?.tipo !== 'notificar' && carga?.tipo !== 'automatizaciones') {
    return NextResponse.json({ error: 'Tipo de trabajo desconocido.' }, { status: 400 })
  }

  try {
    const resultado = await ejecutarTrabajo(carga)
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    console.error('[jobs] fallo ejecutando', carga.tipo, e)
    // 500 a propósito: QStash reintentará. Los trabajos son idempotentes, así
    // que repetir es seguro y perder el trabajo no lo es.
    return NextResponse.json({ error: 'Fallo al ejecutar el trabajo.' }, { status: 500 })
  }
}
