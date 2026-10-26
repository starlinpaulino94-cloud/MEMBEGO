/**
 * INTERRUPTOR AUTOMÁTICO (circuit breaker) de las llamadas al proveedor.
 *
 * Si el proveedor falla varias veces seguidas, dejar de llamarle un rato: cada
 * petición condenada a fallar gasta hasta el tiempo máximo de espera, y con la
 * función serverless esperando se acumulan. Mientras está ABIERTO, las llamadas
 * fallan al instante con `circuito_abierto` y la pantalla dice «inténtalo en un
 * momento». Pasado el enfriamiento deja pasar UNA llamada de prueba (SEMIABIERTO):
 * si funciona se cierra; si falla vuelve a abrirse.
 *
 * Pura y con reloj inyectable para probarla sin esperar. El estado vive en la
 * instancia (no es distribuido): cada instancia protege sus propias llamadas, que
 * es lo que importa para no encolar esperas.
 */

export interface PoliticaDeCircuito {
  /** Fallos consecutivos que lo abren. */
  umbralDeFallos: number
  /** Cuánto permanece abierto antes de dejar pasar una prueba. */
  enfriamientoMs: number
}

export const POLITICA_CIRCUITO_POR_DEFECTO: PoliticaDeCircuito = { umbralDeFallos: 5, enfriamientoMs: 30_000 }

export type EstadoDeCircuito = 'cerrado' | 'abierto' | 'semiabierto'

export class Circuito {
  private fallos = 0
  private abiertoDesde: number | null = null
  private pruebaEnCurso = false

  constructor(
    private readonly politica: PoliticaDeCircuito = POLITICA_CIRCUITO_POR_DEFECTO,
    private readonly ahora: () => number = Date.now
  ) {}

  estado(): EstadoDeCircuito {
    if (this.abiertoDesde === null) return 'cerrado'
    return this.ahora() - this.abiertoDesde >= this.politica.enfriamientoMs ? 'semiabierto' : 'abierto'
  }

  /** ¿Se puede llamar ahora? En semiabierto solo deja pasar UNA llamada de prueba a la vez. */
  puedeLlamar(): boolean {
    const e = this.estado()
    if (e === 'cerrado') return true
    if (e === 'abierto') return false
    if (this.pruebaEnCurso) return false
    this.pruebaEnCurso = true
    return true
  }

  registrarExito(): void {
    this.fallos = 0
    this.abiertoDesde = null
    this.pruebaEnCurso = false
  }

  /** Solo los fallos del PROVEEDOR cuentan (caído, lento): un rechazo por datos malos no es una avería. */
  registrarFallo(): void {
    this.pruebaEnCurso = false
    this.fallos++
    if (this.fallos >= this.politica.umbralDeFallos || this.abiertoDesde !== null) this.abiertoDesde = this.ahora()
  }

  /** Cuándo se puede reintentar, en segundos (para la cabecera `Retry-After`). */
  reintentarEnSegundos(): number {
    if (this.abiertoDesde === null) return 0
    return Math.max(1, Math.ceil((this.politica.enfriamientoMs - (this.ahora() - this.abiertoDesde)) / 1000))
  }
}
