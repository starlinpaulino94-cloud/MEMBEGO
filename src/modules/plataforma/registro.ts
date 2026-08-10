import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import {
  decidirAcceso,
  esEstadoHabilitacion,
  esEstadoSistema,
  type Decision,
  type EstadoHabilitacion,
  type EstadoSistema,
} from '@/modules/plataforma/acceso'

/**
 * PLATAFORMA · Fase 1b — REGISTRO DE SISTEMAS (lectura).
 *
 * La única puerta por la que el Core pregunta «¿qué sistemas puede usar esta
 * empresa?». Antes esa pregunta se resolvía con un `where: { activo: true,
 * categoria }` repetido en cuatro archivos; ahora se resuelve aquí y la regla
 * vive en `acceso.ts`, que es pura y se puede probar sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY UN CAMINO DE RESPALDO
 *
 * El código se despliega antes que la migración: es el orden normal en Vercel y
 * el único que permite volver atrás sin tocar la base. Entre un momento y otro,
 * `sistemas_conectados.estado` no existe todavía y la consulta nueva falla.
 *
 * `leerSistemas` lo detecta y repite la lectura con la forma antigua, mapeando
 * el resultado a la nueva: `activo → ACTIVE|SUSPENDED`, `categoria → [código]`,
 * `autoHabilitar → true`. Eso reproduce EXACTAMENTE la regla de hoy, ni más
 * permisiva ni menos: durante la ventana, quien entraba sigue entrando y quien
 * no, sigue sin entrar.
 *
 * No es un fail-open: el respaldo no concede nada que la versión anterior no
 * concediera. Desaparece con la columna `categoria`, en la fase de contracción.
 */

/** Fila normalizada: lo que la regla de acceso necesita saber de un sistema. */
export interface SistemaRegistrado {
  id: string
  slug: string
  nombre: string
  urlBase: string
  urlWebhook: string | null
  estado: EstadoSistema
  autoHabilitar: boolean
  tiposNegocio: string[]
  /** Habilitación de ESTA empresa. `null` = no hay fila para el par. */
  habilitacion: EstadoHabilitacion | null
  /** Solo se lee cuando hay que firmar; ver `conSecreto`. */
  secreto?: string
}

interface FilaNueva {
  id: string
  slug: string
  nombre: string
  urlBase: string
  urlWebhook: string | null
  estado: string
  autoHabilitar: boolean
  secreto?: string
  tiposNegocio: { tipo: { codigo: string } }[]
  habilitaciones: { estado: string }[]
}

interface FilaLegado {
  id: string
  slug: string
  nombre: string
  urlBase: string
  urlWebhook: string | null
  activo: boolean
  categoria: string
  secreto?: string
}

/**
 * Un estado que la base no reconoce NO se interpreta como activo. La columna es
 * TEXT (con CHECK, pero el CHECK puede no estar en una base restaurada a mano),
 * y ante un valor inesperado la respuesta segura es la puerta cerrada.
 */
function normalizarEstado(v: string): EstadoSistema {
  return esEstadoSistema(v) ? v : 'SUSPENDED'
}

function normalizarHabilitacion(v: string | undefined): EstadoHabilitacion | null {
  if (v === undefined) return null
  return esEstadoHabilitacion(v) ? v : 'DISABLED'
}

/**
 * Sistemas del catálogo con la habilitación de esta empresa resuelta.
 *
 * `conEmpresa` y no `sinEmpresa`: `empresas_sistemas` lleva `companyId`, así
 * que es dato de inquilino y la Capa 2 debe poder filtrarlo. El catálogo de
 * sistemas es global y no la estorba.
 */
async function leerSistemas(companyId: string, conSecreto: boolean): Promise<SistemaRegistrado[]> {
  const comun = {
    id: true,
    slug: true,
    nombre: true,
    urlBase: true,
    urlWebhook: true,
    ...(conSecreto ? { secreto: true } : {}),
  } as const

  try {
    const filas = (await conEmpresa(companyId, (tx) =>
      tx.sistemaConectado.findMany({
        select: {
          ...comun,
          estado: true,
          autoHabilitar: true,
          tiposNegocio: { select: { tipo: { select: { codigo: true } } } },
          habilitaciones: { where: { companyId }, select: { estado: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    )) as FilaNueva[]

    return filas.map((f) => ({
      id: f.id,
      slug: f.slug,
      nombre: f.nombre,
      urlBase: f.urlBase,
      urlWebhook: f.urlWebhook,
      secreto: f.secreto,
      estado: normalizarEstado(f.estado),
      autoHabilitar: f.autoHabilitar,
      tiposNegocio: f.tiposNegocio.map((t) => t.tipo.codigo),
      habilitacion: normalizarHabilitacion(f.habilitaciones[0]?.estado),
    }))
  } catch {
    // Migración aún sin aplicar: misma regla, columnas viejas.
    try {
      const filas = (await conEmpresa(companyId, (tx) =>
        tx.sistemaConectado.findMany({
          select: { ...comun, activo: true, categoria: true },
          orderBy: { createdAt: 'asc' },
        })
      )) as FilaLegado[]

      return filas.map((f) => ({
        id: f.id,
        slug: f.slug,
        nombre: f.nombre,
        urlBase: f.urlBase,
        urlWebhook: f.urlWebhook,
        secreto: f.secreto,
        estado: f.activo ? 'ACTIVE' : 'SUSPENDED',
        autoHabilitar: true,
        tiposNegocio: [f.categoria],
        habilitacion: null,
      }))
    } catch (e) {
      console.error('[plataforma] no se pudo leer el registro de sistemas:', e)
      return []
    }
  }
}

/** Categoría efectiva de la empresa, que es su tipo de negocio. */
async function tipoNegocioDe(companyId: string): Promise<string | null> {
  try {
    const { getCapacidadesEmpresa } = await import('@/modules/capacidades/resolver')
    return (await getCapacidadesEmpresa(companyId)).categoria
  } catch (e) {
    console.error('[plataforma] no se pudo resolver el tipo de negocio:', e)
    return null
  }
}

/**
 * Sistemas a los que la empresa TIENE acceso, en el orden en que se
 * registraron. Nunca lanza: un fallo aquí no puede tumbar un layout ni el bus
 * de eventos.
 */
export async function sistemasDeEmpresa(
  companyId: string,
  opciones: { conSecreto?: boolean } = {}
): Promise<SistemaRegistrado[]> {
  const tipo = await tipoNegocioDe(companyId)
  if (!tipo) return []
  const sistemas = await leerSistemas(companyId, opciones.conSecreto === true)
  return sistemas.filter((s) => decidirAcceso(s, tipo, s.habilitacion).permitido)
}

/**
 * Decisión razonada sobre UN sistema identificado por su slug.
 *
 * Devuelve el motivo del rechazo además del veredicto: quien llama lo escribe
 * en el log del servidor, y así un «no disponible» en pantalla siempre tiene
 * detrás una causa concreta que alguien puede arreglar.
 */
export async function accesoASistema(
  slug: string,
  companyId: string,
  opciones: { conSecreto?: boolean } = {}
): Promise<{ decision: Decision; sistema: SistemaRegistrado | null }> {
  const tipo = await tipoNegocioDe(companyId)
  const sistemas = await leerSistemas(companyId, opciones.conSecreto === true)
  const sistema = sistemas.find((s) => s.slug === slug) ?? null

  if (!sistema) return { decision: { permitido: false, motivo: 'SISTEMA_NO_ACTIVO' }, sistema: null }
  if (!tipo) return { decision: { permitido: false, motivo: 'VERTICAL_INCOMPATIBLE' }, sistema }

  return { decision: decidirAcceso(sistema, tipo, sistema.habilitacion), sistema }
}

/**
 * Sistema por slug SIN empresa: el único caso legítimo es el SSO de entrada,
 * donde el `companyId` viene dentro del token y no se puede saber cuál es hasta
 * haber verificado la firma — que exige este secreto.
 *
 * Por eso comprueba lo único comprobable en ese momento (que el sistema esté
 * ACTIVE) y nada más. El acceso de la empresa se decide DESPUÉS de abrir el
 * token, con `accesoASistema`.
 */
export async function sistemaParaVerificarFirma(
  slug: string
): Promise<{ id: string; secreto: string } | null> {
  const leer = async <T>(select: object): Promise<T | null> =>
    sinEmpresa('sso entrante: sistema por slug antes de conocer la empresa (catálogo global)', (tx) =>
      tx.sistemaConectado.findUnique({ where: { slug }, select })
    ) as Promise<T | null>

  try {
    const s = await leer<{ id: string; secreto: string; estado: string }>({
      id: true,
      secreto: true,
      estado: true,
    })
    if (!s) return null
    return normalizarEstado(s.estado) === 'ACTIVE' ? { id: s.id, secreto: s.secreto } : null
  } catch {
    try {
      const s = await leer<{ id: string; secreto: string; activo: boolean }>({
        id: true,
        secreto: true,
        activo: true,
      })
      if (!s?.activo) return null
      return { id: s.id, secreto: s.secreto }
    } catch (e) {
      console.error('[plataforma] no se pudo leer el sistema por slug:', e)
      return null
    }
  }
}
