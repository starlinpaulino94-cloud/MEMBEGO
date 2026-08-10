import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { capacidadesEfectivas } from '@/modules/capacidades/catalogo'
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
interface ContextoEmpresa {
  tipoNegocio: string | null
  sistemas: SistemaRegistrado[]
}

const VACIO: ContextoEmpresa = { tipoNegocio: null, sistemas: [] }

async function leerContexto(companyId: string, conSecreto: boolean): Promise<ContextoEmpresa> {
  const comun = {
    id: true,
    slug: true,
    nombre: true,
    urlBase: true,
    urlWebhook: true,
    ...(conSecreto ? { secreto: true } : {}),
  } as const

  const empresaSelect = { type: true, capacidades: true } as const

  try {
    // Las dos lecturas en la MISMA transacción: la empresa y los sistemas se
    // deciden juntos, y separarlas abriría la ventana en que la categoría ya
    // cambió y las habilitaciones todavía no.
    const { empresa, filas } = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({
        where: { id: companyId },
        select: empresaSelect,
      })
      const filas = (await tx.sistemaConectado.findMany({
        select: {
          ...comun,
          estado: true,
          autoHabilitar: true,
          tiposNegocio: { select: { tipo: { select: { codigo: true } } } },
          habilitaciones: { where: { companyId }, select: { estado: true } },
        },
        orderBy: { createdAt: 'asc' },
      })) as FilaNueva[]
      return { empresa, filas }
    })

    return {
      tipoNegocio: tipoNegocioDe(empresa),
      sistemas: filas.map((f) => ({
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
      })),
    }
  } catch {
    // Migración aún sin aplicar: misma regla, columnas viejas.
    try {
      const { empresa, filas } = await conEmpresa(companyId, async (tx) => {
        const empresa = await tx.company.findUnique({
          where: { id: companyId },
          select: empresaSelect,
        })
        const filas = (await tx.sistemaConectado.findMany({
          select: { ...comun, activo: true, categoria: true },
          orderBy: { createdAt: 'asc' },
        })) as FilaLegado[]
        return { empresa, filas }
      })

      return {
        tipoNegocio: tipoNegocioDe(empresa),
        sistemas: filas.map((f) => ({
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
        })),
      }
    } catch (e) {
      console.error('[plataforma] no se pudo leer el registro de sistemas:', e)
      return VACIO
    }
  }
}

/**
 * Tipo de negocio efectivo de la empresa: override en `capacidades`, si no el
 * `type` heredado. Es la misma resolución que hace `capacidadesEfectivas`, que
 * es pura y se reutiliza tal cual.
 *
 * SE LEE DIRECTO Y NO POR `getCapacidadesEmpresa`, que era lo natural. Dos
 * motivos, y el segundo se descubrió probándolo:
 *
 *  · Ese resolutor envuelve la lectura en `unstable_cache` con 300 s. Una
 *    decisión de acceso tomada sobre una categoría de hace cinco minutos es una
 *    decisión que nadie puede explicar mirando la base.
 *
 *  · `unstable_cache` LANZA fuera del contexto de petición de Next. La
 *    autorización acababa en el `catch`, o sea denegando —fallo cerrado, no
 *    abierto— pero denegando siempre y sin motivo entendible.
 *
 * El coste es leer dos columnas dentro de una transacción que ya estaba
 * abierta.
 */
function tipoNegocioDe(empresa: { type: string | null; capacidades: unknown } | null): string | null {
  if (!empresa) return null
  return capacidadesEfectivas(empresa.type, empresa.capacidades).categoria
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
  const { tipoNegocio, sistemas } = await leerContexto(companyId, opciones.conSecreto === true)
  if (!tipoNegocio) return []
  return sistemas.filter((s) => decidirAcceso(s, tipoNegocio, s.habilitacion).permitido)
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
  const { tipoNegocio, sistemas } = await leerContexto(companyId, opciones.conSecreto === true)
  const sistema = sistemas.find((s) => s.slug === slug) ?? null

  if (!sistema) return { decision: { permitido: false, motivo: 'SISTEMA_NO_ACTIVO' }, sistema: null }
  if (!tipoNegocio) {
    // La empresa no existe, o su fila no se pudo leer. Cerrado, y con el motivo
    // que menos cuenta de la configuración a quien pregunta.
    return { decision: { permitido: false, motivo: 'VERTICAL_INCOMPATIBLE' }, sistema }
  }

  return { decision: decidirAcceso(sistema, tipoNegocio, sistema.habilitacion), sistema }
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
