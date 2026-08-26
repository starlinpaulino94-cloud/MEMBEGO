import { createHash } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { cardnetTokensConfigurado, probarSesionTokens } from '@/lib/payments/cardnet-tokens'
import { paymentLimiter, paymentSessionLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { FULL_ADMIN_ROLES } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * La sonda de activación encadena varias llamadas a CardNET, cada una con su
 * límite de 20s. Sin esto la plataforma la corta a media secuencia.
 */
export const maxDuration = 60

/**
 * DIAGNÓSTICO (no cobra ni expone secretos): dice si ESTE deploy ve las llaves
 * de la pasarela de tarjeta. Devuelve solo booleanos de presencia — NUNCA el
 * valor de las llaves.
 *
 * Con `?probar=1` además intenta crear una sesión de captura contra el
 * proveedor y devuelve el status HTTP y la respuesta (sin sensibles): la forma
 * de ver POR QUÉ el proveedor rechaza, en vez de un error genérico.
 *
 * Con `?correo=1` envía un correo de PRUEBA al email del usuario logueado y
 * devuelve el resultado: la forma de verificar la configuración de Resend
 * (RESEND_API_KEY + EMAIL_FROM) sin tener que hacer un pago.
 *
 * Uso: entra logueado a /api/pagos/cardnet-token/estado?probar=1 (pasarela)
 * o ?correo=1 (email) en el mismo deploy que estás probando.
 */
/**
 * Huella corta de un secreto: permite compararlo entre dos sitios sin llegar
 * a mostrarlo. Con el largo y estos ocho caracteres alcanza para saber si dos
 * llaves son la misma; no alcanza para reconstruirla.
 */
function huellaCorta(valor: string | undefined): string | null {
  const v = valor?.trim()
  if (!v) return null
  return `${v.length} car · ${createHash('sha256').update(v).digest('hex').slice(0, 8)}`
}

export async function GET(req: NextRequest) {
  // ANTES ESTA RUTA NO TENÍA LÍMITE. Era la única de `/api/pagos/` sin
  // ninguno, y desde aquí se llama al proveedor en cuatro modos distintos.
  if (!(await paymentSessionLimiter(getClientIdentifier(req)))) {
    return NextResponse.json({ error: 'Demasiadas consultas. Espera un momento.' }, { status: 429 })
  }

  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Inicia sesión para ver el estado.' }, { status: 401 })
  }

  /**
   * QUIÉN VE LA CONFIGURACIÓN DEL DESPLIEGUE.
   *
   * Antes: cualquiera con sesión, incluido un cliente cualquiera. Las llaves,
   * la huella de la privada, el ambiente y el estado del correo son
   * configuración del despliegue — no tienen nada que ver con la tarjeta de
   * quien pregunta, y no hay ningún motivo para enseñárselas.
   *
   * Se reutiliza `FULL_ADMIN_ROLES` en vez de escribir aquí una lista propia:
   * una taxonomía de roles paralela es exactamente lo que se queda sin
   * actualizar cuando aparece un rol nuevo.
   */
  const esAdminDespliegue = FULL_ADMIN_ROLES.includes(user.metadata.role)
  const esSuperadmin = user.metadata.role === 'SUPERADMIN'

  // Configuración para USO INTERNO de las sondas (resolver el CustomerId con
  // las llaves vigentes). No se devuelve tal cual: lo que sale al cliente es
  // `base`, que va redactado según el rol.
  const config = {
    configurado: cardnetTokensConfigurado(),
    publicKey: process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim() ?? null,
  }

  const base = esAdminDespliegue ? {
    configurado: cardnetTokensConfigurado(),
    publicKeyPresente: Boolean(process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim()),
    privateKeyPresente: Boolean(process.env.CARDNET_TOKENS_PRIVATE_KEY?.trim()),
    // La llave PÚBLICA se muestra entera a propósito: ya viaja al navegador
    // para abrir el iframe, así que no es un secreto. Enseñarla aquí permite
    // comprobar de un vistazo que es la PAREJA de la privada — CardNET entrega
    // juegos distintos (con y sin autenticación 3DS) y mezclarlos hace que la
    // ventana de captura muera con INTERNAL_SERVER_ERROR: el session_id lo
    // emite una cuenta y el iframe se abre con la llave de otra.
    publicKey: process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim() ?? null,
    // De la privada, solo su huella: nunca el valor.
    privateKeyHuella: huellaCorta(process.env.CARDNET_TOKENS_PRIVATE_KEY),
    ambiente: process.env.CARDNET_TOKENS_AMBIENTE ?? '(sin definir)',
    correo: {
      resendKeyPresente: Boolean(process.env.RESEND_API_KEY?.trim()),
      emailFromPresente: Boolean(process.env.EMAIL_FROM?.trim()),
    },
  } : {
    // Para quien no administra: solo si la pasarela está encendida. Es lo
    // único de aquí que le concierne, porque explica por qué su pantalla de
    // pago se comporta como se comporta.
    configurado: cardnetTokensConfigurado(),
  }

  /** Respuesta única para los modos que solo debe correr quien administra. */
  const soloAdmin = () =>
    NextResponse.json(
      {
        error:
          'Este diagnóstico toca la configuración del despliegue y solo lo puede ejecutar un administrador.',
      },
      { status: 403 }
    )

  if (req.nextUrl.searchParams.get('correo') === '1') {
    // Verifica la configuración de Resend del DESPLIEGUE. Que el correo salga
    // al propio buzón no lo vuelve inofensivo: es un emisor de correo a
    // demanda y un dato de configuración.
    if (!esAdminDespliegue) return soloAdmin()
    const { sendEmail } = await import('@/lib/email')
    const resultado = await sendEmail({
      to: user.email,
      subject: 'Prueba de correo — MembeGo',
      text: 'Si estás leyendo esto, el envío de correos de tu plataforma funciona correctamente.',
    })
    return NextResponse.json({ ...base, correoPrueba: { destinatario: user.email, ...resultado } })
  }
  // ?perfiles=1: CONSULTA PURA del Customer del usuario y muestra QUÉ devuelve
  // el proveedor (forma real de PaymentProfiles, si el Email viene y cómo, y
  // qué logra extraer nuestro parser). Sin sensibles.
  //
  // ANTES esta sonda llamaba a `crearClienteCardnet`, que hace un POST
  // /Customer INCONDICIONAL. Dos consecuencias, las dos malas:
  //
  //   1. Cada llamada creaba un Customer NUEVO — que por definición no tiene
  //      tarjetas. La sonda respondía `perfiles: []` SIEMPRE, y esa respuesta
  //      no dice nada del cliente que sí registró su tarjeta. Justo la
  //      pregunta que la sonda existe para contestar.
  //   2. Cada POST emite una sesión nueva e INVALIDA la anterior: correr la
  //      sonda con la ventana de pago abierta la mata con
  //      INTERNAL_SERVER_ERROR (ver la nota histórica de `crearSesionCaptura`).
  //
  // Ahora resuelve el id con las MISMAS reglas del flujo real —el guardado en
  // `Cliente.cardnetCustomerId`, validado contra la cuenta de las llaves
  // vigentes— y solo hace GET. Si no hay id utilizable lo dice, en vez de
  // fabricar uno. `?customerId=` permite mirar otro a mano.
  if (req.nextUrl.searchParams.get('perfiles') === '1' && config.configurado) {
    const { consultarClienteCardnet, consultarClienteDiagnostico } = await import(
      '@/lib/payments/cardnet-tokens'
    )
    const { leerCustomerIdDeCuenta } = await import('@/lib/payments/cardnet-tokens-core')
    const { prisma } = await import('@/lib/prisma')

    const email = user.email || ''
    const clienteId = user.metadata.clienteId ?? null
    const fila = clienteId
      ? await prisma.cliente
          .findUnique({ where: { id: clienteId }, select: { cardnetCustomerId: true } })
          .catch(() => null)
      : null
    const guardadoCrudo = fila?.cardnetCustomerId ?? null
    const guardadoUtil = leerCustomerIdDeCuenta(
      guardadoCrudo,
      config.publicKey ?? '',
      process.env.CARDNET_TOKENS_PRIVATE_KEY ?? ''
    )
    /**
     * `?customerId=NNNN` LEÍA EL CUSTOMER DE CUALQUIERA.
     *
     * Cualquier usuario con sesión podía pasar un id ajeno y recibir el correo
     * del titular, sus perfiles de pago con marca y últimos 4, y la respuesta
     * cruda del proveedor. Eso es leer datos de otro cliente —de otra empresa,
     * incluso— desde una ruta de diagnóstico, y ninguna pantalla lo delataba.
     *
     * No se borra el parámetro, porque mirar un Customer a mano es justo lo
     * que hace útil esta sonda cuando algo se rompe: se restringe a
     * SUPERADMIN, que es quien opera la plataforma. Para el resto, la sonda
     * mira su propio Customer y nada más.
     */
    const pedido = esSuperadmin
      ? req.nextUrl.searchParams.get('customerId')?.trim() || null
      : null
    const customerId = pedido ?? guardadoUtil

    if (!customerId) {
      return NextResponse.json({
        ...base,
        perfiles: {
          customerId: null,
          // Se distingue el «no hay nada guardado» del «hay, pero es de otra
          // cuenta de llaves»: son dos problemas distintos y se arreglan
          // distinto. El segundo es lo que pasa al cambiar de juego de llaves.
          guardado: guardadoCrudo ? 'presente pero de OTRA cuenta de llaves' : 'ninguno',
          nota: esSuperadmin
            ? 'Este cliente no tiene un CustomerId utilizable con las llaves actuales. Registra la tarjeta en la ventana de captura, o pasa uno a mano con ?customerId=NNNN.'
            : 'Este cliente no tiene un CustomerId utilizable con las llaves actuales. Registra la tarjeta en la ventana de captura.',
        },
      })
    }

    const [consulta, crudo] = await Promise.all([
      consultarClienteCardnet(customerId),
      consultarClienteDiagnostico(customerId),
    ])
    return NextResponse.json({
      ...base,
      perfiles: {
        customerId,
        origen: pedido ? 'query' : 'guardado en el cliente',
        emailDelCustomer: consulta.email,
        emailCoincide: (consulta.email ?? '').trim().toLowerCase() === email.trim().toLowerCase(),
        totalExtraidos: consulta.perfiles.length,
        extraidos: consulta.perfiles.map((p) => ({
          paymentProfileId: p.paymentProfileId,
          tieneToken: Boolean(p.token),
          habilitado: p.habilitado,
          marca: p.marca,
          ultimos4: p.ultimos4,
        })),
        consultaCruda: crudo,
      },
    })
  }
  // ?sesion=1: REPITE los pasos de la ventana de pago y enseña cada uno con su
  // respuesta cruda. Sin esto, un fallo en la sesión sale como un 502 mudo y
  // solo queda adivinar cuál de los tres pasos se rompió.
  if (req.nextUrl.searchParams.get('sesion') === '1' && config.configurado) {
    // Este modo REGISTRA un Customer (POST /customer) cuando no hay id
    // utilizable, y ese POST invalida el UniqueID de una ventana de captura
    // abierta —lo advierte el propio archivo—. O sea que puede tumbarle el
    // pago a alguien. Es un diagnóstico de despliegue, no del cliente.
    if (!esAdminDespliegue) return soloAdmin()
    const { registrarClienteDiagnostico, consultarClienteCardnet, consultarClienteDiagnostico } =
      await import('@/lib/payments/cardnet-tokens')
    const { leerCustomerIdDeCuenta } = await import('@/lib/payments/cardnet-tokens-core')
    const { prisma } = await import('@/lib/prisma')

    const clienteId = user.metadata.clienteId ?? null
    const email = user.email || (clienteId ? `${clienteId}@membego.local` : '')
    const fila = clienteId
      ? await prisma.cliente
          .findUnique({ where: { id: clienteId }, select: { cardnetCustomerId: true } })
          .catch(() => null)
      : null

    const guardadoCrudo = fila?.cardnetCustomerId ?? null
    const guardadoUtil = leerCustomerIdDeCuenta(
      guardadoCrudo,
      config.publicKey ?? '',
      process.env.CARDNET_TOKENS_PRIVATE_KEY ?? ''
    )

    // Paso 1: registrar (solo si no hay id utilizable, igual que el flujo real).
    const registro = guardadoUtil ? [] : await registrarClienteDiagnostico(email)
    const customerId =
      guardadoUtil ??
      (() => {
        const ok = registro.find((r) => r.ok)
        const datos = (ok?.respuesta.Response ?? ok?.respuesta ?? {}) as Record<string, unknown>
        const v = datos.CustomerId ?? datos.customerId ?? ''
        return String(v).trim() || null
      })()

    // Paso 2: el GET del que salen CaptureURL y UniqueID (§4.1.2.2).
    const consulta = customerId ? await consultarClienteCardnet(customerId) : null
    const crudo = customerId ? await consultarClienteDiagnostico(customerId) : null

    return NextResponse.json({
      ...base,
      sesion: {
        rol: user.metadata.role,
        clienteId,
        emailUsado: email,
        guardadoEnBd: guardadoCrudo,
        guardadoUtilizable: guardadoUtil,
        paso1_registro: registro,
        customerIdResuelto: customerId,
        paso2_consulta: consulta
          ? {
              email: consulta.email,
              captureUrl: consulta.captureUrl,
              tieneUniqueId: Boolean(consulta.uniqueId),
              perfiles: consulta.perfiles.length,
            }
          : null,
        paso2_crudo: crudo,
      },
    })
  }

  // ?activar=1[&codigo=XXXXXX]: la sonda de la ACTIVACIÓN 3DS.
  //
  // El contrato ya está fijado por la documentación oficial (manual §7.5 +
  // Postman): el cuerpo es { Token, ActivationCode }. Esta sonda sigue siendo
  // útil para EJECUTARLO contra el ambiente de pruebas sin pasar por la
  // pantalla de pago: registra la tarjeta en la ventana de captura, entra aquí
  // y mira el expediente crudo de la activación.
  //
  //   · SIN código: solo consulta — enseña los perfiles del Customer con su
  //     estado (habilitado o pendiente). No gasta intentos.
  //   · CON código: ejecuta la activación REAL contra el último perfil
  //     pendiente y devuelve el cuerpo enviado + status + respuesta cruda,
  //     más la re-consulta (¿quedó Enabled?). OJO: un código incorrecto
  //     GASTA uno de los 3 intentos; al tercero CardNET borra la tarjeta.
  //
  // A propósito NO cobra después (a diferencia del flujo real, que activa y
  // cobra en un movimiento): aísla la pregunta del contrato de activación.
  if (req.nextUrl.searchParams.get('activar') === '1' && config.configurado) {
    // Solo lo que hace falta para MIRAR. Activar ya no se hace desde el GET,
    // así que ni `activarPerfilCardnet` ni `normalizarCodigoActivacion` pintan
    // nada aquí: viven en el POST.
    const { consultarClienteCardnet } = await import('@/lib/payments/cardnet-tokens')
    const { leerCustomerIdDeCuenta, perfilPendienteDeActivar } = await import(
      '@/lib/payments/cardnet-tokens-core'
    )
    const { prisma } = await import('@/lib/prisma')

    const clienteId = user.metadata.clienteId ?? null
    const fila = clienteId
      ? await prisma.cliente
          .findUnique({ where: { id: clienteId }, select: { cardnetCustomerId: true } })
          .catch(() => null)
      : null
    const customerId = leerCustomerIdDeCuenta(
      fila?.cardnetCustomerId ?? null,
      config.publicKey ?? '',
      process.env.CARDNET_TOKENS_PRIVATE_KEY ?? ''
    )
    if (!customerId) {
      return NextResponse.json({
        ...base,
        activacion: {
          error:
            'Tu cuenta aún no tiene Customer en CardNET: registra primero la tarjeta de prueba en la ventana de captura (pantalla de pago), y vuelve aquí.',
        },
      })
    }

    const consulta = await consultarClienteCardnet(customerId)
    const perfiles = consulta.perfiles.map((p) => ({
      paymentProfileId: p.paymentProfileId,
      marca: p.marca,
      ultimos4: p.ultimos4,
      habilitado: p.habilitado,
    }))
    const perfil = perfilPendienteDeActivar(consulta.perfiles)

    /**
     * EL GET SOLO MIRA. La ejecución se fue al POST de abajo, y no por
     * purismo:
     *
     *   · Un GET debe poder repetirse sin consecuencias. Este ejecutaba una
     *     activación real, y CardNET BORRA LA TARJETA al tercer código
     *     fallido. Una precarga del navegador, un enlace compartido o un
     *     simple volver-atrás en el historial bastaban para quemar intentos.
     *   · El código viajaba en la barra de direcciones: quedaba escrito en los
     *     registros de acceso, en el historial y en la cabecera `Referer`.
     *
     * En el POST el código va en el cuerpo y el límite es el de las rutas que
     * mueven dinero.
     */
    return NextResponse.json({
      ...base,
      activacion: {
        customerId,
        perfiles,
        pendienteDeActivar: perfil
          ? { paymentProfileId: perfil.paymentProfileId, ultimos4: perfil.ultimos4 }
          : null,
        nota: perfil
          ? 'Para EJECUTAR la activación: POST a esta misma ruta con {"activar":true,"codigo":"XXXXXX"} en el cuerpo. Ya no se hace por GET (ver el comentario en el código). Un código incorrecto gasta 1 de los 3 intentos.'
          : 'No hay perfil pendiente de activar: registra la tarjeta de prueba en la ventana de captura primero.',
      },
    })
  }

  if (req.nextUrl.searchParams.get('probar') !== '1' || !config.configurado) {
    return NextResponse.json(base)
  }
  // Crea una sesión de captura real contra el proveedor: mismo riesgo que
  // `?sesion=1` sobre una ventana de pago abierta.
  if (!esAdminDespliegue) return soloAdmin()
  const prueba = await probarSesionTokens()
  return NextResponse.json({ ...base, prueba })
}

/**
 * EJECUTA la activación de diagnóstico. Cuerpo: `{ activar: true, codigo }`.
 *
 * Es el mismo expediente crudo que antes daba `?activar=1&codigo=`, con las
 * tres diferencias que lo hacen seguro: es un POST (no lo dispara una
 * precarga), el código va en el cuerpo (no queda en registros ni historial) y
 * pasa por `paymentLimiter`, el presupuesto estrecho de las rutas que mueven
 * dinero — que es exactamente la categoría de algo que puede borrar una
 * tarjeta al tercer fallo.
 *
 * Sigue sin cobrar después, a propósito: aísla la pregunta del contrato de
 * activación del flujo real, que activa y cobra en un movimiento.
 */
export async function POST(req: NextRequest) {
  if (!(await paymentLimiter(getClientIdentifier(req)))) {
    return NextResponse.json({ error: 'Demasiados intentos. Espera un momento.' }, { status: 429 })
  }

  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 })
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Solicitud ilegible.' }, { status: 400 })
  }
  if (cuerpo.activar !== true) {
    return NextResponse.json(
      { error: 'Cuerpo esperado: {"activar":true,"codigo":"XXXXXX"}.' },
      { status: 400 }
    )
  }
  if (!cardnetTokensConfigurado()) {
    return NextResponse.json({ error: 'La pasarela no está configurada en este despliegue.' }, { status: 400 })
  }

  const { consultarClienteCardnet, consultarClienteDiagnostico, activarPerfilCardnet } =
    await import('@/lib/payments/cardnet-tokens')
  const { normalizarCodigoActivacion, leerCustomerIdDeCuenta, perfilPendienteDeActivar } =
    await import('@/lib/payments/cardnet-tokens-core')
  const { prisma } = await import('@/lib/prisma')

  const codigo = normalizarCodigoActivacion(
    typeof cuerpo.codigo === 'string' ? cuerpo.codigo : ''
  )
  if (!codigo) {
    // Se comprueba ANTES de gastar un intento contra el proveedor.
    return NextResponse.json(
      { error: 'El código debe quedar en 6 caracteres alfanuméricos tras normalizar.' },
      { status: 400 }
    )
  }

  const clienteId = user.metadata.clienteId ?? null
  const fila = clienteId
    ? await prisma.cliente
        .findUnique({ where: { id: clienteId }, select: { cardnetCustomerId: true } })
        .catch(() => null)
    : null
  // El CustomerId NUNCA sale del cuerpo: solo de la cuenta de quien llama.
  const customerId = leerCustomerIdDeCuenta(
    fila?.cardnetCustomerId ?? null,
    process.env.CARDNET_TOKENS_PUBLIC_KEY?.trim() ?? '',
    process.env.CARDNET_TOKENS_PRIVATE_KEY ?? ''
  )
  if (!customerId) {
    return NextResponse.json({
      activacion: {
        error:
          'Tu cuenta aún no tiene Customer en CardNET: registra primero la tarjeta en la ventana de captura.',
      },
    })
  }

  const consulta = await consultarClienteCardnet(customerId)
  const perfiles = consulta.perfiles.map((p) => ({
    paymentProfileId: p.paymentProfileId,
    marca: p.marca,
    ultimos4: p.ultimos4,
    habilitado: p.habilitado,
  }))
  const perfil = perfilPendienteDeActivar(consulta.perfiles)
  if (!perfil) {
    return NextResponse.json({
      activacion: {
        customerId,
        perfiles,
        error: 'No hay perfil pendiente de activar (¿ya se activó, o la tarjeta se borró?).',
      },
    })
  }
  if (!perfil.token) {
    return NextResponse.json({
      activacion: {
        customerId,
        perfiles,
        error:
          'El perfil pendiente no trae Token, y el servicio lo exige para activar (§7.5). Registra la tarjeta de nuevo.',
      },
    })
  }

  const resultado = await activarPerfilCardnet({ customerId, token: perfil.token, codigo })
  // La prueba de fuego no es el status, es si el perfil quedó habilitado (o si
  // desapareció — tercer intento fallido).
  const despues = await consultarClienteCardnet(customerId)
  const despuesCrudo = await consultarClienteDiagnostico(customerId)

  return NextResponse.json({
    activacion: {
      customerId,
      perfilProbado: { paymentProfileId: perfil.paymentProfileId, ultimos4: perfil.ultimos4 },
      // El cuerpo enviado se describe SIN el código: repetirlo aquí lo
      // devolvería a un registro, que es justo lo que se vino a evitar.
      cuerpoEnviado: { Token: perfil.token, ActivationCode: '(6 caracteres, no se registra)' },
      respuestaActivate: { ok: resultado.ok, status: resultado.status, crudo: resultado.crudo },
      perfilesDespues: despues.perfiles.map((p) => ({
        paymentProfileId: p.paymentProfileId,
        ultimos4: p.ultimos4,
        habilitado: p.habilitado,
      })),
      consultaDespuesCruda: despuesCrudo,
    },
  })
}
