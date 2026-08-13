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
import { ultimasSondas, type SondaGuardada } from '@/modules/integraciones/auditoria'

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

/**
 * Un evento concreto que no está saliendo.
 *
 * El panel solo daba números: «37 pendientes». Con eso no se puede decidir
 * nada, porque las dos situaciones que llevan a ese 37 piden respuestas
 * opuestas: si son 37 eventos de un tipo que el satélite todavía no implementa,
 * lo que toca es hablar con su equipo; si son de todos los tipos y de varias
 * empresas, el webhook está caído y hay que arreglarlo ya. Ver tres filas
 * distingue las dos en un vistazo.
 */
export interface EventoAtascado {
  id: string
  /** Nombre interno del evento (`cliente.visita`). */
  tipo: string
  /** Nombre de la empresa, o su id si ya no existe. */
  empresa: string
  intentos: number
  ultimoError: string | null
  createdAt: Date
}

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
  /** Muestra de la cola: los más castigados, los que están a punto de agotarse. */
  atascados: EventoAtascado[]
  /** Última vez que se probó el webhook, según la bitácora. */
  ultimaSonda: SondaGuardada | null
}

/** Cuántos eventos atascados se enseñan por sistema. */
export const MUESTRA_ATASCADOS = 5

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

/**
 * Estado de cada sistema conectado y de su cola de eventos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA CONSULTA CUANDO NO HAY NADA ATASCADO
 *
 * Antes esto era un bucle: por cada sistema, un `groupBy` de su cola y un
 * `findFirst` del pendiente más viejo. Veintiuna consultas con diez sistemas,
 * y las hacía SIEMPRE, aunque estuviera todo verde. Es el mismo N+1 que el
 * panel de Operaciones documenta haber evitado.
 *
 * Ahora un solo `groupBy` por `[sistemaId, estado]` resuelve los tres conteos,
 * el máximo de intentos y desde cuándo espera el más viejo, para TODOS los
 * sistemas y sin traer una sola fila. Lo demás solo se pide para los sistemas
 * que de verdad tienen cola —normalmente ninguno o uno— y con tope: leer los
 * pendientes enteros haría que esta pantalla se volviera lenta justo cuando un
 * satélite lleva una semana caído, que es exactamente cuando se abre.
 */
export async function getPanelIntegraciones(): Promise<ResumenSistema[]> {
  return sinEmpresa('panel del superadmin: estado de las integraciones y colas de todas las empresas', async (tx) => {
    const sistemas = await leerCatalogo(tx)
    if (sistemas.length === 0) return []
    const ids = sistemas.map((s) => s.id)

    const porEstado = await tx.eventoSaliente
      .groupBy({
        by: ['sistemaId', 'estado'],
        where: { sistemaId: { in: ids } },
        _count: { _all: true },
        // El más castigado y el más viejo de la cola, agregados por la base:
        // salían de traerse las filas y recorrerlas.
        _max: { intentos: true },
        _min: { createdAt: true },
      })
      .catch(() => [])

    const pendientesDe = (id: string) => porEstado.find((g) => g.sistemaId === id && g.estado === 'PENDIENTE')

    /**
     * LA MUESTRA DE LO QUE ESTÁ ATASCADO, Y EL ÚLTIMO ERROR DE VERDAD.
     *
     * El error salía del MISMO evento que la espera: el pendiente más viejo. Y
     * eso rompe justo después de pulsar «reencolar», que es cuando más se mira
     * esta pantalla: revivir pone `ultimoError: null` e `intentos: 0`, y los
     * revividos son por definición los más antiguos de la cola. Resultado: el
     * panel decía «sin error, 0 intentos» mientras el resto seguía rebotando
     * con un 401. Enseñaba el hueco que acababa de abrir el propio botón.
     *
     * Se pide por `intentos` descendente, así que la primera fila es la más
     * castigada: la que más pasadas del cron ha recibido y, por tanto, la que
     * tiene el error más reciente. `EventoSaliente` no guarda CUÁNDO fue el
     * último intento, solo cuántos van, pero sirve igual porque el cron drena
     * siempre de más viejo a más nuevo (`orderBy: createdAt asc` en
     * `reintentarPendientes`). Un `updatedAt` daría la fecha exacta a cambio de
     * una columna NOT NULL nueva de la que dependería esta consulta — y entre
     * el despliegue del código y el de la migración la pantalla se quedaría en
     * blanco, que es el fallo que `leerCatalogo` ya tiene que sortear.
     */
    const muestra = new Map<string, EventoAtascado[]>()
    const errorReciente = new Map<string, string>()
    const crudo = new Map<string, { companyId: string; id: string; tipo: string; intentos: number; ultimoError: string | null; createdAt: Date }[]>()
    for (const s of sistemas) {
      if ((pendientesDe(s.id)?._count._all ?? 0) === 0) continue
      const filas = await tx.eventoSaliente
        .findMany({
          where: { sistemaId: s.id, estado: 'PENDIENTE' },
          orderBy: [{ intentos: 'desc' }, { createdAt: 'asc' }],
          take: MUESTRA_ATASCADOS,
          select: {
            id: true,
            companyId: true,
            tipo: true,
            createdAt: true,
            ultimoError: true,
            intentos: true,
          },
        })
        .catch(() => [])
      crudo.set(s.id, filas)
      const conError = filas.find((f) => f.ultimoError)
      if (conError?.ultimoError) errorReciente.set(s.id, conError.ultimoError)
    }

    /**
     * El nombre de la empresa, no su cuid.
     *
     * Un `cmp3k9...` en pantalla obliga a ir a buscarlo a otra tabla para
     * responder a la única pregunta que importa aquí: «¿esto le está pasando a
     * un cliente o a la empresa de pruebas?». Se resuelven solo las que
     * aparecen en la muestra, que son pocas.
     */
    const empresaIds = [...new Set([...crudo.values()].flat().map((p) => p.companyId))]
    const nombres = new Map(
      (empresaIds.length > 0
        ? await tx.company
            .findMany({ where: { id: { in: empresaIds } }, select: { id: true, name: true } })
            .catch(() => [])
        : []
      ).map((c) => [c.id, c.name])
    )
    for (const [sistemaId, filas] of crudo) {
      muestra.set(
        sistemaId,
        filas.map((p) => ({
          id: p.id,
          tipo: p.tipo,
          empresa: nombres.get(p.companyId) ?? p.companyId,
          intentos: p.intentos,
          ultimoError: p.ultimoError,
          createdAt: p.createdAt,
        }))
      )
    }

    const sondas = await ultimasSondas(tx, ids)

    return sistemas.map((s) => {
      const suyos = porEstado.filter((g) => g.sistemaId === s.id)
      const cuenta = (estado: string) =>
        suyos.find((g) => g.estado === estado)?._count._all ?? 0
      return {
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
        ultimoError: errorReciente.get(s.id) ?? null,
        maxIntentos: pendientesDe(s.id)?._max.intentos ?? 0,
        esperandoDesde: pendientesDe(s.id)?._min.createdAt ?? null,
        atascados: muestra.get(s.id) ?? [],
        ultimaSonda: sondas.get(s.id) ?? null,
      }
    })
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
