/**
 * MEMBEGO SUPPLY 2.0 · categorías de vehículo.
 *
 * PURO: sin base de datos, sin `Decimal`, sin fechas. Decide qué categoría de
 * plataforma le corresponde al vehículo de un cliente, y —esto es lo que
 * importa— POR QUÉ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CONTRATO ES EL NIVEL, NUNCA EL NOMBRE
 *
 * Cada empresa nombra sus categorías como quiere: lo que una llama «Jeepeta»
 * otra lo llama «SUV» y otra «Camioneta mediana». Comparar nombres sería
 * comparar ortografía. Lo que se compara es `nivelTarifario`, el número que el
 * esquema declara el contrato (`carwash.prisma:165-168`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `origen` Y NO SOLO LA CATEGORÍA
 *
 * Devolver `null` cuando no hay correspondencia obliga a quien llama a
 * adivinar si fue porque el cliente no tiene vehículo, porque su vehículo no
 * tiene categoría, o porque esa categoría está en un nivel que Membego no
 * conoce. Son tres problemas distintos con tres arreglos distintos, y el
 * tercero es el único que indica un desajuste de configuración.
 *
 * Guardar el motivo en la línea de la orden convierte el riesgo del
 * `nivelTarifario @default(1)` en un informe de una consulta, en vez de un
 * misterio que aparece meses después como «cobramos de menos y no sabemos a
 * quién».
 */

/** Por qué se resolvió —o no— una categoría. */
export type OrigenCategoria =
  /** Hay un nivel que coincide exactamente. El caso bueno. */
  | 'EXACTA'
  /** El cliente no indicó vehículo y no tiene uno principal. */
  | 'SIN_VEHICULO'
  /** El vehículo existe pero nadie le puso categoría (`tipoVehiculoId` null), o está desactivada. */
  | 'SIN_CATEGORIA'
  /** La categoría tiene un nivel que Membego no tiene en su catálogo. Esto es un desajuste a arreglar. */
  | 'SIN_CORRESPONDENCIA'

export interface CategoriaDePlataforma {
  id: string
  code: string
  nombre: string
  nivelTarifario: number
  activo: boolean
}

export interface CategoriaResuelta<T extends CategoriaDePlataforma = CategoriaDePlataforma> {
  categoria: T | null
  origen: OrigenCategoria
}

/**
 * Casa el nivel de un vehículo con la categoría de plataforma que le toca.
 *
 * `nivelDelVehiculo` es `null` cuando no se pudo saber, y entonces hay que
 * decir cuál de los dos «no se pudo» fue: el llamador lo distingue con
 * `motivoSinNivel`.
 *
 * SIN NIVEL EXACTO → `SIN_CORRESPONDENCIA`, y quien llama cobra el precio base.
 * **No se redondea al nivel más cercano**, ni hacia abajo ni hacia arriba, y es
 * una decisión, no una omisión:
 *
 *   - Hacia abajo cobra de menos en silencio, que es el problema que se
 *     intentaba resolver.
 *   - Hacia arriba sorprende al cliente con un precio que nadie configuró para
 *     su vehículo, y es la clase de cobro que cuesta la confianza.
 *
 * Caer al precio base es honesto —es el precio que la oferta publicó— y deja el
 * desajuste visible en `SIN_CORRESPONDENCIA` para que se arregle en vez de
 * enterrarse.
 *
 * Una categoría DESACTIVADA se ignora, igual que ya hace el motor de
 * elegibilidad (`elegibilidad/index.ts:53-75`): dar de baja una categoría tiene
 * que dejar de cobrar por ella, no seguir cobrando desde el archivo.
 */
export function casarCategoria<T extends CategoriaDePlataforma>(
  categorias: readonly T[],
  nivelDelVehiculo: number | null,
  motivoSinNivel: Extract<OrigenCategoria, 'SIN_VEHICULO' | 'SIN_CATEGORIA'> = 'SIN_VEHICULO'
): CategoriaResuelta<T> {
  if (nivelDelVehiculo == null) return { categoria: null, origen: motivoSinNivel }

  const exacta = categorias.find((c) => c.activo && c.nivelTarifario === nivelDelVehiculo)
  if (exacta) return { categoria: exacta, origen: 'EXACTA' }

  return { categoria: null, origen: 'SIN_CORRESPONDENCIA' }
}

/**
 * Lo que se le cuenta a un operador sobre por qué una compra cobró lo que
 * cobró. Nunca se le muestra al cliente: a él se le dice el precio, no la
 * mecánica.
 */
export const ORIGEN_CATEGORIA_LABEL: Record<OrigenCategoria, string> = {
  EXACTA: 'Precio de su categoría de vehículo',
  SIN_VEHICULO: 'Precio base: el cliente no indicó vehículo',
  SIN_CATEGORIA: 'Precio base: su vehículo no tiene categoría asignada',
  SIN_CORRESPONDENCIA: 'Precio base: la categoría del vehículo está en un nivel que Membego no tiene configurado',
}

/**
 * Los motivos que señalan algo que ARREGLAR, frente a los que son normales.
 *
 * `SIN_VEHICULO` y `SIN_CATEGORIA` son estados legítimos y frecuentes —mucha
 * gente compra sin habernos contado qué carro tiene, y eso nunca debe impedir
 * una compra—. `SIN_CORRESPONDENCIA` es distinto: significa que una categoría
 * existe, está activa y tiene un nivel que nadie mapeó. Esa es la única que
 * delata configuración pendiente, y por eso se cuenta aparte.
 */
export function esDesajusteDeConfiguracion(origen: OrigenCategoria): boolean {
  return origen === 'SIN_CORRESPONDENCIA'
}
