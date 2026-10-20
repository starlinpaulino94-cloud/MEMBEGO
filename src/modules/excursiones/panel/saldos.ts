import { obtenerDetalleConversion } from '../config'

/**
 * SALDOS DEL VENDEDOR · el cálculo, sin base de datos.
 *
 * Auditoría admin · D-02. El panel sumaba «por cobrar» y «ya cobrado» sobre la
 * MISMA lista que pintaba, recortada a 200 filas: desde la comisión 201 los
 * dos saldos quedaban cortos en silencio, y los más viejos —entre ellos lo ya
 * pagado— eran justo los que se perdían. Ahora la base de datos suma TODO
 * (una fila por estado de pago y moneda) y esta función solo convierte y
 * reparte. La lista que se enseña es otra consulta, paginada, y no decide
 * ninguna cifra.
 */

/** Una fila de la agregación: el neto (monto + ajustes, sin bajar de cero) de un grupo. */
export interface GrupoSaldo {
  /** `true` = comisiones PAGADAS; `false` = vivas y todavía por cobrar. */
  pagada: boolean
  moneda: string
  neto: number
  /** Cuántas comisiones suma el grupo (para saber el total sin leerlas). */
  lineas?: number
}

const centavos = (n: number) => Math.round(n * 100) / 100

/**
 * Reparte los grupos en «por cobrar» y «cobrado», ya en la moneda por defecto.
 *
 * Se convierte la SUMA de cada moneda, no cada línea: con una sola moneda (lo
 * normal) da lo mismo al centavo; con varias, puede diferir en céntimos de
 * redondear línea a línea, que es la forma correcta de no depender de cuántas
 * filas se hayan leído.
 */
export function resumirSaldos(
  grupos: readonly GrupoSaldo[],
  monedaDefecto: string,
  tasasCambio: Record<string, number>
): { porCobrar: number; cobrado: number } {
  let porCobrar = 0
  let cobrado = 0
  for (const g of grupos) {
    const convertido = obtenerDetalleConversion(
      Number(g.neto) || 0,
      g.moneda,
      monedaDefecto,
      tasasCambio
    ).montoConvertido
    if (g.pagada) cobrado += convertido
    else porCobrar += convertido
  }
  return { porCobrar: centavos(porCobrar), cobrado: centavos(cobrado) }
}

/** Páginas que hacen falta para `total` líneas (siempre al menos una). */
export function paginasDe(total: number, porPagina: number): number {
  return Math.max(1, Math.ceil(total / porPagina))
}

/** Normaliza el `?pagina=` que llega de la URL: entero ≥ 1, o 1. */
export function paginaDeUrl(valor: string | string[] | undefined): number {
  const n = Number(Array.isArray(valor) ? valor[0] : valor)
  return Number.isInteger(n) && n >= 1 ? n : 1
}
