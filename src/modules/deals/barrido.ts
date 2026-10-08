import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { cancelarPedidoEnTx } from '@/modules/orders/service'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { alertasDeOferta, claveDeAlertaDeOferta, textoDeAlertaDeOferta } from './domain'
import { terminarOfertaEnTx } from './service'

/**
 * COMMERCE CORE · ofertas con presupuesto — el barrido diario (Fase 5).
 *
 * Dos cosas, empresa por empresa y cada una en su propia transacción (un fallo no frena a las
 * demás; es idempotente):
 *
 *  1. Los reclamos que VENCIERON sin canjearse: se cancela su pedido (lo cierra el sistema, así
 *     que el reclamo queda EXPIRED), lo que libera el stock apartado, el cupo y lo reservado
 *     del presupuesto — esa cuota vuelve a estar disponible para otra persona.
 *  2. Las ofertas cuya vigencia TERMINÓ pasan a COMPLETED. Los cupones ya reclamados siguen
 *     valiendo hasta su propio vencimiento.
 *  3. Los AVISOS a la empresa sobre sus ofertas vivas: 80 % y 100 % del presupuesto, agotada y por vencer
 *     (`alertasDeOferta`). Cada aviso es idempotente: su clave (`claveDeAlertaDeOferta`) es única por usuario, así que
 *     repetir el barrido —o correr dos a la vez— no duplica nada, y ampliar el presupuesto o alargar la vigencia
 *     deja que el siguiente cruce avise de nuevo.
 *
 * El canje NO depende de este barrido: un cupón vencido ya se rechaza al escanearlo
 * (`RECLAMO_VENCIDO`); esto solo limpia y devuelve lo reservado.
 */

export interface ResultadoBarridoDeOfertas {
  reclamosVencidos: number
  ofertasTerminadas: number
  /** Avisos NUEVOS enviados a las empresas (presupuesto al 80 %/100 %, agotada, por vencer). */
  alertas: number
  errores: number
  /** `true` si se acabó el tiempo con trabajo todavía pendiente (la próxima pasada sigue donde quedó). */
  quedaTrabajo: boolean
}

const POR_LOTE = 200
/** Cuánto trabajar en una pasada. El cron admite 60 s: se deja margen para terminar el lote en curso. */
const PRESUPUESTO_MS = 40_000
const SISTEMA = { actor: 'SISTEMA' as const, actorId: null }

/**
 * Procesa lotes hasta vaciar lo pendiente o agotar el presupuesto de tiempo. Lo que falla se anota y no se reintenta en
 * la misma pasada (si no, un cupón que siempre falla taparía a los demás para siempre). Antes había un tope de 200 por
 * día: con más vencimientos que eso, el exceso seguía reservando presupuesto y la oferta quedaba agotada sin estarlo.
 */
export async function barridoDeOfertas(
  ahora: Date = new Date(),
  opciones: { presupuestoMs?: number; reloj?: () => number; porLote?: number } = {}
): Promise<ResultadoBarridoDeOfertas> {
  const reloj = opciones.reloj ?? (() => Date.now())
  const limite = reloj() + (opciones.presupuestoMs ?? PRESUPUESTO_MS)
  const porLote = opciones.porLote ?? POR_LOTE
  const r: ResultadoBarridoDeOfertas = { reclamosVencidos: 0, ofertasTerminadas: 0, alertas: 0, errores: 0, quedaTrabajo: false }

  const fallidosPedidos = new Set<string>()
  for (;;) {
    if (reloj() >= limite) {
      r.quedaTrabajo = true
      break
    }
    const lote = await sinEmpresa('barrido de ofertas: reclamos vencidos (recorre empresa por empresa)', (tx) =>
      tx.dealClaim.findMany({
        where: { status: 'CLAIMED', expiresAt: { lte: ahora }, ...(fallidosPedidos.size > 0 ? { orderId: { notIn: [...fallidosPedidos] } } : {}) },
        select: { orderId: true, companyId: true },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: porLote,
      })
    )
    if (lote.length === 0) break
    for (const { orderId, companyId } of lote) {
      if (reloj() >= limite) break
      try {
        await conEmpresa(companyId, (tx) => cancelarPedidoEnTx(tx, companyId, orderId, { motivo: 'El cupón de la oferta venció sin canjearse.' }, SISTEMA, ahora))
        r.reclamosVencidos++
      } catch (e) {
        r.errores++
        fallidosPedidos.add(orderId)
        console.error('[ofertas] vencer reclamo', orderId, e instanceof Error ? e.message : e)
      }
    }
  }

  const fallidasOfertas = new Set<string>()
  for (;;) {
    if (reloj() >= limite) {
      r.quedaTrabajo = true
      break
    }
    const lote = await sinEmpresa('barrido de ofertas: ofertas cuya vigencia terminó (recorre empresa por empresa)', (tx) =>
      tx.deal.findMany({
        where: { status: { in: ['ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED'] }, endsAt: { lte: ahora }, ...(fallidasOfertas.size > 0 ? { id: { notIn: [...fallidasOfertas] } } : {}) },
        select: { id: true, companyId: true },
        orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
        take: porLote,
      })
    )
    if (lote.length === 0) break
    for (const { id, companyId } of lote) {
      if (reloj() >= limite) break
      try {
        const x = await conEmpresa(companyId, (tx) => terminarOfertaEnTx(tx, companyId, id, { actorId: null }, ahora))
        if (x.cambio) r.ofertasTerminadas++
        else fallidasOfertas.add(id) // ya estaba terminada: que no vuelva a salir en la misma pasada
      } catch (e) {
        r.errores++
        fallidasOfertas.add(id)
        console.error('[ofertas] terminar oferta', id, e instanceof Error ? e.message : e)
      }
    }
  }

  await avisarDeOfertas(r, ahora, reloj, limite, porLote)
  return r
}

/** Paso 3 del barrido: los avisos de presupuesto y vigencia, página por página y empresa por empresa. */
async function avisarDeOfertas(r: ResultadoBarridoDeOfertas, ahora: Date, reloj: () => number, limite: number, porLote: number): Promise<void> {
  let cursor: string | undefined
  for (;;) {
    if (reloj() >= limite) {
      r.quedaTrabajo = true
      return
    }
    const pagina = await sinEmpresa('barrido de ofertas: avisos de presupuesto y vigencia (recorre empresa por empresa)', (tx) =>
      tx.deal.findMany({
        where: { status: { in: ['ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED'] } },
        select: { id: true, companyId: true, title: true, status: true, endsAt: true, currency: true, feePerRedemption: true, budgetTotal: true, budgetReserved: true, budgetSpent: true },
        orderBy: { id: 'asc' },
        take: porLote,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    )
    if (pagina.length === 0) return
    cursor = pagina[pagina.length - 1]!.id
    for (const d of pagina) {
      for (const tipo of alertasDeOferta(d, ahora)) {
        try {
          const clave = claveDeAlertaDeOferta(d.id, tipo, d)
          const yaAvisada = await sinEmpresa('barrido de ofertas: ¿ya se avisó? (la clave es única por usuario)', (tx) => tx.notificacion.count({ where: { dedupeKey: clave } }))
          if (yaAvisada > 0) continue
          const texto = textoDeAlertaDeOferta(tipo, d.title, d)
          const nuevos = await notificarAdmins(d.companyId, { tipo: 'SISTEMA', ...texto, href: `/admin/deals/${d.id}`, dedupeKey: clave })
          if (nuevos > 0) r.alertas++
        } catch (e) {
          r.errores++
          console.error('[ofertas] aviso de oferta', d.id, tipo, e instanceof Error ? e.message : e)
        }
      }
    }
    if (pagina.length < porLote) return
  }
}
