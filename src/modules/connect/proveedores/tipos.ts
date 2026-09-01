/**
 * FRAMEWORK DE INTEGRACIONES · vocabulario y reglas puras (Connect · Fase 10).
 *
 * Sin Prisma, sin red, sin `server-only`: todo lo que decide QUÉ ve una empresa
 * en el catálogo vive aquí y se prueba sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SEPARACIÓN QUE SOSTIENE EL MÓDULO
 *
 * Cinco cosas distintas, que hasta ahora estaban mezcladas en dos:
 *
 *   1. IMPLEMENTACIÓN      ¿existe código que sepa hablar con el proveedor?
 *   2. METADATOS           nombre, logo, categoría — existen aunque no haya (1)
 *   3. PUBLICACIÓN         ¿el superadmin quiere que aparezca? (fila ACTIVE)
 *   4. DESPLIEGUE          ¿ESTE despliegue tiene lo que hace falta (env)?
 *   5. PLAN                ¿la empresa lo tiene concedido? (entitlements)
 *
 *   (1)+(3)+(4)+(5) = CONECTABLE
 *   ¬(1)+(3)        = PRÓXIMAMENTE
 *
 * Que sean cinco preguntas separadas es lo que impide el fallo clásico: un
 * botón «Conectar» sobre algo que no está implementado, o un logo bonito que
 * lleva a una pantalla de error del proveedor.
 */

// ─── Categorías ──────────────────────────────────────────────────────────────

export const CATEGORIAS_INTEGRACION = {
  CALENDARIO: 'Calendario',
  COMUNICACION: 'Comunicación',
  PAGOS: 'Pagos',
  MARKETING: 'Marketing',
  CONTABILIDAD: 'Contabilidad',
  CRM: 'CRM',
  AUTOMATIZACION: 'Automatización',
  IDENTIDAD: 'Identidad',
} as const

export type CategoriaIntegracion = keyof typeof CATEGORIAS_INTEGRACION

// ─── Clases de error ─────────────────────────────────────────────────────────

/**
 * POR QUÉ FALLÓ, en un vocabulario cerrado (decisión 5 del rediseño).
 *
 * No es taxonomía por gusto: cada clase implica una CONDUCTA distinta del
 * sistema, y ésa es la única razón por la que una clase merece existir.
 *
 *   AUTH           el token caducó o fue revocado  → hay que reconectar
 *   PERMISSIONS    falta un permiso que no pedimos → hay que reautorizar
 *   RATE_LIMIT     nos pasamos de cuota            → reintentar, NO molestar
 *   NETWORK        no llegamos al proveedor        → reintentar
 *   PROVIDER       el proveedor devolvió un fallo suyo (5xx)
 *   CONFIGURATION  falta algo de nuestro lado (número, calendario, variable)
 *   UNKNOWN        no clasificado — el cajón que hay que vigilar
 *
 * SOBRE RATE_LIMIT (usted preguntó si merece clase propia): SÍ, y es la que
 * más la merece. Es el único fallo TRANSITORIO Y CULPA NUESTRA: la conexión
 * está perfectamente sana, el token es válido y no hay nada que el dueño del
 * negocio pueda arreglar. Si cayera dentro de PROVIDER, un pico de envíos le
 * pintaría «Requiere atención» a una empresa cuya integración funciona, y le
 * pediría reconectar una cuenta que no tiene ningún problema. Separada, la
 * regla es trivial: no toca el estado, se reintenta con espera.
 */
export const CLASES_ERROR = [
  'AUTH',
  'PERMISSIONS',
  'RATE_LIMIT',
  'NETWORK',
  'PROVIDER',
  'CONFIGURATION',
  'UNKNOWN',
] as const

export type ClaseError = (typeof CLASES_ERROR)[number]

/**
 * Las clases que obligan a que una persona vuelva a autorizar. Las demás se
 * resuelven solas o las resuelve el reintento: pedir una reconexión por un
 * 429 sería mentirle al usuario sobre la causa.
 */
export const CLASES_QUE_PIDEN_RECONECTAR: readonly ClaseError[] = ['AUTH', 'PERMISSIONS']

/** Las que NO deben mover el estado de la conexión: pasan y se van. */
export const CLASES_TRANSITORIAS: readonly ClaseError[] = ['RATE_LIMIT', 'NETWORK']

export function esClaseError(valor: string): valor is ClaseError {
  return (CLASES_ERROR as readonly string[]).includes(valor)
}

/**
 * DE UN ESTADO HTTP A UNA CLASE DE ERROR.
 *
 * El reparto por defecto, que sirve para casi todos los proveedores. Uno con
 * particularidades (Google devuelve 403 tanto por permiso que falta como por
 * cuota agotada) lo afina en su propio módulo; esto es la base.
 *
 *   401  el token no vale  → AUTH, hay que reconectar
 *   403  falta permiso     → PERMISSIONS, hay que reautorizar con más scope
 *   404  no está           → CONFIGURATION, apunta a algo que ya no existe
 *   429  demasiadas        → RATE_LIMIT, esperar; NO es culpa de la cuenta
 *   5xx  suyo              → PROVIDER
 */
export function claseDeEstadoHttp(estado: number): ClaseError {
  if (estado === 401) return 'AUTH'
  if (estado === 403) return 'PERMISSIONS'
  if (estado === 404) return 'CONFIGURATION'
  if (estado === 429) return 'RATE_LIMIT'
  if (estado >= 500) return 'PROVIDER'
  return 'UNKNOWN'
}

/**
 * Un fallo que ni siquiera llegó a tener respuesta: se cortó la conexión, se
 * agotó el tiempo. No dice nada de la cuenta del cliente.
 */
export function claseDeFalloDeRed(): ClaseError {
  return 'NETWORK'
}

// ─── Autorización ────────────────────────────────────────────────────────────

/**
 * CÓMO se autoriza, y el patrón NO se elige por gusto: lo impone el proveedor.
 *
 *   REDIRECCION  salimos del navegador y volvemos al callback. Es lo que hace
 *                Google, y lo que nuestro OAuth ya sabe hacer.
 *   POPUP        una ventana aparte que devuelve el resultado por mensaje. Meta
 *                lo EXIGE para el alta incrustada: no es una redirección OAuth
 *                normal, es un diálogo de su SDK.
 *   CREDENCIAL   no hay flujo del proveedor: la empresa trae un secreto.
 */
export type PatronAutorizacion = 'REDIRECCION' | 'POPUP' | 'CREDENCIAL'

export interface AutorizacionProveedor {
  tipo: 'OAUTH2' | 'API_KEY'
  patron: PatronAutorizacion
  /**
   * Un camino que funciona hoy pero NO es el que queremos en producción.
   * Existir aquí, con motivo y sustituto escritos, es lo que impide que un
   * apaño se convierta en la arquitectura por olvido.
   */
  provisional?: { motivo: string; sustituyePor: string }
}

// ─── Pasos del alta ──────────────────────────────────────────────────────────

/**
 * El guion del asistente, declarado por cada proveedor (§21 del rediseño).
 *
 * El proveedor declara PASOS; el framework los pinta. Un proveedor no escribe
 * pantallas — por eso añadir uno nuevo no toca la interfaz.
 *
 * `COMPONENTE` es la válvula de escape explícita para lo que ningún tipo
 * genérico puede cubrir (el diálogo del SDK de Meta). Es deliberadamente fea
 * de usar: se nombra un componente a mano, y eso se ve en la revisión.
 */
export type TipoPaso =
  | 'INFORMATIVO'
  | 'AUTORIZACION'
  | 'ELECCION'
  | 'FORMULARIO'
  | 'VALIDACION'
  | 'COMPONENTE'

export interface PasoConexion {
  id: string
  titulo: string
  /** Qué verá la persona en ese paso, en su idioma. */
  descripcion: string
  tipo: TipoPaso
  /** Solo para COMPONENTE: qué pinta el framework en su lugar. */
  componente?: string
  /**
   * CÓMO se da por cumplido este paso, cuando no basta con haberlo contestado.
   *
   * Existe por un caso muy concreto: el paso donde una empresa pega el token
   * de WhatsApp NO puede guardar su respuesta en `setupState` —sería un
   * secreto en claro dentro de un JSON— así que el token va directo a la
   * credencial sellada y el paso se da por hecho porque LA CREDENCIAL EXISTE,
   * no porque alguien apuntara que la escribió.
   */
  cumpleCon?: 'autorizado' | 'validado'
}

// ─── Metadatos de catálogo ───────────────────────────────────────────────────

/**
 * IDENTIDAD VISUAL de la marca. Separada de la implementación a propósito: los
 * metadatos de las integraciones previstas existen sin una línea de código que
 * las conecte.
 *
 * `logoVerificado` es una declaración de PROCEDENCIA, no de estética: solo se
 * pone en true cuando el archivo de `public/marcas/<slug>.svg` existe y su uso
 * y distribución se comprobaron contra las guías de marca del titular. Mientras
 * sea false, el framework pinta el monograma con el color de la marca. Un
 * placeholder honesto es mejor que un logo redibujado a ojo, que además de
 * feo puede infringir.
 */
export interface MarcaProveedor {
  /** Color oficial de la marca, para el monograma y el acento de la tarjeta. */
  color: string
  /** ¿Hay un SVG oficial en el repositorio Y su licencia está comprobada? */
  logoVerificado: boolean
}

export interface MetadatosProveedor {
  slug: string
  nombre: string
  descripcion: string
  categoria: CategoriaIntegracion
  marca: MarcaProveedor
  /** Página del proveedor, para que quien dude pueda ir a la fuente. */
  sitioUrl?: string
}

// ─── Definición de un proveedor implementado ─────────────────────────────────

/**
 * DOS CLASES DE INTEGRACIÓN, un solo catálogo (ajuste 3 del rediseño).
 *
 *   NATIVA    la conexión vive en Membego Connect: `conexiones_empresa`,
 *             credenciales selladas, salud, bitácora.
 *   ADAPTADA  la conexión YA EXISTE en otro subsistema estable de Membego
 *             (hoy: CardNET, con su `MetodoPago`, su `PagoIntento` y sus
 *             variables de plataforma). Connect NO duplica su estado: lo LEE
 *             y lo traduce al mismo vocabulario, y «Gestionar» lleva al módulo
 *             que ya lo administra.
 *
 * La segunda clase existe para no tener que migrar un subsistema de cobros
 * —en producción y con un incidente abierto— solo para conseguir una
 * experiencia unificada. La experiencia se unifica; la arquitectura interna,
 * cuando toque y con su propia decisión.
 */
export type ClaseProveedor = 'NATIVA' | 'ADAPTADA'

export interface DefinicionProveedor {
  metadatos: MetadatosProveedor
  clase: ClaseProveedor
  autorizacion: AutorizacionProveedor
  /** Qué sabe hacer, en vocabulario nuestro. Se enseña en la página de detalle. */
  capacidades: readonly string[]
  /** El guion del alta. Vacío solo para las ADAPTADAS, que no se altan aquí. */
  pasos: readonly PasoConexion[]
  /**
   * Versión del guion. Cuando el alta cambie (un paso nuevo, un permiso más),
   * esto sube y las conexiones viejas quedan marcadas como «hechas con un
   * guion anterior» sin tener que adivinarlo por fechas.
   */
  versionAlta: number
  /** ¿Está lo necesario para conectarlo en ESTE despliegue? */
  disponible: () => boolean
  /** Qué le falta al administrador de la plataforma, dicho para arreglarlo. */
  queFalta: string
  /** Solo ADAPTADA: a dónde lleva «Gestionar». */
  rutaGestionExterna?: string
  /**
   * De las respuestas del alta a la CONFIGURACIÓN OPERATIVA. Puro: es solo un
   * mapeo, sin red ni base.
   *
   * Existe para que la frontera entre lo temporal y lo permanente la dibuje el
   * proveedor y no el asistente: solo él sabe que `datos.calendario` se llama
   * `calendarId` cuando vive para siempre.
   */
  configDesdeAlta?: (datos: Record<string, unknown>) => Record<string, unknown>
}

// ─── Estado de una integración, tal y como lo ve la empresa ──────────────────

/**
 * UN SOLO VOCABULARIO para toda la aplicación: la rejilla, la página de
 * detalle y el componente que aparece dentro de Citas o Comunicación leen
 * exactamente esto. Que sea uno solo es lo que garantiza que una tarjeta no
 * pueda decir «Conectar» sobre algo ya conectado.
 */
export const ESTADOS_INTEGRACION = [
  'PROXIMAMENTE',
  'NO_DISPONIBLE',
  'SIN_PLAN',
  'DISPONIBLE',
  'ALTA_SIN_TERMINAR',
  'CONECTADA',
  'REQUIERE_ATENCION',
  'REAUTORIZAR',
  'CON_PROBLEMAS',
] as const

export type EstadoIntegracion = (typeof ESTADOS_INTEGRACION)[number]

/**
 * El estado, dicho como se lo diríamos a la dueña de un salón de belleza. Los
 * nombres de arriba son para el código; esto es lo único que sale a pantalla.
 */
export const ETIQUETA_ESTADO: Record<EstadoIntegracion, string> = {
  PROXIMAMENTE: 'Próximamente',
  NO_DISPONIBLE: 'No disponible todavía',
  SIN_PLAN: 'No incluido en tu plan',
  DISPONIBLE: 'Disponible',
  ALTA_SIN_TERMINAR: 'Configuración sin terminar',
  CONECTADA: 'Conectado',
  REQUIERE_ATENCION: 'Requiere atención',
  REAUTORIZAR: 'Vuelve a conectar tu cuenta',
  CON_PROBLEMAS: 'Hay un problema con la conexión',
}

/**
 * El botón. Null = no hay acción posible, y entonces no se pinta ningún botón:
 * un botón que no hace nada es peor que ningún botón.
 */
export const ACCION_ESTADO: Record<EstadoIntegracion, string | null> = {
  PROXIMAMENTE: null,
  NO_DISPONIBLE: null,
  SIN_PLAN: null,
  DISPONIBLE: 'Conectar',
  ALTA_SIN_TERMINAR: 'Continuar',
  CONECTADA: 'Gestionar',
  REQUIERE_ATENCION: 'Revisar',
  REAUTORIZAR: 'Reconectar',
  CON_PROBLEMAS: 'Revisar',
}

/** Estados en los que la empresa YA tiene algo suyo aquí (pestaña «Mis integraciones»). */
export const ESTADOS_PROPIOS: readonly EstadoIntegracion[] = [
  'ALTA_SIN_TERMINAR',
  'CONECTADA',
  'REQUIERE_ATENCION',
  'REAUTORIZAR',
  'CON_PROBLEMAS',
]

/** Los que piden que alguien mire, para el aviso de la cabecera. */
export const ESTADOS_QUE_PIDEN_ATENCION: readonly EstadoIntegracion[] = [
  'REQUIERE_ATENCION',
  'REAUTORIZAR',
  'CON_PROBLEMAS',
]

// ─── La regla ────────────────────────────────────────────────────────────────

/** Lo que la conexión guardada aporta a la decisión. Null = nunca se conectó. */
export interface SenalesConexion {
  estado: 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED'
  claseError: ClaseError | null
  /** CONNECTED pero con fallos recientes: funciona a medias. */
  degradada: boolean
}

export interface SenalesIntegracion {
  /** (1) ¿Hay código que sepa hablar con el proveedor? */
  implementado: boolean
  /** (3) ¿El superadmin la publicó? (fila del catálogo en ACTIVE) */
  publicado: boolean
  /** (4) ¿Tiene este despliegue lo que hace falta? */
  configuradoEnDespliegue: boolean
  /** (5) ¿El plan de la empresa lo permite? */
  permitidoPorPlan: boolean
  conexion: SenalesConexion | null
}

/**
 * LA REGLA. Un solo sitio donde se decide qué ve la empresa.
 *
 * El orden de las preguntas no es casual:
 *
 *  · Lo NO implementado sale antes que nada: nunca puede acabar en un estado
 *    conectable por mucho que las otras cuatro señales digan que sí.
 *
 *  · Una conexión VIVA gana a las señales de plataforma y de plan. Si mañana
 *    se retira el permiso del plan o alguien quita una variable de entorno,
 *    una empresa que YA tiene WhatsApp conectado tiene que seguir viéndolo —
 *    para poder desconectarlo, o al menos para saber que existe. Hacerla
 *    desaparecer dejaría un token vivo invisible, que es exactamente lo que
 *    `desconectarConexion` se cuida de no dejar.
 */
export function decidirEstadoIntegracion(s: SenalesIntegracion): EstadoIntegracion {
  if (!s.implementado) return 'PROXIMAMENTE'

  const viva = s.conexion && s.conexion.estado !== 'DISCONNECTED' ? s.conexion : null
  if (viva) {
    if (viva.estado === 'PENDING') return 'ALTA_SIN_TERMINAR'
    if (viva.estado === 'ERROR') {
      const clase = viva.claseError
      if (clase && CLASES_QUE_PIDEN_RECONECTAR.includes(clase)) return 'REAUTORIZAR'
      return 'CON_PROBLEMAS'
    }
    return viva.degradada ? 'REQUIERE_ATENCION' : 'CONECTADA'
  }

  if (!s.configuradoEnDespliegue) return 'NO_DISPONIBLE'
  if (!s.permitidoPorPlan) return 'SIN_PLAN'
  return 'DISPONIBLE'
}

/**
 * ¿Se puede EMPEZAR o REANUDAR un alta desde este estado? Esta función es la
 * guardia, no un detalle de la interfaz: la usan también las acciones de
 * servidor, para que ocultar un botón y prohibir la operación sean la misma
 * decisión y no dos que puedan desincronizarse.
 */
export function permiteConectar(estado: EstadoIntegracion): boolean {
  return estado === 'DISPONIBLE' || estado === 'ALTA_SIN_TERMINAR' || estado === 'REAUTORIZAR'
}
