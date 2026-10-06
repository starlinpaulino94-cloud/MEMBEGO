import { randomBytes } from 'node:crypto'
import { hashearSecreto } from '../../src/modules/plataforma/credenciales'
import { prismaDeArnes } from './supply-v2-sesion'

/**
 * ARNÉS DE SIEMBRA · catálogo unificado (E2E).
 *
 * Siembra por Prisma lo que el recorrido NO debe hacer por la interfaz: las
 * empresas, sus capacidades y los ítems ya publicados que la vitrina y la API
 * leen. Lo que la prueba verifica (crear, editar, publicar) lo hace por la
 * interfaz, nunca por aquí.
 *
 * Todo lleva un sufijo propio de la corrida: dos corridas contra la misma base
 * no se pisan, y la base de CI nace vacía de todos modos.
 */

export interface EmpresaCatalogo {
  id: string
  slug: string
  name: string
}

export async function empresaCatalogo(
  sufijo: string,
  clave: string,
  o: { capacidad: boolean; publicada?: boolean }
): Promise<EmpresaCatalogo> {
  const slug = `e2e-cat-${clave}-${sufijo}`
  const name = `E2E Catálogo ${clave} ${sufijo}`
  const c = await prismaDeArnes().company.upsert({
    where: { slug },
    update: {},
    create: {
      name,
      slug,
      type: 'carwash',
      ciudad: 'Santo Domingo',
      isPublished: o.publicada ?? true,
      isActive: true,
      esDemo: false,
      // La capacidad se enciende por override ANTES de la primera petición: el
      // resolutor la cachea por empresa, y una empresa nueva no tiene caché.
      ...(o.capacidad ? { capacidades: { overrides: { CATALOGO_UNIFICADO: true } } } : {}),
    },
    select: { id: true },
  })
  return { id: c.id, slug, name }
}

export interface ItemSembrado {
  id: string
  slug: string
}

/** Ítem con sus variantes, creado en UNA transacción (la base exige ≥1 variante al confirmar). */
export async function itemSembrado(
  empresaId: string,
  d: {
    name: string
    slug: string
    status?: 'DRAFT' | 'ACTIVE' | 'PAUSED'
    marketplace?: boolean
    /** Producto físico que CONTROLA inventario (Fase 2). Sin esto, es un servicio. */
    controlaInventario?: boolean
    variantes: { name: string; sku: string; price: number; cost?: number; compareAt?: number; status?: 'ACTIVE' | 'OUT_OF_STOCK' | 'DISCONTINUED'; atributos?: Record<string, string>; porDefecto?: boolean }[]
  }
): Promise<ItemSembrado> {
  const status = d.status ?? 'ACTIVE'
  const prisma = prismaDeArnes()
  const previo = await prisma.catalogItem.findUnique({
    where: { companyId_slug: { companyId: empresaId, slug: d.slug } },
    select: { id: true, slug: true },
  })
  if (previo) return previo
  // Una transacción: el disparador diferido de la base rechaza un ítem sin
  // variantes AL CONFIRMAR, no al insertar.
  return prisma.$transaction(async (tx) => {
    const it = await tx.catalogItem.create({
      data: {
        companyId: empresaId,
        name: d.name,
        slug: d.slug,
        type: d.controlaInventario ? 'PHYSICAL_PRODUCT' : 'SERVICE',
        status,
        publishedAt: status === 'DRAFT' ? null : new Date(),
        capabilities: { availableMarketplace: d.marketplace ?? true, availablePOS: true, trackInventory: d.controlaInventario ?? false },
      },
      select: { id: true, slug: true },
    })
    await tx.catalogVariant.createMany({
      data: d.variantes.map((v, i) => ({
        companyId: empresaId,
        catalogItemId: it.id,
        name: v.name,
        sku: v.sku,
        price: v.price,
        cost: v.cost,
        compareAtPrice: v.compareAt,
        attributes: v.atributos ?? {},
        status: v.status ?? 'ACTIVE',
        isDefault: v.porDefecto ?? false,
        position: i,
      })),
    })
    return it
  })
}

/**
 * Clave de API de EMPRESA. Se inserta la fila directamente: el límite
 * `api_keys.max` (cero por defecto, se concede empresa a empresa) es una regla
 * del panel, no de la API que aquí se prueba.
 */
export async function claveApi(empresaId: string, scopes: string[]): Promise<string> {
  const prefijo = `mbk_${randomBytes(6).toString('hex')}`
  const secreto = randomBytes(32).toString('base64url')
  await prismaDeArnes().claveApiEmpresa.create({
    data: { companyId: empresaId, nombre: 'e2e catálogo', prefijo, secretoHash: hashearSecreto(secreto), scopes },
  })
  return `${prefijo}.${secreto}`
}

/** Una sucursal de la empresa (las existencias se llevan por sucursal). */
export async function sucursalSembrada(empresaId: string, nombre: string): Promise<{ id: string; nombre: string }> {
  const prisma = prismaDeArnes()
  const previa = await prisma.sucursal.findFirst({ where: { companyId: empresaId, nombre }, select: { id: true } })
  if (previa) return { id: previa.id, nombre }
  const s = await prisma.sucursal.create({ data: { companyId: empresaId, nombre }, select: { id: true } })
  return { id: s.id, nombre }
}

/** El id de la primera variante de un ítem sembrado. */
export async function varianteDe(itemId: string): Promise<string> {
  const v = await prismaDeArnes().catalogVariant.findFirstOrThrow({ where: { catalogItemId: itemId }, orderBy: { position: 'asc' }, select: { id: true } })
  return v.id
}
