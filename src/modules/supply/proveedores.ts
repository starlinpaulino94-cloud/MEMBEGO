import 'server-only'

import type { SupplyProveedorOrigen } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { capacidadesDeEmpresa } from '@/modules/capacidades/catalogo'

/**
 * MEMBEGO SUPPLY · PROVEEDORES (§5 del encargo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA IDENTIDAD, DOS ORÍGENES
 *
 * La identidad del proveedor sigue siendo `Company` con la capacidad
 * MEMBEGO_SUPPLIER: no se duplica la entidad (ADR-0001). Lo que faltaba era
 * lo que una relación comercial necesita saber y una empresa normal no tiene
 * —RNC, contacto de facturación, banco, plazo— y, sobre todo, el proveedor
 * que TODAVÍA NO usa Membego.
 *
 * Un proveedor EXTERNO es una `Company` mínima e INACTIVA (`isActive:false`,
 * `isPublished:false`) con la capacidad encendida y un perfil aquí. No sale en
 * el marketplace, nadie puede iniciar sesión en ella, y toda su historia
 * (acuerdos, órdenes, lotes, cuentas, liquidaciones) cuelga de ese `id`.
 * Convertirlo en empresa registrada es ACTIVAR esa misma `Company` y
 * onboardear a su administrador por el flujo normal de empresas: el historial
 * no se toca porque el id no cambia.
 */

export interface DatosPerfilProveedor {
  rnc?: string | null
  razonSocial?: string | null
  contactoNombre?: string | null
  contactoEmail?: string | null
  contactoTelefono?: string | null
  banco?: string | null
  cuentaBancaria?: string | null
  tipoCuenta?: string | null
  plazoPagoDias?: number | null
  notas?: string | null
}

function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Da de alta un proveedor externo: la `Company` inactiva + su perfil.
 * Idempotente por nombre normalizado: dos altas del mismo nombre devuelven la
 * misma empresa en vez de crear dos proveedores «Litre Pizza».
 */
export async function registrarProveedorExterno(
  d: { nombre: string; tipo?: string | null; email?: string | null; telefono?: string | null; ciudad?: string | null } & DatosPerfilProveedor,
  creadoPorId?: string | null
): Promise<{ companyId: string; perfilId: string; reutilizado: boolean }> {
  const nombre = d.nombre.trim()
  if (!nombre) throw new Error('El proveedor necesita un nombre.')

  return sinEmpresa('Membego Supply: alta de un proveedor externo', async (tx) => {
    const base = slugify(nombre) || 'proveedor'
    const existente = await tx.supplyProveedor.findFirst({
      where: { origen: 'EXTERNA', company: { slug: { startsWith: `prov-${base}` }, name: { equals: nombre, mode: 'insensitive' } } },
      select: { id: true, companyId: true },
    })
    if (existente) return { companyId: existente.companyId, perfilId: existente.id, reutilizado: true }

    let slug = `prov-${base}`
    for (let n = 2; await tx.company.findUnique({ where: { slug }, select: { id: true } }); n++) {
      slug = `prov-${base}-${n}`
    }

    const company = await tx.company.create({
      data: {
        name: nombre,
        slug,
        type: d.tipo?.trim() || 'otro',
        isActive: false,
        isPublished: false,
        email: d.email?.trim() || null,
        telefono: d.telefono?.trim() || null,
        ciudad: d.ciudad?.trim() || null,
        razonSocial: d.razonSocial?.trim() || null,
        capacidades: { overrides: { MEMBEGO_SUPPLIER: true } },
      },
      select: { id: true },
    })
    const perfil = await tx.supplyProveedor.create({
      data: {
        companyId: company.id,
        origen: 'EXTERNA',
        ...limpiarPerfil(d),
        creadoPorId: creadoPorId ?? null,
      },
      select: { id: true },
    })
    return { companyId: company.id, perfilId: perfil.id, reutilizado: false }
  })
}

function limpiarPerfil(d: DatosPerfilProveedor) {
  const t = (v: string | null | undefined) => (v?.trim() ? v.trim() : null)
  return {
    rnc: t(d.rnc),
    razonSocial: t(d.razonSocial),
    contactoNombre: t(d.contactoNombre),
    contactoEmail: t(d.contactoEmail),
    contactoTelefono: t(d.contactoTelefono),
    banco: t(d.banco),
    cuentaBancaria: t(d.cuentaBancaria),
    tipoCuenta: t(d.tipoCuenta),
    plazoPagoDias: d.plazoPagoDias != null && Number.isInteger(d.plazoPagoDias) && d.plazoPagoDias >= 0 ? d.plazoPagoDias : null,
    notas: t(d.notas),
  }
}

/** Crea o actualiza el perfil de una empresa que ya es proveedora. */
export async function guardarPerfilProveedor(
  companyId: string,
  d: DatosPerfilProveedor & { activo?: boolean },
  creadoPorId?: string | null
): Promise<{ perfilId: string }> {
  return sinEmpresa('Membego Supply: perfil de un proveedor', async (tx) => {
    const empresa = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true, isActive: true, type: true, tipoNegocioCodigo: true, capacidades: true },
    })
    if (!empresa) throw new Error('Empresa no encontrada.')
    if (!capacidadesDeEmpresa(empresa).activas.has('MEMBEGO_SUPPLIER')) {
      throw new Error('Esta empresa no tiene encendida la capacidad de proveedora de Membego.')
    }
    const perfil = await tx.supplyProveedor.upsert({
      where: { companyId },
      create: {
        companyId,
        origen: empresa.isActive ? 'REGISTRADA' : 'EXTERNA',
        ...limpiarPerfil(d),
        activo: d.activo ?? true,
        creadoPorId: creadoPorId ?? null,
      },
      update: { ...limpiarPerfil(d), ...(d.activo != null ? { activo: d.activo } : {}) },
      select: { id: true },
    })
    return { perfilId: perfil.id }
  })
}

/**
 * Un proveedor externo pasa a empresa registrada: se activa la MISMA
 * `Company`. Sus usuarios se dan de alta por el flujo normal de empresas
 * (`/superadmin/empresas`); aquí solo se levanta la marca y se anota cuándo.
 */
export async function convertirProveedorEnEmpresa(companyId: string): Promise<void> {
  await sinEmpresa('Membego Supply: convertir un proveedor externo en empresa registrada', async (tx) => {
    const perfil = await tx.supplyProveedor.findUnique({ where: { companyId }, select: { origen: true } })
    if (!perfil) throw new Error('Este proveedor no tiene perfil.')
    if (perfil.origen === 'REGISTRADA') throw new Error('Este proveedor ya es una empresa registrada.')
    await tx.company.update({ where: { id: companyId }, data: { isActive: true } })
    await tx.supplyProveedor.update({
      where: { companyId },
      data: { origen: 'REGISTRADA', convertidoAt: new Date() },
    })
  })
}

export interface ProveedorElegible {
  id: string
  nombre: string
  origen: SupplyProveedorOrigen
  activo: boolean
  sucursales: { id: string; nombre: string }[]
}

/**
 * Las empresas con las que Membego PUEDE contratar: toda `Company` con la
 * capacidad encendida, esté activa (registrada) o no (externa). El hallazgo H8
 * de la auditoría: exigir `isActive` dejaba fuera al proveedor externo.
 */
export async function proveedoresElegibles(): Promise<ProveedorElegible[]> {
  return sinEmpresa('Membego Supply: proveedores con los que se puede contratar', async (tx) => {
    const empresas = await tx.company.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        tipoNegocioCodigo: true,
        capacidades: true,
        isActive: true,
        supplyPerfilProveedor: { select: { origen: true, activo: true } },
        sucursales: { where: { activa: true }, select: { id: true, nombre: true } },
      },
    })
    return empresas
      .filter((e) => capacidadesDeEmpresa(e).activas.has('MEMBEGO_SUPPLIER'))
      .filter((e) => e.supplyPerfilProveedor?.activo !== false)
      .map((e) => ({
        id: e.id,
        nombre: e.name,
        origen: e.supplyPerfilProveedor?.origen ?? (e.isActive ? 'REGISTRADA' : 'EXTERNA'),
        activo: e.supplyPerfilProveedor?.activo ?? true,
        sucursales: e.sucursales,
      }))
  })
}

export async function perfilDeProveedor(companyId: string) {
  return sinEmpresa('Membego Supply: ficha de un proveedor', (tx) =>
    tx.supplyProveedor.findUnique({
      where: { companyId },
      include: { company: { select: { name: true, isActive: true, email: true, telefono: true, ciudad: true } } },
    })
  )
}
