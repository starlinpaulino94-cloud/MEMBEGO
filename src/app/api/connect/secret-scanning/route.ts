import { NextResponse, type NextRequest } from 'next/server'
import {
  parsearAlertaFuga,
  verificarFirmaSecretScanning,
  type RespuestaFuga,
} from '@/modules/connect/fugaClaveNucleo'
import { clavePublicaGithub, procesarTokenFiltrado } from '@/modules/connect/fugaClave'

export const dynamic = 'force-dynamic'

/**
 * ALERTA DE FUGA DE CLAVES · GitHub Secret Scanning (Membego Connect · seguridad).
 *
 * El otro extremo del prefijo `mbk_`, elegido scannable a propósito: cuando
 * GitHub detecta una clave nuestra en un repo, la manda aquí FIRMADA y nosotros
 * la revocamos sola antes de que quien la encontró la use. Sin este endpoint, el
 * prefijo reconocible solo le ahorraba trabajo al atacante.
 *
 * Registro (paso de operaciones, fuera del código): dar de alta el patrón `mbk_`
 * y esta URL en el programa de Secret Scanning de GitHub. El contrato completo
 * está en `fugaClaveNucleo.ts`.
 *
 * NO lleva rate-limit por IP ni auth de sesión: la autenticación ES la firma
 * ECDSA de GitHub. Una petición sin firma válida no pasa de los primeros ifs, y
 * eso es más fuerte que cualquier lista de IPs.
 */
export async function POST(req: NextRequest) {
  // El cuerpo CRUDO, y una sola vez: la firma se verifica sobre estos bytes
  // exactos, no sobre el JSON re-serializado.
  const crudo = await req.text()
  const identificador = req.headers.get('github-public-key-identifier')
  const firma = req.headers.get('github-public-key-signature')
  if (!identificador || !firma) {
    return new NextResponse('faltan las cabeceras de firma', { status: 401 })
  }

  let pem: string | null
  try {
    pem = await clavePublicaGithub(identificador)
  } catch (e) {
    // No pudimos traer las claves de GitHub para verificar: es un fallo NUESTRO
    // transitorio (503), no un rechazo — GitHub reintenta.
    console.error('[connect] no se pudieron traer las claves de GitHub:', e)
    return new NextResponse('no se pudo verificar la firma ahora', { status: 503 })
  }

  if (!pem || !verificarFirmaSecretScanning(crudo, firma, pem)) {
    return new NextResponse('firma inválida', { status: 401 })
  }

  const entradas = parsearAlertaFuga(crudo)
  if (!entradas) return new NextResponse('cuerpo inválido', { status: 400 })

  // En serie a propósito: una alerta trae uno o unos pocos tokens, no un lote.
  const respuesta: RespuestaFuga[] = []
  for (const entrada of entradas) {
    respuesta.push({
      token_raw: entrada.token,
      token_type: entrada.type,
      label: await procesarTokenFiltrado(entrada.token),
    })
  }

  return NextResponse.json(respuesta)
}
