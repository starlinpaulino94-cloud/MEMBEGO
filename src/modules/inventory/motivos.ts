import { normalizarMotivo } from './domain'

/**
 * COMMERCE CORE · inventario — INV-4b: el catálogo de motivos. PURO: sin base de datos ni servidor, para que lo usen el servicio,
 * los formularios, los informes y las pruebas.
 *
 * POR QUÉ UN CÓDIGO. El «por qué» de un ajuste, un daño o una baja era texto libre: sirve para LEER un movimiento, no para SUMAR.
 * «Vencido», «venció» y «caducado» son lo mismo para una persona y tres cosas para un informe. El movimiento guarda ahora un
 * código estable del catálogo (`reasonCode`) y el texto libre queda como DETALLE (`reason`). El detalle sigue siendo obligatorio
 * donde la base lo exige (un ajuste o un daño sin texto no se escribe): si la persona no lo teclea, se guarda la etiqueta del
 * motivo, así que el texto nunca queda vacío ni miente.
 *
 * CUATRO CLASES. Un motivo solo vale para lo que explica:
 *   · FALTANTE: hay menos de lo que decía el sistema (un ajuste que resta);
 *   · SOBRANTE: hay más (un ajuste que suma);
 *   · DANO:     mercancía que deja de ser vendible pero sigue en la sucursal;
 *   · BAJA:     lo dañado sale del inventario para siempre.
 * Recuperar lo dañado (vuelve a vendible) no es una pérdida y no lleva motivo del catálogo.
 *
 * El catálogo vive aquí y no en una tabla: añadir un motivo no exige una migración. La base solo vigila lo que no cambia (que el
 * código tenga forma de código y que solo lo lleven los ajustes y los daños).
 */

export type ClaseDeMotivo = 'FALTANTE' | 'SOBRANTE' | 'DANO' | 'BAJA'

export const CLASES_DE_MOTIVO: readonly ClaseDeMotivo[] = ['FALTANTE', 'SOBRANTE', 'DANO', 'BAJA']

export const ETIQUETA_CLASE: Record<ClaseDeMotivo, string> = {
  FALTANTE: 'Faltante',
  SOBRANTE: 'Sobrante',
  DANO: 'Dañado',
  BAJA: 'Baja de lo dañado',
}

export interface Motivo {
  codigo: string
  etiqueta: string
  ayuda: string
  /** En qué clases se puede elegir, en el orden en que se ofrece. */
  clases: readonly ClaseDeMotivo[]
}

/** El motivo que escribe sola cada diferencia de un conteo físico (nadie lo elige). */
export const MOTIVO_DE_CONTEO = 'COUNT_DIFFERENCE'
/** «Otro»: el motivo que no explica nada por sí solo, así que exige detalle. */
export const MOTIVO_OTRO = 'OTHER'

export const MOTIVOS: readonly Motivo[] = [
  { codigo: 'EXPIRED', etiqueta: 'Vencido', ayuda: 'Pasó su fecha de caducidad.', clases: ['FALTANTE', 'DANO', 'BAJA'] },
  { codigo: 'THEFT', etiqueta: 'Robo o hurto', ayuda: 'Se lo llevaron sin pagar.', clases: ['FALTANTE'] },
  { codigo: 'LOST', etiqueta: 'Pérdida o extravío', ayuda: 'No aparece y no se sabe qué pasó.', clases: ['FALTANTE'] },
  { codigo: 'SAMPLE', etiqueta: 'Muestra o regalo', ayuda: 'Se entregó sin cobrar: muestra, cortesía, promoción.', clases: ['FALTANTE'] },
  { codigo: 'INTERNAL_USE', etiqueta: 'Consumo interno', ayuda: 'Lo usó el propio negocio.', clases: ['FALTANTE'] },
  { codigo: 'SUPPLIER_RETURN', etiqueta: 'Devuelto al proveedor', ayuda: 'Se le regresó al proveedor.', clases: ['FALTANTE', 'BAJA'] },
  { codigo: MOTIVO_DE_CONTEO, etiqueta: 'Diferencia de conteo', ayuda: 'Salió de contar: lo que había no era lo que decía el sistema.', clases: ['FALTANTE', 'SOBRANTE'] },
  { codigo: 'FOUND', etiqueta: 'Apareció mercancía', ayuda: 'Estaba en otro lugar y se encontró.', clases: ['SOBRANTE'] },
  { codigo: 'ENTRY_ERROR', etiqueta: 'Error de captura', ayuda: 'Una entrada o un movimiento anterior se capturó mal.', clases: ['SOBRANTE'] },
  { codigo: 'HANDLING', etiqueta: 'Golpe o mal manejo', ayuda: 'Se cayó, se rompió o se maltrató.', clases: ['DANO', 'BAJA'] },
  { codigo: 'STORAGE', etiqueta: 'Mal almacenamiento', ayuda: 'Humedad, calor, plagas.', clases: ['DANO', 'BAJA'] },
  { codigo: 'TRANSPORT', etiqueta: 'Daño en el transporte', ayuda: 'Llegó o se movió dañado.', clases: ['DANO', 'BAJA'] },
  { codigo: 'DEFECT', etiqueta: 'Defecto de fábrica', ayuda: 'Venía mal de origen.', clases: ['DANO', 'BAJA'] },
  { codigo: MOTIVO_OTRO, etiqueta: 'Otro', ayuda: 'Ninguno de los anteriores: explícalo en el detalle.', clases: ['FALTANTE', 'SOBRANTE', 'DANO', 'BAJA'] },
]

const POR_CODIGO = new Map(MOTIVOS.map((m) => [m.codigo, m]))

/** Los motivos que se pueden elegir para una clase, en el orden del catálogo (con «Otro» siempre al final). */
export function motivosDeClase(clase: ClaseDeMotivo): readonly Motivo[] {
  return MOTIVOS.filter((m) => m.clases.includes(clase))
}

export function esMotivoDelCatalogo(codigo: unknown): codigo is string {
  return typeof codigo === 'string' && POR_CODIGO.has(codigo)
}

export function esMotivoDeClase(codigo: unknown, clase: ClaseDeMotivo): boolean {
  return typeof codigo === 'string' && (POR_CODIGO.get(codigo)?.clases.includes(clase) ?? false)
}

/** Lo que se ve en pantalla. Un código que el catálogo ya no conoce se enseña tal cual (nunca se esconde); sin código, se dice. */
export const SIN_MOTIVO_CODIFICADO = 'Sin motivo codificado'

export function etiquetaDeMotivo(codigo: string | null | undefined): string {
  if (codigo === null || codigo === undefined || codigo === '') return SIN_MOTIVO_CODIFICADO
  return POR_CODIGO.get(codigo)?.etiqueta ?? codigo
}

/**
 * El detalle que vale la pena enseñar junto al motivo: el texto del movimiento, salvo que sea la propia etiqueta (cuando la persona
 * no escribió nada se guarda la etiqueta, y repetirla al lado del motivo sería ruido). null si no hay nada que añadir.
 */
export function detalleDeMotivo(codigo: string | null | undefined, texto: string | null | undefined): string | null {
  if (!texto || texto.trim() === '') return null
  if (codigo && texto === etiquetaDeMotivo(codigo)) return null
  return texto
}

// ── Qué clase de motivo explica un movimiento ────────────────────────────────

export type CubetaDeMovimiento = 'AVAILABLE' | 'RESERVED' | 'DAMAGED'

/**
 * A qué clase pertenece un movimiento del ledger, o null si no se explica con un motivo del catálogo (una venta, una entrada, una
 * transferencia, una reserva, o recuperar lo dañado).
 *   · ajuste que SUMA (entra desde fuera)           → SOBRANTE
 *   · ajuste que RESTA de lo vendible (sale)        → FALTANTE
 *   · ajuste que saca lo dañado (sale)              → BAJA
 *   · daño (vendible → dañado)                      → DANO
 */
export function claseDeMovimiento(m: { tipo: string; origen: CubetaDeMovimiento | null; destino: CubetaDeMovimiento | null }): ClaseDeMotivo | null {
  if (m.tipo === 'DAMAGE') return m.origen === 'AVAILABLE' && m.destino === 'DAMAGED' ? 'DANO' : null
  if (m.tipo !== 'ADJUSTMENT') return null
  if (m.origen === null && m.destino !== null) return 'SOBRANTE'
  if (m.destino === null && m.origen === 'DAMAGED') return 'BAJA'
  if (m.destino === null && m.origen !== null) return 'FALTANTE'
  return null
}

/** Lo que se pierde de verdad: sale del inventario sin venderse (faltantes y bajas). El daño todavía está en la sucursal. */
export function esPerdida(clase: ClaseDeMotivo | null): boolean {
  return clase === 'FALTANTE' || clase === 'BAJA'
}

// ── Del motivo elegido a lo que se guarda ────────────────────────────────────

export type MotivoResuelto = { ok: true; codigo: string | null; texto: string | null } | { ok: false; codigo: string; error: string }

/**
 * Convierte «el motivo que eligió la persona + el detalle que escribió» en lo que se guarda: el código (o null si no eligió
 * ninguno) y el texto del movimiento.
 *
 *   · Con código: tiene que ser del catálogo y de la clase; con «Otro» el detalle es obligatorio; sin detalle, el texto es la
 *     etiqueta del motivo.
 *   · Sin código y `exigirCodigo`: se pide elegirlo (así lo piden las pantallas).
 *   · Sin código y sin `exigirCodigo`: es el camino de antes (texto libre, obligatorio si `textoObligatorio`): lo siguen usando
 *     los procesos que no eligen un motivo.
 */
export function resolverMotivo(e: { clase: ClaseDeMotivo; codigo?: unknown; detalle?: unknown; exigirCodigo?: boolean; textoObligatorio: boolean }): MotivoResuelto {
  const detalle = normalizarMotivo(e.detalle)
  if (!detalle.ok) return { ok: false, codigo: 'MOTIVO_INVALIDO', error: detalle.error }
  const hayCodigo = e.codigo !== undefined && e.codigo !== null && e.codigo !== ''
  if (!hayCodigo) {
    if (e.exigirCodigo) return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Elige el motivo.' }
    if (e.textoObligatorio && !detalle.valor) return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Escribe el motivo: un ajuste o un daño sin explicación es un faltante sin explicar.' }
    return { ok: true, codigo: null, texto: detalle.valor }
  }
  if (typeof e.codigo !== 'string' || !esMotivoDelCatalogo(e.codigo)) return { ok: false, codigo: 'MOTIVO_INVALIDO', error: 'Ese motivo no está en el catálogo.' }
  if (!esMotivoDeClase(e.codigo, e.clase)) {
    return { ok: false, codigo: 'MOTIVO_INVALIDO', error: `«${etiquetaDeMotivo(e.codigo)}» no sirve para explicar esto (${ETIQUETA_CLASE[e.clase].toLowerCase()}): elige otro motivo.` }
  }
  if (e.codigo === MOTIVO_OTRO && !detalle.valor) return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Con «Otro» escribe el detalle: por sí solo no explica nada.' }
  return { ok: true, codigo: e.codigo, texto: detalle.valor ?? etiquetaDeMotivo(e.codigo) }
}
