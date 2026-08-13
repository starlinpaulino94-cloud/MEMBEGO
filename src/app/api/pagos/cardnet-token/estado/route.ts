import { createHash } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { cardnetTokensConfigurado, probarSesionTokens } from '@/lib/payments/cardnet-tokens'

export const dynamic = 'force-dynamic'

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
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Inicia sesión para ver el estado.' }, { status: 401 })
  }
  const base = {
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
  }
  if (req.nextUrl.searchParams.get('correo') === '1') {
    const { sendEmail } = await import('@/lib/email')
    const resultado = await sendEmail({
      to: user.email,
      subject: 'Prueba de correo — MembeGo',
      text: 'Si estás leyendo esto, el envío de correos de tu plataforma funciona correctamente.',
    })
    return NextResponse.json({ ...base, correoPrueba: { destinatario: user.email, ...resultado } })
  }
  // ?perfiles=1: crea/consulta el Customer del usuario logueado y muestra QUÉ
  // devuelve el proveedor al consultarlo (forma real de PaymentProfiles, si el
  // Email viene y cómo, y qué logra extraer nuestro parser). Sin sensibles.
  if (req.nextUrl.searchParams.get('perfiles') === '1' && base.configurado) {
    const { crearClienteCardnet, consultarClienteCardnet, consultarClienteDiagnostico } =
      await import('@/lib/payments/cardnet-tokens')
    const email = user.email || ''
    const cliente = await crearClienteCardnet({ email })
    if (!cliente) {
      return NextResponse.json({ ...base, perfiles: { error: 'No se pudo registrar/consultar el Customer.' } })
    }
    const [consulta, crudo] = await Promise.all([
      consultarClienteCardnet(cliente.customerId),
      consultarClienteDiagnostico(cliente.customerId),
    ])
    return NextResponse.json({
      ...base,
      perfiles: {
        customerId: cliente.customerId,
        emailDelCustomer: consulta.email,
        emailCoincide: (consulta.email ?? '').trim().toLowerCase() === email.trim().toLowerCase(),
        totalExtraidos: consulta.perfiles.length,
        extraidos: consulta.perfiles.map((p) => ({
          paymentProfileId: p.paymentProfileId,
          tieneToken: Boolean(p.token),
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
  if (req.nextUrl.searchParams.get('sesion') === '1' && base.configurado) {
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
      base.publicKey ?? '',
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

  // ?activar=1[&codigo=XXXXXX]: la sonda del contrato de ACTIVACIÓN 3DS.
  //
  // El endpoint `POST /Customer/{id}/activate` no está en el manual (sale del
  // Postman) y el NOMBRE del campo del código está marcado VERIFICAR-QA: hoy
  // se envían las grafías plausibles a la vez. Esta sonda es la manera de
  // fijar el contrato real SIN pasar por la pantalla de pago: registra la
  // tarjeta de prueba en la ventana de captura, entra aquí y mira el
  // expediente crudo de la activación.
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
  if (req.nextUrl.searchParams.get('activar') === '1' && base.configurado) {
    const { consultarClienteCardnet, consultarClienteDiagnostico, activarPerfilCardnet } =
      await import('@/lib/payments/cardnet-tokens')
    const { normalizarCodigoActivacion, leerCustomerIdDeCuenta } = await import(
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
      base.publicKey ?? '',
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
    const pendientes = consulta.perfiles.filter((p) => !p.habilitado)
    const perfil = pendientes[pendientes.length - 1] ?? null

    const codigo = normalizarCodigoActivacion(req.nextUrl.searchParams.get('codigo') ?? '')
    if (!codigo) {
      return NextResponse.json({
        ...base,
        activacion: {
          customerId,
          perfiles,
          pendienteDeActivar: perfil
            ? { paymentProfileId: perfil.paymentProfileId, ultimos4: perfil.ultimos4 }
            : null,
          nota: perfil
            ? 'Agrega &codigo=XXXXXX (los 6 caracteres del banco, p. ej. el «z2r78v» de «Cardnet:z2r78v») para ejecutar la activación real. Un código incorrecto gasta 1 de los 3 intentos.'
            : 'No hay perfil pendiente de activar: registra la tarjeta de prueba en la ventana de captura primero.',
        },
      })
    }
    if (!perfil) {
      return NextResponse.json({
        ...base,
        activacion: {
          customerId,
          perfiles,
          error: 'No hay perfil pendiente de activar (¿ya se activó, o la tarjeta se borró?).',
        },
      })
    }

    // El cuerpo que se envía, espejado aquí para que el expediente sea
    // autocontenido (debe coincidir con activarPerfilCardnet).
    const cuerpoEnviado = {
      ActivationCode: codigo,
      ActivationKey: codigo,
      Code: codigo,
      PaymentProfileId: perfil.paymentProfileId,
    }
    const resultado = await activarPerfilCardnet({
      customerId,
      paymentProfileId: perfil.paymentProfileId,
      codigo,
    })
    // Re-consulta: la prueba de fuego no es el status, es si el perfil quedó
    // habilitado (o si desapareció — tercer intento fallido).
    const despues = await consultarClienteCardnet(customerId)
    const despuesCrudo = await consultarClienteDiagnostico(customerId)

    return NextResponse.json({
      ...base,
      activacion: {
        customerId,
        perfilProbado: { paymentProfileId: perfil.paymentProfileId, ultimos4: perfil.ultimos4 },
        cuerpoEnviado,
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

  if (req.nextUrl.searchParams.get('probar') !== '1' || !base.configurado) {
    return NextResponse.json(base)
  }
  const prueba = await probarSesionTokens()
  return NextResponse.json({ ...base, prueba })
}
