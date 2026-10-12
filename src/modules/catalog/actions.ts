'use server'

/**
 * COMMERCE CORE · catálogo — acciones (Fase 1, sin interfaz todavía).
 *
 * Todas detrás de `requireSection('catalogo', <función>)`: la capacidad
 * CATALOGO_UNIFICADO y los permisos por empleado gobiernan cada mutación. La
 * empresa sale SIEMPRE de la sesión (`resolveCompanyId`), nunca de lo que
 * mande el navegador, y todo corre en `conEmpresa`.
 *
 * Devuelven un resultado, no lanzan: el mensaje de un `CatalogoError` se
 * enseña tal cual; cualquier otro error se traduce a uno genérico para no
 * filtrar detalles de la base.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import type { CatalogItemStatus } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'
import { uniqueFileName } from '@/lib/storage'
import { rutaCatalogo } from '@/lib/storage-rutas'
import { detectarTipoImagen, EXTENSION_DE_IMAGEN, type TipoImagen } from '@/lib/imagen-tipo'
import { mensajeDeStorage } from '@/lib/storage-errores'
import { FORMATO_CATALOGO, baseDeVariantes, recorteDesde, rutaDeVariante, rutasDeVariantes } from '@/lib/imagen/formatos'
import { ErrorDeImagen, dimensionesOrientadas, generarVariantesCatalogo, type ResultadoVariantes } from './variantes-imagen'
import type { SessionUser } from '@/types'
import type { ContextoAuditoria } from './auditoria'
import type { DatosItem, DatosVariante } from './domain'
import { CatalogoError } from './errores'
import {
  actualizarItemEnTx,
  actualizarVarianteEnTx,
  agregarVarianteEnTx,
  cambiarEstadoItemEnTx,
  crearItemEnTx,
  eliminarVarianteEnTx,
  type CambiosItem,
  type CambiosVariante,
} from './service'
import {
  asignarCategoriasEnTx,
  crearCategoriaEnTx,
  eliminarCategoriaEnTx,
  eliminarImagenEnTx,
  leerImagenParaReencuadrarEnTx,
  reencuadrarImagenEnTx,
  exigirCupoDeImagen,
  ponerPortadaEnTx,
  prefijoImagenesItem,
  registrarImagenEnTx,
} from './medios'
import { urlImagenCatalogo } from './formato'

export type ResultadoCatalogo<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/admin/catalogo'

/**
 * Tras cualquier cambio: el panel se refresca y la VITRINA PÚBLICA también
 * (publicar, pausar, cambiar un precio o una foto debe verse en segundos, no
 * esperar el TTL de la caché del marketplace).
 */
function refrescar() {
  revalidatePath(RUTA)
  revalidateTag(MARKETPLACE_TAG, 'max')
}
const ESTADOS: readonly CatalogItemStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function contexto(
  funcion: string
): Promise<{ user: SessionUser; companyId: string; ctx: ContextoAuditoria } | { error: string }> {
  const user = await requireSection('catalogo', funcion)
  if (!user) return { error: 'No autorizado.' }
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  const meta = await getRequestMeta()
  return { user, companyId, ctx: { actorId: user.metadata.dbUserId ?? null, ...meta } }
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof CatalogoError) return { ok: false, error: e.message }
  console.error('[catalogo]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

export async function crearItemCatalogo(
  entrada: DatosItem
): Promise<ResultadoCatalogo<{ id: string; slug: string }>> {
  const c = await contexto('crear')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => crearItemEnTx(tx, c.companyId, entrada, c.ctx))
    refrescar()
    return { ok: true, id: r.id, slug: r.slug }
  } catch (e) {
    return aError(e)
  }
}

export async function actualizarItemCatalogo(itemId: string, cambios: CambiosItem): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !esObjeto(cambios)) return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => actualizarItemEnTx(tx, c.companyId, itemId, cambios, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Publicar, pausar, archivar o restaurar. La función de permiso depende del
 * destino (archivar y publicar se conceden por separado), así que el destino
 * se valida ANTES de pedir la guardia.
 */
export async function cambiarEstadoItemCatalogo(itemId: string, estado: CatalogItemStatus): Promise<ResultadoCatalogo> {
  if (typeof itemId !== 'string' || !ESTADOS.includes(estado)) return { ok: false, error: 'Datos no válidos.' }
  // Archivar y publicar se conceden por separado; restaurar a borrador es editar.
  const funcion = estado === 'ARCHIVED' ? 'archivar' : estado === 'DRAFT' ? 'editar' : 'publicar'
  const c = await contexto(funcion)
  if ('error' in c) return { ok: false, error: c.error }
  try {
    await conEmpresa(c.companyId, (tx) => cambiarEstadoItemEnTx(tx, c.companyId, itemId, estado, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function agregarVarianteCatalogo(
  itemId: string,
  datos: DatosVariante
): Promise<ResultadoCatalogo<{ id: string; sku: string }>> {
  const c = await contexto('variante')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !esObjeto(datos)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => agregarVarianteEnTx(tx, c.companyId, itemId, datos, c.ctx))
    refrescar()
    return { ok: true, id: r.id, sku: r.sku }
  } catch (e) {
    return aError(e)
  }
}

export async function actualizarVarianteCatalogo(
  varianteId: string,
  cambios: CambiosVariante
): Promise<ResultadoCatalogo> {
  const c = await contexto('variante')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof varianteId !== 'string' || !esObjeto(cambios)) return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => actualizarVarianteEnTx(tx, c.companyId, varianteId, cambios, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function eliminarVarianteCatalogo(varianteId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('variante')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof varianteId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => eliminarVarianteEnTx(tx, c.companyId, varianteId, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

// ── Imágenes ─────────────────────────────────────────────────────────────────

const BUCKET = 'promociones'
const MAX_MB = 5
const MAX_BYTES = MAX_MB * 1024 * 1024
const TIPOS_IMAGEN = Object.keys(EXTENSION_DE_IMAGEN) as TipoImagen[]

/**
 * SUBIDA DE IMÁGENES EN DOS PASOS, SIN PASAR EL ARCHIVO POR EL SERVIDOR.
 *
 * Antes el archivo entero viajaba dentro de la Server Action y el servidor lo
 * reenviaba a Storage. Eso duplicaba el tráfico y, peor, dependía de límites
 * de transporte que no controla el código (el de la plataforma de despliegue
 * es menor que los 5 MB que admite el formulario): la petición moría antes de
 * llegar a la validación y el panel solo decía «No se pudo subir la imagen».
 *
 * Ahora, igual que los comprobantes de pago (`modules/storage/subidas.ts`):
 *
 *   1. `prepararSubidaImagenCatalogo` autoriza (sesión, permiso, empresa de la
 *      sesión, ítem editable, cupo) y devuelve una URL firmada de un solo uso
 *      para UNA ruta que decide el servidor (`<empresa>/catalogo/<ítem>/…`).
 *   2. El navegador sube el archivo directamente a Storage con ese token. El
 *      token no sirve para ninguna otra ruta, y el bucket impone el tamaño y
 *      los tipos permitidos.
 *   3. `confirmarImagenCatalogo` vuelve a autorizar, lee el objeto subido,
 *      decide el tipo por la FIRMA del archivo (no por lo que dijo el
 *      navegador), y solo entonces registra la fila. Si algo no cuadra, borra
 *      el objeto: no quedan huérfanos ni archivos sin fila.
 *
 * Storage se usa con la SESIÓN de quien sube, no con la clave de servicio: la
 * política del bucket (`membego_medio_propio`) comprueba que la ruta sea de su
 * empresa, así que ni la firma ni la lectura necesitan saltarse RLS. Antes se
 * firmaba con la clave de servicio, y si esa variable no era de verdad
 * `service_role` Storage respondía «new row violates row-level security policy»
 * sin que el panel pudiera distinguirlo de cualquier otro fallo. El cliente se
 * crea DESPUÉS de autorizar, como siempre.
 */
export async function prepararSubidaImagenCatalogo(
  itemId: string,
  tipoDeclarado: string
): Promise<ResultadoCatalogo<{ path: string; token: string }>> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !itemId) return { ok: false, error: 'Datos no válidos.' }
  // El tipo declarado solo elige la extensión del nombre; el tipo que vale lo
  // decide `confirmarImagenCatalogo` leyendo los bytes.
  const tipo = TIPOS_IMAGEN.find((t) => t === tipoDeclarado)
  if (!tipo) return { ok: false, error: 'Formato no permitido. Usa JPG, PNG o WebP.' }

  try {
    await conEmpresa(c.companyId, (tx) => exigirCupoDeImagen(tx, c.companyId, itemId))
    const path = rutaCatalogo(c.companyId, itemId, uniqueFileName(EXTENSION_DE_IMAGEN[tipo]))
    const supabase = await createServerClient()
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      console.error('[catalogo-imagen] createSignedUploadUrl:', error?.message)
      return { ok: false, error: mensajeDeStorage(error, { maxMb: MAX_MB }) }
    }
    return { ok: true, path: data.path, token: data.token }
  } catch (e) {
    return aError(e)
  }
}

type Almacen = Awaited<ReturnType<typeof createServerClient>>['storage']

/**
 * Sube las versiones de una foto bajo un prefijo NUEVO. Si alguna falla, borra
 * las que ya subió y relanza: nunca quedan versiones a medias en el bucket.
 * Caché de un año: el nombre lleva un token propio y no se reutiliza jamás.
 */
async function subirVariantes(almacen: Almacen, base: string, generadas: ResultadoVariantes['variantes']): Promise<void> {
  const subidas: string[] = []
  try {
    for (const v of generadas) {
      const ruta = rutaDeVariante(base, v.nombre)
      const { error } = await almacen
        .from(BUCKET)
        .upload(ruta, v.buffer, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
      if (error) {
        console.error('[catalogo-imagen] subir versión:', error.message)
        throw error
      }
      subidas.push(ruta)
    }
  } catch (e) {
    await almacen.from(BUCKET).remove(subidas).catch(() => undefined)
    throw e
  }
}

/** Traduce lo que puede fallar al procesar una foto a algo que se le pueda decir a quien sube. */
function mensajeDeProcesado(e: unknown): string {
  if (e instanceof ErrorDeImagen) return e.message
  const texto = e instanceof Error ? e.message : ''
  if (/pixel limit/i.test(texto)) return 'La imagen es demasiado grande (máximo 40 megapíxeles). Reduce su tamaño e inténtalo de nuevo.'
  if (/unsupported image format|corrupt|bad seek|VipsJpeg|not a valid/i.test(texto)) {
    return 'No se pudo leer la imagen. Prueba con otro archivo.'
  }
  return mensajeDeStorage(e, { maxMb: MAX_MB })
}

/**
 * Tercer paso de la subida. `recorte` es el encuadre que eligió la persona en
 * el editor (píxeles del original ya orientado). Sin él —un navegador con la
 * pestaña abierta de antes del editor— se centra el encuadre más grande, que
 * es lo que mostraba la ficha hasta ahora.
 */
export async function confirmarImagenCatalogo(
  itemId: string,
  path: string,
  recorte?: unknown
): Promise<ResultadoCatalogo<{ id: string; url: string | null }>> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !itemId) return { ok: false, error: 'Datos no válidos.' }
  // La ruta debe ser la que ESTE servidor emitió para ESTE ítem de ESTA empresa.
  if (typeof path !== 'string' || !path.startsWith(prefijoImagenesItem(c.companyId, itemId)) || path.includes('..')) {
    return { ok: false, error: 'La ruta de la imagen no corresponde a este producto.' }
  }

  const supabase = await createServerClient()
  const almacen = supabase.storage
  const descartar = (rutas: string[]) => almacen.from(BUCKET).remove(rutas).catch(() => undefined)
  try {
    const { data, error } = await almacen.from(BUCKET).download(path)
    if (error || !data) {
      console.error('[catalogo-imagen] download:', error?.message)
      return { ok: false, error: mensajeDeStorage(error, { maxMb: MAX_MB }) }
    }
    const buffer = Buffer.from(await data.arrayBuffer())
    if (buffer.length > MAX_BYTES) {
      await descartar([path])
      return { ok: false, error: `La imagen no puede superar ${MAX_MB} MB.` }
    }
    const tipo = detectarTipoImagen(buffer)
    if (!tipo || !path.endsWith(`.${EXTENSION_DE_IMAGEN[tipo]}`)) {
      await descartar([path])
      return { ok: false, error: 'Formato no permitido. Usa JPG, PNG o WebP.' }
    }

    // Versiones: tarjeta, ficha y compartir, desde el original y el encuadre.
    let generado: ResultadoVariantes
    try {
      let encuadre = recorte
      if (encuadre === undefined || encuadre === null) {
        const { ancho, alto } = await dimensionesOrientadas(buffer)
        encuadre = recorteDesde(ancho, alto, FORMATO_CATALOGO.aspecto)
      }
      generado = await generarVariantesCatalogo(buffer, encuadre)
    } catch (e) {
      console.error('[catalogo-imagen] procesar:', e instanceof Error ? e.message : e)
      await descartar([path])
      return { ok: false, error: mensajeDeProcesado(e) }
    }
    const base = baseDeVariantes(path, randomBytes(4).toString('hex'))
    try {
      await subirVariantes(almacen, base, generado.variantes)
    } catch (e) {
      await descartar([path])
      return { ok: false, error: mensajeDeStorage(e, { maxMb: MAX_MB }) }
    }

    try {
      const r = await conEmpresa(c.companyId, (tx) =>
        registrarImagenEnTx(tx, c.companyId, itemId, path, null, c.ctx, {
          width: generado.ancho,
          height: generado.alto,
          crop: generado.recorte,
          variantesBase: base,
        })
      )
      refrescar()
      return { ok: true, id: r.id, url: urlImagenCatalogo({ path, variantesBase: base }, 'tarjeta') }
    } catch (e) {
      // Los archivos ya están en Storage y la fila no se pudo escribir: no dejar huérfanos.
      await descartar([path, ...rutasDeVariantes(base)])
      throw e
    }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Cambia el encuadre de una foto YA subida. Parte siempre del ORIGINAL, así que
 * reencuadrar mil veces no degrada nada. Las versiones nuevas se suben primero
 * y las viejas se borran al final: si algo falla a medias, la foto sigue
 * viéndose con su encuadre anterior.
 */
export async function reencuadrarImagenCatalogo(
  imagenId: string,
  recorte: unknown
): Promise<ResultadoCatalogo<{ url: string | null }>> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof imagenId !== 'string' || !imagenId) return { ok: false, error: 'Datos no válidos.' }
  try {
    const actual = await conEmpresa(c.companyId, (tx) => leerImagenParaReencuadrarEnTx(tx, c.companyId, imagenId))
    const almacen = (await createServerClient()).storage
    const { data, error } = await almacen.from(BUCKET).download(actual.path)
    if (error || !data) {
      console.error('[catalogo-imagen] download (reencuadre):', error?.message)
      return { ok: false, error: mensajeDeStorage(error, { maxMb: MAX_MB }) }
    }
    let generado: ResultadoVariantes
    try {
      generado = await generarVariantesCatalogo(Buffer.from(await data.arrayBuffer()), recorte)
    } catch (e) {
      console.error('[catalogo-imagen] procesar (reencuadre):', e instanceof Error ? e.message : e)
      return { ok: false, error: mensajeDeProcesado(e) }
    }
    const base = baseDeVariantes(actual.path, randomBytes(4).toString('hex'))
    try {
      await subirVariantes(almacen, base, generado.variantes)
    } catch (e) {
      return { ok: false, error: mensajeDeStorage(e, { maxMb: MAX_MB }) }
    }
    let anterior: string | null
    try {
      const r = await conEmpresa(c.companyId, (tx) =>
        reencuadrarImagenEnTx(
          tx,
          c.companyId,
          imagenId,
          { width: generado.ancho, height: generado.alto, crop: generado.recorte, variantesBase: base },
          c.ctx
        )
      )
      anterior = r.variantesBaseAnterior
    } catch (e) {
      await almacen.from(BUCKET).remove(rutasDeVariantes(base)).catch(() => undefined)
      throw e
    }
    // Solo se borra lo que cuelga del ítem de ESTA empresa.
    if (anterior && anterior.startsWith(prefijoImagenesItem(c.companyId, actual.itemId))) {
      await almacen.from(BUCKET).remove(rutasDeVariantes(anterior)).catch(() => undefined)
    }
    refrescar()
    return { ok: true, url: urlImagenCatalogo({ path: actual.path, variantesBase: base }, 'tarjeta') }
  } catch (e) {
    return aError(e)
  }
}

export async function eliminarImagenCatalogo(imagenId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof imagenId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    const { path, variantesBase, itemId } = await conEmpresa(c.companyId, async (tx) => {
      const imagen = await tx.catalogItemImage.findFirst({
        where: { id: imagenId, companyId: c.companyId },
        select: { catalogItemId: true },
      })
      const r = await eliminarImagenEnTx(tx, c.companyId, imagenId, c.ctx)
      return { path: r.path, variantesBase: r.variantesBase, itemId: imagen?.catalogItemId ?? '' }
    })
    // Solo se borra del bucket lo que cuelga del ítem de ESTA empresa: el original y sus versiones.
    const prefijo = prefijoImagenesItem(c.companyId, itemId)
    const rutas = [path, ...(variantesBase ? rutasDeVariantes(variantesBase) : [])].filter((r) => r.startsWith(prefijo))
    if (rutas.length > 0) {
      ;(await createServerClient()).storage.from(BUCKET).remove(rutas).catch(() => undefined)
    }
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function ponerPortadaCatalogo(imagenId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof imagenId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => ponerPortadaEnTx(tx, c.companyId, imagenId, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

// ── Categorías ───────────────────────────────────────────────────────────────

export async function crearCategoriaCatalogo(
  nombre: string
): Promise<ResultadoCatalogo<{ id: string; name: string }>> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => crearCategoriaEnTx(tx, c.companyId, nombre))
    refrescar()
    return { ok: true, id: r.id, name: r.name }
  } catch (e) {
    return aError(e)
  }
}

export async function eliminarCategoriaCatalogo(categoriaId: string): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof categoriaId !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => eliminarCategoriaEnTx(tx, c.companyId, categoriaId))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

export async function asignarCategoriasCatalogo(itemId: string, categoriaIds: string[]): Promise<ResultadoCatalogo> {
  const c = await contexto('editar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof itemId !== 'string' || !Array.isArray(categoriaIds)) return { ok: false, error: 'Datos no válidos.' }
  try {
    await conEmpresa(c.companyId, (tx) => asignarCategoriasEnTx(tx, c.companyId, itemId, categoriaIds, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}
