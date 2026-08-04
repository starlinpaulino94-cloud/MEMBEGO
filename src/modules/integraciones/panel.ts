import 'server-only'
import { prisma } from '@/lib/prisma'
import { firmarHmac } from '@/modules/integraciones/nucleo'
import {
  diagnosticarSonda,
  type Diagnostico,
  type RespuestaSonda,
} from '@/modules/integraciones/diagnostico'

/**
 * Integraciones · PANEL DEL SUPERADMIN.
 *
 * Por qué existe: el dueño de MembeGo no tiene terminal. Cuando un satélite
 * deja de recibir eventos, la única salida era pedirle que pegara SQL en
 * Supabase y que otra persona corriera `curl` — y aun así el outbox solo
 * guardaba `HTTP 404`, que no dice de quién es el problema.
 *
 * Aquí el servidor hace de terminal: toca la URL del webhook desde donde SÍ
 * hay salida a internet, enseña el código y el cuerpo crudos, y traduce el
 * resultado a una frase accionable. Sin esto, cada diagnóstico costaba un día
 * de ida y vuelta por WhatsApp.
 */

const TIMEOUT_SONDA_MS = 10_000
/** Recorte del cuerpo: lo justo para reconocer una página de error. */
const MAX_CUERPO = 300

export interface ResumenSistema {
  id: string
  slug: string
  nombre: string
  categoria: string
  urlBase: string
  urlWebhook: string | null
  activo: boolean
  /** Huella del secreto: permite comparar con el satélite SIN exponerlo. */
  secretoLargo: number
  pendientes: number
  enviados: number
  fallidos: number
  ultimoError: string | null
  /** Cuántos intentos lleva el evento pendiente más castigado (tope: 8). */
  maxIntentos: number
  esperandoDesde: Date | null
}

/** Estado de cada sistema conectado y de su cola de eventos. */
export async function getPanelIntegraciones(): Promise<ResumenSistema[]> {
  const sistemas = await prisma.sistemaConectado
    .findMany({ orderBy: { slug: 'asc' } })
    .catch(() => [])

  const resumenes: ResumenSistema[] = []
  for (const s of sistemas) {
    // Un groupBy por estado y una lectura del pendiente más viejo: el detalle
    // fila por fila no aporta nada cuando hay decenas de eventos iguales.
    const porEstado = await prisma.eventoSaliente
      .groupBy({
        by: ['estado'],
        where: { sistemaId: s.id },
        _count: { _all: true },
        _max: { intentos: true },
      })
      .catch(() => [])

    const cuenta = (estado: string) =>
      porEstado.find((g) => g.estado === estado)?._count._all ?? 0

    const masViejo = await prisma.eventoSaliente
      .findFirst({
        where: { sistemaId: s.id, estado: 'PENDIENTE' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, ultimoError: true, intentos: true },
      })
      .catch(() => null)

    resumenes.push({
      id: s.id,
      slug: s.slug,
      nombre: s.nombre,
      categoria: s.categoria,
      urlBase: s.urlBase,
      urlWebhook: s.urlWebhook,
      activo: s.activo,
      secretoLargo: s.secreto.length,
      pendientes: cuenta('PENDIENTE'),
      enviados: cuenta('ENVIADO'),
      fallidos: cuenta('FALLIDO'),
      ultimoError: masViejo?.ultimoError ?? null,
      maxIntentos: Math.max(
        0,
        ...porEstado.map((g) => (g.estado === 'PENDIENTE' ? (g._max.intentos ?? 0) : 0))
      ),
      esperandoDesde: masViejo?.createdAt ?? null,
    })
  }
  return resumenes
}

/** Un toque a la URL, sin lanzar nunca: los fallos de red son un resultado. */
async function tocar(url: string, init: RequestInit): Promise<RespuestaSonda> {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_SONDA_MS) })
    const cuerpo = await resp.text().catch(() => '')
    return { status: resp.status, cuerpo: cuerpo.slice(0, MAX_CUERPO) }
  } catch (e) {
    return {
      status: 0,
      cuerpo: '',
      error: e instanceof Error ? e.message : 'no se pudo conectar',
    }
  }
}

export interface ResultadoSonda {
  url: string
  get: RespuestaSonda
  post: RespuestaSonda
  diagnostico: Diagnostico
}

/**
 * Sonda el webhook: un GET (¿existe la ruta?) y un POST firmado (¿funciona?).
 *
 * El POST lleva `tipo: 'membego.ping'`, que NO está en `EVENTOS_REENVIADOS`:
 * un satélite bien hecho lo ignora y responde 200. Así la prueba nunca crea
 * datos falsos en el satélite ni se confunde con un evento real. El `id`
 * también es distinguible a simple vista en sus logs.
 */
export async function sondearWebhook(sistemaId: string): Promise<ResultadoSonda | { error: string }> {
  const sistema = await prisma.sistemaConectado
    .findUnique({ where: { id: sistemaId }, select: { urlWebhook: true, secreto: true } })
    .catch(() => null)
  if (!sistema) return { error: 'Sistema no encontrado.' }
  if (!sistema.urlWebhook) return { error: 'Este sistema no tiene URL de webhook registrada.' }

  const cuerpo = JSON.stringify({
    id: `ping-${Date.now()}`,
    tipo: 'membego.ping',
    companyId: 'ping',
    payload: { prueba: true },
    emitidoEn: new Date().toISOString(),
  })

  // En serie y no en paralelo: si el satélite tiene límite de peticiones, dos
  // a la vez desde la misma IP pueden dar un 429 que confundiría el resultado.
  const get = await tocar(sistema.urlWebhook, { method: 'GET' })
  const post = await tocar(sistema.urlWebhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Membego-Firma': firmarHmac(sistema.secreto, cuerpo),
    },
    body: cuerpo,
  })

  return {
    url: sistema.urlWebhook,
    get,
    post,
    diagnostico: diagnosticarSonda(get, post),
  }
}

/**
 * Devuelve los FALLIDO a la cola. Se usa cuando la causa del fallo era externa
 * (el satélite estaba caído) y ya se corrigió: los eventos siguen siendo
 * válidos y el satélite los descarta por id si ya los tenía.
 */
export async function revivirFallidos(sistemaId: string): Promise<number> {
  const r = await prisma.eventoSaliente
    .updateMany({
      where: { sistemaId, estado: 'FALLIDO' },
      data: { estado: 'PENDIENTE', intentos: 0, ultimoError: null },
    })
    .catch(() => ({ count: 0 }))
  return r.count
}
