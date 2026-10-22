import type {
  ClienteOpcion,
  ErroresReserva,
  ExcursionOpcion,
  ItinerarioMulti,
  ModoComboFechas,
} from '@/modules/excursiones/reservas/formulario'

/** Todo lo que el formulario «Nueva reserva» recuerda mientras se llena. */
export interface ValoresReserva {
  busquedaExcursion: string
  excursionId: string
  varianteId: string
  hora: string
  fecha: string
  adultos: number
  ninos: number
  descuento: string
  vendedorId: string
  canal: string
  modoCombo: ModoComboFechas
  turnoCombo: string
  itinerario: ItinerarioMulti
  modoCliente: 'NUEVO' | 'EXISTENTE'
  cliente: ClienteOpcion | null
  clienteNombre: string
  clienteEmail: string
  clienteTelefono: string
  mostrarLogistica: boolean
  voucherAgencia: string
  hotelRecogida: string
  lobbyRecogida: string
  horaRecogida: string
  habitacion: string
  notas: string
}

/** Lo que cada paso recibe: los valores, cómo cambiarlos y el error de cada campo. */
export interface PasoProps {
  v: ValoresReserva
  poner: (cambios: Partial<ValoresReserva>) => void
  errores: ErroresReserva
}

export type { ExcursionOpcion }
