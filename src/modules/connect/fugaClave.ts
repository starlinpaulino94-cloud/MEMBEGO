import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { secretoValido } from '@/modules/plataforma/credenciales'
import { partirClave } from '@/modules/connect/clavesApiNucleo'
import { anotarConector } from '@/modules/connect/bitacora'
import { decidirFuga, type EtiquetaFuga } from '@/modules/connect/fugaClaveNucleo'

/**
 * GLUE de la alerta de fuga de claves (lo que toca base y red).
 *
 * La lógica pura —parsear, verificar la firma, decidir— está en
 * `fugaClaveNucleo.ts`. Aquí van las dos cosas con efectos: traer la clave
 * pública de GitHub para verificar la firma, y procesar un token filtrado
 * (buscarlo, y si es nuestro y está vivo, REVOCARLO).
 */

/** Dónde publica GitHub las claves con las que firma las alertas. */
const URL_CLAVES_GITHUB = 'https://api.github.com/meta/public_keys/secret_scanning'

interface ClaveGithub {
  key_identifier: string
  key: string
  is_current: boolean
}

/**
 * Las claves se cachean en proceso: rotan rara vez y verificar cada alerta con
 * una llamada a GitHub sería frágil y lento. Ante un identificador desconocido
 * se refresca una vez, por si acaba de rotar.
 */
let cache: { claves: ClaveGithub[]; hasta: number } | null = null
const TTL_MS = 60 * 60 * 1000

async function traerClavesGithub(): Promise<ClaveGithub[]> {
  const res = await fetch(URL_CLAVES_GITHUB, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MembeGo-SecretScanning' },
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new Error(`github meta ${res.status}`)
  const data = (await res.json()) as { public_keys?: ClaveGithub[] }
  if (!Array.isArray(data.public_keys)) throw new Error('respuesta inesperada de github meta')
  return data.public_keys
}

/** La PEM con la que GitHub firmó, por su identificador. `null` si no la hay. */
export async function clavePublicaGithub(identificador: string): Promise<string | null> {
  const ahora = Date.now()
  if (!cache || cache.hasta < ahora) {
    cache = { claves: await traerClavesGithub(), hasta: ahora + TTL_MS }
  }
  let clave = cache.claves.find((k) => k.key_identifier === identificador)
  if (!clave) {
    // Puede haber rotado justo ahora: refresca una vez antes de rendirse.
    cache = { claves: await traerClavesGithub(), hasta: ahora + TTL_MS }
    clave = cache.claves.find((k) => k.key_identifier === identificador)
  }
  return clave?.key ?? null
}

/**
 * Procesa UN token que GitHub reporta como filtrado y devuelve su etiqueta.
 *
 * `sinEmpresa` en las dos escrituras porque esto es una acción de sistema
 * disparada por GitHub, no por una empresa: la empresa se DESCUBRE al resolver
 * el prefijo, igual que al autenticar. Solo se revoca con el secreto completo
 * correcto (ver `decidirFuga`): el prefijo es público y no basta para actuar.
 */
export async function procesarTokenFiltrado(token: string): Promise<EtiquetaFuga> {
  const partida = partirClave(token)

  const fila = partida
    ? await sinEmpresa('connect: clave de API por prefijo (alerta de fuga de GitHub)', (tx) =>
        tx.claveApiEmpresa.findUnique({
          where: { prefijo: partida.prefijo },
          select: { id: true, companyId: true, secretoHash: true, estado: true },
        })
      ).catch(() => null)
    : null

  const secretoCoincide = !!(partida && fila && secretoValido(partida.secreto, fila.secretoHash))
  const decision = decidirFuga({
    formatoValido: !!partida,
    filaExiste: !!fila,
    secretoCoincide,
    estaActiva: fila?.estado === 'ACTIVE',
  })

  if (decision.revocar && fila) {
    // El `estado: 'ACTIVE'` en el where hace la revocación idempotente: si dos
    // alertas del mismo token llegan a la vez, solo la primera cuenta y anota.
    const r = await sinEmpresa(
      'connect: revocar clave filtrada (alerta de fuga de GitHub, cross-tenant)',
      (tx) =>
        tx.claveApiEmpresa.updateMany({
          where: { id: fila.id, estado: 'ACTIVE' },
          data: { estado: 'REVOKED' },
        })
    ).catch(() => ({ count: 0 }))

    if (r.count > 0) {
      // Evento PROPIO —no el `clave_api.revocada` de una revocación manual—: la
      // empresa tiene que ver en su bitácora que su clave se cerró por una FUGA,
      // no porque alguien pulsara un botón. Nunca el secreto; sí el prefijo.
      await anotarConector({
        companyId: fila.companyId,
        origen: 'CLAVE_API',
        origenId: fila.id,
        nivel: 'WARN',
        evento: 'clave_api.revocada_por_fuga',
        detalle: { prefijo: partida!.prefijo },
      }).catch(anotarFallo('connect:fuga:bitacora', { id: fila.id }))
    }
  }

  return decision.etiqueta
}
