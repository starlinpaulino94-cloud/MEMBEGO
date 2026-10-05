import type { Prisma } from '@prisma/client'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'

type Tx = Prisma.TransactionClient

/**
 * MEMBEGO SUPPLY 2.0 · catálogo de categorías de vehículo de PLATAFORMA.
 *
 * Cuatro filas que se tocan una vez al año, pero que deciden cuánto se cobra:
 * cambiar el `nivelTarifario` de una categoría cambia qué vehículos caen en
 * ella y, por tanto, qué precio paga su dueño. Por eso todo cambio deja rastro
 * con el diff, igual que la edición de una oferta.
 *
 * NO hay borrado, solo baja lógica. Una oferta ya publicada puede tener un
 * precio colgado de esta categoría; borrarla reescribiría el pasado.
 */

export interface DatosCategoriaVehiculo {
  code: string
  nombre: string
  nivelTarifario: number
  orden?: number
  descripcion?: string | null
  iconoUrl?: string | null
}

/**
 * Reglas PURAS del catálogo. Lo que depende de la base —que el código o el
 * nivel ya existan— lo comprueba el servicio con sus unique; aquí solo la forma.
 */
export function validarCategoriaVehiculo(d: Partial<DatosCategoriaVehiculo>): string | null {
  if (d.code !== undefined) {
    const code = d.code.trim().toUpperCase()
    if (!code) return 'La categoría necesita un código.'
    if (code.length > 32) return 'El código es demasiado largo.'
    // Estable y legible porque viaja a semillas e informes: un código con
    // espacios o acentos se escribe distinto cada vez que alguien lo teclea.
    if (!/^[A-Z0-9_]+$/.test(code)) return 'El código solo admite letras sin acentos, números y guión bajo.'
  }
  if (d.nombre !== undefined) {
    if (!d.nombre.trim()) return 'La categoría necesita un nombre.'
    if (d.nombre.trim().length > 60) return 'El nombre es demasiado largo.'
  }
  if (d.nivelTarifario !== undefined) {
    if (!Number.isInteger(d.nivelTarifario) || d.nivelTarifario <= 0) {
      // El 0 y los negativos no son «antes del sedán»: son datos corruptos.
      return 'El nivel tarifario tiene que ser un entero mayor que cero.'
    }
    if (d.nivelTarifario > 999) return 'El nivel tarifario es demasiado alto.'
  }
  if (d.orden !== undefined && (!Number.isInteger(d.orden) || d.orden < 0)) {
    return 'El orden tiene que ser un entero positivo o cero.'
  }
  return null
}

function normalizar(d: DatosCategoriaVehiculo) {
  return {
    code: d.code.trim().toUpperCase(),
    nombre: d.nombre.trim(),
    nivelTarifario: d.nivelTarifario,
    orden: d.orden ?? 0,
    descripcion: d.descripcion?.trim() || null,
    iconoUrl: d.iconoUrl?.trim() || null,
  }
}

/**
 * Traduce el choque de un unique a un mensaje que diga qué hacer.
 *
 * Sin esto, poner dos categorías en el mismo nivel devuelve «Unique constraint
 * failed on the fields: (`nivelTarifario`)», que es cierto y no sirve de nada.
 * El nivel repetido es además el error más fácil de cometer aquí, porque es
 * justo lo que alguien intenta al reordenar el catálogo.
 */
function comoChoque(e: unknown): never {
  const codigo = (e as { code?: string })?.code
  const campos = String((e as { meta?: { target?: unknown } })?.meta?.target ?? '')
  if (codigo === 'P2002') {
    if (campos.includes('nivelTarifario')) {
      fallo('NIVEL_OCUPADO', 'Ya hay una categoría en ese nivel tarifario. Cada nivel resuelve a UNA categoría: cambia el nivel de la otra primero.')
    }
    if (campos.includes('code')) fallo('CODIGO_OCUPADO', 'Ya existe una categoría con ese código.')
    if (campos.includes('nombre')) fallo('NOMBRE_OCUPADO', 'Ya existe una categoría con ese nombre.')
  }
  throw e
}

export async function crearCategoriaVehiculoEnTx(
  tx: Tx,
  d: DatosCategoriaVehiculo,
  ctx: ContextoAuditoria
): Promise<{ id: string; code: string }> {
  const error = validarCategoriaVehiculo(d)
  if (error) fallo('CATEGORIA_INVALIDA', error)
  const data = normalizar(d)
  try {
    const c = await tx.supplyV2VehicleCategory.create({ data })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED', 'SupplyV2VehicleCategory', c.id, {
      que: 'CREADA',
      code: c.code,
      nombre: c.nombre,
      nivelTarifario: c.nivelTarifario,
    })
    return { id: c.id, code: c.code }
  } catch (e) {
    comoChoque(e)
  }
}

/**
 * Edita una categoría. Ausente = no se toca; el `code` NO se edita nunca:
 * viaja a semillas e informes, y cambiarlo rompería la correspondencia con lo
 * que ya se escribió fuera de la base.
 */
export async function editarCategoriaVehiculoEnTx(
  tx: Tx,
  id: string,
  d: Partial<Omit<DatosCategoriaVehiculo, 'code'>> & { activo?: boolean },
  ctx: ContextoAuditoria
): Promise<{ id: string; cambios: string[] }> {
  const actual = await tx.supplyV2VehicleCategory.findUnique({ where: { id } })
  if (!actual) fallo('CATEGORIA_NO_ENCONTRADA', 'Esa categoría de vehículo no existe.')

  const error = validarCategoriaVehiculo(d)
  if (error) fallo('CATEGORIA_INVALIDA', error)

  const data: Prisma.SupplyV2VehicleCategoryUpdateInput = {}
  const cambios: string[] = []
  const anota = (campo: string, antes: unknown, despues: unknown) => {
    if (String(antes ?? '') !== String(despues ?? '')) cambios.push(campo)
  }

  if (d.nombre !== undefined) { anota('nombre', actual.nombre, d.nombre.trim()); data.nombre = d.nombre.trim() }
  if (d.nivelTarifario !== undefined) { anota('nivel tarifario', actual.nivelTarifario, d.nivelTarifario); data.nivelTarifario = d.nivelTarifario }
  if (d.orden !== undefined) { anota('orden', actual.orden, d.orden); data.orden = d.orden }
  if (d.descripcion !== undefined) { anota('descripción', actual.descripcion, d.descripcion?.trim() || null); data.descripcion = d.descripcion?.trim() || null }
  if (d.iconoUrl !== undefined) { anota('icono', actual.iconoUrl, d.iconoUrl?.trim() || null); data.iconoUrl = d.iconoUrl?.trim() || null }
  if (d.activo !== undefined) { anota('activa', actual.activo, d.activo); data.activo = d.activo }

  if (cambios.length === 0) return { id: actual.id, cambios: [] }

  try {
    await tx.supplyV2VehicleCategory.update({ where: { id: actual.id }, data })
  } catch (e) {
    comoChoque(e)
  }
  // El nivel es el que decide cobros, así que el rastro guarda su antes y su
  // después explícitos: «cambió el nivel» no sirve para reconstruir un recibo.
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED', 'SupplyV2VehicleCategory', actual.id, {
    que: 'EDITADA',
    code: actual.code,
    cambios,
    ...(d.nivelTarifario !== undefined && d.nivelTarifario !== actual.nivelTarifario
      ? { nivelAntes: actual.nivelTarifario, nivelDespues: d.nivelTarifario }
      : {}),
    ...(d.activo !== undefined && d.activo !== actual.activo ? { activaAntes: actual.activo, activaDespues: d.activo } : {}),
  })
  return { id: actual.id, cambios }
}
