/**
 * EXCURSIONES · Datos de demostración — EL GUION.
 *
 * Una demo no es «datos de relleno»: es una historia que se sostiene. Un
 * vendedor que captó ocho clientes y cerró tres, un hotel que vende caro y poco,
 * una reserva a medio cobrar y otra cancelada. Si todas las cifras son redondas
 * y todo sale bien, quien mira sabe que está viendo un decorado.
 *
 * Este archivo es PURO: solo describe. Quien escribe es `sembrar.ts`, y solo
 * sobre empresas marcadas como DEMO — la marca `esDemo` ya las excluye del
 * marketplace y de las métricas globales de la plataforma.
 */

export interface ExcursionDemo {
  nombre: string
  descripcion: string
  ubicacion: string
  duracionMin: number
  impuestoPct: number
  capacidad: number
  puntoSalida: string
  horaSalida: string
  horaRegreso: string
  incluye: string
  variantes: { nombre: string; precioAdulto: number; precioNino: number | null; capacidad: number | null }[]
  /// Días ISO (1 = lunes).
  dias: number[]
}

export const EXCURSIONES_DEMO: ExcursionDemo[] = [
  {
    nombre: 'Isla Saona · Día completo',
    descripcion: 'Catamarán, piscina natural y almuerzo bufé en la playa.',
    ubicacion: 'Bayahíbe, La Altagracia',
    duracionMin: 480,
    impuestoPct: 18,
    capacidad: 60,
    puntoSalida: 'Muelle de Bayahíbe',
    horaSalida: '08:00',
    horaRegreso: '17:00',
    incluye: 'Transporte, almuerzo, bebidas nacionales y guía.',
    variantes: [
      { nombre: 'Estándar', precioAdulto: 2500, precioNino: 1250, capacidad: 50 },
      { nombre: 'Premium (catamarán VIP)', precioAdulto: 3900, precioNino: 1950, capacidad: 12 },
    ],
    dias: [1, 3, 5, 6, 7],
  },
  {
    nombre: 'Hoyo Azul y Scape Park',
    descripcion: 'Cenote de agua turquesa, tirolinas y sendero ecológico.',
    ubicacion: 'Cap Cana, Punta Cana',
    duracionMin: 300,
    impuestoPct: 18,
    capacidad: 40,
    puntoSalida: 'Entrada de Scape Park',
    horaSalida: '09:00',
    horaRegreso: '14:00',
    incluye: 'Entrada al parque, guía y refrigerio.',
    variantes: [{ nombre: 'Estándar', precioAdulto: 3200, precioNino: 1600, capacidad: 40 }],
    dias: [1, 2, 3, 4, 5, 6],
  },
  {
    nombre: 'Ciudad Colonial · Tour histórico',
    descripcion: 'Recorrido a pie por la primera ciudad de América.',
    ubicacion: 'Santo Domingo',
    duracionMin: 240,
    impuestoPct: 18,
    capacidad: 25,
    puntoSalida: 'Parque Colón',
    horaSalida: '10:00',
    horaRegreso: '14:00',
    incluye: 'Guía certificado y entradas a los museos.',
    variantes: [{ nombre: 'Estándar', precioAdulto: 1800, precioNino: 900, capacidad: 25 }],
    dias: [2, 4, 6],
  },
]

export interface VendedorDemo {
  nombre: string
  apellido: string
  telefono: string
  tipo: string
  /// Cuántos clientes trajo y cuántos de esos llegaron a reservar.
  captados: number
}

/**
 * Cuatro perfiles distintos a propósito: el que capta mucho y cierra poco, el
 * hotel que trae pocos pero caros, el taxista constante y la que acaba de
 * empezar. Es lo que hace creíble el ranking.
 */
export const VENDEDORES_DEMO: VendedorDemo[] = [
  { nombre: 'Luis', apellido: 'Almonte', telefono: '809-555-0111', tipo: 'Empleado', captados: 9 },
  { nombre: 'Hotel', apellido: 'Bávaro Suites', telefono: '809-555-0122', tipo: 'Hotel', captados: 4 },
  { nombre: 'Ramón', apellido: 'Polanco', telefono: '809-555-0133', tipo: 'Taxi', captados: 6 },
  { nombre: 'Yaritza', apellido: 'Mena', telefono: '809-555-0144', tipo: 'Promotor', captados: 2 },
]

export const CLIENTES_DEMO = [
  'Ana Beltré', 'Carlos Jiménez', 'María Fernández', 'Pedro Santana',
  'Laura Guzmán', 'Miguel Ortiz', 'Rosa Núñez', 'Jorge Peña',
  'Elena Vargas', 'Andrés Cabral', 'Sofía Reyes', 'Diego Herrera',
  'Patricia Lora', 'Rafael Then', 'Isabel Ureña', 'Tomás Feliz',
  'Gabriela Sosa', 'Iván Castillo', 'Noemí Paredes', 'Héctor Batista',
  'Carmen Díaz',
]

export interface ReservaDemo {
  /// Índice dentro de CLIENTES_DEMO.
  cliente: number
  /// Índice dentro de VENDEDORES_DEMO; null = venta directa del mostrador.
  vendedor: number | null
  /// Índice dentro de EXCURSIONES_DEMO.
  excursion: number
  variante: number
  adultos: number
  ninos: number
  /// Días respecto de hoy: negativo = pasado, 0 = hoy, positivo = futuro.
  dia: number
  /// Qué pasó con el dinero.
  cobro: 'COMPLETO' | 'ABONO' | 'NADA'
  /// Se confirmó la venta (y con ella nació la comisión).
  vendida: boolean
  cancelada?: boolean
  /// Cuántos se subieron de verdad (solo para salidas de hoy o pasadas).
  embarcados?: number
}

/**
 * Doce reservas repartidas en el mes: la mayoría bien, una a medio cobrar, una
 * cancelada y una que no se presentó completa. El desorden es el punto.
 */
export const RESERVAS_DEMO: ReservaDemo[] = [
  { cliente: 0, vendedor: 0, excursion: 0, variante: 0, adultos: 2, ninos: 1, dia: -12, cobro: 'COMPLETO', vendida: true, embarcados: 3 },
  { cliente: 1, vendedor: 0, excursion: 0, variante: 0, adultos: 4, ninos: 0, dia: -9, cobro: 'COMPLETO', vendida: true, embarcados: 4 },
  { cliente: 2, vendedor: 2, excursion: 1, variante: 0, adultos: 2, ninos: 2, dia: -8, cobro: 'COMPLETO', vendida: true, embarcados: 3 },
  { cliente: 3, vendedor: 1, excursion: 0, variante: 1, adultos: 2, ninos: 0, dia: -7, cobro: 'COMPLETO', vendida: true, embarcados: 2 },
  { cliente: 4, vendedor: 2, excursion: 2, variante: 0, adultos: 3, ninos: 0, dia: -5, cobro: 'COMPLETO', vendida: true, embarcados: 3 },
  { cliente: 5, vendedor: 0, excursion: 1, variante: 0, adultos: 2, ninos: 0, dia: -4, cobro: 'COMPLETO', vendida: true, embarcados: 2 },
  { cliente: 6, vendedor: null, excursion: 2, variante: 0, adultos: 2, ninos: 1, dia: -3, cobro: 'COMPLETO', vendida: true, embarcados: 3 },
  { cliente: 7, vendedor: 1, excursion: 0, variante: 1, adultos: 2, ninos: 0, dia: -2, cobro: 'ABONO', vendida: false, cancelada: true },
  { cliente: 8, vendedor: 3, excursion: 1, variante: 0, adultos: 2, ninos: 1, dia: 0, cobro: 'COMPLETO', vendida: true, embarcados: 3 },
  { cliente: 9, vendedor: 0, excursion: 0, variante: 0, adultos: 5, ninos: 2, dia: 0, cobro: 'ABONO', vendida: false, embarcados: 6 },
  { cliente: 10, vendedor: 2, excursion: 2, variante: 0, adultos: 2, ninos: 0, dia: 2, cobro: 'ABONO', vendida: false },
  { cliente: 11, vendedor: 3, excursion: 0, variante: 0, adultos: 3, ninos: 1, dia: 5, cobro: 'NADA', vendida: false },
]

/** Metas del mes: una alcanzable, otra ambiciosa. */
export const METAS_DEMO = [
  { vendedor: 0, metaRegistros: 12, metaVentas: 6, metaIngresos: 40000 },
  { vendedor: 2, metaRegistros: 8, metaVentas: 4, metaIngresos: 25000 },
]
