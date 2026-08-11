// Definiciones PURAS de los segmentos de clientes (sin Prisma ni nada de
// servidor): este archivo se importa también desde componentes cliente.
// La resolución/conteo real vive en ./segmentos (solo servidor).

export const SEGMENTOS = [
  { value: 'seguidores', label: 'Seguidores de la empresa' },
  { value: 'todos', label: 'Todos mis clientes' },
  { value: 'activos', label: 'Clientes con membresía activa' },
  { value: 'por_vencer', label: 'Membresías por vencer (7 días)' },
  { value: 'nuevos', label: 'Clientes nuevos (últimos 30 días)' },
  { value: 'inactivos', label: 'Sin visitas en 30 días' },
  { value: 'plan', label: 'Por plan específico…' },
] as const

export type SegmentoValue = (typeof SEGMENTOS)[number]['value']

export function esSegmentoValido(s: string): s is SegmentoValue {
  return SEGMENTOS.some((x) => x.value === s)
}

/**
 * Dónde SE VE quién está en cada segmento.
 *
 * Estos segmentos llevaban tiempo calculados y probados, pero `resolverSegmento`
 * devuelve identificadores y su único consumidor era el envío de
 * notificaciones: el sistema sabía quiénes eran los clientes en riesgo, podía
 * mandarles un mensaje, y no podía enseñárselos a nadie. Mandar a ciegas es
 * justo lo que hace que nadie se atreva a pulsar el botón.
 *
 * No hace falta una pantalla nueva: los filtros del directorio dicen lo mismo,
 * así que enlazar es poner una URL. `null` = ese segmento no tiene equivalente
 * (los seguidores no son necesariamente clientes; «por plan» depende de cuál).
 */
export const VER_SEGMENTO: Record<SegmentoValue, string | null> = {
  seguidores: null,
  todos: '/admin/clientes',
  activos: '/admin/clientes?membresia=vigente',
  por_vencer: '/admin/clientes?membresia=por_vencer&vence=7',
  nuevos: '/admin/clientes?nuevos=30',
  inactivos: '/admin/clientes?sinVisitas=30',
  plan: null,
}

export interface ConteoSegmentos {
  seguidores: number
  todos: number
  activos: number
  por_vencer: number
  nuevos: number
  inactivos: number
}
