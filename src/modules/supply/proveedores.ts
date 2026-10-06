import 'server-only'

import type { Prisma } from '@prisma/client'

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
  whatsapp?: string | null
  direccion?: string | null
  pais?: string | null
  moneda?: string | null
  condicionesPago?: string | null
  documentos?: string[]
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
    whatsapp: t(d.whatsapp),
    direccion: t(d.direccion),
    pais: t(d.pais),
    moneda: t(d.moneda)?.toUpperCase().slice(0, 3) ?? 'DOP',
    condicionesPago: t(d.condicionesPago),
    ...(d.documentos ? { documentos: d.documentos.filter(Boolean).slice(0, 20) } : {}),
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


// ── Empresa existente → proveedora (encargo 2026-09 bis, §1) ────────────────

export interface EmpresaHabilitable {
  id: string
  nombre: string
  slug: string
  tipo: string
}

/** Empresas activas que todavía NO son proveedoras: las candidatas a «Nuevo proveedor → empresa existente». */
export async function empresasParaHabilitar(limite = 300): Promise<EmpresaHabilitable[]> {
  return sinEmpresa('Membego Supply: empresas que podrían ser proveedoras', async (tx) => {
    const empresas = await tx.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: limite,
      select: { id: true, name: true, slug: true, type: true, tipoNegocioCodigo: true, capacidades: true },
    })
    return empresas
      .filter((e) => !capacidadesDeEmpresa(e).activas.has('MEMBEGO_SUPPLIER'))
      .map((e) => ({ id: e.id, nombre: e.name, slug: e.slug, tipo: e.tipoNegocioCodigo ?? e.type }))
  })
}

/**
 * Relaciona una empresa YA registrada como proveedora de Membego: enciende la
 * capacidad `MEMBEGO_SUPPLIER` (override sobre su paquete, conservando el
 * resto de su configuración) y crea su perfil con origen REGISTRADA. No se
 * duplica la empresa: es la misma `Company` con una capacidad más.
 */
export async function habilitarProveedorExistente(
  companyId: string,
  d: DatosPerfilProveedor,
  creadoPorId?: string | null
): Promise<{ perfilId: string; yaEra: boolean }> {
  return sinEmpresa('Membego Supply: habilitar una empresa existente como proveedora', async (tx) => {
    const empresa = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true, isActive: true, type: true, tipoNegocioCodigo: true, capacidades: true },
    })
    if (!empresa) throw new Error('Empresa no encontrada.')
    const yaEra = capacidadesDeEmpresa(empresa).activas.has('MEMBEGO_SUPPLIER')
    if (!yaEra) {
      const actual = (empresa.capacidades ?? {}) as Record<string, unknown>
      const overrides = { ...((actual.overrides as Record<string, unknown> | undefined) ?? {}), MEMBEGO_SUPPLIER: true }
      await tx.company.update({
        where: { id: companyId },
        data: { capacidades: { ...actual, overrides } as Prisma.InputJsonValue },
      })
    }
    const perfil = await tx.supplyProveedor.upsert({
      where: { companyId },
      create: { companyId, origen: 'REGISTRADA', ...limpiarPerfil(d), creadoPorId: creadoPorId ?? null },
      update: { ...limpiarPerfil(d), activo: true },
      select: { id: true },
    })
    return { perfilId: perfil.id, yaEra }
  })
}

// ── KPIs del perfil (§2) ────────────────────────────────────────────────────

export interface KpisProveedor {
  totalComprado: number
  totalPagado: number
  unidadesDisponibles: number
  unidadesConsumidas: number
  unidadesVencidas: number
  valorDisponible: number
  valorConsumido: number
  valorVencido: number
  /** Membego → proveedor (saldo del ledger a favor del proveedor). */
  deudaMembego: number
  /** Proveedor → Membego (cuentas por cobrar vivas). */
  deudaProveedor: number
  redenciones: number
  incidenciasAbiertas: number
  ventasEntregadas: number
  ventasBruto: number
  comisionMembego: number
}

export async function kpisDeProveedor(companyId: string): Promise<KpisProveedor> {
  return sinEmpresa('Membego Supply: KPIs de un proveedor', async (tx) => {
    const [lotes, pagos, asientos, cxc, redenciones, incidencias, ventas] = await Promise.all([
      tx.supplyLote.findMany({
        where: { proveedorId: companyId },
        select: { compradas: true, disponibles: true, asignadas: true, retenidas: true, redimidas: true, cerradas: true, snapshotCostoUnitario: true },
      }),
      tx.supplyPago.aggregate({ where: { proveedorId: companyId, estado: 'CONFIRMADO', tipo: { not: 'REEMBOLSO' } }, _sum: { monto: true } }),
      tx.supplyAsientoFinanciero.aggregate({ where: { proveedorId: companyId, tipo: { not: 'COMPROMISO_COMPRA' } }, _sum: { monto: true } }),
      tx.supplyCuentaPorCobrar.findMany({ where: { proveedorId: companyId, estado: { in: ['ABIERTA', 'PARCIALMENTE_SALDADA'] } }, select: { montoNeto: true, montoSaldado: true } }),
      tx.supplyRedencion.count({ where: { proveedorId: companyId, reversadaAt: null } }),
      tx.supplyIncidencia.count({ where: { proveedorId: companyId, estado: { in: ['ABIERTA', 'EN_REVISION', 'ESPERANDO_PROVEEDOR', 'ESPERANDO_CLIENTE'] } } }),
      tx.supplyVentaDirecta.findMany({ where: { proveedorId: companyId, estado: 'ENTREGADA' }, select: { montoBruto: true, comisionMonto: true } }),
    ])
    const r2 = (n: number) => Number(n.toFixed(2))
    let totalComprado = 0, uDisp = 0, uCons = 0, uVenc = 0, vDisp = 0, vCons = 0, vVenc = 0
    for (const l of lotes) {
      const c = Number(l.snapshotCostoUnitario)
      totalComprado += l.compradas * c
      uDisp += l.disponibles + l.asignadas + l.retenidas
      vDisp += (l.disponibles + l.asignadas + l.retenidas) * c
      uCons += l.redimidas
      vCons += l.redimidas * c
      uVenc += l.cerradas
      vVenc += l.cerradas * c
    }
    const saldo = Number(asientos._sum.monto ?? 0)
    return {
      totalComprado: r2(totalComprado),
      totalPagado: r2(Number(pagos._sum.monto ?? 0)),
      unidadesDisponibles: uDisp,
      unidadesConsumidas: uCons,
      unidadesVencidas: uVenc,
      valorDisponible: r2(vDisp),
      valorConsumido: r2(vCons),
      valorVencido: r2(vVenc),
      deudaMembego: r2(Math.max(0, saldo)),
      deudaProveedor: r2(Math.max(0, -saldo) + cxc.reduce((t, c) => t + Number(c.montoNeto) - Number(c.montoSaldado), 0)),
      redenciones,
      incidenciasAbiertas: incidencias,
      ventasEntregadas: ventas.length,
      ventasBruto: r2(ventas.reduce((t, v) => t + Number(v.montoBruto), 0)),
      comisionMembego: r2(ventas.reduce((t, v) => t + Number(v.comisionMonto), 0)),
    }
  })
}
