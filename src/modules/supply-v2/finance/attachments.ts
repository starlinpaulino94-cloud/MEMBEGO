import type { Tx } from '@/lib/tenant'
import { rutaValida } from '@/modules/storage/comprobantes'
import { fallo } from '../core/errores'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · adjuntos (§42): la factura (PDF/imagen) y el
 * comprobante del pago viven en el bucket PRIVADO `comprobantes` existente,
 * con el tipo `supply-v2` y la ruta firmada por el servidor para ESA entidad.
 * Aquí solo se guarda la ruta, después de comprobar que pertenece a la entidad.
 */
export type EntidadConAdjunto = 'factura' | 'pago'

export async function guardarAdjuntoEnTx(tx: Tx, entidad: EntidadConAdjunto, id: string, path: string): Promise<void> {
  if (!(await rutaValida('supply-v2', id, path))) fallo('RUTA_INVALIDA', 'La ruta del archivo no corresponde a esta entidad.')
  if (entidad === 'factura') {
    const f = await tx.supplyV2SupplierInvoice.findUnique({ where: { id }, select: { id: true } })
    if (!f) fallo('FACTURA_NO_ENCONTRADA', 'La factura no existe.')
    await tx.supplyV2SupplierInvoice.update({ where: { id }, data: { attachmentPath: path } })
  } else {
    const p = await tx.supplyV2SupplierPayment.findUnique({ where: { id }, select: { id: true } })
    if (!p) fallo('PAGO_NO_ENCONTRADO', 'El pago no existe.')
    await tx.supplyV2SupplierPayment.update({ where: { id }, data: { proofPath: path } })
  }
}
