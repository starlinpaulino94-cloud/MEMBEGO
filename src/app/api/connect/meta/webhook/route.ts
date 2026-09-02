import { NextResponse, type NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { anotarConector } from '@/modules/connect/bitacora'
import { firmaWebhookValida, respuestaDeVerificacion } from '@/modules/connect/metaNucleo'

export const dynamic = 'force-dynamic'

/**
 * WEBHOOK DE META (Connect · Fase 14).
 *
 * Meta lo exige para el Alta Incrustada: es por donde avisa de que una empresa
 * terminó el alta (`account_update`) y por donde llegarán después los estados
 * de entrega y las respuestas de sus clientes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PÚBLICA, Y POR ESO NO SE FÍA DE NADA
 *
 * Meta llama sin sesión, así que lo único que separa un aviso legítimo de uno
 * inventado es la FIRMA. Se comprueba antes de mirar el contenido y sobre el
 * cuerpo CRUDO: parsearlo y volver a serializarlo rompería la firma de un
 * aviso bueno por una coma de diferencia.
 *
 * Sin `META_APP_SECRET` la ruta responde 404 y no 500: si el alta incrustada
 * no está configurada aquí, este endpoint no existe para nadie.
 *
 * NO SE HA PROBADO CONTRA META. Escrito contra la documentación pública
 * vigente, sin app con la que ejecutarlo.
 */

/** El apretón de manos de alta de la URL. */
export async function GET(req: NextRequest) {
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN ?? ''
  const res = respuestaDeVerificacion(req.nextUrl.searchParams, esperado)
  if (!res.ok) return new NextResponse('Forbidden', { status: 403 })
  // Meta exige el challenge en crudo, no envuelto en JSON.
  return new NextResponse(res.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

interface CambioMeta {
  field?: string
  value?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const secreto = process.env.META_APP_SECRET
  if (!secreto) return new NextResponse('Not found', { status: 404 })

  // El cuerpo CRUDO, y una sola vez: `req.text()` no se puede repetir.
  const crudo = await req.text()

  if (!firmaWebhookValida(crudo, req.headers.get('x-hub-signature-256'), secreto)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  let cuerpo: { entry?: { id?: string; changes?: CambioMeta[] }[] }
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    // Firmado pero ilegible: se acepta para que Meta no reintente en bucle, y
    // se anota. Devolver error aquí solo produciría más entregas iguales.
    return NextResponse.json({ ok: true })
  }

  // El conector, una sola vez: la clave única es (conectorId, cuentaExterna).
  const conector = await sinEmpresa('connect: webhook de Meta — resolver el conector', (tx) =>
    tx.conector.findUnique({ where: { slug: 'whatsapp' }, select: { id: true } })
  ).catch(anotarFallo('connect:webhook-meta-conector'))
  if (!conector) return NextResponse.json({ ok: true })
  const conectorWhatsapp = conector.id

  for (const entrada of cuerpo.entry ?? []) {
    const wabaId = entrada.id
    if (!wabaId) continue

    // ────────────────────────────────────────────────────────────────────────
    // A QUÉ EMPRESA PERTENECE (F14.1 · el fallo de aislamiento que la
    // auditoría encontró).
    //
    // La Fase 14 buscaba con `findFirst` sobre los metadatos de las
    // credenciales. Dos problemas, y el segundo es grave:
    //
    //   · sin unicidad garantizada, dos filas con el mismo valor hacen que
    //     `findFirst` devuelva UNA CUALQUIERA — el aviso de una empresa
    //     acabaría atribuido a otra;
    //   · buscar por un campo de JSON sin índice ni restricción convierte una
    //     frontera entre inquilinos en una convención.
    //
    // Ahora la cuenta vive en una COLUMNA de la conexión con UNIQUE por
    // (conector, cuenta): `findUnique` no puede devolver la fila de otro,
    // porque la base impide que exista.
    //
    // Cruzar empresas para averiguarlo es legítimo —el aviso llega sin sesión—
    // y va declarado con su motivo.
    const conexion = await sinEmpresa(
      'connect: webhook de Meta — resolver la única conexión dueña de esta cuenta de WhatsApp',
      (tx) =>
        tx.conexionEmpresa.findUnique({
          where: {
            conectorId_cuentaExterna: { conectorId: conectorWhatsapp, cuentaExterna: wabaId },
          },
          select: { id: true, companyId: true },
        })
    ).catch(anotarFallo('connect:webhook-meta-resolver'))

    // Sin dueño conocido no se anota nada. Pasa de verdad y no es un error:
    // Meta puede avisar del alta ANTES de que el canje termine, y ese primer
    // aviso no tiene dueño todavía. El alta deja su propio apunte.
    if (!conexion) continue

    for (const cambio of entrada.changes ?? []) {
      await anotarConector({
        companyId: conexion.companyId,
        origen: 'CONEXION',
        origenId: conexion.id,
        evento: `meta.${cambio.field ?? 'desconocido'}`,
        // Del contenido NADA: en `value` viaja el número de teléfono de
        // clientes finales. Basta con saber que Meta avisó y de qué.
        detalle: { wabaId },
      })
    }
  }

  // Meta reintenta ante cualquier respuesta que no sea 2xx. Se confirma
  // siempre que la firma cuadre: lo que no sepamos procesar queda en la
  // bitácora, no en una cola de reintentos infinita.
  return NextResponse.json({ ok: true })
}
