import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { logErrorBd } from '@/lib/prisma-errors'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { esEmpresaDemo } from '@/modules/demo'
import {
  getTokensConfig,
  cardnetTokensConfigurado,
  cobrarConToken,
  consultarClienteCardnet,
  activarPerfilCardnet,
} from '@/lib/payments/cardnet-tokens'
import {
  MENSAJE_ACTIVACION_PENDIENTE,
  mismoPerfilCardnet,
  perfilPendienteDeActivar,
} from '@/lib/payments/cardnet-tokens-core'
import { crearIntento, confirmarIntento } from '@/modules/pagos/intentos'
import { montoDeObjetivo, type ObjetivoPago } from '@/modules/pagos/cardnet3ds'

/**
 * ORQUESTACIÓN DEL COBRO CON TARJETA HOSPEDADA (CardNET Tokenización).
 *
 * El navegador abre el iframe de CardNET, el cliente digita la tarjeta ALLÁ, y
 * nos devuelve un TOKEN. Este módulo recibe ese token y cobra. La tarjeta nunca
 * llega aquí — por eso este flujo es mucho más simple y seguro que el directo
 * (`cardnet3ds.ts`): no hay 3DS que orquestar (lo hace el iframe), no hay PAN.
 *
 * GARANTÍAS (las mismas del flujo directo):
 *  1. EL MONTO SALE DE LA BASE, NUNCA DEL NAVEGADOR (`montoDeObjetivo`).
 *  2. SOLO CARTOWN: capacidad `PAGO_CARDNET` + no empresa demo.
 *  3. IDEMPOTENCIA: activa una sola vez (`confirmarIntento`).
 *  4. EL TOKEN NO SE GUARDA (en Fase 1). Se usa para el cobro y se descarta.
 */

export type CobroTokenResultado =
  | { estado: 'aprobado'; compraId: string | null; membershipId: string | null }
  /**
   * La pasarela contestó CS012 (`PROFILE_MUST_BE_ACTIVATED_FIRST`): la tarjeta
   * existe pero todavía no está activada. NO es un rechazo del banco — falta
   * que el cliente teclee el código de 6 caracteres del microcargo. Ver
   * `exigeActivacionPrimero` en cardnet-tokens-core.ts.
   */
  | { estado: 'pendiente_activacion'; motivo: string; ultimos4: string | null }
  | { estado: 'rechazado'; motivo: string }
  | { estado: 'error'; motivo: string }

/** ¿Puede esta empresa cobrar con tarjeta hospedada ahora mismo? */
export async function puedeCobrarToken(companyId: string): Promise<boolean> {
  if (!cardnetTokensConfigurado()) return false
  const [capacidad, demo] = await Promise.all([
    tieneCapacidad(companyId, 'PAGO_CARDNET').catch(() => false),
    esEmpresaDemo(companyId),
  ])
  return capacidad && !demo
}

/**
 * Cobra un objetivo (membresía o compra) con el token del iframe. Registra el
 * intento, cobra, y activa el producto si aprobó — todo con el monto de la base.
 */
export async function cobrarObjetivoConToken(input: {
  objetivo: ObjetivoPago
  trxToken: string
  clienteIp: string
  userAgent?: string | null
}): Promise<CobroTokenResultado> {
  if (!getTokensConfig() || !(await puedeCobrarToken(input.objetivo.companyId))) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
  }
  if (!input.trxToken || input.trxToken.length < 8) {
    return { estado: 'error', motivo: 'No se recibió una tarjeta válida. Intenta de nuevo.' }
  }

  const monto = await montoDeObjetivo(input.objetivo)
  if (!monto) return { estado: 'error', motivo: 'No se encontró qué pagar, o ya no está pendiente.' }
  if (monto.pesos <= 0) return { estado: 'error', motivo: 'El monto a pagar no es válido.' }

  const intento = await crearIntento({
    companyId: input.objetivo.companyId,
    clienteId: input.objetivo.clienteId,
    proveedor: 'CARDNET',
    membershipId: input.objetivo.membershipId ?? null,
    compraId: input.objetivo.compraId ?? null,
    monto: monto.pesos,
    moneda: 'DOP',
    ipAddress: input.clienteIp,
    userAgent: input.userAgent ?? null,
  })

  let cobro
  try {
    cobro = await cobrarConToken({
      trxToken: input.trxToken,
      pesos: monto.pesos,
      orden: intento.id,
      clienteIp: input.clienteIp,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:cobrar', e, { intentoId: intento.id })
    await confirmarIntento(intento.id, {
      aprobada: false,
      autorizacion: null,
      motivo: 'No se pudo contactar la pasarela.',
      crudo: null,
    })
    return { estado: 'error', motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.' }
  }

  const res = await confirmarIntento(intento.id, {
    aprobada: cobro.aprobada,
    autorizacion: cobro.autorizacion,
    motivo: cobro.motivo,
    crudo: cobro.crudo,
  })

  if (res.ok) {
    return { estado: 'aprobado', compraId: res.compraId, membershipId: res.membershipId }
  }
  // SEGUNDA fuente de la pantalla de activación, y la más fiable.
  //
  // Hasta aquí, esa pantalla se abría SOLO si el listado de perfiles traía
  // `Enabled: false`. Ese campo puede no venir, y cuando no viene se asume
  // habilitado (a propósito: un campo ausente no debe bloquear un cobro que sí
  // habría pasado). Entonces se intentaba cobrar, CardNET respondía CS012, y
  // al cliente le salía «no se pudo procesar el pago» — un callejón sin salida
  // con el código de activación ya en su app del banco y ningún lugar donde
  // escribirlo. El error CS012 no es un campo opcional: es la respuesta
  // explícita del servicio a esa pregunta exacta.
  if (cobro.requiereActivacion) {
    return {
      estado: 'pendiente_activacion',
      motivo: MENSAJE_ACTIVACION_PENDIENTE,
      ultimos4: null,
    }
  }
  if (res.estado === 'RECHAZADO') {
    return { estado: 'rechazado', motivo: cobro.motivo ?? 'La tarjeta fue rechazada.' }
  }
  return { estado: 'error', motivo: res.motivo }
}

// ── Confirmación por perfil (camino oficial confirmado por CardNET) ─────────

/** Referencias del perfil cobrado, por si el cliente pidió guardar la tarjeta. */
export interface PerfilCobrado {
  customerId: string
  paymentProfileId: string | null
  token: string | null
  marca: string | null
  ultimos4: string | null
}

export type ConfirmacionPerfilResultado =
  | { estado: 'aprobado'; compraId: string | null; membershipId: string | null; perfil: PerfilCobrado }
  | { estado: 'sin_tarjeta' }
  | { estado: 'en_proceso' }
  | { estado: 'sin_pendiente' }
  /**
   * La tarjeta se registró pero CardNET la dejó deshabilitada a la espera del
   * código de activación de 6 dígitos (§4.1.2.3). Es un estado TERMINAL del
   * sondeo: seguir esperando no la va a habilitar sola.
   */
  | { estado: 'pendiente_activacion'; motivo: string; ultimos4: string | null }
  | { estado: 'rechazado'; motivo: string }
  | { estado: 'error'; motivo: string }

// Ventana en la que un intento CREADO se considera "en vuelo" y bloquea un
// segundo cobro del mismo objetivo (los dos canales — navegador y sondeo —
// pueden llegar casi a la vez).
const VENTANA_EN_VUELO_MS = 2 * 60 * 1000

/**
 * COBRA EL PENDIENTE CONSULTANDO AL PROVEEDOR (sin token del navegador).
 *
 * Camino confirmado por CardNET: tras la captura hospedada, el token queda en
 * `PaymentProfiles` al consultar el Customer. El servidor registra/consulta el
 * Customer por el email del cliente, toma el perfil MÁS RECIENTE y cobra con
 * su token por la misma tubería idempotente de siempre.
 *
 * `conteoAntes` (opcional) es cuántos perfiles tenía el Customer al abrir la
 * ventana de pago: solo se cobra si hay MÁS perfiles ahora — así, si el
 * cliente cierra la ventana sin registrar la tarjeta, un perfil viejo no se
 * cobra por accidente.
 */
export async function cobrarPendienteConPerfil(input: {
  objetivo: ObjetivoPago
  emailCliente: string
  clienteIp: string
  userAgent?: string | null
  conteoAntes?: number | null
  /**
   * CustomerId de la sesión de captura, si el navegador lo trae. Con él la
   * consulta es un GET puro — CRÍTICO mientras la ventana está abierta: un
   * POST /customer con el mismo email genera un UniqueID nuevo e INVALIDA la
   * sesión de la ventana (la mata con INTERNAL_SERVER_ERROR). El valor no se
   * confía a ciegas: el Email del Customer debe coincidir con el del usuario.
   */
  customerId?: string | null
}): Promise<ConfirmacionPerfilResultado> {
  if (!(await puedeCobrarToken(input.objetivo.companyId))) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
  }

  // ¿Hay un cobro de este mismo objetivo en vuelo? (doble canal / doble pestaña)
  const enVuelo = await conEmpresa(input.objetivo.companyId, (tx) =>
    tx.pagoIntento
      .findFirst({
        where: {
          proveedor: 'CARDNET',
          estado: 'CREADO',
          createdAt: { gte: new Date(Date.now() - VENTANA_EN_VUELO_MS) },
          ...(input.objetivo.membershipId ? { membershipId: input.objetivo.membershipId } : {}),
          ...(input.objetivo.compraId ? { compraId: input.objetivo.compraId } : {}),
        },
        select: { id: true },
      })
  ).catch(() => null)
  if (enVuelo) return { estado: 'en_proceso' }

  // Si ya no hay nada pendiente (p. ej. el otro canal ya cobró y activó),
  // el sondeo termina sin error y sin doble cobro.
  const monto = await montoDeObjetivo(input.objetivo)
  if (!monto || monto.pesos <= 0) return { estado: 'sin_pendiente' }

  // Resolver el Customer SIN tocar la sesión de la ventana abierta: con el
  // customerId de la sesión se consulta por GET y se verifica la pertenencia
  // por email. Solo si no llegó (caso raro) se cae al POST /customer — que es
  // seguro únicamente cuando la ventana ya se cerró.
  let customerId = input.customerId?.trim() || null
  let perfiles: Awaited<ReturnType<typeof consultarClienteCardnet>>['perfiles']
  if (customerId) {
    const consulta = await consultarClienteCardnet(customerId)
    const emailCoincide =
      !!consulta.email &&
      consulta.email.trim().toLowerCase() === input.emailCliente.trim().toLowerCase()
    if (!emailCoincide) {
      // Customer ajeno o consulta fallida: no se cobra nada con él.
      return { estado: 'sin_tarjeta' }
    }
    perfiles = consulta.perfiles
  } else {
    // Sin customerId del navegador: se usa el guardado del cliente (§4.1.2.1).
    // NUNCA se hace POST aquí — la ventana de captura puede seguir abierta y
    // un POST emitiría un UniqueID nuevo, matándola con INTERNAL_SERVER_ERROR.
    const guardado = await conEmpresa(input.objetivo.companyId, (tx) =>
      tx.cliente
        .findUnique({
          where: { id: input.objetivo.clienteId },
          select: { cardnetCustomerId: true },
        })
        .catch(() => null)
    )
    customerId = guardado?.cardnetCustomerId?.trim() || null
    if (!customerId) return { estado: 'sin_tarjeta' }
    perfiles = (await consultarClienteCardnet(customerId)).perfiles
  }
  const conteoAntes = Math.max(0, input.conteoAntes ?? 0)
  // Sin perfil NUEVO todavía: el cliente sigue digitando (o cerró sin terminar).
  if (perfiles.length === 0 || perfiles.length <= conteoAntes) {
    return { estado: 'sin_tarjeta' }
  }
  // El perfil recién agregado es el último de la lista (VERIFICAR-QA el orden).
  const perfil = perfiles[perfiles.length - 1]
  if (!perfil.token) return { estado: 'sin_tarjeta' }

  // MANUAL §4.1.2.2 punto 12: el PaymentProfile puede venir `Enabled: false`.
  // Con las llaves CON autenticación, la tarjeta recién capturada nace así:
  // CardNET cobra RD$1.00 y el banco le muestra al cliente un código de 6
  // dígitos que hay que ingresar para activarla (§4.1.2.3). Cobrar con un
  // perfil deshabilitado falla, y el fallo no explica por qué — por eso se
  // detecta aquí y se le dice al cliente qué tiene que hacer.
  if (!perfil.habilitado) {
    return {
      estado: 'pendiente_activacion',
      ultimos4: perfil.ultimos4,
      motivo: MENSAJE_ACTIVACION_PENDIENTE,
    }
  }

  const res = await cobrarObjetivoConToken({
    objetivo: input.objetivo,
    trxToken: perfil.token,
    clienteIp: input.clienteIp,
    userAgent: input.userAgent,
  })
  if (res.estado === 'aprobado') {
    return {
      ...res,
      perfil: {
        customerId,
        paymentProfileId: perfil.paymentProfileId,
        token: perfil.token,
        marca: perfil.marca,
        ultimos4: perfil.ultimos4,
      },
    }
  }
  // El cobro llegó a CS012: aquí SÍ se sabe de qué tarjeta se trata, así que
  // se completan los últimos 4 antes de devolverlo (el cobro por token suelto
  // no puede saberlo).
  if (res.estado === 'pendiente_activacion') {
    return { ...res, ultimos4: res.ultimos4 ?? perfil.ultimos4 }
  }
  return res
}

// ── Activación del perfil (llaves CON autenticación · §4.1.2.3) ─────────────

export type ActivacionResultado =
  /** Activó y además cobró el pendiente: el flujo completo en un movimiento. */
  | {
      estado: 'aprobado'
      compraId: string | null
      membershipId: string | null
      /** Referencias del perfil cobrado (para «guardar tarjeta», como en el cobro). */
      perfil: PerfilCobrado
    }
  /** Activó, pero el cobro posterior no aprobó (o no había qué cobrar). */
  | { estado: 'activada_sin_cobro'; motivo: string }
  /**
   * CardNET no aceptó el código. OJO: el manual da 3 intentos y al tercero
   * BORRA la tarjeta — el mensaje se lo advierte al cliente.
   */
  | { estado: 'codigo_rechazado'; motivo: string }
  /** No hay perfil pendiente de activar (ya se activó, o la tarjeta se borró). */
  | { estado: 'sin_perfil'; motivo: string }
  | { estado: 'error'; motivo: string }

/**
 * ACTIVA la tarjeta con el código del banco y, si CardNET la habilita, COBRA
 * el pendiente en el mismo movimiento — por la misma tubería idempotente de
 * siempre (`cobrarPendienteConPerfil`). El cliente teclea el código UNA vez y
 * sale con la membresía activa, no con un segundo botón que apretar.
 *
 * El customerId se resuelve con las mismas reglas de pertenencia que el cobro:
 * el de la sesión solo se usa si su email coincide con el del usuario; si no
 * llegó, se usa el guardado del cliente. Nunca se activa un Customer ajeno.
 */
export async function activarTarjetaPendiente(input: {
  objetivo: ObjetivoPago
  emailCliente: string
  codigo: string
  clienteIp: string
  userAgent?: string | null
  customerId?: string | null
  conteoAntes?: number | null
}): Promise<ActivacionResultado> {
  if (!(await puedeCobrarToken(input.objetivo.companyId))) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
  }

  // Resolver el Customer con las mismas reglas de pertenencia del cobro.
  //
  // La consulta de pertenencia se REUTILIZA para leer los perfiles. Antes se
  // consultaba dos veces el mismo Customer, una detrás de otra: 20s de límite
  // desperdiciados en una secuencia que ya encadena varias llamadas y que la
  // plataforma corta por tiempo. Es el mismo dato, en la misma petición.
  let customerId = input.customerId?.trim() || null
  let consultaPrevia: Awaited<ReturnType<typeof consultarClienteCardnet>> | null = null
  if (customerId) {
    const consulta = await consultarClienteCardnet(customerId)
    const emailCoincide =
      !!consulta.email &&
      consulta.email.trim().toLowerCase() === input.emailCliente.trim().toLowerCase()
    if (emailCoincide) consultaPrevia = consulta
    else customerId = null
  }
  if (!customerId) {
    const guardado = await conEmpresa(input.objetivo.companyId, (tx) =>
      tx.cliente
        .findUnique({
          where: { id: input.objetivo.clienteId },
          select: { cardnetCustomerId: true },
        })
        .catch(() => null)
    )
    customerId = guardado?.cardnetCustomerId?.trim() || null
  }
  if (!customerId) {
    return { estado: 'sin_perfil', motivo: 'No se encontró la tarjeta a activar. Regístrala de nuevo.' }
  }

  // El perfil a activar: el MÁS RECIENTE deshabilitado (mismo criterio que el
  // cobro usa para "el recién agregado").
  const { perfiles } = consultaPrevia ?? (await consultarClienteCardnet(customerId))
  const perfil = perfilPendienteDeActivar(perfiles)
  if (!perfil) {
    // Nada deshabilitado: o ya se activó (otra pestaña) o CardNET la borró al
    // tercer intento fallido. El cobro normal decide cuál de los dos es.
    return {
      estado: 'sin_perfil',
      motivo: 'No hay ninguna tarjeta pendiente de activar. Si el pago sigue pendiente, registra la tarjeta de nuevo.',
    }
  }

  // El servicio identifica el perfil por su TOKEN, no por su PaymentProfileId
  // (manual §7.5: ambos campos del objeto CustomerActivation son mandatorios).
  // Un perfil sin token no se puede activar: pedir la tarjeta de nuevo es más
  // honesto que gastarle un intento al cliente con una llamada que va a fallar.
  if (!perfil.token) {
    return {
      estado: 'sin_perfil',
      motivo: 'No se pudo identificar la tarjeta a activar. Regístrala de nuevo.',
    }
  }

  let activacion
  try {
    activacion = await activarPerfilCardnet({
      customerId,
      token: perfil.token,
      codigo: input.codigo,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:activar', e, { clienteId: input.objetivo.clienteId })
    return { estado: 'error', motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.' }
  }

  if (!activacion.ok) {
    // El proveedor no aceptó ESTA RESPUESTA. Sin contrato de error confirmado,
    // la verdad la da re-consultar el perfil — pero hay que leer bien lo que
    // dice, porque son TRES estados y no dos:
    //
    //   1. El perfil ya no está        → tercer fallo, CardNET la borró.
    //   2. El perfil está, deshabilitado → el código no era correcto.
    //   3. El perfil está, HABILITADO   → la activación SÍ funcionó, aunque la
    //      respuesta no viniera limpia. Aquí se sigue al cobro.
    //
    // EL FALLO QUE ESTO ARREGLA: la comprobación era
    // `some(p => !p.habilitado && p.paymentProfileId === …)`, que mezcla
    // «existe» con «sigue deshabilitado». En el caso 3 daba `false` y se le
    // decía al cliente que su tarjeta se había ELIMINADO — con la tarjeta viva
    // y activada, y sin cobrarle. Se dispara con facilidad porque el parser
    // trata un `Enabled` AUSENTE como habilitado (a propósito: un campo que no
    // viene no debe bloquear un cobro que sí habría pasado), así que bastaba
    // una respuesta sin ese campo para anunciar una tarjeta destruida.
    // El expediente crudo del `activate` fallido SE GUARDA. Antes se descartaba,
    // y sin él la única forma de saber qué respondió el proveedor era pedirle al
    // cliente que repitiera el fallo con una sonda delante. `evidencia()` ya pasa
    // por `sinSensibles`, y el código de activación no viaja en la respuesta.
    logErrorBd('pagos:cardnet-token:activate-rechazado', new Error('activate no aceptado'), {
      clienteId: input.objetivo.clienteId,
      status: activacion.status,
      errores: activacion.errores,
      crudo: activacion.crudo,
    })

    const despues = await consultarClienteCardnet(customerId)
    const mismo = despues.perfiles.find((p) => mismoPerfilCardnet(p, perfil))

    if (!mismo) {
      return {
        estado: 'sin_perfil',
        motivo: 'La tarjeta se eliminó tras varios intentos fallidos (así opera el banco). Regístrala de nuevo para reintentar el pago.',
      }
    }

    // SI EL PROVEEDOR DIJO QUÉ FALLÓ, MANDA ESO.
    //
    // Es más fiable que deducirlo del listado de perfiles, porque `Enabled`
    // puede no venir y entonces el perfil se lee como habilitado. Sin esta
    // rama, un código rechazado con el campo ausente terminaba pareciendo una
    // activación correcta y se caía a cobrar.
    if (activacion.errores.length > 0) {
      return {
        estado: 'codigo_rechazado',
        motivo: 'El código no fue aceptado. Revísalo en el cargo de RD$1.00 de tu banco (formato «Cardnet:XXXXXX»). Cuidado: al tercer intento fallido el banco elimina la tarjeta.',
      }
    }
    if (!mismo.habilitado) {
      return {
        estado: 'codigo_rechazado',
        motivo: 'El código no fue aceptado. Revísalo en el cargo de RD$1.00 de tu banco (formato «Cardnet:XXXXXX»). Cuidado: al tercer intento fallido el banco elimina la tarjeta.',
      }
    }
    // Solo aquí: el proveedor no señaló ningún error Y el perfil aparece
    // habilitado. Se cae al cobro a propósito — el cliente puso su código bien
    // y lo que espera es que se complete el pago.
  }

  // Activada → cobrar el pendiente por la tubería de siempre. `conteoAntes: 0`
  // a propósito: la tarjeta ya existe y está habilitada; la guarda de "solo
  // cobrar perfiles nuevos" aplicaba a la ventana de captura, no aquí.
  const cobro = await cobrarPendienteConPerfil({
    objetivo: input.objetivo,
    emailCliente: input.emailCliente,
    clienteIp: input.clienteIp,
    userAgent: input.userAgent,
    conteoAntes: 0,
    customerId,
  })
  if (cobro.estado === 'aprobado') {
    return {
      estado: 'aprobado',
      compraId: cobro.compraId,
      membershipId: cobro.membershipId,
      perfil: cobro.perfil,
    }
  }
  if (cobro.estado === 'sin_pendiente') {
    return { estado: 'activada_sin_cobro', motivo: 'Tu tarjeta quedó activa. No había ningún pago pendiente.' }
  }

  /**
   * EL COBRO DICE QUE LA TARJETA SIGUE SIN ACTIVAR (CS012).
   *
   * Este caso caía en el catch-all de abajo y salía como `activada_sin_cobro`,
   * un estado cuyo nombre AFIRMA lo contrario de lo que acaba de pasar. Dos
   * consecuencias, las dos malas:
   *
   *   · Al cliente se le devolvía «tu tarjeta quedó registrada pero falta
   *     activarla» — la instrucción de hacer justo lo que acababa de hacer.
   *   · La pantalla de activación se cerraba (el componente traduce
   *     `activada_sin_cobro` a un error general), así que NO PODÍA REINTENTAR
   *     con otro código sin volver a registrar la tarjeta entera.
   *
   * Si el Purchase responde CS012, la activación no surtió efecto: es un
   * código no aceptado, y lo que corresponde es dejar al cliente en la
   * pantalla para que lo intente de nuevo.
   */
  if (cobro.estado === 'pendiente_activacion') {
    return {
      estado: 'codigo_rechazado',
      motivo: 'El código no fue aceptado. Revísalo en el cargo de RD$1.00 de tu banco (formato «Cardnet:XXXXXX»). Cuidado: al tercer intento fallido el banco elimina la tarjeta.',
    }
  }

  const motivo =
    'motivo' in cobro && cobro.motivo
      ? cobro.motivo
      : 'Tu tarjeta quedó activa, pero el cobro no se completó. Intenta pagar de nuevo.'
  return { estado: 'activada_sin_cobro', motivo }
}
