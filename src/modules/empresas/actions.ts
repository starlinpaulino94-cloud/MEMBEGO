'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { ensureSucursalPrincipal } from '@/modules/empresas/sucursalPrincipal'
import { filasDeAcceso } from '@/modules/empresas/accesos'
import { anotarFallo } from '@/lib/prisma-errors'
import { verticalValido } from '@/modules/empresas/verticales'

export interface ActionState {
  error?: string
  success?: boolean
  message?: string
}

async function requireSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

/** Convierte un nombre en un slug URL-safe. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Devuelve un slug único para Company, agregando sufijo si ya existe. */
async function uniqueCompanySlug(name: string): Promise<string> {
  const base = slugify(name) || 'empresa'
  let slug = base
  let n = 1
  // Colisiones esperadas raras; el bucle termina rápido.
  while (await sinEmpresa('superadmin: verificar unicidad de slug', (tx) => tx.company.findUnique({ where: { slug } }))) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

/**
 * Crea una empresa nueva y le pone un administrador. Solo superadmin. Es la
 * única vía soportada para dar de alta un negocio sin tocar SQL.
 *
 * DOS FORMAS DE PONER AL ADMINISTRADOR:
 *
 *   · CUENTA NUEVA (`adminModo=nuevo`, el de siempre): se crea el usuario en
 *     Supabase Auth con su correo y contraseña. Es lo correcto cuando la
 *     empresa es de otra persona.
 *
 *   · CUENTA EXISTENTE (`adminModo=existente`): se le da ACCESO a un
 *     administrador que ya usa la plataforma. No se crea ninguna cuenta, no se
 *     pide contraseña, y —esto es lo importante— NO se le cambia su empresa
 *     activa: sigue en su negocio y entra a la nueva cuando quiere, con el
 *     selector de arriba del panel. Es la forma natural de una empresa de
 *     práctica: el administrador de CARTOWN no necesita una segunda cuenta ni
 *     una segunda contraseña para entrenar; entra a su modo de prueba y sale.
 *
 * Si algo falla después de crear la empresa, se revierte para no dejar una
 * empresa huérfana. En el modo "cuenta existente" el rollback NUNCA toca a esa
 * persona: existía antes y tiene que seguir existiendo igual.
 */
export async function crearEmpresa(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'No autorizado.' }

  const name = String(formData.get('name') ?? '').trim()
  const type = String(formData.get('type') ?? 'otro').trim() || 'otro'
  const usarExistente = String(formData.get('adminModo') ?? 'nuevo') === 'existente'
  const adminNombre = String(formData.get('adminNombre') ?? '').trim()
  const adminEmail = String(formData.get('adminEmail') ?? '').trim().toLowerCase()
  const adminPassword = String(formData.get('adminPassword') ?? '')
  const adminExistenteId = String(formData.get('adminExistenteId') ?? '').trim()

  if (!name) return { error: 'El nombre de la empresa es requerido.' }

  // Datos de la persona que va a administrar, resueltos ANTES de crear nada:
  // si algo está mal, no se llega a escribir la empresa.
  let existente: {
    id: string
    name: string
    role: string
    companyId: string | null
  } | null = null

  if (usarExistente) {
    if (!adminExistenteId) return { error: 'Elige el administrador existente.' }
    existente = await sinEmpresa('superadmin: buscar admin existente', (tx) =>
      tx.user.findUnique({
        where: { id: adminExistenteId },
        select: { id: true, name: true, role: true, companyId: true },
      })
    )
    if (!existente) return { error: 'Ese administrador ya no existe.' }
    if (existente.role === 'CLIENTE') {
      return { error: 'Esa cuenta es de cliente, no puede administrar una empresa.' }
    }
    if (existente.role === 'SUPERADMIN') {
      return { error: 'El superadmin ya entra a todas las empresas; elige otro administrador.' }
    }
  } else {
    if (!adminNombre || !adminEmail || !adminPassword) {
      return { error: 'Nombre, correo y contraseña del administrador son obligatorios.' }
    }
    if (!/.+@.+\..+/.test(adminEmail)) {
      return { error: 'El correo del administrador no es válido.' }
    }
    if (adminPassword.length < 6) {
      return { error: 'La contraseña debe tener al menos 6 caracteres.' }
    }
    // El correo del admin no puede estar ya en uso.
    const yaExiste = await sinEmpresa('superadmin: verificar correo no usado', (tx) =>
      tx.user.findUnique({ where: { email: adminEmail } })
    )
    if (yaExiste) {
      return {
        error:
          'Ya existe un usuario con ese correo. Si es quien va a administrar esta empresa, usa "Cuenta existente".',
      }
    }
  }

  let companyId: string | null = null
  const supabase = createAdminClient()
  let supabaseId: string | null = null

  // Empresa de DEMOSTRACIÓN (entrenamiento). Se nombra igual que cualquier
  // otra y se crea por este mismo camino a propósito: el alta es parte de lo
  // que se entrena. Lo único distinto es la marca — y todo lo que esa marca
  // apaga hacia afuera (ver src/modules/demo/index.ts).
  //
  // El campo se añade al `data` solo cuando se pide: si la columna todavía no
  // está migrada, crear empresas NORMALES tiene que seguir funcionando.
  const esDemo = String(formData.get('esDemo') ?? '') === '1'

  /**
   * EL VERTICAL, EN LA COLUMNA QUE MANDA.
   *
   * `registro.ts` resuelve el vertical de una empresa leyendo PRIMERO
   * `tipoNegocioCodigo` y cayendo a `type` solo si está vacía. Su propio
   * comentario avisaba del hueco: «creada por un camino que aún no la rellena».
   * Este era ese camino.
   *
   * Sin escribirla, elegir «Hotel» en el selector guardaba la cadena en `type`
   * y la resolución antigua la mandaba al `default: CAR_WASH`. La empresa
   * quedaba clasificada como lavadero — el mismo fallo que la Fase 7 encontró
   * probando contra base real, reaparecido por la puerta del formulario.
   *
   * Se valida contra la tabla: un código que no existe deja la columna en null
   * y la empresa se resuelve como siempre, en vez de apuntar a un vertical
   * inexistente y quedarse sin ningún sistema.
   */
  const codigoVertical = await verticalValido(type)

  try {
    const slug = await uniqueCompanySlug(name)
    const company = await sinEmpresa('superadmin: crear empresa', (tx) =>
      tx.company.create({
        data: {
          ...(esDemo ? { esDemo: true } : {}),
          name,
          slug,
          type,
          ...(codigoVertical ? { tipoNegocioCodigo: codigoVertical } : {}),
          description: String(formData.get('description') ?? '').trim() || null,
          email: String(formData.get('email') ?? '').trim() || null,
          telefono: String(formData.get('telefono') ?? '').trim() || null,
          direccion: String(formData.get('direccion') ?? '').trim() || null,
          ciudad: String(formData.get('ciudad') ?? '').trim() || null,
          categoria: String(formData.get('categoria') ?? '').trim() || null,
          website: String(formData.get('website') ?? '').trim() || null,
          isActive: true,
        },
      })
    )
    companyId = company.id

    // Sucursal principal automática con los datos recién capturados: la
    // mayoría de las empresas tiene un solo local y sin sucursal la Caja
    // no puede cobrar.
    await ensureSucursalPrincipal(company.id)

    // Categorías de marketplace (relación many-to-many).
    const categoryIds = formData
      .getAll('categoryIds')
      .map(String)
      .filter(Boolean)
    if (categoryIds.length > 0) {
      await conEmpresa(company.id, (tx) =>
        tx.companyToCategory.createMany({
          data: categoryIds.map((categoryId) => ({
            companyId: company.id,
            categoryId,
          })),
          skipDuplicates: true,
        })
      )
    }

    if (existente) {
      // Administrador que ya existe: solo se le suma esta empresa a las que
      // puede abrir. Ni cuenta nueva, ni contraseña, ni cambio de su empresa
      // activa. `filasDeAcceso` escribe además la fila de su empresa de
      // siempre — sin eso, al cambiar a esta perdería el camino de vuelta.
      await sinEmpresa('superadmin: crear filas de acceso del admin', (tx) =>
        tx.userCompanyAccess.createMany({
          data: filasDeAcceso(existente.id, company.id, existente.companyId),
          skipDuplicates: true,
        })
      )
    } else {
      // Usuario admin en Supabase Auth.
      const { data: created, error: createError } =
        await supabase.auth.admin.createUser({
          email: adminEmail,
          password: adminPassword,
          email_confirm: true,
          user_metadata: { name: adminNombre },
        })
      if (createError || !created.user) {
        throw new Error(createError?.message ?? 'No se pudo crear el usuario admin.')
      }
      supabaseId = created.user.id

      await ensureEmailIdentity(supabaseId, adminEmail)

      const sid = supabaseId
      const uid = company.id
      const dbUser = await conEmpresa(uid, (tx) =>
        tx.user.create({
          data: {
            supabaseId: sid,
            email: adminEmail,
            name: adminNombre,
            role: 'ADMINISTRADOR',
            companyId: uid,
          },
        })
      )

      await supabase.auth.admin.updateUserById(supabaseId, {
        app_metadata: {
          role: 'ADMINISTRADOR',
          dbUserId: dbUser.id,
          companyId: company.id,
        },
      })
    }

    revalidatePath('/superadmin/empresas')
    revalidatePath('/superadmin/demo')
    revalidatePath('/superadmin/usuarios')
    revalidatePath('/empresas')
    return {
      success: true,
      message: existente
        ? esDemo
          ? `Empresa de demostración "${name}" creada. ${existente.name} la verá en el selector de empresas de su panel: ahí entra al modo de prueba y ahí sale.`
          : `Empresa "${name}" creada. ${existente.name} ya puede administrarla desde el selector de empresas de su panel.`
        : esDemo
          ? `Empresa de demostración "${name}" creada. Comparte su enlace de registro para entrenar.`
          : `Empresa "${name}" creada con su administrador.`,
    }
  } catch (e) {
    console.error('[empresa] crearEmpresa error:', e)
    // Rollback: borrar el auth user y la empresa recién creada para no dejar
    // registros huérfanos.
    //
    // `supabaseId` solo tiene valor en el camino de "cuenta nueva", así que un
    // administrador existente NUNCA se toca aquí. Sus filas de acceso a esta
    // empresa desaparecen solas al borrarla (cascada); las de su empresa de
    // siempre se quedan, que es lo correcto.
    if (supabaseId) {
      await supabase.auth.admin.deleteUser(supabaseId).catch(anotarFallo('empresas:rollback-auth-user'))
    }
    if (companyId) {
      const cid = companyId
      await sinEmpresa('superadmin: rollback borrar empresa', (tx) =>
        tx.company.delete({ where: { id: cid } })
      ).catch(anotarFallo('empresas:company.delete'))
    }
    return { error: 'No se pudo crear la empresa. Intenta de nuevo.' }
  }
}

export async function actualizarEmpresa(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Empresa no especificada.' }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'El nombre es requerido.' }

  const codigoVerticalEdicion = await verticalValido(String(formData.get('type') ?? ''))

  try {
    const categoryIds = formData
      .getAll('categoryIds')
      .map(String)
      .filter(Boolean)

    // Actualiza la empresa y re-sincroniza sus categorías atómicamente.
    const existing = await conEmpresa(id, async (tx) => {
      const actual = await tx.company.findUnique({ where: { id } })
      if (!actual) return null

      await tx.company.update({
        where: { id },
        data: {
          name,
          description: String(formData.get('description') ?? '').trim() || null,
          type: String(formData.get('type') ?? actual.type),
          // Igual que en el alta: si no se escribe la columna, cambiar el tipo
          // desde la interfaz no cambia el vertical de verdad. Un código
          // inválido no la toca, para no dejar a la empresa sin sistemas por
          // un formulario enviado a mano.
          ...(codigoVerticalEdicion ? { tipoNegocioCodigo: codigoVerticalEdicion } : {}),
          email: String(formData.get('email') ?? '').trim() || null,
          telefono: String(formData.get('telefono') ?? '').trim() || null,
          direccion: String(formData.get('direccion') ?? '').trim() || null,
          ciudad: String(formData.get('ciudad') ?? '').trim() || null,
          categoria: String(formData.get('categoria') ?? '').trim() || null,
          website: String(formData.get('website') ?? '').trim() || null,
          logoUrl: String(formData.get('logoUrl') ?? '').trim() || null,
        },
      })
      await tx.companyToCategory.deleteMany({ where: { companyId: id } })
      if (categoryIds.length > 0) {
        await tx.companyToCategory.createMany({
          data: categoryIds.map((categoryId) => ({
            companyId: id,
            categoryId,
          })),
          skipDuplicates: true,
        })
      }
      return actual
    })
    if (!existing) return { error: 'Empresa no encontrada.' }

    revalidatePath('/superadmin/empresas')
    revalidatePath(`/superadmin/empresas/${id}`)
    revalidatePath('/empresas')
    return { success: true, message: 'Empresa actualizada.' }
  } catch (e) {
    console.error('[empresa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function toggleEmpresa(id: string, activate: boolean): Promise<ActionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'No autorizado.' }

  try {
    const company = await conEmpresa(id, async (tx) => {
      const c = await tx.company.findUnique({ where: { id } })
      if (!c) return null
      await tx.company.update({
        where: { id },
        data: { isActive: activate },
      })
      return c
    })
    if (!company) return { error: 'Empresa no encontrada.' }

    revalidatePath('/superadmin/empresas')
    return { success: true, message: activate ? 'Empresa activada.' : 'Empresa suspendida.' }
  } catch (e) {
    console.error('[empresa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarEmpresa(id: string): Promise<ActionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'No autorizado.' }

  try {
    const company = await conEmpresa(id, (tx) =>
      tx.company.findUnique({
        where: { id },
        include: { _count: { select: { clientes: true, users: true } } },
      })
    )
    if (!company) return { error: 'Empresa no encontrada.' }

    if (company._count.clientes > 0 || company._count.users > 0) {
      return { error: 'No se puede eliminar una empresa con clientes o usuarios activos.' }
    }

    await conEmpresa(id, (tx) => tx.company.delete({ where: { id } }))

    revalidatePath('/superadmin/empresas')
    return { success: true, message: 'Empresa eliminada.' }
  } catch (e) {
    console.error('[empresa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function duplicarEmpresa(id: string): Promise<ActionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'No autorizado.' }

  try {
    const company = await sinEmpresa('superadmin: leer empresa a duplicar', (tx) =>
      tx.company.findUnique({ where: { id } })
    )
    if (!company) return { error: 'Empresa no encontrada.' }

    const slug = `${company.slug}-copia-${Date.now().toString(36)}`

    await sinEmpresa('superadmin: crear copia de empresa', (tx) =>
      tx.company.create({
        data: {
          name: `${company.name} (Copia)`,
          slug,
          type: company.type,
          description: company.description,
          email: company.email,
          telefono: company.telefono,
          direccion: company.direccion,
          ciudad: company.ciudad,
          categoria: company.categoria,
          website: company.website,
          isActive: false,
        },
      })
    )

    revalidatePath('/superadmin/empresas')
    return { success: true, message: 'Empresa duplicada.' }
  } catch (e) {
    console.error('[empresa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/**
 * Marca única · las categorías del directorio se crean desde el superadmin
 * cuando se incorpora una empresa nueva (no existían en la UI: venían de SQL).
 */
export async function crearCategoria(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireSuperadmin()
  if (!user) return { error: 'No autorizado.' }

  const name = String(formData.get('nombre') ?? '').trim()
  if (name.length < 2) return { error: 'Escribe el nombre de la categoría.' }

  try {
    const slug = slugify(name)
    const existente = await sinEmpresa('superadmin: buscar categoría existente', (tx) =>
      tx.businessCategory.findFirst({
        where: { OR: [{ name }, { slug }] },
        select: { id: true },
      })
    )
    if (existente) return { error: 'Ya existe una categoría con ese nombre.' }

    await sinEmpresa('superadmin: crear categoría', (tx) =>
      tx.businessCategory.create({
        data: { name, slug, active: true },
      })
    )

    revalidatePath('/superadmin/empresas')
    revalidateTag('marketplace', 'max')
    return { success: true, message: `Categoría "${name}" creada.` }
  } catch (e) {
    console.error('[categoria]', e)
    return { error: 'No se pudo crear la categoría.' }
  }
}
