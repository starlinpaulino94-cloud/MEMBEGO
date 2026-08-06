'use server'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { registerLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { vincularReferido } from '@/lib/referidos-attribution'
import { ensureCodigoCorto } from '@/lib/referidos'
import { otorgarRegaloBienvenida, otorgarBienvenidaDirecta } from '@/modules/invitaciones/beneficios'
import { vincularRegalosPorContacto } from '@/modules/regalos/entrega'
import { procesarRegistroGrowth } from '@/modules/growth/registro'
import { capturarCanalRegistro } from '@/modules/adquisicion/canal'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { TERMS_VERSION } from '@/lib/legal'
import { isEmailVerificationEnabled, sendVerificationEmail } from '@/lib/auth/emailVerification'
import { anotarFallo, clasificarErrorPrisma } from '@/lib/prisma-errors'
import { primerErrorZod } from '@/lib/validacion'
import { capturarErrorInesperado } from '@/lib/sentry'
import { registroSchema } from '@/modules/registro/schema'
import { validarVehiculoNuevo, normalizarPlaca } from '@/modules/registro/vehiculo-nuevo'
import { capacidadesEfectivas } from '@/modules/capacidades/catalogo'
import { flujoRequiereVehiculo } from '@/modules/onboarding/flujos'
import { PAIS_PLACA_DEFECTO } from '@/modules/onboarding/vehiculo'

export interface RegistroState {
  error?: string
  success?: boolean
  /** Cuenta creada pero pendiente de confirmar el correo (flag O-1). */
  pendingVerification?: boolean
  /**
   * MVP "Invita y Gana": código de invitación propio del cliente recién
   * creado, para que la pantalla de celebración ofrezca compartir SU enlace
   * (/invitar/[code]) sin necesitar sesión iniciada.
   */
  codigoInvitacion?: string
  /**
   * Token del QR del regalo de bienvenida (campañas "Invita y Gana"): la
   * entrega del beneficio ocurre dentro del propio registro, así que la
   * celebración puede mostrar el QR inmediatamente, sin esperar el login.
   * Solo viaja en la respuesta al propio registrante.
   */
  qrBienvenida?: string
}

/**
 * Código de invitación del cliente; nunca bloquea el registro si falla.
 */
async function codigoInvitacionDe(clienteId: string): Promise<string | undefined> {
  try {
    return await ensureCodigoCorto(clienteId)
  } catch (e) {
    console.error('[registro] codigoInvitacion error:', e)
    return undefined
  }
}

/**
 * QR del regalo de bienvenida que la campaña acaba de entregar a la wallet
 * (vincularReferido → motorProgreso → ProductoCompra + QrToken, todo dentro
 * del mismo registro). El cliente es recién creado: su único QR activo de
 * compra ES el del regalo. Nunca bloquea el registro si falla.
 */
async function qrBienvenidaDe(
  clienteId: string,
  campanaInvitacionId?: string
): Promise<string | undefined> {
  if (!campanaInvitacionId) return undefined
  try {
    const qr = await sinEmpresa('registro: qr del regalo de bienvenida del cliente recién creado', (tx) =>
      tx.qrToken.findFirst({
        where: { clienteId, activo: true, compraId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { token: true },
      })
    )
    return qr?.token
  } catch (e) {
    console.error('[registro] qrBienvenida error:', e)
    return undefined
  }
}

export async function registrarCliente(
  _prev: RegistroState,
  formData: FormData
): Promise<RegistroState> {
  try {
  // Rate limit server-side por IP: evita creación masiva de cuentas / spam.
  // El límite del navegador no cuenta como protección (se salta recargando).
  const { ipAddress } = await getRequestMeta()
  if (!(await registerLimiter(ipAddress ?? 'unknown'))) {
    return { error: 'Demasiados registros desde esta conexión. Intenta de nuevo en unos minutos.' }
  }

  const parsed = registroSchema.safeParse({
    companySlug: String(formData.get('companySlug') ?? ''),
    nombre: String(formData.get('nombre') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    telefono: String(formData.get('telefono') ?? ''),
    terminos: String(formData.get('terminos') ?? ''),
    refCode: String(formData.get('refCode') ?? ''),
    campanaId: String(formData.get('campanaId') ?? ''),
    glCode: String(formData.get('glCode') ?? ''),
    canalDeclarado: String(formData.get('canalDeclarado') ?? ''),
    marca: String(formData.get('marca') ?? ''),
    modelo: String(formData.get('modelo') ?? ''),
    anioRaw: String(formData.get('anio') ?? ''),
    color: String(formData.get('color') ?? ''),
    placa: String(formData.get('placa') ?? ''),
    tipoVehiculoId: String(formData.get('tipoVehiculoId') ?? ''),
    pais: String(formData.get('pais') ?? ''),
    flujoV2: String(formData.get('flujoV2') ?? ''),
  })
  if (!parsed.success) return { error: primerErrorZod(parsed.error) }
  const {
    companySlug,
    nombre,
    email,
    password,
    telefono,
    refCode,
    campanaId: campanaInvitacionId,
    glCode,
    canalDeclarado,
    marca,
    modelo,
    anioRaw,
    color,
    placa,
    tipoVehiculoId,
    pais,
    flujoV2,
  } = parsed.data
  // F5.2: auto-seguir con opción de desmarcar. El hidden "off" va primero;
  // si el checkbox está marcado, el último valor es "on".
  const seguirEmpresa = formData.getAll('seguirEmpresa').at(-1) !== 'off'
  // Consentimiento (Fase 1): marketing opcional (términos ya validado por zod).
  const marketingConsent = formData.getAll('marketingConsent').at(-1) === 'on'

  // La empresa debe existir realmente en la BD: su id se usa como FK al crear
  // el Cliente. Un fallback con id ficticio provocaría una violación de FK y
  // dejaría un usuario huérfano en Supabase Auth, así que devolvemos un error
  // limpio si no se encuentra o si la BD no está disponible.
  // select explícito: si la BD de producción aún no tiene una columna recién
  // agregada al modelo Company, un findUnique sin select falla y bloquea TODO
  // el registro. Con select, solo dependemos de columnas que siempre existen.
  let company: { id: string; name: string; slug: string; type: string; capacidades: unknown } | null = null
  try {
    company = await sinEmpresa('registro: buscar empresa por slug (catálogo global)', (tx) =>
      tx.company.findUnique({
        where: { slug: companySlug },
        select: { id: true, name: true, slug: true, type: true, capacidades: true },
      })
    )
  } catch (e) {
    console.error('[registro] company lookup error:', e)
    return { error: 'No se pudo verificar la empresa. Intenta de nuevo.' }
  }
  if (!company) {
    return { error: 'Empresa no encontrada.' }
  }

  // ── Onboarding v2: vehículo obligatorio y completo (solo asistente) ────────
  //
  // La categoría del negocio se resuelve EN EL SERVIDOR (tipo + overrides de
  // capacidades): el navegador no decide si el vehículo es obligatorio. El
  // formulario clásico (flujoV2 vacío, bandera de emergencia) conserva su
  // comportamiento de siempre — regla de compatibilidad.
  const requiereVehiculo = flujoRequiereVehiculo(
    capacidadesEfectivas(company.type, company.capacidades).categoria
  )
  const companyIdVerificado = company.id
  let vehiculoV2: import('@/modules/registro/vehiculo-nuevo').VehiculoNuevoValidado | null = null
  if (flujoV2 === '1' && requiereVehiculo) {
    const r = validarVehiculoNuevo({ tipoVehiculoId, marca, modelo, anioRaw, color, placa, pais })
    if (!r.ok) return { error: r.error }
    vehiculoV2 = r.vehiculo

    // La categoría debe ser de ESTA empresa y estar activa (no fiarse del id
    // que mandó el navegador).
    const tipoValido = await conEmpresa(companyIdVerificado, (tx) =>
      tx.tipoVehiculo.findFirst({
        where: { id: r.vehiculo.tipoVehiculoId, companyId: companyIdVerificado, activo: true },
        select: { id: true },
      })
    ).catch(() => null)
    if (!tipoValido) {
      return { error: 'La categoría de vehículo elegida ya no está disponible. Vuelve a elegirla.' }
    }

    // Placa ya registrada en OTRA cuenta → no se duplica el vehículo (§18).
    // Cross-empresa a propósito (la placa es identidad global) pero excluyendo
    // a la MISMA persona: quien se afilia a otra empresa con su propio carro
    // no es un duplicado. Chequeo previo sin unique todavía (el constraint
    // llega tras la auditoría de producción).
    const placaAjena = await sinEmpresa(
      'registro: detectar placa duplicada (la placa es identidad global del vehículo)',
      (tx) =>
        tx.vehiculo.findFirst({
          where: {
            pais: r.vehiculo.pais,
            placaNormalizada: r.vehiculo.placaNormalizada,
            cliente: { email: { not: email } },
          },
          select: { id: true },
        })
    ).catch(() => null)
    if (placaAjena) {
      return {
        error:
          'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
      }
    }
  }

  const admin = createAdminClient()

  // Si ya existe una cuenta de cliente con este correo, esto es una
  // afiliación a una empresa adicional, no un registro nuevo.
  const existingUser = await sinEmpresa('registro: buscar usuario por email (cross-tenant)', (tx) =>
    tx.user.findUnique({ where: { email } })
  )
  if (existingUser && existingUser.role !== 'CLIENTE') {
    return { error: 'Ya existe una cuenta con este correo.' }
  }
  if (existingUser) {
    const existingCliente = await conEmpresa(company.id, (tx) =>
      tx.cliente.findUnique({
        where: {
          supabaseId_companyId: {
            supabaseId: existingUser.supabaseId,
            companyId: company.id,
          },
        },
      })
    )
    if (existingCliente) {
      return { error: 'Ya tienes una cuenta en esta empresa. Inicia sesión.' }
    }

    try {
      const cliente = await conEmpresa(company.id, (tx) =>
        tx.cliente.create({
          data: {
            companyId: company.id,
            supabaseId: existingUser.supabaseId,
            nombre: existingUser.name,
            email,
            telefono: telefono || null,
          },
        })
      )

      if (vehiculoV2) {
        // Asistente v2: vehículo completo, validado arriba. Primer vehículo de
        // esta ficha → principal (§8).
        await conEmpresa(company.id, (tx) =>
          tx.vehiculo.create({
            data: { clienteId: cliente.id, ...vehiculoV2, esPrincipal: true },
          })
        )
      } else if (marca && modelo && anioRaw && color) {
        // Formulario clásico (bandera de emergencia): vehículo opcional como
        // siempre, pero las filas NUEVAS ya nacen con placa normalizada y
        // principal — higiene de datos sin cambiar el comportamiento.
        const anio = Number(anioRaw)
        if (!Number.isNaN(anio)) {
          await conEmpresa(company.id, (tx) =>
            tx.vehiculo.create({
              data: {
                clienteId: cliente.id,
                marca,
                modelo,
                anio,
                color,
                placa: placa || null,
                placaNormalizada: normalizarPlaca(placa) || null,
                pais: PAIS_PLACA_DEFECTO,
                esPrincipal: true,
              },
            })
          )
        }
      }

      // Atribución de marketing: cookie del enlace ?src= o canal declarado.
      await capturarCanalRegistro(cliente.id, canalDeclarado)

      // FASE 3/5.2: seguir la empresa al registrarse (salvo que lo desmarque).
      if (seguirEmpresa) {
        await conEmpresa(company.id, (tx) =>
          tx.companyFollow
            .upsert({
              where: {
                userId_companyId: { userId: existingUser.id, companyId: company.id },
              },
              update: {},
              create: { userId: existingUser.id, companyId: company.id },
            })
            .catch((e) => console.error('[registro] auto-follow error:', e))
        )
      }

      await admin.auth.admin.updateUserById(existingUser.supabaseId, {
        app_metadata: {
          role: 'CLIENTE',
          dbUserId: existingUser.id,
          clienteId: cliente.id,
          companyId: company.id,
        },
      })

      await vincularReferido(refCode, company.id, cliente.id, ipAddress, {
        permitirCookie: false,
        campanaInvitacionId,
      })

      // Regalo de bienvenida: si el registro vino de una campaña, el de ESA
      // campaña; si fue DIRECTO (sin enlace), el de la campaña activa del
      // negocio — todo registro recibe su regalo, venga de donde venga.
      let campanaBienvenida = campanaInvitacionId
      if (campanaInvitacionId) {
        await otorgarRegaloBienvenida(campanaInvitacionId, cliente.id, company.id)
      } else {
        campanaBienvenida =
          (await otorgarBienvenidaDirecta(cliente.id, company.id)) ?? undefined
      }

      await emitirEventoEstrategia({
        companyId: company.id,
        type: 'cliente.registrado',
        subjectId: cliente.id,
        // Contacto incluido: los sistemas satélite crean la ficha del cliente
        // con este evento y sin teléfono no pueden llamarlo ni buscarlo.
        payload: {
          cliente: {
            nombre: cliente.nombre,
            compras: 0,
            visitas: 0,
            email: email ?? null,
            telefono: telefono ?? null,
          },
        },
      })

      // Regalos P2P · R4: si alguien le envió un regalo a este correo o
      // teléfono antes de que tuviera cuenta, se le asigna ahora.
      await vincularRegalosPorContacto({
        clienteId: cliente.id,
        companyId: company.id,
        email,
        telefono,
      })

      return {
        success: true,
        codigoInvitacion: await codigoInvitacionDe(cliente.id),
        qrBienvenida: await qrBienvenidaDe(cliente.id, campanaBienvenida),
      }
    } catch (e) {
      // El unique de placa cierra la carrera que el chequeo previo no puede:
      // quien pierde la carrera recibe el mismo mensaje claro, no un genérico.
      if (clasificarErrorPrisma(e).codigo === 'P2002') {
        return {
          error:
            'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
        }
      }
      capturarErrorInesperado('registro:afiliacion', e)
      return { error: 'No se pudo completar el registro. Intenta de nuevo.' }
    }
  }

  // 1. Create Supabase auth user
  const verificarCorreo = isEmailVerificationEnabled()
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      // Con verificación activada la cuenta nace SIN confirmar; el usuario la
      // activa desde el enlace del correo. Sin el flag, se confirma al vuelo.
      email_confirm: !verificarCorreo,
      user_metadata: { name: nombre },
    })

  if (createError || !created.user) {
    if (createError?.message?.toLowerCase().includes('already')) {
      return { error: 'Ya existe una cuenta con este correo.' }
    }
    return { error: createError?.message ?? 'No se pudo crear la cuenta.' }
  }

  const supabaseId = created.user.id

  // Garantiza la fila de identity (email) para que el login funcione.
  await ensureEmailIdentity(supabaseId, email)

  try {
    const result = await conEmpresa(company.id, async (tx) => {
      const now = new Date()
      const dbUser = await tx.user.create({
        data: {
          supabaseId,
          email,
          name: nombre,
          role: 'CLIENTE',
          companyId: company.id,
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
          marketingConsent,
          marketingConsentAt: marketingConsent ? now : null,
        },
      })

      const cliente = await tx.cliente.create({
        data: {
          companyId: company.id,
          supabaseId,
          nombre,
          email,
          telefono: telefono || null,
        },
      })

      // FASE 3/5.2: seguir la empresa al registrarse (salvo que lo desmarque).
      if (seguirEmpresa) {
        await tx.companyFollow.create({
          data: { userId: dbUser.id, companyId: company.id },
        })
      }

      // QR se genera solo al activar la membresía, no en el registro

      if (vehiculoV2) {
        // Asistente v2: vehículo completo, validado antes de crear la cuenta.
        // Primer vehículo del cliente → principal (§8).
        await tx.vehiculo.create({
          data: { clienteId: cliente.id, ...vehiculoV2, esPrincipal: true },
        })
      } else if (marca && modelo && anioRaw && color) {
        // Formulario clásico (bandera de emergencia): vehículo opcional como
        // siempre, con higiene de datos en las filas nuevas.
        const anio = Number(anioRaw)
        if (!Number.isNaN(anio)) {
          await tx.vehiculo.create({
            data: {
              clienteId: cliente.id,
              marca,
              modelo,
              anio,
              color,
              placa: placa || null,
              placaNormalizada: normalizarPlaca(placa) || null,
              pais: PAIS_PLACA_DEFECTO,
              esPrincipal: true,
            },
          })
        }
      }

      return { dbUser, cliente }
    })

    // 2. Store app_metadata for middleware/role resolution
    await admin.auth.admin.updateUserById(supabaseId, {
      app_metadata: {
        role: 'CLIENTE',
        dbUserId: result.dbUser.id,
        clienteId: result.cliente.id,
        companyId: company.id,
      },
    })

    // Atribución de marketing: cookie del enlace ?src= o canal declarado.
    await capturarCanalRegistro(result.cliente.id, canalDeclarado)

    await vincularReferido(refCode, company.id, result.cliente.id, ipAddress, {
      campanaInvitacionId,
    })

    // Regalo de bienvenida: de la campaña que trajo al usuario, o —en el
    // registro DIRECTO sin enlace— el de la campaña activa del negocio.
    // Idempotente con la entrega del motor de referidos.
    let campanaBienvenida = campanaInvitacionId
    if (campanaInvitacionId) {
      await otorgarRegaloBienvenida(campanaInvitacionId, result.cliente.id, company.id)
    } else {
      campanaBienvenida =
        (await otorgarBienvenidaDirecta(result.cliente.id, company.id)) ?? undefined
    }

    // Growth Engine 3.0: atribución al enlace + beneficio de bienvenida +
    // reglas del evento REGISTRO (no bloquea el registro si falla).
    if (glCode) {
      await procesarRegistroGrowth(glCode, company.id, result.cliente.id).catch((e) =>
        console.error('[registro] growth:', e)
      )
    }

    await emitirEventoEstrategia({
      companyId: company.id,
      type: 'cliente.registrado',
      subjectId: result.cliente.id,
      payload: {
        cliente: {
          nombre: result.cliente.nombre,
          compras: 0,
          visitas: 0,
          email: email ?? null,
          telefono: telefono ?? null,
        },
      },
    })

    // Regalos P2P · R4: si alguien le envió un regalo a este correo o teléfono
    // antes de que tuviera cuenta, se le asigna ahora (fuera de la transacción:
    // nunca bloquea el registro).
    await vincularRegalosPorContacto({
      clienteId: result.cliente.id,
      companyId: company.id,
      email,
      telefono,
    })

    const [codigoInvitacion, qrBienvenida] = await Promise.all([
      codigoInvitacionDe(result.cliente.id),
      qrBienvenidaDe(result.cliente.id, campanaBienvenida),
    ])
    if (verificarCorreo) {
      await sendVerificationEmail(admin, email, nombre)
      return { pendingVerification: true, codigoInvitacion }
    }
    return { success: true, codigoInvitacion, qrBienvenida }
  } catch (e) {
    // Roll back the Supabase user if DB write failed
    await admin.auth.admin.deleteUser(supabaseId).catch(e => console.error('[registro-cleanup]', e))
    // Carrera de placa duplicada perdida contra el unique: mensaje claro.
    if (clasificarErrorPrisma(e).codigo === 'P2002') {
      return {
        error:
          'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
      }
    }
    capturarErrorInesperado('registro:crear', e)
    return { error: 'No se pudo completar el registro. Intenta de nuevo.' }
  }
  } catch (e) {
    capturarErrorInesperado('registro:unexpected', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Registro general en MembeGo, SIN empresa: crea la cuenta (Supabase + User
 * CLIENTE) sin afiliarse a ninguna empresa, sin seguirla y sin membresía.
 * El usuario luego explora empresas dentro de la app y se afilia cuando
 * quiera (la afiliación reutiliza el flujo existente de /registro/[slug]).
 */
export async function registrarCuentaGeneral(
  _prev: RegistroState,
  formData: FormData
): Promise<RegistroState> {
  try {
    const { ipAddress } = await getRequestMeta()
    if (!(await registerLimiter(ipAddress ?? 'unknown'))) {
      return { error: 'Demasiados registros desde esta conexión. Intenta de nuevo en unos minutos.' }
    }

    const parsed = registroSchema.safeParse({
      companySlug: '',
      nombre: String(formData.get('nombre') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      telefono: String(formData.get('telefono') ?? ''),
      terminos: String(formData.get('terminos') ?? ''),
      refCode: '',
      campanaId: '',
      glCode: '',
      canalDeclarado: String(formData.get('canalDeclarado') ?? ''),
      marca: '',
      modelo: '',
      anioRaw: '',
      color: '',
      placa: '',
    })
    if (!parsed.success) return { error: primerErrorZod(parsed.error) }
    const { nombre, email, password, telefono, canalDeclarado } = parsed.data
    // Consentimiento (Fase 1): marketing opcional (términos ya validado por zod).
    const marketingConsent = formData.getAll('marketingConsent').at(-1) === 'on'

    const existingUser = await sinEmpresa('registro: buscar usuario por email (cross-tenant)', (tx) =>
      tx.user.findUnique({ where: { email } })
    )
    if (existingUser) {
      return { error: 'Ya existe una cuenta con este correo. Inicia sesión.' }
    }

    const admin = createAdminClient()
    const verificarCorreo = isEmailVerificationEnabled()
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: !verificarCorreo,
        user_metadata: { name: nombre, telefono: telefono || null },
      })

    if (createError || !created.user) {
      if (createError?.message?.toLowerCase().includes('already')) {
        return { error: 'Ya existe una cuenta con este correo.' }
      }
      return { error: createError?.message ?? 'No se pudo crear la cuenta.' }
    }

    const supabaseId = created.user.id
    await ensureEmailIdentity(supabaseId, email)

    try {
      const now = new Date()
      const dbUser = await sinEmpresa('registro: crear usuario general sin empresa', (tx) =>
        tx.user.create({
          data: {
            supabaseId,
            email,
            name: nombre,
            role: 'CLIENTE',
            companyId: null,
            termsAcceptedAt: now,
            termsVersion: TERMS_VERSION,
            marketingConsent,
            marketingConsentAt: marketingConsent ? now : null,
          },
        })
      )

      await admin.auth.admin.updateUserById(supabaseId, {
        app_metadata: {
          role: 'CLIENTE',
          dbUserId: dbUser.id,
          clienteId: null,
          companyId: null,
        },
      })

      // Marca única: la cuenta "general" se afilia DE UNA VEZ a la empresa
      // principal (ficha de cliente + regalo de bienvenida + metadata), para
      // que ningún módulo la reciba a medias. Si aún no hay empresa publicada,
      // la auto-reparación de getUser() completará el alta al primer acceso.
      const { repararContextoCliente } = await import('@/lib/auth/reparar-contexto')
      const sesion = await repararContextoCliente({
        supabaseId,
        email,
        metadata: { role: 'CLIENTE', dbUserId: dbUser.id, clienteId: null, companyId: null },
      })
      // Teléfono del formulario → ficha recién creada (la reparación no lo tiene).
      if (sesion.metadata.clienteId && telefono) {
        const nuevoClienteId = sesion.metadata.clienteId
        await sinEmpresa('registro: actualizar teléfono de la ficha recién creada', (tx) =>
          tx.cliente
            .update({ where: { id: nuevoClienteId }, data: { telefono } })
            .catch(anotarFallo('registro:cliente.update'))
        )
      }
      // Atribución de marketing: cookie del enlace ?src= o canal declarado.
      if (sesion.metadata.clienteId) {
        await capturarCanalRegistro(sesion.metadata.clienteId, canalDeclarado)
      }

      if (verificarCorreo) {
        await sendVerificationEmail(admin, email, nombre)
        return { pendingVerification: true }
      }
      return { success: true }
    } catch (e) {
      await admin.auth.admin.deleteUser(supabaseId).catch((err) =>
        console.error('[registro-general-cleanup]', err)
      )
      capturarErrorInesperado('registro:general-crear', e)
      return { error: 'No se pudo completar el registro. Intenta de nuevo.' }
    }
  } catch (e) {
    capturarErrorInesperado('registro:general-unexpected', e)
    return { error: 'Ocurrió un error inesperado. Intenta de nuevo.' }
  }
}
