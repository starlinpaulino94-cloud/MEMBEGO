import 'server-only'

import { sinEmpresa, type Tx } from '@/lib/tenant'
import { claveIdempotencia } from './codigos'
import { emitirDerechoEnTx, retener, type ResultadoEmision } from './derechos'
import { cupoPorEmitir } from './asignaciones'
import { candidatosParaEntregar } from './pool'
import { ORIGEN_POR_DESTINO, type SupplyDestino } from './catalogo'
import type { EstrategiaSeleccion } from './fefo'

/**
 * MEMBEGO SUPPLY · DISTRIBUCIÓN (Fases 21-28, 55-57).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA PUERTA PARA LOS SIETE CANALES
 *
 * Regalo de bienvenida, oferta con descuento, beneficio de membresía,
 * recompensa por puntos, premio de referidos, campaña de influencers y entrega
 * manual de soporte entregan EXACTAMENTE la misma cosa: una unidad de un lote.
 * Lo único que cambia es quién decide que esa persona se la merece.
 *
 * Por eso hay una función —`entregar`— y no siete. Siete caminos hacia el
 * ledger serían siete sitios donde olvidarse de comprobar el cupo de la
 * campaña, siete claves de idempotencia distintas y siete formas de que el
 * invariante se rompa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SUPPLY RESPONDE «¿QUIÉN PONE LA UNIDAD?», NO «¿QUIÉN SE LA MERECE?»
 *
 * Esa segunda pregunta la siguen contestando los motores que ya existen:
 * promociones, campañas, membresías, recompensas y referidos. Este módulo no
 * los reemplaza ni les copia las reglas (Fase 72): recibe la decisión ya tomada
 * y se encarga de que salga una unidad de verdad, del lote correcto, sin
 * sobregiro y con su rastro.
 */

export interface PeticionEntrega {
  clienteId: string
  /** Desde qué canal se entrega. Decide el origen del derecho y sus reglas. */
  destino: SupplyDestino
  /** Campaña concreta, si la hay. Sin ella se tira de las unidades libres. */
  asignacionId?: string | null
  /** Lote concreto. Sin él se elige por FEFO entre los candidatos. */
  loteId?: string | null
  /** Filtros para elegir lote cuando no se dice cuál. */
  proveedorId?: string | null
  item?: string | null
  sucursalId?: string | null
  estrategia?: EstrategiaSeleccion
  /** Lo que el cliente le pagó a Membego. 0 = regalo. */
  precioCliente?: number
  /** Referencia del motor que decidió la entrega (campaña, regla, programa). */
  referencia?: string | null
  actorId?: string | null
}

export type ResultadoEntrega =
  | { ok: true; derechoId: string; voucherId: string; codigo: string; loteId: string; costo: number; reutilizado: boolean }
  | { ok: false; mensaje: string }

/**
 * Entrega una unidad a una persona desde el canal que sea.
 *
 * ELECCIÓN DE LOTE: cuando la campaña ya tiene lote (lo normal), se usa ese.
 * Cuando no —un premio de referidos que puede salir de cualquier pizza
 * disponible—, se elige por FEFO entre los candidatos: primero el que vence
 * antes, que es lo que evita tirar dinero.
 *
 * IDEMPOTENCIA: la clave se arma con el canal, el destino, el lote y la
 * persona. La misma recompensa concedida dos veces por un reintento devuelve
 * el derecho que ya existe en vez de emitir otro.
 */
export async function entregar(p: PeticionEntrega): Promise<ResultadoEntrega> {
  return sinEmpresa('Membego Supply: entregar una unidad desde un canal', async (tx) => {
    let loteId = p.loteId ?? null

    if (!loteId && p.asignacionId) {
      const asignacion = await tx.supplyAsignacion.findUnique({
        where: { id: p.asignacionId },
        select: { loteId: true },
      })
      loteId = asignacion?.loteId ?? null
    }

    if (!loteId) {
      const candidatos = await candidatosParaEntregar(tx, {
        proveedorId: p.proveedorId,
        sucursalId: p.sucursalId,
        item: p.item,
        estrategia: p.estrategia,
        // Sin campaña se tira de lo LIBRE: gastar lo apartado para la
        // bienvenida en un premio de referidos es exactamente lo que la
        // asignación existe para impedir.
        exigirDisponibles: !p.asignacionId,
      })
      loteId = candidatos[0]?.id ?? null
    }

    if (!loteId) {
      return { ok: false, mensaje: 'No hay supply disponible para entregar este beneficio.' }
    }

    if (p.asignacionId) {
      const cupo = await cupoPorEmitir(tx, p.asignacionId)
      if (cupo <= 0) return { ok: false, mensaje: 'La campaña ya repartió todas sus unidades.' }
    }

    const emision: ResultadoEmision = await emitirDerechoEnTx(tx, {
      loteId,
      clienteId: p.clienteId,
      asignacionId: p.asignacionId ?? null,
      origen: ORIGEN_POR_DESTINO[p.destino],
      precioCliente: p.precioCliente ?? 0,
      actorId: p.actorId ?? null,
      claveIdempotencia: claveIdempotencia(
        p.destino,
        p.asignacionId ?? loteId,
        p.clienteId,
        p.referencia
      ),
      meta: {
        canal: p.destino,
        ...(p.referencia ? { referencia: p.referencia } : {}),
        ...(p.sucursalId ? { sucursalPreferida: p.sucursalId } : {}),
      },
    })

    if (!emision.ok) return { ok: false, mensaje: emision.veredicto.mensaje }

    return {
      ok: true,
      derechoId: emision.derecho.derechoId,
      voucherId: emision.derecho.voucherId,
      codigo: emision.derecho.codigo,
      loteId: emision.derecho.loteId,
      costo: emision.derecho.costoUnitario,
      reutilizado: emision.derecho.reutilizado,
    }
  })
}

// ── Los siete canales, con su nombre ────────────────────────────────────────

/**
 * REGALO (Fase 21). «Regístrate en Membego y recibe una pizza gratis.»
 *
 * El costo de la unidad se imputa como adquisición de cliente en cuanto la
 * persona la consume; mientras el voucher siga sin canjear no costó nada.
 */
export function regalar(
  clienteId: string,
  asignacionId: string,
  referencia?: string
): Promise<ResultadoEntrega> {
  return entregar({ clienteId, destino: 'CAMPANA', asignacionId, referencia, precioCliente: 0 })
}

/**
 * BENEFICIO DE MEMBRESÍA (Fase 25). «Membego Gold incluye una pizza al mes.»
 *
 * `periodo` entra en la referencia —y por tanto en la clave de idempotencia—
 * para que el beneficio mensual se pueda conceder UNA vez cada mes y no una
 * sola vez en la vida: sin él, el segundo mes chocaría con la clave del primero
 * y el suscriptor se quedaría sin su pizza.
 */
export function porMembresia(
  clienteId: string,
  asignacionId: string,
  periodo: string
): Promise<ResultadoEntrega> {
  return entregar({
    clienteId,
    destino: 'MEMBRESIA',
    asignacionId,
    referencia: periodo,
    precioCliente: 0,
  })
}

/**
 * RECOMPENSA POR PUNTOS (Fase 26). «500 puntos → pizza gratis.»
 *
 * El canje de puntos lo decide el motor de recompensas; aquí solo sale la
 * unidad. `referencia` es el id del canje, así que dos llamadas del mismo
 * canje no consumen dos pizzas.
 */
export function porRecompensa(
  clienteId: string,
  canjeId: string,
  opciones: { asignacionId?: string; loteId?: string; item?: string } = {}
): Promise<ResultadoEntrega> {
  return entregar({
    clienteId,
    destino: 'RECOMPENSA',
    asignacionId: opciones.asignacionId ?? null,
    loteId: opciones.loteId ?? null,
    item: opciones.item ?? null,
    referencia: canjeId,
    precioCliente: 0,
  })
}

/**
 * PREMIO DE REFERIDOS (Fase 27). «Invita a 3 amigos y recibe una pizza.»
 *
 * Sale del MISMO pool que todo lo demás: si no queda supply, el premio no se
 * entrega y se dice por qué, en vez de prometer algo que ningún proveedor está
 * obligado a cumplir.
 */
export function porReferido(
  clienteId: string,
  recompensaId: string,
  opciones: { asignacionId?: string; item?: string } = {}
): Promise<ResultadoEntrega> {
  return entregar({
    clienteId,
    destino: 'REFERIDO',
    asignacionId: opciones.asignacionId ?? null,
    item: opciones.item ?? null,
    referencia: recompensaId,
    precioCliente: 0,
  })
}

/** Entrega manual de atención al cliente, con su rastro y su motivo. */
export function porSoporte(
  clienteId: string,
  loteId: string,
  motivo: string,
  actorId?: string | null
): Promise<ResultadoEntrega> {
  return entregar({
    clienteId,
    destino: 'RESERVA',
    loteId,
    referencia: motivo,
    actorId,
    precioCliente: 0,
  })
}

// ── Venta con descuento y checkout (Fases 22-23) ────────────────────────────

export interface ReservaCheckout {
  derechoId: string
  expiraEn: Date
  costo: number
}

/**
 * CHECKOUT · paso 1: apartar la unidad ANTES de cobrar (Fase 58).
 *
 * Sin esto, dos personas pagan la última pizza y una se queda sin ella con el
 * dinero ya cobrado. El hold caduca solo: si el pago no llega, la unidad
 * vuelve al pool sin que nadie tenga que acordarse.
 */
export async function apartarParaCompra(
  clienteId: string,
  loteId: string,
  minutos = 15
): Promise<{ ok: true; reserva: ReservaCheckout } | { ok: false; mensaje: string }> {
  const res = await retener({
    loteId,
    clienteId,
    origen: 'COMPRA',
    minutos,
  })
  if (!res.ok) return { ok: false, mensaje: res.veredicto.mensaje }
  return {
    ok: true,
    reserva: {
      derechoId: res.derecho.derechoId,
      expiraEn: new Date(Date.now() + minutos * 60_000),
      costo: res.derecho.costoUnitario,
    },
  }
}

/**
 * CHECKOUT · el puerto de cobro (Fase 23).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO SE SIMULA UNA PASARELA QUE NO EXISTE
 *
 * Cuando Membego compró la unidad entera y la revende a RD$399, ese dinero lo
 * cobra MEMBEGO, no el comercio: el comercio ya cobró por contrato. Eso exige
 * un cobro a nombre de la plataforma, y la infraestructura de pagos actual
 * cobra a nombre de cada EMPRESA.
 *
 * El prompt es explícito: «si la infraestructura actual todavía no permite
 * pagos, no simules seguridad financiera inexistente». Así que esto es un
 * PUERTO —la forma del contrato, no una implementación falsa—: quien lo
 * implemente recibe el derecho ya retenido y solo tiene que confirmarlo cuando
 * el dinero esté. Mientras tanto, el camino que SÍ funciona de punta a punta es
 * el regalo, que no cobra nada.
 */
export interface PuertoCobroMembego {
  /** Inicia el cobro y devuelve a dónde mandar a la persona, si hace falta. */
  iniciar(peticion: {
    clienteId: string
    derechoId: string
    monto: number
    moneda: string
    referencia: string
  }): Promise<{ ok: true; redirigirA?: string; referenciaPasarela: string } | { ok: false; mensaje: string }>

  /** ¿Está cobrado? Lo consulta el webhook o el retorno del usuario. */
  estado(referenciaPasarela: string): Promise<'PENDIENTE' | 'PAGADO' | 'FALLIDO'>
}

/** Todavía no hay pasarela a nombre de la plataforma. Se dice, no se finge. */
export const COBRO_MEMBEGO_DISPONIBLE = false

/** Lectura simple: ¿puede Membego vender supply hoy? */
export function puedeVenderSupply(): boolean {
  return COBRO_MEMBEGO_DISPONIBLE
}

// ── Marketplace (Fases 55, 56) ──────────────────────────────────────────────

export interface OfertaMarketplace {
  asignacionId: string
  loteId: string
  etiqueta: string
  producto: string
  variante: string | null
  proveedor: string
  proveedorSlug: string
  /** Cuántas quedan por repartir en esta campaña. */
  disponibles: number
  venceAt: Date
  /** Precio público de referencia, si se conoce. */
  precioReferencia: number | null
  /** Lo que el cliente pagaría a Membego. 0 = gratis. */
  precioMembego: number
  esGratis: boolean
}

/**
 * Lo que un cliente puede conseguir hoy con supply de Membego.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA CONSULTA NO DEVUELVE, Y ES DELIBERADO
 *
 * El costo unitario, el contrato, el proveedor como «proveedor», el saldo por
 * liquidar. Al consumidor le toca ver qué se lleva, de quién, cuántas quedan y
 * hasta cuándo. La economía interna de Membego no es parte de la oferta
 * (Fase 55), y una vez que un dato sale en una API pública ya no vuelve.
 */
export async function ofertasDisponibles(limite = 50): Promise<OfertaMarketplace[]> {
  return sinEmpresa('Membego Supply: vitrina pública de supply', async (tx) => {
    const asignaciones = await tx.supplyAsignacion.findMany({
      where: {
        activa: true,
        destinoTipo: { in: ['CAMPANA', 'OFERTA', 'REGALO'] },
        lote: { estado: 'ACTIVO', venceAt: { gt: new Date() } },
      },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true,
        etiqueta: true,
        cantidad: true,
        emitidas: true,
        liberadas: true,
        destinoTipo: true,
        lote: {
          select: {
            id: true,
            venceAt: true,
            snapshotItemNombre: true,
            snapshotVariante: true,
            snapshotPrecioReferencia: true,
            proveedor: { select: { name: true, slug: true } },
          },
        },
      },
    })

    return asignaciones
      .map((a) => {
        const disponibles = Math.max(0, a.cantidad - a.emitidas - a.liberadas)
        return {
          asignacionId: a.id,
          loteId: a.lote.id,
          etiqueta: a.etiqueta,
          producto: a.lote.snapshotItemNombre,
          variante: a.lote.snapshotVariante,
          proveedor: a.lote.proveedor.name,
          proveedorSlug: a.lote.proveedor.slug,
          disponibles,
          venceAt: a.lote.venceAt,
          precioReferencia: a.lote.snapshotPrecioReferencia
            ? Number(a.lote.snapshotPrecioReferencia)
            : null,
          // Vender supply exige el puerto de cobro; mientras no exista, todo lo
          // que se publica es gratis. Enseñar un precio que nadie puede cobrar
          // sería prometer una compra que termina en error.
          precioMembego: 0,
          esGratis: true,
        }
      })
      .filter((o) => o.disponibles > 0)
  })
}

// ── Cross-selling (Fase 28) ─────────────────────────────────────────────────

export interface RecorridoCliente {
  clienteId: string
  /** Empresa por la que entró a la red (su primera redención). */
  empresaDeEntrada: string | null
  /** Empresas distintas en las que ha consumido supply después. */
  empresasVisitadas: number
  /** true = consumió en más de una empresa: hubo conversión cruzada. */
  cruzo: boolean
}

/**
 * Recorrido de un cliente por la red.
 *
 * No es un motor de recomendación —la Fase 28 dice explícitamente que no hace
 * falta todavía— sino el REGISTRO con el que se podrá medir si el supply de
 * una empresa está trayendo clientes a las demás. Sin este dato, la hipótesis
 * central del modelo no se puede comprobar.
 */
export async function recorridoDelCliente(
  tx: Tx,
  clienteIds: readonly string[]
): Promise<RecorridoCliente[]> {
  if (clienteIds.length === 0) return []

  const redenciones = await tx.supplyRedencion.findMany({
    where: { clienteId: { in: [...clienteIds] }, reversadaAt: null },
    orderBy: { createdAt: 'asc' },
    select: { clienteId: true, proveedorId: true },
  })

  const porCliente = new Map<string, string[]>()
  for (const r of redenciones) {
    const lista = porCliente.get(r.clienteId) ?? []
    lista.push(r.proveedorId)
    porCliente.set(r.clienteId, lista)
  }

  return [...porCliente.entries()].map(([clienteId, proveedores]) => {
    const distintas = new Set(proveedores)
    return {
      clienteId,
      empresaDeEntrada: proveedores[0] ?? null,
      empresasVisitadas: distintas.size,
      cruzo: distintas.size > 1,
    }
  })
}
