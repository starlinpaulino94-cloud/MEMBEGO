/**
 * DOMINIO DE PLATAFORMA · Fase 1b — LA REGLA DE ACCESO A UN SISTEMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SUSTITUYE
 *
 * Hasta ahora, «¿puede esta empresa entrar a este sistema?» se contestaba en
 * cuatro sitios distintos con la misma línea copiada:
 *
 *     sistema.activo && sistema.categoria === categoriaDeLaEmpresa
 *
 * Cuatro copias de una regla es cuatro sitios donde arreglarla, y en uno de
 * ellos —`/sso/entrar`— la comparación de categoría se leía de la base y no se
 * usaba: el satélite del car wash podía abrir sesión de un usuario de un
 * restaurante con solo firmar el token.
 *
 * Aquí la regla está UNA vez, es pura y se puede probar sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ COMPATIBILIDAD Y CONCESIÓN SON COSAS DISTINTAS
 *
 * «Este sistema sirve a restaurantes» y «este restaurante concreto lo tiene
 * contratado» son dos preguntas. Mientras hubo un solo vertical daban la misma
 * respuesta, así que una sola columna bastaba. Con dos verticales deja de ser
 * cierto: registrar el sistema de Restaurante no puede concedérselo de golpe a
 * todos los restaurantes de la plataforma.
 *
 *   compatibilidad → `tiposNegocio` del sistema (N:M)
 *   concesión      → `EmpresaSistema.estado` (habilitación por empresa)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN DE LAS COMPROBACIONES NO ES ARBITRARIO
 *
 * Una revocación explícita (DISABLED / SUSPENDED) se mira ANTES que la política
 * `autoHabilitar`. Si fuera al revés, apagarle el sistema a una empresa
 * concreta no serviría de nada mientras el vertical siguiera siendo automático
 * — y el panel diría «deshabilitado» mientras la puerta sigue abierta.
 */

// ── Estados ─────────────────────────────────────────────────────────────────

/**
 * Ciclo de vida del sistema.
 *
 * `activo: boolean` no distinguía «aún no lanzado» de «suspendido por
 * incidente» de «retirado», y son tres conversaciones distintas con el
 * satélite. Solo ACTIVE abre la puerta; los otros tres la cierran por motivos
 * que sí se pueden explicar.
 */
export const ESTADOS_SISTEMA = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED'] as const
export type EstadoSistema = (typeof ESTADOS_SISTEMA)[number]

/**
 * Estado de la habilitación de UNA empresa sobre UN sistema.
 *
 * AVAILABLE no significa «encendido»: significa «compatible y disponible para
 * encender». Es el estado en el que nace una fila creada por el catálogo, y
 * por sí solo no concede nada.
 */
export const ESTADOS_HABILITACION = ['AVAILABLE', 'ENABLED', 'DISABLED', 'SUSPENDED'] as const
export type EstadoHabilitacion = (typeof ESTADOS_HABILITACION)[number]

export function esEstadoSistema(v: unknown): v is EstadoSistema {
  return (ESTADOS_SISTEMA as readonly unknown[]).includes(v)
}

export function esEstadoHabilitacion(v: unknown): v is EstadoHabilitacion {
  return (ESTADOS_HABILITACION as readonly unknown[]).includes(v)
}

// ── La decisión ─────────────────────────────────────────────────────────────

export interface SistemaParaAcceso {
  estado: EstadoSistema
  /** ¿Toda empresa compatible entra sin habilitación explícita? */
  autoHabilitar: boolean
  /** Códigos de tipo de negocio que el sistema atiende (N:M). */
  tiposNegocio: readonly string[]
}

/**
 * Motivos de rechazo. Existen separados —y no como un booleano— porque cada uno
 * lo arregla una persona distinta: el estado lo cambia el superadmin, la
 * compatibilidad la declara quien registra el sistema, y la habilitación la
 * concede quien vende. Un `false` pelado obliga a adivinar a quién llamar.
 */
export type MotivoDenegado =
  | 'SISTEMA_NO_ACTIVO'
  | 'VERTICAL_INCOMPATIBLE'
  | 'SIN_HABILITACION'
  | 'HABILITACION_REVOCADA'

export type Decision = { permitido: true } | { permitido: false; motivo: MotivoDenegado }

const PERMITIDO: Decision = { permitido: true }

/**
 * ¿Puede una empresa de `tipoNegocio` usar este sistema?
 *
 * `habilitacion` es `null` cuando no existe fila para el par (empresa,
 * sistema) — el caso normal de una empresa creada después de que se registrara
 * el sistema. Ahí decide la política del sistema, no la ausencia de dato.
 */
export function decidirAcceso(
  sistema: SistemaParaAcceso,
  tipoNegocio: string,
  habilitacion: EstadoHabilitacion | null
): Decision {
  if (sistema.estado !== 'ACTIVE') return { permitido: false, motivo: 'SISTEMA_NO_ACTIVO' }

  if (!sistema.tiposNegocio.includes(tipoNegocio)) {
    return { permitido: false, motivo: 'VERTICAL_INCOMPATIBLE' }
  }

  // Antes que `autoHabilitar`, a propósito: lo explícito gana a la política.
  if (habilitacion === 'DISABLED' || habilitacion === 'SUSPENDED') {
    return { permitido: false, motivo: 'HABILITACION_REVOCADA' }
  }

  if (habilitacion === 'ENABLED') return PERMITIDO

  // Sin fila, o con la fila en AVAILABLE: decide la política del sistema.
  // `autoHabilitar` nace en false —el vertical nuevo es opt-in— y solo los
  // sistemas que ya funcionaban por categoría lo tienen en true.
  return sistema.autoHabilitar ? PERMITIDO : { permitido: false, motivo: 'SIN_HABILITACION' }
}

/**
 * Mensaje para el usuario. Deliberadamente GRUESO: los cuatro motivos son
 * información sobre la configuración de la plataforma, y quien pulsa el botón
 * no puede hacer nada con ellos. El detalle va al log del servidor.
 */
export function mensajeDenegado(motivo: MotivoDenegado): string {
  switch (motivo) {
    case 'SISTEMA_NO_ACTIVO':
      return 'Sistema no disponible.'
    case 'VERTICAL_INCOMPATIBLE':
      return 'Este sistema no aplica a tu empresa.'
    case 'SIN_HABILITACION':
    case 'HABILITACION_REVOCADA':
      return 'Tu empresa no tiene este sistema habilitado.'
  }
}
