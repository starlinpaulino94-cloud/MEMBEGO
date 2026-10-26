import type { DecisionNeutral, NivelIdentidad } from '@/modules/identidad/identidadCore'

/**
 * EL CONTRATO CON EL PROVEEDOR DE VERIFICACIÓN (Fase 2).
 *
 * Es lo único que el resto de la identidad conoce del proveedor. Un proveedor
 * nuevo implementa esta interfaz y su verificador de avisos; ni el servicio, ni
 * la bandeja, ni las pantallas se enteran. Hoy hay uno: Didit (`didit.ts`).
 *
 * Todo lo que sale de aquí ya está traducido al vocabulario NEUTRAL de MEMBEGO
 * (`DecisionNeutral`, `CODIGOS_RAZON`): ninguna pantalla ve `LOW_FACE_MATCH_SIMILARITY`
 * ni un texto del proveedor.
 */

/** Los datos del documento que SOLO sirven para calcular el hash de «mismo documento en dos cuentas». */
export interface DocumentoParaDedupe {
  /** Categoría cerrada: `CEDULA | PASAPORTE | LICENCIA | RESIDENCIA | OTRO`. */
  tipoDocumento: string
  /** El número, en claro: el worker lo hashea con el pepper y lo DESCARTA. Nunca se guarda ni se registra. */
  numeroDocumento: string
  /** País emisor tal como lo informa el proveedor (ISO). */
  pais: string
}

export interface DecisionDelProveedor {
  decision: DecisionNeutral
  /** Solo si el proveedor trae el documento de una verificación aprobada. */
  documento: DocumentoParaDedupe | null
  /** Lo que MEMBEGO mandó como referencia propia al crear la sesión (nuestro `intentoId`). */
  referenciaDelCliente: string | null
  /** Lo que se acreditó: hoy siempre documento + selfie. */
  nivel: NivelIdentidad
}

export interface SesionCreada {
  /** El id de la sesión en el proveedor. Se sella antes de guardarlo. */
  sesionId: string
  /** A dónde se manda a la persona. Lleva un token de la sesión: es secreto, no se registra. */
  url: string
}

export interface ProveedorDeIdentidad {
  readonly nombre: string
  /**
   * Crea (o recupera, el proveedor es idempotente por `intentoId`) la sesión de
   * verificación. `callbackUrl` es adonde vuelve la persona: solo dispara una
   * consulta de estado, jamás se confía en lo que traiga.
   */
  crearSesion(entrada: { intentoId: string; callbackUrl: string; idioma: string }): Promise<SesionCreada>
  /** La decisión VIGENTE, preguntada al proveedor: «fetch the truth». */
  consultarDecision(sesionId: string): Promise<DecisionDelProveedor>
  /**
   * Borra la sesión y sus datos en el proveedor. `supresion` además purga las
   * plantillas biométricas de la persona (derecho de supresión). Idempotente:
   * una sesión que ya no existe cuenta como `ya_borrada`.
   */
  borrarSesion(sesionId: string, opciones: { motivo: 'operacional' | 'supresion'; instruccionId: string }): Promise<'borrada' | 'ya_borrada'>
  /** Borra las entidades de persona que el proveedor creó a partir de nuestras referencias. Idempotente. */
  borrarUsuarios(referencias: readonly string[]): Promise<void>
}

export type CodigoErrorDeProveedor =
  /** Caído, saturado, tiempo agotado o error 5xx: reintentar más tarde. */
  | 'no_disponible'
  /** El proveedor rechazó la petición (clave inválida, permisos, datos): reintentar igual no sirve. */
  | 'rechazado'
  /** Respondió algo que no entendemos. */
  | 'respuesta_invalida'
  /** El circuito está abierto: se evita llamar mientras el proveedor esté fallando. */
  | 'circuito_abierto'
  | 'no_configurado'

/**
 * Un fallo del proveedor. El mensaje NUNCA lleva cuerpo de respuesta, URL con
 * token ni nada de la persona: solo qué operación y qué estado HTTP.
 */
export class ErrorDeProveedor extends Error {
  constructor(
    readonly codigo: CodigoErrorDeProveedor,
    mensaje: string,
    readonly estadoHttp: number | null = null
  ) {
    super(mensaje)
    this.name = 'ErrorDeProveedor'
  }

  /** ¿Tiene sentido volver a intentarlo más tarde? */
  get reintentable(): boolean {
    return this.codigo === 'no_disponible' || this.codigo === 'circuito_abierto'
  }
}
