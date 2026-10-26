import type { Prisma } from '@prisma/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { anotarFallo } from '@/lib/prisma-errors'
import { ensureSucursalPrincipal } from '@/modules/empresas/sucursalPrincipal'
import { filasDeAcceso } from '@/modules/empresas/accesos'
import { CAPACIDADES_OVERRIDE_TENANT_NUEVO } from '@/modules/capacidades/catalogo'

/**
 * EL ALTA DE UNA EMPRESA, EN UN SOLO SITIO (auditoría admin · fase 7, tarea 7.3; 04 · F-02).
 *
 * Tres caminos creaban una empresa con su administrador —el alta del superadmin, la solicitud aprobada y el registro público— y cada
 * uno repetía el mismo guion: un slug único, la empresa con sus capacidades de «tenant nuevo», su sucursal principal, la cuenta en
 * Supabase Auth, el usuario en la base, el rol en la sesión y, si algo fallaba, deshacerlo todo. Cada copia tenía su propio `slugify`
 * y su propio rollback, y se habían separado en lo pequeño: el registro público no escribía el vertical, la solicitud borraba la
 * empresa por otra vía que el alta del superadmin.
 *
 * Aquí vive ese guion, una vez. Cada camino sigue siendo dueño de lo que SOLO le toca: quién puede llamarlo, cómo se valida su
 * formulario, de dónde sale la contraseña y qué se hace al terminar (`alTerminar`, que corre DENTRO de la protección del rollback:
 * si falla, no queda una empresa a medias).
 *
 * Los efectos (base de datos y Supabase Auth) entran por `PuertosDeAlta` para poder probar lo que importa —el orden y el deshacer—
 * sin tocar ningún servicio. Los puertos reales están abajo.
 *
 * `duplicarEmpresa` NO usa esto a propósito: copia el perfil de una empresa que ya existe y nace inactiva y sin administrador; no es un
 * alta.
 */

/** Convierte un nombre en un slug apto para URL. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** El primer slug libre a partir del nombre: `nombre`, `nombre-2`, `nombre-3`… */
export async function slugLibre(nombre: string, existe: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(nombre) || 'empresa'
  let slug = base
  let n = 1
  while (await existe(slug)) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

/** Los campos opcionales del perfil: `undefined` = no se escribe (la columna conserva su valor por defecto); `null` = se escribe vacío. */
export interface DatosDeEmpresa {
  nombre: string
  /** Lo que se guarda en `type` (el código del vertical o un texto libre). */
  tipo: string
  /** El vertical, YA validado contra `tipos_negocio` (ver `verticalValido`). `null`/ausente = la empresa se resuelve como siempre. */
  tipoNegocioCodigo?: string | null
  descripcion?: string | null
  email?: string | null
  telefono?: string | null
  direccion?: string | null
  ciudad?: string | null
  pais?: string | null
  categoria?: string | null
  website?: string | null
  googleMapsUrl?: string | null
  horario?: string | null
  colorPrimario?: string | null
  logoUrl?: string | null
  bannerUrl?: string | null
  /** Empresa de entrenamiento: se marca solo cuando se pide (y todo lo que esa marca apaga hacia afuera sigue siendo cosa de `demo`). */
  esDemo?: boolean
  /** `false` = nace sin publicar (registro y solicitud). Ausente = el valor por defecto de la columna. */
  publicada?: boolean
  /** Categorías del directorio público. */
  categoryIds?: string[]
}

export type AdministradorDeAlta =
  | {
      /** Cuenta nueva: se crea el usuario en Supabase Auth y en la base. */
      modo: 'nuevo'
      nombre: string
      email: string
      password: string
      /** `false` = la cuenta nace sin confirmar el correo (registro público con verificación activada). */
      confirmarCorreo: boolean
      /** Lo que aceptó quien se registra por su cuenta. El alta que hace el superadmin no lo lleva. */
      consentimiento?: { terminosVersion: string; marketing: boolean; en: Date }
    }
  | {
      /** Cuenta existente: solo se le da ACCESO; no se le cambia su empresa activa ni se crea nada. */
      modo: 'existente'
      id: string
      companyId: string | null
    }

export interface ResultadoDeAlta {
  companyId: string
  slug: string
  /** Solo con cuenta nueva. */
  adminId?: string
}

export interface EntradaDeAlta {
  empresa: DatosDeEmpresa
  administrador: AdministradorDeAlta
  /**
   * Lo que cada camino hace al terminar (marcar la solicitud, mandar el correo de verificación…). Corre dentro de la protección del
   * rollback: si lanza, la empresa y la cuenta recién creadas se deshacen.
   */
  alTerminar?: (r: ResultadoDeAlta) => Promise<void>
}

/** Todo lo que el alta le pide al mundo. */
export interface PuertosDeAlta {
  slugOcupado(slug: string): Promise<boolean>
  crearEmpresa(data: Prisma.CompanyUncheckedCreateInput): Promise<{ id: string }>
  asegurarSucursalPrincipal(companyId: string): Promise<void>
  vincularCategorias(companyId: string, categoryIds: string[]): Promise<void>
  darAcceso(adminId: string, companyId: string, empresaActualDelAdmin: string | null): Promise<void>
  crearCuenta(c: { email: string; password: string; nombre: string; confirmarCorreo: boolean }): Promise<string>
  asegurarIdentidad(supabaseId: string, email: string): Promise<void>
  crearUsuario(companyId: string, u: { supabaseId: string; email: string; nombre: string; consentimiento?: { terminosVersion: string; marketing: boolean; en: Date } }): Promise<{ id: string }>
  fijarRolEnLaSesion(supabaseId: string, r: { dbUserId: string; companyId: string }): Promise<void>
  borrarCuenta(supabaseId: string): Promise<void>
  borrarEmpresa(companyId: string): Promise<void>
}

/** Los datos de la empresa tal como van a la base. Pura: se prueba sin servicios. */
export function datosParaLaBase(e: DatosDeEmpresa, slug: string): Prisma.CompanyUncheckedCreateInput {
  const opcionales: Partial<Prisma.CompanyUncheckedCreateInput> = {}
  const poner = <K extends keyof Prisma.CompanyUncheckedCreateInput>(clave: K, valor: Prisma.CompanyUncheckedCreateInput[K] | undefined) => {
    if (valor !== undefined) opcionales[clave] = valor
  }
  poner('description', e.descripcion)
  poner('email', e.email)
  poner('telefono', e.telefono)
  poner('direccion', e.direccion)
  poner('ciudad', e.ciudad)
  poner('pais', e.pais)
  poner('categoria', e.categoria)
  poner('website', e.website)
  poner('googleMapsUrl', e.googleMapsUrl)
  poner('horario', e.horario)
  poner('colorPrimario', e.colorPrimario)
  poner('logoUrl', e.logoUrl)
  poner('bannerUrl', e.bannerUrl)
  return {
    ...(e.esDemo ? { esDemo: true } : {}),
    name: e.nombre,
    slug,
    type: e.tipo,
    ...(e.tipoNegocioCodigo ? { tipoNegocioCodigo: e.tipoNegocioCodigo } : {}),
    ...opcionales,
    isActive: true,
    ...(e.publicada === false ? { isPublished: false } : {}),
    // Fase 0 (Plan Maestro §8.5–§8.6): un tenant nuevo nace sin CRM ni mensajería avanzada; las empresas existentes no se tocan.
    capacidades: { overrides: CAPACIDADES_OVERRIDE_TENANT_NUEVO },
  }
}

/**
 * Da de alta la empresa y su administrador. Si algo falla, deshace lo que alcanzó a crear —la cuenta de Auth (solo si ESTA llamada la
 * creó: una cuenta existente no se toca nunca) y la empresa— y vuelve a lanzar el error original para que cada camino lo registre y
 * conteste a su manera.
 */
export async function darDeAltaEmpresa(entrada: EntradaDeAlta, p: PuertosDeAlta = puertosReales): Promise<ResultadoDeAlta> {
  let companyId: string | null = null
  let supabaseId: string | null = null
  try {
    const slug = await slugLibre(entrada.empresa.nombre, (s) => p.slugOcupado(s))
    const company = await p.crearEmpresa(datosParaLaBase(entrada.empresa, slug))
    companyId = company.id

    // Toda empresa nace con su sucursal principal: la mayoría tiene un solo local y sin sucursal la Caja no puede cobrar.
    await p.asegurarSucursalPrincipal(company.id)

    const categoryIds = (entrada.empresa.categoryIds ?? []).filter(Boolean)
    if (categoryIds.length > 0) await p.vincularCategorias(company.id, categoryIds)

    const resultado: ResultadoDeAlta = { companyId: company.id, slug }
    const a = entrada.administrador
    if (a.modo === 'existente') {
      // Solo se le suma esta empresa a las que puede abrir (y se conserva su camino de vuelta a la de siempre).
      await p.darAcceso(a.id, company.id, a.companyId)
    } else {
      supabaseId = await p.crearCuenta({ email: a.email, password: a.password, nombre: a.nombre, confirmarCorreo: a.confirmarCorreo })
      await p.asegurarIdentidad(supabaseId, a.email)
      const dbUser = await p.crearUsuario(company.id, { supabaseId, email: a.email, nombre: a.nombre, consentimiento: a.consentimiento })
      await p.fijarRolEnLaSesion(supabaseId, { dbUserId: dbUser.id, companyId: company.id })
      resultado.adminId = dbUser.id
    }

    if (entrada.alTerminar) await entrada.alTerminar(resultado)
    return resultado
  } catch (e) {
    // `supabaseId` solo tiene valor con cuenta nueva: un administrador existente NUNCA se toca aquí. Sus filas de acceso a esta empresa
    // desaparecen solas al borrarla (cascada); las de su empresa de siempre se quedan, que es lo correcto.
    if (supabaseId) await p.borrarCuenta(supabaseId).catch(anotarFallo('alta-empresa:rollback-cuenta'))
    if (companyId) await p.borrarEmpresa(companyId).catch(anotarFallo('alta-empresa:rollback-empresa'))
    throw e
  }
}

/** Los puertos reales: base de datos y Supabase Auth. */
export const puertosReales: PuertosDeAlta = {
  slugOcupado: async (slug) =>
    Boolean(await sinEmpresa('alta de empresa: comprobar el slug (catálogo global)', (tx) => tx.company.findUnique({ where: { slug }, select: { id: true } }))),
  crearEmpresa: (data) => sinEmpresa('alta de empresa: crear la empresa', (tx) => tx.company.create({ data, select: { id: true } })),
  asegurarSucursalPrincipal: (companyId) => ensureSucursalPrincipal(companyId),
  vincularCategorias: async (companyId, categoryIds) => {
    await conEmpresa(companyId, (tx) =>
      tx.companyToCategory.createMany({ data: categoryIds.map((categoryId) => ({ companyId, categoryId })), skipDuplicates: true })
    )
  },
  darAcceso: async (adminId, companyId, empresaActualDelAdmin) => {
    await sinEmpresa('alta de empresa: filas de acceso del administrador', (tx) =>
      tx.userCompanyAccess.createMany({ data: filasDeAcceso(adminId, companyId, empresaActualDelAdmin), skipDuplicates: true })
    )
  },
  crearCuenta: async ({ email, password, nombre, confirmarCorreo }) => {
    const { data, error } = await createAdminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: confirmarCorreo,
      user_metadata: { name: nombre },
    })
    if (error || !data.user) throw new Error(error?.message ?? 'No se pudo crear la cuenta del administrador.')
    return data.user.id
  },
  asegurarIdentidad: (supabaseId, email) => ensureEmailIdentity(supabaseId, email),
  crearUsuario: (companyId, u) =>
    conEmpresa(companyId, (tx) =>
      tx.user.create({
        data: {
          supabaseId: u.supabaseId,
          email: u.email,
          name: u.nombre,
          role: 'ADMINISTRADOR',
          companyId,
          ...(u.consentimiento
            ? {
                termsAcceptedAt: u.consentimiento.en,
                termsVersion: u.consentimiento.terminosVersion,
                marketingConsent: u.consentimiento.marketing,
                marketingConsentAt: u.consentimiento.marketing ? u.consentimiento.en : null,
              }
            : {}),
        },
        select: { id: true },
      })
    ),
  fijarRolEnLaSesion: async (supabaseId, { dbUserId, companyId }) => {
    await createAdminClient().auth.admin.updateUserById(supabaseId, {
      app_metadata: { role: 'ADMINISTRADOR', dbUserId, companyId },
    })
  },
  borrarCuenta: async (supabaseId) => {
    await createAdminClient().auth.admin.deleteUser(supabaseId)
  },
  /**
   * Borra una empresa RECIÉN CREADA por esta misma llamada, con lo único que el alta le pone: su sucursal principal y, con cuenta nueva,
   * su administrador. La sucursal tiene una clave foránea RESTRICT hacia la empresa y el usuario SET NULL: borrar solo la empresa fallaba
   * (y el error se tragaba) dejando la empresa huérfana —el rollback de los tres caminos antiguos nunca llegó a deshacerla— y, con el
   * usuario, una fila de usuario sin empresa. Se verificó contra la base de QA. Todo en una transacción.
   */
  borrarEmpresa: async (companyId) => {
    await conEmpresa(companyId, async (tx) => {
      await tx.user.deleteMany({ where: { companyId } })
      await tx.sucursal.deleteMany({ where: { companyId } })
      await tx.company.delete({ where: { id: companyId } })
    })
  },
}
