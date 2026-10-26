import type { ErroresExcursion } from '@/modules/excursiones/catalogo/formulario'

/** La excursión que se edita, como la entrega la página (el formulario de alta no recibe ninguna). */
export interface ExcursionEditable {
  id: string
  nombre: string
  tipoItem?: string
  actividadesComboIds?: string[]
  descripcion: string | null
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: string
  impuestoPct: unknown
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
  portadaUrl?: string | null
  /** URLs de la galería, tal como las guarda la columna JSON. */
  galeria?: string[] | null
  horarios?: {
    id: string
    horaSalida: string
    diasSemana: unknown
    cupo?: number | null
  }[]
  comboItems?: {
    actividadId?: string
    horaSalida?: string | null
    permitirSolapamiento?: boolean
    horarioFijo?: unknown
    actividad?: {
      id: string
      nombre?: string
      tipoItem?: string
      horaSalida?: string | null
      duracionMin?: number | null
      horarios?: { id: string; horaSalida: string; diasSemana: unknown; cupo?: number | null }[]
    }
  }[]
}

/** Los campos de texto, números y precios del formulario: lo que el administrador va escribiendo. */
export interface ValoresExcursion {
  nombre: string
  descripcion: string
  categoria: string
  capacidad: string
  ubicacion: string
  puntoSalida: string
  incluye: string
  noIncluye: string
  politicas: string
  moneda: string
  impuestoPct: string
  precioAdulto: string
  precioNino: string
  precioResidente: string
  precioNinoResidente: string
}

/** Lo que cada sección recibe: los valores, cómo cambiarlos y el error de cada campo. */
export interface SeccionProps {
  v: ValoresExcursion
  poner: (cambios: Partial<ValoresExcursion>) => void
  errores: ErroresExcursion
}
