import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { reintentarEntrega } from '@/modules/pagos/intentos'
import { asegurarVentaDelIntento } from '@/modules/pagos/venta-tarjeta'
import { asentarEnBitacora } from '@/modules/observabilidad/conciliacion-servicio'
import { entregaRequierePersona, situacionDeEntrega, type EstadoDeEntrega } from '@/modules/observabilidad/conciliacion-entrega'
import {
  UMBRAL_AVISO_MS,
  VENTANA_COMPROBANTE_DIAS,
  avisoDeEntregas,
  claveDeAvisoDelDia,
  decidirReintento,
} from '@/modules/pagos/barrido-entregas-reglas'

/**
 * EL BARRIDO DE ENTREGAS DE PAGO (cron) — la red de seguridad de un cobro con tarjeta.
 *
 * Hace tres cosas, en este orden, y ninguna recobra dinero:
 *
 *   1 · REINTENTA la entrega de los clientes que pagaron y siguen sin su producto (`reintentarEntrega`, la misma función
 *       de siempre: reclama el cobro con un candado, así que correrlo a la vez que un clic de la conciliación o que el
 *       retorno del navegador no activa dos veces). Cobros recientes, con tope de reintentos y espera creciente: nunca
 *       insiste para siempre y nunca toca un cobro viejo que una persona debe mirar.
 *   2 · REPARA los comprobantes que faltan de cobros YA entregados y recientes (`asegurarVentaDelIntento`, idempotente).
 *       Solo cobros que ya nacen con su canal: no escribe comprobantes retroactivos de lo anterior (eso es una decisión).
 *   3 · AVISA a los administradores de cada empresa que todavía tiene clientes esperando: un aviso por empresa y día
 *       (clave estable en la notificación), con cuántos son y si ya hace falta una persona.
 *
 * Idempotente en conjunto: correrlo dos veces seguidas no duplica reintentos pasados el espaciado, ni comprobantes, ni avisos.
 * Cada cobro va por su cuenta: uno que falle no frena a los demás. Con presupuesto de tiempo, porque corre en una función
 * serverless con `maxDuration`: lo que no alcanza, lo recoge la siguiente pasada.
 */

/** Filas por página y páginas como máximo: lo que no cabe se marca `incompleto` en vez de callarse. */
const PAGINA = 500
const MAX_PAGINAS = 10
const MAX_REINTENTOS_POR_PASADA = 50
const MAX_COMPROBANTES_POR_PASADA = 200
/** Margen bajo `maxDuration = 60` de la ruta: se deja de empezar trabajo nuevo antes de que la función muera a mitad. */
const PRESUPUESTO_MS = 45_000

const SISTEMA = { userId: null as string | null }

export interface ResultadoBarridoEntregas {
  /** Clientes esperando que se miraron. */
  revisados: number
  /** Entregas que se reintentaron en esta pasada. */
  reintentadas: number
  /** De esas, las que terminaron entregando el producto. */
  entregadas: number
  /** Cobros que no se reintentaron: esperando su turno, sin reintentos que gastar, demasiado viejos o a cargo de una persona. */
  omitidos: { esperar: number; agotados: number; fueraDeVentana: number; requierenPersona: number }
  /** Comprobantes escritos por la autorreparación. */
  comprobantes: number
  /** Clientes que siguen esperando al terminar (los del aviso). */
  siguenEsperando: number
  /** Notificaciones NUEVAS a administradores (con la clave del día, repetir la pasada da 0). */
  avisos: number
  /** Cobros cuyo trabajo falló por una excepción (el log del servidor trae el detalle). */
  errores: number
  /** `true` si se paró por tiempo o por tope y queda trabajo para la siguiente pasada. */
  incompleto: boolean
}

/**
 * Los clientes que esperan su producto, los más recientes primero y por páginas.
 *
 * Antes era UNA lectura de 500 filas, las más antiguas primero, filtrada en memoria: con 500 cobros viejos que no eran
 * clientes esperando (registros sin cerrar, entregas en vuelo), los cobros recientes que sí lo eran nunca entraban en la
 * lectura y el barrido no los reintentaba ni los avisaba. Ahora se recorre por páginas (con tope) y el orden pone primero lo
 * reciente, que es lo que se puede reintentar.
 */
async function leerEsperando(ahora: Date, companyId?: string) {
  const esperando = []
  let cursor: string | undefined
  let truncado = false
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINAS) {
      truncado = true
      break
    }
    const filas = await sinEmpresa('barrido de entregas de pago: leer los cobros sin entregar de todas las empresas', (tx) =>
      tx.pagoIntento.findMany({
        where: { estado: 'APROBADO', fulfillmentEstado: { in: ['PENDIENTE', 'PROCESANDO', 'FALLIDA'] }, ...(companyId ? { companyId } : {}) },
        select: {
          id: true,
          companyId: true,
          monto: true,
          canal: true,
          activadoAt: true,
          updatedAt: true,
          fulfillmentEstado: true,
          fulfillmentIntentos: true,
          membership: { select: { pagoConfirmado: true, fechaPago: true, estado: true, planIdSolicitado: true } },
          compra: { select: { pagoConfirmado: true, fechaActivacion: true } },
        },
        orderBy: [{ activadoAt: 'desc' }, { id: 'desc' }],
        take: PAGINA,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    )
    // Solo los CLIENTES ESPERANDO: un registro sin cerrar (el producto ya está activo) o una entrega en vuelo no se tocan.
    for (const i of filas) {
      const situacion = situacionDeEntrega(
        { estado: i.fulfillmentEstado as EstadoDeEntrega, actualizadoAt: i.updatedAt, activadoAt: i.activadoAt, membership: i.membership, compra: i.compra },
        ahora
      )
      if (situacion === 'CLIENTE_ESPERANDO') esperando.push({ ...i, requierePersona: entregaRequierePersona({ canal: i.canal, membership: i.membership }) })
    }
    if (filas.length < PAGINA) break
    cursor = filas[filas.length - 1].id
  }
  return { esperando, truncado }
}

export async function barridoEntregasDePago(
  opciones: {
    ahora?: Date
    presupuestoMs?: number
    maxReintentos?: number
    /** Barrer UNA sola empresa (una pasada a mano, o una prueba). Sin ella, todas. */
    companyId?: string
    /** Quién escribe la venta de un cobro entregado. Solo las pruebas lo cambian (para simular que la base no la deja escribir). */
    asegurarVenta?: typeof asegurarVentaDelIntento
  } = {}
): Promise<ResultadoBarridoEntregas> {
  const ahora = opciones.ahora ?? new Date()
  const presupuesto = opciones.presupuestoMs ?? PRESUPUESTO_MS
  const maxReintentos = opciones.maxReintentos ?? MAX_REINTENTOS_POR_PASADA
  const inicio = Date.now()
  const sinTiempo = () => Date.now() - inicio >= presupuesto

  const r: ResultadoBarridoEntregas = {
    revisados: 0,
    reintentadas: 0,
    entregadas: 0,
    omitidos: { esperar: 0, agotados: 0, fueraDeVentana: 0, requierenPersona: 0 },
    comprobantes: 0,
    siguenEsperando: 0,
    avisos: 0,
    errores: 0,
    incompleto: false,
  }

  // ── 1 · reintentar a los clientes que esperan ──────────────────────────────────────────────────────────────────
  const lectura = await leerEsperando(ahora, opciones.companyId)
  const esperando = lectura.esperando
  if (lectura.truncado) r.incompleto = true
  r.revisados = esperando.length
  for (const i of esperando) {
    const decision = decidirReintento(
      { intentos: i.fulfillmentIntentos, actualizadoAt: i.updatedAt, activadoAt: i.activadoAt, requierePersona: i.requierePersona },
      ahora
    )
    if (decision === 'REQUIERE_PERSONA') r.omitidos.requierenPersona++
    else if (decision === 'ESPERAR') r.omitidos.esperar++
    else if (decision === 'AGOTADO') r.omitidos.agotados++
    else if (decision === 'FUERA_DE_VENTANA') r.omitidos.fueraDeVentana++
    else {
      if (r.reintentadas >= maxReintentos || sinTiempo()) {
        r.incompleto = true
        continue
      }
      r.reintentadas++
      try {
        const res = await reintentarEntrega(i.id)
        if (res.ok && res.entrega === 'COMPLETADA') {
          r.entregadas++
          await asentarEnBitacora(i.companyId, SISTEMA, 'CONCILIACION_ENTREGA_REINTENTADA', i.id, {
            origen: 'AUTOMATICO',
            estadoAnterior: i.fulfillmentEstado,
            resultado: 'COMPLETADA',
          })
        }
      } catch (e) {
        r.errores++
        console.error('[entregas-pago:reintento]', i.id, e instanceof Error ? e.message : e)
      }
    }
  }

  // ── 2 · reparar los comprobantes que faltan de cobros ya entregados y recientes ────────────────────────────────
  const sinVenta = await sinEmpresa('barrido de entregas de pago: cobros entregados sin comprobante (todas las empresas)', (tx) =>
    tx.pagoIntento.findMany({
      where: {
        estado: 'APROBADO',
        fulfillmentEstado: 'COMPLETADA',
        transaccion: { is: null },
        // Solo los que ya nacen con su canal: lo anterior no se factura hacia atrás (decisión pendiente del negocio).
        canal: { not: null },
        activadoAt: { gte: new Date(ahora.getTime() - VENTANA_COMPROBANTE_DIAS * 86_400_000) },
        ...(opciones.companyId ? { companyId: opciones.companyId } : {}),
      },
      select: { id: true, companyId: true },
      // Lo reciente primero: si hubiera cobros que no se dejan facturar, los más viejos no deben quitarle el turno a los nuevos.
      orderBy: [{ activadoAt: 'desc' }, { id: 'desc' }],
      take: MAX_COMPROBANTES_POR_PASADA + 1,
    })
  )
  if (sinVenta.length > MAX_COMPROBANTES_POR_PASADA) {
    r.incompleto = true
    sinVenta.length = MAX_COMPROBANTES_POR_PASADA
  }
  for (const i of sinVenta) {
    if (sinTiempo()) {
      r.incompleto = true
      break
    }
    try {
      const venta = await (opciones.asegurarVenta ?? asegurarVentaDelIntento)(i.id)
      if (!venta) {
        // `asegurarVentaDelIntento` no lanza: devuelve null cuando no pudo. Callarlo hacía que el cron dijera «todo bien»
        // mientras un cobro seguía sin comprobante.
        r.errores++
        console.error('[entregas-pago:comprobante]', i.id, 'no se pudo registrar la venta')
      } else if (venta.nueva) {
        r.comprobantes++
        await asentarEnBitacora(i.companyId, SISTEMA, 'CONCILIACION_COMPROBANTE_GENERADO', i.id, {
          origen: 'AUTOMATICO',
          ticketNumero: venta.ticketNumero,
          codigo: venta.codigo,
        })
      }
    } catch (e) {
      r.errores++
      console.error('[entregas-pago:comprobante]', i.id, e instanceof Error ? e.message : e)
    }
  }

  // ── 3 · avisar a los administradores de lo que sigue sin entregar ──────────────────────────────────────────────
  // Se vuelve a leer: lo que el paso 1 resolvió ya no cuenta, y lo que falló otra vez sí.
  const relectura = await leerEsperando(ahora, opciones.companyId)
  if (relectura.truncado) r.incompleto = true
  const siguen = relectura.esperando.filter((i) => i.activadoAt && ahora.getTime() - i.activadoAt.getTime() >= UMBRAL_AVISO_MS)
  r.siguenEsperando = siguen.length
  const porEmpresa = new Map<string, { esperando: number; monto: number; sinSalidaAutomatica: number }>()
  for (const i of siguen) {
    const e = porEmpresa.get(i.companyId) ?? { esperando: 0, monto: 0, sinSalidaAutomatica: 0 }
    e.esperando++
    e.monto += Number(i.monto)
    const d = decidirReintento(
      { intentos: i.fulfillmentIntentos, actualizadoAt: i.updatedAt, activadoAt: i.activadoAt, requierePersona: i.requierePersona },
      ahora
    )
    if (d === 'AGOTADO' || d === 'FUERA_DE_VENTANA' || d === 'REQUIERE_PERSONA') e.sinSalidaAutomatica++
    porEmpresa.set(i.companyId, e)
  }
  for (const [companyId, resumen] of porEmpresa) {
    try {
      const aviso = avisoDeEntregas(resumen)
      r.avisos += await notificarAdmins(companyId, {
        tipo: 'SISTEMA',
        titulo: aviso.titulo,
        mensaje: aviso.mensaje,
        href: '/admin/conciliacion',
        dedupeKey: claveDeAvisoDelDia(companyId, ahora),
      })
    } catch (e) {
      r.errores++
      console.error('[entregas-pago:aviso]', companyId, e instanceof Error ? e.message : e)
    }
  }

  return r
}
