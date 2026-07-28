/**
 * Tipos y constantes del almacenamiento de comprobantes.
 *
 * Viven APARTE de `comprobantes.ts` porque aquel lleva `'use server'`, y en un
 * archivo así solo se pueden exportar funciones asíncronas: una constante
 * exportada rompe el build. Separarlas también permite importarlas desde
 * componentes de cliente sin arrastrar el módulo de servidor entero.
 */

/** Bucket privado donde viven comprobantes de pago y adjuntos de soporte. */
export const BUCKET_COMPROBANTES = 'comprobantes'

/** A qué se adjunta el comprobante. Determina quién puede subirlo y verlo. */
export type TipoComprobante = 'membresia' | 'compra' | 'soporte'
