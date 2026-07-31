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

export interface ConteoSegmentos {
  seguidores: number
  todos: number
  activos: number
  por_vencer: number
  nuevos: number
  inactivos: number
}
