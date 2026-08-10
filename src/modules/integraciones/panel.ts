import 'server-only'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { getPlatformEventPrivateKey } from '@/lib/env'
import { firmarHmac } from '@/modules/integraciones/nucleo'
import { esEstadoSistema, type EstadoSistema } from '@/modules/plataforma/acceso'
import { construirSobre, cuerpoDelSobre } from '@/modules/plataforma/eventos'
import {
  CABECERA_EVENTO,
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
  clavePrivadaDesde,
  firmarEd25519,
} from '@/modules/plataforma/firma'
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
 *
 * Es del superadmin y cruza inquilinos por diseño (ve los sistemas y colas de
 * TODAS las empresas), así que sus consultas van con `sinEmpresa` — el caso que
 * `src/lib/tenant.ts` nombra explícitamente para el panel del superadmin.
 */

const TIMEOUT_SONDA_MS = 10_000
/** Recorte del cuerpo: lo justo para reconocer una página de error. */
const MAX_CUERPO = 300

export interface ResumenSistema {
  id: string
  slug: string
  nombre: string
  /** DRAFT | ACTIVE | SUSPENDED | RETIRED. */
  estado: EstadoSistema
  /** Verticales que atiende (N:M). Vacío = nadie puede entrar. */
  tiposNegocio: string[]
  /** ¿Toda empresa compatible entra sin habilitación explícita? */
  autoHabilitar: boolean
  /** Empresas con habilitación ENABLED. */
  habilitadas: number
  urlBase: string
  urlWebhook: string | null
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

interface FilaSistema {
  id: string
  slug: string
  nombre: string
  urlBase: string
  urlWebhook: string | null
  secreto: string
  estado: EstadoSistema
  tiposNegocio: string[]
  autoHabilitar: boolean
  habilitadas: number
}

/**
 * Sistemas del catálogo con su ciclo de vida y sus verticales.
 *
 * Doble forma por el mismo motivo que en `modules/plataforma/registro`: entre
 * el despliegue del código y el de la migración, las columnas nuevas no
 * existen. Ahí el panel enseña lo que hay y lo etiqueta con el estado
 * equivalente, en vez de quedarse en blanco justo cuando alguien está mirando
 * por qué no salen los eventos.
 */
async function leerCatalogo(tx: Tx): Promise<FilaSistema[]> {
  try {
    const filas = await tx.sistemaConectado.findMany({
      orderBy: { slug: 'asc' },
      select: {
        id: true,
        slug: true,
        nombre: true,
        urlBase: true,
        urlWebhook: true,
        secreto: true,
        estado: true,
        autoHabilitar: true,
        tiposNegocio: { select: { tipo: { select: { codigo: true } } } },
        _count: { select: { habilitaciones: { where: { estado: 'ENABLED' } } } },
      },
    })
    return filas.map((f) => ({
      ...f,
      estado: esEstadoSistema(f.estado) ? f.estado : 'SUSPENDED',
      tiposNegocio: f.tiposNegocio.map((t) => t.tipo.codigo),
      habilitadas: f._count.habilitaciones,
    }))
  } catch {
    const filas = await tx.sistemaConectado
      .findMany({
        orderBy: { slug: 'asc' },
        select: {
          id: true,
          slug: true,
          nombre: true,
          urlBase: true,
          urlWebhook: true,
          secreto: true,
          activo: true,
          categoria: true,
        },
      })
      .catch(() => [])
    return filas.map((f) => ({
      id: f.id,
      slug: f.slug,
      nombre: f.nombre,
      urlBase: f.urlBase,
      urlWebhook: f.urlWebhook,
      secreto: f.secreto,
      estado: (f.activo ? 'ACTIVE' : 'SUSPENDED') as EstadoSistema,
      tiposNegocio: [f.categoria],
      autoHabilitar: true,
      habilitadas: 0,
    }))
  }
}

/** Estado de cada sistema conectado y de su cola de eventos. */
export async function getPanelIntegraciones(): Promise<ResumenSistema[]> {
  return sinEmpresa('panel del superadmin: estado de las integraciones y colas de todas las empresas', async (tx) => {
    const sistemas = await leerCatalogo(tx)

    const resumenes: ResumenSistema[] = []
    for (const s of sistemas) {
      // Un groupBy por estado y una lectura del pendiente más viejo: el detalle
      // fila por fila no aporta nada cuando hay decenas de eventos iguales.
      const porEstado = await tx.eventoSaliente
        .groupBy({
          by: ['estado'],
          where: { sistemaId: s.id },
          _count: { _all: true },
          _max: { intentos: true },
        })
        .catch(() => [])

      const cuenta = (estado: string) =>
        porEstado.find((g) => g.estado === estado)?._count._all ?? 0

      const masViejo = await tx.eventoSaliente
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
        estado: s.estado,
        tiposNegocio: s.tiposNegocio,
        autoHabilitar: s.autoHabilitar,
        habilitadas: s.habilitadas,
        urlBase: s.urlBase,
        urlWebhook: s.urlWebhook,
        secretoLargo: s.secreto.length,
        pendientes: cuenta('PENDIENTE'),
        enviados: cuenta('ENVIADO'),
        // Los dos nombres del mismo estado terminal: `FALLIDO` es como se
        // llamaba antes de la Fase 3, y sigue en las filas anteriores a la
        // migración. Contar solo uno haría desaparecer del panel media cola.
        fallidos: cuenta('DEAD_LETTER') + cuenta('FALLIDO'),
        ultimoError: masViejo?.ultimoError ?? null,
        maxIntentos: Math.max(
          0,
          ...porEstado.map((g) => (g.estado === 'PENDIENTE' ? (g._max.intentos ?? 0) : 0))
        ),
        esperandoDesde: masViejo?.createdAt ?? null,
      })
    }
    return resumenes
  })
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
 *
 * EL `companyId` ES REAL, y eso importa: la primera versión mandaba la cadena
 * `'ping'`, y un satélite que resuelve la empresa antes de mirar el tipo
 * reventaba con 500 por una empresa inexistente. Ese 500 no decía nada del
 * satélite — lo causaba la sonda. Se reutiliza la empresa del último evento
 * encolado para ese sistema: es exactamente la que mandan los eventos reales.
 *
 * Las lecturas de BD (sistema + último evento) van en `sinEmpresa` y se cierran
 * ANTES de tocar la red: la sonda hace hasta dos fetches con 10 s de timeout
 * cada uno, y no hay razón para sostener una transacción abierta durante eso.
 */
export async function sondearWebhook(sistemaId: string): Promise<ResultadoSonda | { error: string }> {
  const { sistema, ultimo } = await sinEmpresa(
    'panel del superadmin: sonda del webhook de un sistema conectado',
    async (tx) => {
      const sistema = await tx.sistemaConectado
        .findUnique({ where: { id: sistemaId }, select: { urlWebhook: true, secreto: true } })
        .catch(() => null)
      const ultimo = sistema
        ? await tx.eventoSaliente
            .findFirst({
              where: { sistemaId },
              orderBy: { createdAt: 'desc' },
              select: { companyId: true },
            })
            .catch(() => null)
        : null
      return { sistema, ultimo }
    }
  )

  if (!sistema) return { error: 'Sistema no encontrado.' }
  if (!sistema.urlWebhook) return { error: 'Este sistema no tiene URL de webhook registrada.' }

  // La sonda manda EXACTAMENTE la forma de un evento real —sobre v2, claves de
  // legado y las dos firmas—. Si mandara otra cosa, un satélite podría pasar la
  // prueba y rechazar los eventos de verdad, que es la peor respuesta posible:
  // «funciona» cuando no funciona.
  const eventId = `ping-${Date.now()}`
  const sobre = construirSobre({
    id: eventId,
    tipo: 'membego.ping',
    companyId: ultimo?.companyId ?? 'ping',
    payload: { prueba: true },
    createdAt: new Date(),
  })
  const cuerpo = cuerpoDelSobre(sobre)
  const timestamp = Math.floor(Date.now() / 1000)
  const ed25519 = firmarEd25519(clavePrivadaDesde(getPlatformEventPrivateKey()), timestamp, eventId, cuerpo)

  // En serie y no en paralelo: si el satélite tiene límite de peticiones, dos
  // a la vez desde la misma IP pueden dar un 429 que confundiría el resultado.
  const get = await tocar(sistema.urlWebhook, { method: 'GET' })
  const post = await tocar(sistema.urlWebhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Membego-Firma': firmarHmac(sistema.secreto, cuerpo),
      [CABECERA_TIMESTAMP]: String(timestamp),
      [CABECERA_EVENTO]: eventId,
      ...(ed25519 ? { [CABECERA_FIRMA]: ed25519 } : {}),
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
 * REPLAY: devuelve la cola de descarte a PENDIENTE.
 *
 * Se usa cuando la causa era externa —el satélite estaba caído— y ya se
 * corrigió. Los eventos siguen siendo válidos: conservan su `eventId`, así que
 * un satélite que ya hubiera procesado alguno lo descarta por su inbox en vez
 * de duplicarlo. Reencolar de más es seguro; perder un evento no lo es.
 *
 * Acepta los dos nombres del estado terminal: las filas anteriores a la Fase 3
 * dicen `FALLIDO`, y dejarlas fuera haría que el botón no reviviera justo las
 * más viejas, que son las que más falta hacen.
 */
export async function revivirFallidos(sistemaId: string): Promise<number> {
  return sinEmpresa('panel del superadmin: reencolar la cola de descarte de un sistema', async (tx) => {
    const r = await tx.eventoSaliente
      .updateMany({
        where: { sistemaId, estado: { in: ['DEAD_LETTER', 'FALLIDO'] } },
        data: { estado: 'PENDIENTE', intentos: 0, ultimoError: null },
      })
      .catch(() => ({ count: 0 }))
    return r.count
  })
}
