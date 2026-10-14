import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import type { ContextoAuditoria } from './auditoria'
import { MAX_LINEAS_IMPORTACION } from './entradas'
import { indexarCatalogo, leerImportacion, validarImportacion, type FilaCsv, type InformeImportacion, type VarianteImportable } from './importacion'
import { importarConteoEnTx, registrarEntradaMultipleEnTx, type ResultadoEntradaMultiple, type ResultadoImportarConteo } from './service'

/**
 * COMMERCE CORE · inventario — INV-2a: importar existencias desde un CSV (la
 * parte que SÍ habla con la base).
 *
 * El texto del archivo llega al servidor dos veces: para la vista previa y para
 * aplicar. Aplicar NO reutiliza la vista previa: vuelve a leer y a validar todo
 * contra el catálogo de ESE momento (un producto pudo dejar de controlar
 * inventario entre un paso y otro) y recién entonces escribe, todo o nada, por
 * la misma entrada múltiple que la captura a mano.
 */

/** Los productos de la empresa que el archivo menciona (por SKU o por código de barras), sin importar mayúsculas. */
export async function resolverCatalogoDeImportacionEnTx(tx: Tx, companyId: string, filas: readonly FilaCsv[]): Promise<VarianteImportable[]> {
  const skus = [...new Set(filas.map((f) => f.sku?.toLowerCase()).filter((x): x is string => Boolean(x)))]
  const codigos = [...new Set(filas.map((f) => f.barcode?.toLowerCase()).filter((x): x is string => Boolean(x)))]
  if (skus.length === 0 && codigos.length === 0) return []
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "catalog_variants"
     WHERE "companyId" = ${companyId} AND (lower("sku") = ANY(${skus}) OR lower("barcode") = ANY(${codigos}))`
  if (ids.length === 0) return []
  const vs = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: ids.map((r) => r.id) } },
    select: { id: true, sku: true, barcode: true, name: true, isDefault: true, status: true, item: { select: { name: true, type: true, capabilities: true } } },
  })
  return vs.map((v) => ({
    id: v.id,
    sku: v.sku,
    barcode: v.barcode,
    nombre: v.isDefault ? v.item.name : `${v.item.name} · ${v.name}`,
    controlaInventario: normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory,
    descontinuada: v.status === 'DISCONTINUED',
  }))
}

export type ResultadoInforme = { ok: true; informe: InformeImportacion } | { ok: false; error: string }

/** Lee y valida el archivo contra el catálogo de la empresa, sin escribir nada. */
export async function informeDeImportacionEnTx(tx: Tx, companyId: string, texto: unknown, opciones: { permitirCostos?: boolean } = {}): Promise<ResultadoInforme> {
  const lectura = leerImportacion(texto)
  if (!lectura.ok) return { ok: false, error: lectura.error }
  // Un archivo con más filas que el tope se informa SIN consultar el catálogo.
  const catalogo = lectura.filas.length > MAX_LINEAS_IMPORTACION ? [] : await resolverCatalogoDeImportacionEnTx(tx, companyId, lectura.filas)
  return { ok: true, informe: validarImportacion(lectura.filas, indexarCatalogo(catalogo), 'ENTRADA', opciones) }
}

export type ResultadoAplicacion = { aplicada: true; entrada: ResultadoEntradaMultiple } | { aplicada: false; informe: InformeImportacion }

/**
 * Aplica el archivo: si el informe tiene UN solo error no escribe nada y lo
 * devuelve; si está limpio, lo registra como una entrada de origen CSV.
 */
export async function aplicarImportacionEnTx(
  tx: Tx,
  companyId: string,
  e: { sucursalId: string; texto: unknown; referencia?: string | null; nota?: string | null; idempotencyKey?: string | null; permitirCostos?: boolean },
  ctx: ContextoAuditoria
): Promise<{ ok: true; resultado: ResultadoAplicacion } | { ok: false; error: string }> {
  const r = await informeDeImportacionEnTx(tx, companyId, e.texto, { permitirCostos: e.permitirCostos })
  if (!r.ok) return r
  if (!r.informe.ok) return { ok: true, resultado: { aplicada: false, informe: r.informe } }
  const entrada = await registrarEntradaMultipleEnTx(
    tx,
    companyId,
    { sucursalId: e.sucursalId, lineas: r.informe.lineas, referencia: e.referencia, nota: e.nota, origen: 'CSV', idempotencyKey: e.idempotencyKey, maxLineas: MAX_LINEAS_IMPORTACION },
    ctx
  )
  return { ok: true, resultado: { aplicada: true, entrada } }
}

// ── INV-2b · Importar lo contado en una hoja ─────────────────────────────────

/** Lee y valida la hoja contada contra el catálogo, sin escribir nada. Una celda vacía significa «no se contó». */
export async function informeDeConteoImportadoEnTx(tx: Tx, companyId: string, texto: unknown): Promise<ResultadoInforme> {
  const lectura = leerImportacion(texto, 'CONTEO')
  if (!lectura.ok) return { ok: false, error: lectura.error }
  const conValor = lectura.filas.filter((f) => f.cantidad !== '')
  // Un archivo con más filas contadas que el tope se informa SIN consultar el catálogo.
  const catalogo = conValor.length > MAX_LINEAS_IMPORTACION ? [] : await resolverCatalogoDeImportacionEnTx(tx, companyId, conValor)
  return { ok: true, informe: validarImportacion(lectura.filas, indexarCatalogo(catalogo), 'CONTEO') }
}

export type ResultadoAplicacionConteo = ({ aplicada: true } & ResultadoImportarConteo) | { aplicada: false; informe: InformeImportacion }

/**
 * Carga la hoja contada en el conteo abierto: si el informe tiene UN solo error
 * no escribe nada y lo devuelve; si está limpio, lo registra todo junto. Como
 * al aplicar entradas, NO reutiliza la revisión de antes: vuelve a leer y validar.
 */
export async function aplicarImportacionDeConteoEnTx(
  tx: Tx,
  companyId: string,
  e: { conteoId: string; texto: unknown },
  ctx: ContextoAuditoria
): Promise<{ ok: true; resultado: ResultadoAplicacionConteo } | { ok: false; error: string }> {
  const r = await informeDeConteoImportadoEnTx(tx, companyId, e.texto)
  if (!r.ok) return r
  if (!r.informe.ok) return { ok: true, resultado: { aplicada: false, informe: r.informe } }
  const resultado = await importarConteoEnTx(tx, companyId, { conteoId: e.conteoId, lineas: r.informe.lineas }, ctx)
  return { ok: true, resultado: { aplicada: true, ...resultado } }
}
