import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { formatMoney } from '@/lib/format'
import { landingUrlFor } from '@/lib/site'
import {
  RUTA_POLITICA_RENOVACION,
  TEXTO_VERSION_RENOVACION,
  partirTexto,
  periodoDelPlan,
  renderizarTexto,
} from '@/modules/pagos/consentimientosCore'
import {
  activarRenovacion,
  desactivarRenovacion,
  estadoRenovacion,
  tarjetasParaRenovar,
  type ActivarRenovacion,
  type EstadoRenovacion,
} from '@/modules/pagos/renovacionCliente'
import { renovacionVisible, type TarjetaDePantalla } from '@/modules/pagos/renovacionFormato'

/**
 * LA PUERTA DE LA RENOVACIÓN AUTOMÁTICA, compartida por todas las superficies.
 *
 * La web (acciones de servidor) y la app móvil (API) piden lo mismo y tienen que
 * recibir las mismas respuestas: quién puede, si la empresa puede cobrar con
 * tarjeta, que la aceptación sea explícita, de quién es la membresía y qué se
 * dice cuando algo no se puede. Si cada superficie escribiera su copia, una
 * comprobación de seguridad podría existir en una y faltar en la otra. Aquí se
 * decide una vez; lo que se hace una vez dentro está en `renovacionCliente.ts`.
 *
 * DOS REGLAS QUE NO SON LAS MISMAS:
 *
 *  · **Encender** exige el límite de peticiones, la aceptación explícita y que la
 *    empresa pueda cobrar con tarjeta ahora mismo (si no puede, prometer «se
 *    renovará sola» sería mentirle).
 *  · **Apagar** NO exige que la empresa pueda cobrar. Dejar de cobrarle a alguien
 *    no puede depender de un interruptor de la empresa.
 *
 * El texto que se registra como aceptado es siempre `TEXTO_VERSION_RENOVACION`:
 * lo que se muestra y lo que se anota salen de la misma fuente.
 */

export type ResultadoPuerta =
  | { ok: true }
  | { ok: false; error: string; estado: 400 | 403 | 404 | 409 | 429 | 500 }

/** Quién pide: la persona autenticada y su ficha. Lo mínimo que las dos superficies saben. */
export interface PedidoDeCliente {
  supabaseId: string
  clienteId: string
}

const NO_AUTORIZADO: ResultadoPuerta = { ok: false, error: 'No autorizado.', estado: 403 }

/**
 * La membresía de ESTA persona. La pertenencia es de la persona y no de la ficha
 * activa (cliente global): la misma regla que usa la pantalla de la membresía y
 * `cancelarMiMembresia`.
 */
async function membresiaDeLaPersona(quien: PedidoDeCliente, membershipId: string) {
  const m = await sinEmpresa('renovación: la persona busca su membresía entre todas sus fichas', (tx) =>
    tx.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, cliente: { select: { id: true, supabaseId: true, companyId: true } } },
    })
  ).catch(() => null)
  if (!m) return null
  const esSuya = m.cliente.supabaseId === quien.supabaseId || m.cliente.id === quien.clienteId
  return esSuya ? m : null
}

const MENSAJES: Record<Exclude<ActivarRenovacion, 'ok'>, { error: string; estado: 404 | 409 }> = {
  membresia_no_encontrada: { error: 'No encontramos esa membresía.', estado: 404 },
  membresia_no_activa: { error: 'La renovación automática solo se puede activar en una membresía activa.', estado: 409 },
  cancelacion_programada: { error: 'Esta membresía tiene la cancelación programada y no se va a renovar.', estado: 409 },
  cambio_de_plan_pendiente: { error: 'Primero termina de pagar el cambio de plan.', estado: 409 },
  plan_sin_precio: { error: 'Este plan no tiene un precio que cobrar.', estado: 409 },
  tarjeta_no_encontrada: { error: 'No encontramos esa tarjeta.', estado: 404 },
  tarjeta_sin_perfil: { error: 'Esa tarjeta no se puede usar para renovar. Registra otra al pagar.', estado: 409 },
  tarjeta_vencida: { error: 'Esa tarjeta está vencida. Registra una vigente al pagar.', estado: 409 },
}

export async function activarRenovacionDelCliente(
  quien: PedidoDeCliente,
  input: {
    membershipId: string
    tarjetaId: string
    /** Lo que dijo el formulario o la app: ¿marcó la casilla? */
    acepto: boolean
    /**
     * La versión del texto que la persona VIO al aceptar. Si no es la vigente (el
     * texto cambió entre que cargó la pantalla y que la aceptó), no se registra:
     * aceptar un texto y anotar otro es lo que este módulo existe para impedir.
     */
    textoVersionVista: string | null
    ip: string | null
    userAgent: string | null
  }
): Promise<ResultadoPuerta> {
  try {
    if (!(await formSubmitLimiter(quien.clienteId))) {
      return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en unos minutos.', estado: 429 }
    }
    if (!input.membershipId) return { ok: false, error: 'Falta la membresía.', estado: 400 }
    if (!input.tarjetaId) return { ok: false, error: 'Elige la tarjeta con la que se renovará.', estado: 400 }
    // SIN ACEPTACIÓN EXPLÍCITA NO SE ENCIENDE. Es lo único que el servidor puede
    // exigir: que quien pide diga que se aceptó el texto. Un consentimiento que se
    // registra sin que nadie lo marque no es evidencia.
    if (!input.acepto) {
      return { ok: false, error: 'Marca la casilla para autorizar la renovación automática.', estado: 400 }
    }

    if (input.textoVersionVista !== TEXTO_VERSION_RENOVACION) {
      return { ok: false, error: 'El texto de la autorización cambió. Actualiza la pantalla y vuelve a leerlo.', estado: 409 }
    }

    const m = await membresiaDeLaPersona(quien, input.membershipId)
    if (!m) return NO_AUTORIZADO
    if (!(await puedeCobrarToken(m.cliente.companyId))) {
      return { ok: false, error: 'El pago con tarjeta no está disponible para este negocio.', estado: 403 }
    }

    const r = await activarRenovacion({
      companyId: m.cliente.companyId,
      clienteId: m.cliente.id,
      membershipId: input.membershipId,
      tarjetaId: input.tarjetaId,
      contexto: { textoVersion: TEXTO_VERSION_RENOVACION, ip: input.ip, userAgent: input.userAgent },
    })
    if (r !== 'ok') return { ok: false, ...MENSAJES[r] }
    return { ok: true }
  } catch (e) {
    console.error('[renovacion:activar]', e)
    return { ok: false, error: 'No pudimos activar la renovación automática. Intenta de nuevo.', estado: 500 }
  }
}

export async function desactivarRenovacionDelCliente(
  quien: PedidoDeCliente,
  membershipId: string
): Promise<ResultadoPuerta> {
  try {
    if (!(await formSubmitLimiter(quien.clienteId))) {
      return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en unos minutos.', estado: 429 }
    }
    if (!membershipId) return { ok: false, error: 'Falta la membresía.', estado: 400 }
    const m = await membresiaDeLaPersona(quien, membershipId)
    if (!m) return NO_AUTORIZADO
    const r = await desactivarRenovacion({
      companyId: m.cliente.companyId,
      clienteId: m.cliente.id,
      membershipId,
    })
    if (r === 'membresia_no_encontrada') return { ok: false, error: 'No encontramos esa membresía.', estado: 404 }
    return { ok: true }
  } catch (e) {
    console.error('[renovacion:desactivar]', e)
    return { ok: false, error: 'No pudimos desactivar la renovación. Intenta de nuevo.', estado: 500 }
  }
}

export interface PanelDeRenovacion {
  /** ¿La empresa puede cobrar con tarjeta ahora? Sin esto no se ofrece ACTIVAR (sí desactivar). */
  puedeActivar: boolean
  estado: EstadoRenovacion
  tarjetas: TarjetaDePantalla[]
}

/**
 * Lo que una pantalla necesita para el panel de renovación de una membresía, o
 * `null` si no se debe mostrar. Se ofrece ACTIVAR si la empresa puede cobrar con
 * tarjeta; si ya está activa se muestra siempre, para poder desactivarla aunque la
 * empresa haya apagado el cobro.
 *
 * Fail-safe: si cualquiera de las consultas fallara, devuelve `null` — el panel
 * simplemente no aparece y NUNCA tumba la pantalla de la membresía.
 *
 * Quien llama decide ANTES si la membresía admite el panel (`renovacionVisible`).
 */
export async function cargarPanelDeRenovacion(m: {
  id: string
  companyId: string
  clienteId: string
}): Promise<PanelDeRenovacion | null> {
  try {
    const [puedeActivar, estado, tarjetas] = await Promise.all([
      puedeCobrarToken(m.companyId),
      estadoRenovacion(m.companyId, m.id),
      tarjetasParaRenovar(m.companyId, m.clienteId),
    ])
    return puedeActivar || estado.activa ? { puedeActivar, estado, tarjetas } : null
  } catch {
    return null
  }
}

/** Lo que la app móvil muestra de la renovación de una membresía (el SERVIDOR decide todo). */
export type RenovacionParaLaApp =
  | { disponible: false }
  | {
      disponible: true
      activa: boolean
      /** Se activó antes de que existiera el registro de consentimientos: se ofrece confirmarla. */
      heredada: boolean
      tarjetaActual: { id: string; marca: string | null; ultimos4: string | null } | null
      puedeActivar: boolean
      tarjetas: TarjetaDePantalla[]
      proximoCobro: Date | null
      montoTexto: string
      consentimiento: { textoVersion: string; titulo: string; detalle: string; urlCondiciones: string }
    }

/**
 * La renovación automática de una membresía, para la app móvil: si se ofrece, con
 * qué tarjetas y el texto del consentimiento tal como se registrará. Con la misma
 * regla de visibilidad y el mismo panel que la web.
 *
 * La app muestra esto tal cual y devuelve `consentimiento.textoVersion` al aceptar.
 */
export async function renovacionParaLaApp(
  quien: PedidoDeCliente,
  membershipId: string
): Promise<{ ok: true; cuerpo: RenovacionParaLaApp } | { ok: false; error: string; estado: 403 | 404 | 500 }> {
  try {
    const m = await sinEmpresa('renovación: la app lee la renovación de una membresía para su propietaria', (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        select: {
          id: true,
          clienteId: true,
          companyId: true,
          estado: true,
          fechaVencimiento: true,
          planIdSolicitado: true,
          canceladaAlVencimiento: true,
          plan: { select: { precio: true, vigenciaDias: true } },
          cliente: {
            select: {
              id: true,
              supabaseId: true,
              company: { select: { name: true, moneda: true, idioma: true, zonaHoraria: true } },
            },
          },
        },
      })
    )
    if (!m) return { ok: false, error: 'Membresía no encontrada.', estado: 404 }
    if (m.cliente.supabaseId !== quien.supabaseId && m.cliente.id !== quien.clienteId) {
      return { ok: false, error: 'No autorizado.', estado: 403 }
    }

    const precio = Number(m.plan.precio)
    const admitePanel = renovacionVisible({
      estado: m.estado,
      fechaVencimiento: m.fechaVencimiento,
      planIdSolicitado: m.planIdSolicitado,
      canceladaAlVencimiento: m.canceladaAlVencimiento,
      precioPlan: precio,
    })
    const panel = admitePanel
      ? await cargarPanelDeRenovacion({ id: m.id, companyId: m.companyId, clienteId: m.clienteId })
      : null
    if (!panel) return { ok: true, cuerpo: { disponible: false } }

    const montoTexto = formatMoney(precio, m.cliente.company)
    const texto = partirTexto(
      renderizarTexto(TEXTO_VERSION_RENOVACION, {
        empresa: m.cliente.company.name,
        monto: montoTexto,
        periodo: periodoDelPlan(m.plan.vigenciaDias),
      })
    )
    return {
      ok: true,
      cuerpo: {
        disponible: true,
        activa: panel.estado.activa,
        heredada: panel.estado.origen === 'HEREDADO',
        tarjetaActual: panel.estado.tarjeta,
        puedeActivar: panel.puedeActivar,
        tarjetas: panel.tarjetas,
        proximoCobro: m.fechaVencimiento,
        montoTexto,
        consentimiento: {
          textoVersion: TEXTO_VERSION_RENOVACION,
          titulo: texto.titulo,
          detalle: texto.detalle,
          urlCondiciones: landingUrlFor(RUTA_POLITICA_RENOVACION),
        },
      },
    }
  } catch (e) {
    console.error('[renovacion:app]', e)
    return { ok: false, error: 'No pudimos cargar la renovación automática.', estado: 500 }
  }
}
