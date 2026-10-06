/**
 * MEMBEGO SUPPLY · COBRO A NOMBRE DE LA PLATAFORMA (Fases 22-23).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CIERRA, Y POR QUÉ ESTABA ABIERTO
 *
 * Era el último hueco del módulo. Membego podía comprar 1.000 pizzas,
 * asignarlas, regalarlas y verlas redimir — pero no podía VENDER una.
 *
 * El motivo no era pereza: cuando Membego compró la unidad entera a RD$300 y la
 * revende a RD$399, ese dinero lo cobra MEMBEGO. El comercio ya cobró por
 * contrato, así que volver a cobrarle al cliente por la unidad base sería
 * cobrarla dos veces. Y toda la infraestructura de pagos del proyecto cobra a
 * nombre de una EMPRESA: `PaymentContext` lleva `companyId`, `MetodoPago` cuelga
 * de `companies`, y el proveedor de transferencia dice, literalmente, «a las
 * cuentas de la empresa».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE ARCHIVO NO HACE, Y ES LO IMPORTANTE
 *
 * No mueve supply. Ni una unidad. El movimiento vive donde ya vivía:
 *
 *   `retener`        DISPONIBLE → RETENIDO   (al abrir el pedido)
 *   `confirmarHold`  RETENIDO   → EMITIDO    (cuando el dinero está)
 *   `cancelarDerecho` RETENIDO  → DISPONIBLE (si no llega)
 *
 * Esas tres ya existían, probadas, con el lote bloqueado y el ledger cuadrando.
 * Este archivo solo responde a UNA pregunta —«¿pagó?»— y llama a la que toca.
 * Meterle aquí aritmética de cubetas habría duplicado el invariante en dos
 * sitios, y un invariante duplicado es un invariante que algún día discrepa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES REGLAS QUE SOSTIENEN EL COBRO
 *
 * Son las mismas que `docs/PAGOS.md` fijó para las compras de empresa, porque
 * el dinero no cambia de naturaleza por cambiar de destinatario:
 *
 *  1. LA APROBACIÓN LA DECIDE EL SERVIDOR. Aquí, además, la decide una PERSONA
 *     de Membego mirando un comprobante. El cliente nunca marca su propio
 *     pedido como pagado: `confirmarPedido` exige un revisor, y la base lo
 *     exige también (`supply_pedidos_revision_completa`).
 *
 *  2. TODO SE ACTIVA EXACTAMENTE UNA VEZ. `confirmarHold` lanza si el derecho
 *     no está RETENIDO, y el índice único `supply_pedidos_derechoId_key` impide
 *     dos pedidos por la misma unidad apartada. Dos confirmaciones a la vez: una
 *     gana, la otra se estrella.
 *
 *  3. EL MONTO SE COMPARA, NO SE CONFÍA. El precio se congela al abrir el
 *     pedido. Al confirmar, quien revisa declara lo que vio en el banco y se
 *     compara contra lo congelado. Si no cuadra, no se activa nada.
 */

import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import type { MetodoPagoTipo, Prisma } from '@prisma/client'
import { rutaValida } from '@/modules/storage/comprobantes'
import { montoCuadra } from './cobro-nucleo'
import { numeroPedido } from './codigos'
import { cancelarDerecho, confirmarHold, retener, MINUTOS_HOLD } from './derechos'
import { abrirVentaEnTx, marcarVentaPagadaEnTx } from './ventas'

type Tx = Prisma.TransactionClient

/** Lo que hace falta para abrir un pedido. */
export interface DatosPedido {
  clienteId: string
  loteId: string
  asignacionId?: string | null
  /** Lo que el cliente va a pagarle a Membego. Se congela en el pedido. */
  precio: number
  moneda?: string
  cuentaId?: string | null
  minutos?: number
  claveIdempotencia?: string | null
}

export type ResultadoPedido =
  | { ok: true; pedidoId: string; numero: string; derechoId: string; monto: number; expiraAt: Date }
  | { ok: false; mensaje: string }

// ── ¿Puede Membego vender hoy? ──────────────────────────────────────────────
//
// Antes esto era una constante en `false` que decía en voz alta «no hay
// pasarela». Ahora es una PREGUNTA A LA BASE, y la respuesta depende de que
// exista al menos una cuenta de cobro activa.
//
// Se calcula así, y no con una variable de entorno, porque el fallo que hay que
// evitar es que la vitrina publique un precio que nadie puede cobrar. Una
// bandera se enciende «para probar» y se olvida encendida; una cuenta activa es
// un hecho verificable, y si alguien la desactiva la vitrina se apaga con ella.

/** Las cuentas a las que un cliente puede transferirle a Membego. */
export async function cuentasDeCobro(): Promise<
  { id: string; tipo: string; nombre: string; titular: string | null; numeroCuenta: string | null; tipoCuenta: string | null; instrucciones: string | null }[]
> {
  return sinEmpresa('Membego Supply: cuentas de cobro de la plataforma', (tx) =>
    tx.supplyCuentaCobro.findMany({
      where: { activa: true },
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        tipo: true,
        nombre: true,
        titular: true,
        numeroCuenta: true,
        tipoCuenta: true,
        instrucciones: true,
      },
    })
  )
}

/** ¿Puede Membego cobrar a su nombre ahora mismo? */
export async function cobroMembegoDisponible(): Promise<boolean> {
  const cuantas = await sinEmpresa('Membego Supply: hay cuenta de cobro activa', (tx) =>
    tx.supplyCuentaCobro.count({ where: { activa: true } })
  )
  return cuantas > 0
}

// ── Administrar las cuentas ─────────────────────────────────────────────────

export interface CuentaAdmin {
  id: string
  tipo: MetodoPagoTipo
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
  moneda: string
  activa: boolean
  /** Cuántos pedidos la señalan. Una cuenta con historia no se borra. */
  pedidos: number
  createdAt: Date
}

/** Todas, activas e inactivas: es la vista de quien las administra. */
export async function cuentasParaAdministrar(): Promise<CuentaAdmin[]> {
  const filas = await sinEmpresa('Membego Supply: administrar cuentas de cobro', (tx) =>
    tx.supplyCuentaCobro.findMany({
      orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
      include: { _count: { select: { pedidos: true } } },
    })
  )
  return filas.map((c) => ({
    id: c.id,
    tipo: c.tipo,
    nombre: c.nombre,
    titular: c.titular,
    numeroCuenta: c.numeroCuenta,
    tipoCuenta: c.tipoCuenta,
    instrucciones: c.instrucciones,
    moneda: c.moneda,
    activa: c.activa,
    pedidos: c._count.pedidos,
    createdAt: c.createdAt,
  }))
}

export interface DatosCuenta {
  tipo: MetodoPagoTipo
  nombre: string
  titular?: string | null
  numeroCuenta?: string | null
  tipoCuenta?: string | null
  instrucciones?: string | null
  moneda?: string
}

/**
 * Da de alta una cuenta de cobro de Membego.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE ES EL DATO QUE ENCIENDE LA VENTA
 *
 * En cuanto existe una cuenta activa, `cobroMembegoDisponible` devuelve `true` y
 * la vitrina empieza a publicar las ofertas de pago. No hay un interruptor
 * aparte, y es deliberado: un sistema con dos llaves —«hay cuenta» y «vender
 * está encendido»— acaba con una de las dos en el estado que nadie esperaba.
 *
 * Por eso una cuenta se crea ACTIVA solo si quien la da de alta lo dice. El
 * formulario lo pregunta en vez de asumirlo.
 */
export async function crearCuentaCobro(
  d: DatosCuenta,
  activa: boolean
): Promise<{ ok: true; id: string } | { ok: false; mensaje: string }> {
  const nombre = d.nombre.trim()
  if (!nombre) return { ok: false, mensaje: 'La cuenta necesita un nombre.' }

  // Una transferencia sin número de cuenta no se puede hacer. Se exige aquí y
  // no solo en el formulario: publicar una cuenta a la que nadie puede
  // transferir enciende la venta y la rompe en el mismo gesto.
  const numero = d.numeroCuenta?.trim() || null
  if (d.tipo === 'TRANSFERENCIA' && !numero) {
    return { ok: false, mensaje: 'Una cuenta de transferencia necesita su número.' }
  }

  const id = await sinEmpresa('Membego Supply: alta de una cuenta de cobro', async (tx) => {
    const creada = await tx.supplyCuentaCobro.create({
      data: {
        tipo: d.tipo,
        nombre,
        titular: d.titular?.trim() || null,
        numeroCuenta: numero,
        tipoCuenta: d.tipoCuenta?.trim() || null,
        instrucciones: d.instrucciones?.trim() || null,
        moneda: (d.moneda || 'DOP').trim().toUpperCase().slice(0, 3),
        activa,
      },
      select: { id: true },
    })
    return creada.id
  })
  return { ok: true, id }
}

/**
 * Enciende o apaga una cuenta.
 *
 * No hay borrado, y no es un descuido: un pedido guarda a QUÉ cuenta se le pidió
 * transferir, y esa es la respuesta a «¿dónde dije que pagara?» seis meses
 * después. Apagarla la retira de la vitrina y deja la historia intacta, que es
 * lo que pide la Fase 63.
 *
 * Apagar la última cuenta activa APAGA LA VENTA. Se avisa, no se impide: puede
 * ser justo lo que alguien quiere hacer si la cuenta se cerró en el banco.
 */
export async function cambiarEstadoCuenta(
  cuentaId: string,
  activa: boolean
): Promise<{ ok: true; sinCobro: boolean } | { ok: false; mensaje: string }> {
  return sinEmpresa('Membego Supply: activar o desactivar una cuenta de cobro', async (tx) => {
    const cuenta = await tx.supplyCuentaCobro.findUnique({
      where: { id: cuentaId },
      select: { id: true, activa: true },
    })
    if (!cuenta) return { ok: false as const, mensaje: 'Cuenta no encontrada.' }
    if (cuenta.activa === activa) return { ok: true as const, sinCobro: false }

    await tx.supplyCuentaCobro.update({ where: { id: cuentaId }, data: { activa } })
    const quedan = await tx.supplyCuentaCobro.count({ where: { activa: true } })
    return { ok: true as const, sinCobro: quedan === 0 }
  })
}

// ── Abrir el pedido ─────────────────────────────────────────────────────────

/**
 * Aparta la unidad y abre el pedido. El orden importa: primero se RETIENE y
 * solo después se crea el pedido.
 *
 * Al revés —pedido primero, hold después— habría un instante con un pedido
 * cobrable sobre una unidad que otro puede llevarse, y el cliente pagaría por
 * algo que ya no está. Si el hold falla, aquí no se ha creado nada.
 */
export async function abrirPedido(d: DatosPedido): Promise<ResultadoPedido> {
  if (!Number.isFinite(d.precio) || d.precio < 0) {
    return { ok: false, mensaje: 'El precio de un pedido no puede ser negativo.' }
  }
  if (!(await cobroMembegoDisponible())) {
    return {
      ok: false,
      mensaje: 'Membego no tiene ninguna cuenta de cobro activa, así que no puede cobrar todavía.',
    }
  }

  // Una petición repetida devuelve el pedido que ya existe en vez de retener una
  // segunda unidad. Se mira ANTES del hold: es el hold lo que cuesta caro.
  if (d.claveIdempotencia) {
    const previo = await sinEmpresa('Membego Supply: pedido ya abierto con esta clave', (tx) =>
      tx.supplyPedido.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia! },
        select: { id: true, numero: true, derechoId: true, monto: true, expiraAt: true },
      })
    )
    if (previo) {
      return {
        ok: true,
        pedidoId: previo.id,
        numero: previo.numero,
        derechoId: previo.derechoId ?? '',
        monto: Number(previo.monto),
        expiraAt: previo.expiraAt,
      }
    }
  }

  const minutos = d.minutos ?? MINUTOS_HOLD
  const hold = await retener({
    loteId: d.loteId,
    clienteId: d.clienteId,
    origen: 'COMPRA',
    asignacionId: d.asignacionId ?? null,
    minutos,
    claveIdempotencia: d.claveIdempotencia ? `${d.claveIdempotencia}:hold` : null,
  })
  if (!hold.ok) return { ok: false, mensaje: hold.veredicto.mensaje }

  const expiraAt = new Date(Date.now() + minutos * 60_000)

  try {
    return await sinEmpresa('Membego Supply: abrir el pedido de un cliente', async (tx) => {
      const numero = await siguienteNumero(tx)
      const pedido = await tx.supplyPedido.create({
        data: {
          numero,
          clienteId: d.clienteId,
          derechoId: hold.derecho.derechoId,
          monto: d.precio,
          moneda: d.moneda ?? 'DOP',
          cuentaId: d.cuentaId ?? null,
          expiraAt,
          claveIdempotencia: d.claveIdempotencia ?? null,
        },
        select: { id: true, numero: true },
      })
      return {
        ok: true as const,
        pedidoId: pedido.id,
        numero: pedido.numero,
        derechoId: hold.derecho.derechoId,
        monto: d.precio,
        expiraAt,
      }
    })
  } catch (e) {
    // Si el pedido no se pudo crear, la unidad retenida NO se queda apartada
    // esperando a que el barrido la suelte en quince minutos: se suelta ahora.
    // Quince minutos de una unidad que nadie va a pagar es una venta perdida, y
    // con la última unidad de un lote es LA venta perdida.
    await cancelarDerecho(
      hold.derecho.derechoId,
      'El pedido no se pudo abrir; se devuelve la unidad al pool.',
      true
    ).catch(() => undefined)
    throw e
  }
}

// ── Venta sin precompra (§14) ───────────────────────────────────────────────

/**
 * Abre una venta a comisión Y su pedido en la misma transacción. No retiene
 * ninguna unidad: no hay lote. Lo que congela es el precio (en la venta) y el
 * monto a cobrar (en el pedido), y el pedido expira igual que los demás para
 * que una venta que nadie paga no se quede abierta contando contra el tope.
 */
export async function abrirPedidoDeVenta(d: {
  clienteId: string
  acuerdoId: string
  cantidad?: number
  sucursalId?: string | null
  cuentaId?: string | null
  minutos?: number
  claveIdempotencia?: string | null
  /** Venta mixta: derecho del cliente que cubre parte del valor. */
  bonoDerechoId?: string | null
}): Promise<ResultadoPedido & { ventaId?: string; montoBono?: number }> {
  if (!(await cobroMembegoDisponible())) {
    return { ok: false, mensaje: 'Membego no tiene ninguna cuenta de cobro activa, así que no puede cobrar todavía.' }
  }
  const minutos = d.minutos ?? MINUTOS_HOLD * 4
  return sinEmpresa('Membego Supply: abrir una venta sin precompra y su pedido', async (tx) => {
    if (d.claveIdempotencia) {
      const previo = await tx.supplyPedido.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia },
        select: { id: true, numero: true, ventaId: true, monto: true, expiraAt: true },
      })
      if (previo) {
        return { ok: true as const, pedidoId: previo.id, numero: previo.numero, derechoId: '', ventaId: previo.ventaId ?? undefined, monto: Number(previo.monto), expiraAt: previo.expiraAt }
      }
    }
    const venta = await abrirVentaEnTx(tx, {
      acuerdoId: d.acuerdoId,
      clienteId: d.clienteId,
      cantidad: d.cantidad,
      sucursalId: d.sucursalId,
      bonoDerechoId: d.bonoDerechoId ?? null,
      claveIdempotencia: d.claveIdempotencia ? `${d.claveIdempotencia}:venta` : null,
    })
    if (!venta.ok) return { ok: false as const, mensaje: venta.mensaje }
    const expiraAt = new Date(Date.now() + minutos * 60_000)
    const numero = await siguienteNumero(tx)
    // El pedido cobra la DIFERENCIA (bruto − bono). Si el bono cubre todo, el
    // pedido nace pagado con monto cero y la venta queda lista para entregar.
    const cubiertoPorBono = venta.aPagar <= 0
    const pedido = await tx.supplyPedido.create({
      data: {
        numero,
        clienteId: d.clienteId,
        ventaId: venta.ventaId,
        monto: venta.aPagar,
        cuentaId: d.cuentaId ?? null,
        expiraAt,
        claveIdempotencia: d.claveIdempotencia ?? null,
        ...(cubiertoPorBono ? { estado: 'PAGADO' as const, revisadoAt: new Date(), metodo: 'BONO' } : {}),
      },
      select: { id: true, numero: true },
    })
    if (cubiertoPorBono) await marcarVentaPagadaEnTx(tx, venta.ventaId)
    return { ok: true as const, pedidoId: pedido.id, numero: pedido.numero, derechoId: '', ventaId: venta.ventaId, monto: venta.aPagar, montoBono: venta.montoBono, expiraAt }
  })
}

/**
 * El siguiente número de pedido, contando lo que ya hay.
 *
 * Con `count` y no con una secuencia de PostgreSQL porque así se lee igual que
 * `numeroOrden`, y porque una colisión no rompe nada: el índice único de
 * `numero` la rechaza y el llamador reintenta. Lo que no puede pasar es que dos
 * pedidos compartan número, y de eso se encarga la base.
 */
async function siguienteNumero(tx: Tx): Promise<string> {
  const cuantos = await tx.supplyPedido.count()
  return numeroPedido(cuantos + 1)
}

// ── El cliente dice que pagó ────────────────────────────────────────────────

/**
 * El cliente sube su comprobante. Esto NO activa nada: solo pone el pedido en
 * la cola de revisión de Membego.
 *
 * `clienteId` se exige y se compara: sin eso, cualquiera con un id de pedido
 * podría colgarle un comprobante al pedido de otro.
 */
export async function adjuntarComprobante(
  pedidoId: string,
  clienteId: string,
  comprobantePath: string,
  nota?: string | null,
  metodo?: string | null
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const ruta = comprobantePath.trim()
  if (!ruta) return { ok: false, mensaje: 'Falta el comprobante.' }

  // La ruta viene del navegador, así que se comprueba que sea de ESTE pedido.
  // El token de subida ya la ató a quien la pidió, pero nada impediría enviar
  // aquí la ruta de OTRO pedido —una que la persona vio en su propia sesión— y
  // hacer pasar ese comprobante por el de este. La forma de la ruta es lo único
  // que hay que mirar, y es barato.
  if (!(await rutaValida('pedido', pedidoId, ruta))) {
    return { ok: false, mensaje: 'Ese comprobante no corresponde a este pedido.' }
  }

  return sinEmpresa('Membego Supply: adjuntar comprobante a un pedido', async (tx) => {
    const pedido = await tx.supplyPedido.findUnique({
      where: { id: pedidoId },
      select: { id: true, clienteId: true, estado: true, expiraAt: true },
    })
    if (!pedido || pedido.clienteId !== clienteId) {
      return { ok: false as const, mensaje: 'Pedido no encontrado.' }
    }
    if (pedido.estado !== 'INICIADO' && pedido.estado !== 'EN_REVISION') {
      return { ok: false as const, mensaje: `Este pedido está ${pedido.estado}.` }
    }
    // Un comprobante que llega tarde NO revive el pedido: la unidad ya volvió
    // al pool y puede estar vendida. Se dice, en vez de dejarlo en revisión
    // para que alguien lo apruebe y descubra después que no hay qué entregar.
    if (pedido.expiraAt <= new Date()) {
      return {
        ok: false as const,
        mensaje: 'El pedido expiró y la unidad volvió al pool. Vuelve a empezar.',
      }
    }

    await tx.supplyPedido.update({
      where: { id: pedidoId },
      data: {
        estado: 'EN_REVISION',
        comprobantePath: ruta,
        comprobanteNota: nota?.trim() || null,
        comprobanteAt: new Date(),
        metodo: metodo?.trim() || 'TRANSFERENCIA',
      },
    })
    return { ok: true as const }
  })
}

// ── Membego decide ──────────────────────────────────────────────────────────

/**
 * Una persona de Membego vio el dinero. Aquí se activa el derecho.
 *
 * `montoVisto` es lo que quien revisa dice haber encontrado en la cuenta, y se
 * compara contra el precio congelado al abrir el pedido. No es burocracia: es la
 * regla 3.3 de `docs/PAGOS.md`. Un comprobante por RD$39 aprobado a ojo para un
 * pedido de RD$399 regala una pizza, y el descuadre no aparece en ningún sitio
 * porque el derecho queda perfectamente emitido.
 */
export async function confirmarPedido(
  pedidoId: string,
  revisorId: string,
  montoVisto: number,
  /** EFECTIVO o MANUAL: Membego vio el dinero sin comprobante del cliente (§20). */
  metodoManual?: 'EFECTIVO' | 'MANUAL' | null
): Promise<{ ok: true; derechoId: string } | { ok: false; mensaje: string }> {
  const pedido = await sinEmpresa('Membego Supply: leer pedido a confirmar', (tx) =>
    tx.supplyPedido.findUnique({
      where: { id: pedidoId },
      select: { id: true, estado: true, derechoId: true, ventaId: true, clienteId: true, monto: true, expiraAt: true },
    })
  )
  if (!pedido) return { ok: false, mensaje: 'Pedido no encontrado.' }
  const manualValido = metodoManual && pedido.estado === 'INICIADO' && pedido.expiraAt > new Date()
  if (pedido.estado !== 'EN_REVISION' && !manualValido) {
    return {
      ok: false,
      mensaje:
        pedido.estado === 'PAGADO'
          ? 'Este pedido ya estaba confirmado.'
          : `Solo se confirma un pedido en revisión; este está ${pedido.estado}.`,
    }
  }
  // Nadie aprueba su propio pedido. El revisor es personal de Membego y el
  // cliente es un cliente, así que en la práctica no coinciden — pero «en la
  // práctica» no es un control, y esto cuesta una comparación.
  if (revisorId === pedido.clienteId) {
    return { ok: false, mensaje: 'Quien abre un pedido no puede confirmarlo.' }
  }

  const esperado = Number(pedido.monto)
  if (!montoCuadra(montoVisto, esperado)) {
    return {
      ok: false,
      mensaje: `El monto no cuadra: el pedido es por ${esperado.toFixed(2)} y el comprobante dice ${montoVisto.toFixed(2)}. No se activa nada.`,
    }
  }

  if (pedido.ventaId) {
    // Venta sin precompra: no hay hold que confirmar. La venta pasa a PAGADA y
    // el cliente recibe su código de recogida; la cuenta por pagar nace al
    // ENTREGAR, no aquí.
    const ventaId = pedido.ventaId
    await sinEmpresa('Membego Supply: marcar pagados el pedido y su venta', async (tx) => {
      await marcarVentaPagadaEnTx(tx, ventaId)
      await tx.supplyPedido.update({
        where: { id: pedidoId },
        data: { estado: 'PAGADO', revisadoPor: revisorId, revisadoAt: new Date(), ...(metodoManual ? { metodo: metodoManual } : {}) },
      })
    })
    return { ok: true, derechoId: '' }
  }
  if (!pedido.derechoId) return { ok: false, mensaje: 'El pedido no tiene derecho ni venta.' }

  // `confirmarHold` es quien mueve el supply y crea el voucher, y quien vuelve a
  // comprobar que la retención sigue viva. Si expiró, lanza, y el pedido NO se
  // marca pagado: es correcto, porque no hay nada que entregar.
  await confirmarHold(pedido.derechoId, esperado, revisorId)

  await sinEmpresa('Membego Supply: marcar el pedido como pagado', (tx) =>
    tx.supplyPedido.update({
      where: { id: pedidoId },
      data: { estado: 'PAGADO', revisadoPor: revisorId, revisadoAt: new Date(), ...(metodoManual ? { metodo: metodoManual } : {}) },
    })
  )

  return { ok: true, derechoId: pedido.derechoId }
}

/** Una venta cuyo pedido se rechaza, cancela o expira se cierra con ella. */
async function cerrarVentaDePedido(ventaId: string | null, motivo: string): Promise<void> {
  if (!ventaId) return
  const { cerrarVenta } = await import('./ventas')
  await cerrarVenta(ventaId, 'CANCELADA', motivo).catch(() => undefined)
}


/** Membego no vio el dinero. Se suelta la unidad y se dice por qué. */
export async function rechazarPedido(
  pedidoId: string,
  revisorId: string,
  motivo: string
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  if (!motivo.trim()) return { ok: false, mensaje: 'Un rechazo tiene que decir por qué.' }

  const pedido = await sinEmpresa('Membego Supply: leer pedido a rechazar', (tx) =>
    tx.supplyPedido.findUnique({
      where: { id: pedidoId },
      select: { id: true, estado: true, derechoId: true, ventaId: true },
    })
  )
  if (!pedido) return { ok: false, mensaje: 'Pedido no encontrado.' }
  if (pedido.estado !== 'EN_REVISION' && pedido.estado !== 'INICIADO') {
    return { ok: false, mensaje: `No se rechaza un pedido ${pedido.estado}.` }
  }

  // La unidad vuelve al pool: nadie pagó por ella, así que no es una pérdida,
  // es una venta que no ocurrió.
  if (pedido.derechoId) {
    await cancelarDerecho(pedido.derechoId, `Pedido rechazado: ${motivo.trim()}`, true, revisorId)
  }
  await cerrarVentaDePedido(pedido.ventaId, `Pedido rechazado: ${motivo.trim()}`)

  await sinEmpresa('Membego Supply: marcar el pedido como rechazado', (tx) =>
    tx.supplyPedido.update({
      where: { id: pedidoId },
      data: {
        estado: 'RECHAZADO',
        motivoRechazo: motivo.trim(),
        revisadoPor: revisorId,
        revisadoAt: new Date(),
      },
    })
  )
  return { ok: true }
}

/** El cliente se echa atrás antes de pagar. */
export async function cancelarPedido(
  pedidoId: string,
  clienteId: string
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const pedido = await sinEmpresa('Membego Supply: leer pedido a cancelar', (tx) =>
    tx.supplyPedido.findUnique({
      where: { id: pedidoId },
      select: { id: true, clienteId: true, estado: true, derechoId: true, ventaId: true },
    })
  )
  if (!pedido || pedido.clienteId !== clienteId) {
    return { ok: false, mensaje: 'Pedido no encontrado.' }
  }
  // Un pedido EN_REVISION no lo cancela el cliente: puede haber dinero ya
  // transferido y en ese caso hay que devolverlo, no borrar el rastro. Eso lo
  // decide Membego con `rechazarPedido`, que deja motivo y revisor.
  if (pedido.estado !== 'INICIADO') {
    return { ok: false, mensaje: `No puedes cancelar un pedido ${pedido.estado}.` }
  }

  if (pedido.derechoId) await cancelarDerecho(pedido.derechoId, 'El cliente canceló el pedido.', true)
  await cerrarVentaDePedido(pedido.ventaId, 'El cliente canceló el pedido.')
  await sinEmpresa('Membego Supply: marcar el pedido como cancelado', (tx) =>
    tx.supplyPedido.update({ where: { id: pedidoId }, data: { estado: 'CANCELADO' } })
  )
  return { ok: true }
}

// ── El barrido ──────────────────────────────────────────────────────────────

/**
 * Cierra los pedidos cuyo hold ya caducó. Lo llama el cron.
 *
 * NO suelta las unidades: de eso se encarga `soltarHoldsVencidos`, que ya
 * existía y ya corre en el mismo cron. Aquí solo se pone al día el estado del
 * pedido, para que el cliente vea «expiró» en vez de «esperando pago» para
 * siempre, y para que la cola de revisión no acumule lo que ya no se puede
 * cumplir.
 *
 * Se barren INICIADO y EN_REVISION: un comprobante subido en el último minuto y
 * no revisado a tiempo también expira. Duro, pero la alternativa es aprobar un
 * pedido cuya unidad ya se vendió a otro.
 */
export async function expirarPedidosVencidos(limite = 200): Promise<number> {
  return sinEmpresa('Membego Supply: expirar pedidos con el hold caducado', async (tx) => {
    const vencidos = await tx.supplyPedido.findMany({
      where: { estado: { in: ['INICIADO', 'EN_REVISION'] }, expiraAt: { lte: new Date() } },
      select: { id: true, ventaId: true },
      take: limite,
      orderBy: { expiraAt: 'asc' },
    })
    if (vencidos.length === 0) return 0
    const r = await tx.supplyPedido.updateMany({
      where: { id: { in: vencidos.map((v) => v.id) }, estado: { in: ['INICIADO', 'EN_REVISION'] } },
      data: { estado: 'EXPIRADO' },
    })
    // Las ventas sin precompra no tienen hold que soltar: se cierran aquí para
    // que dejen de contar contra el tope del acuerdo.
    const ventas = vencidos.map((v) => v.ventaId).filter((v): v is string => Boolean(v))
    if (ventas.length > 0) {
      await tx.supplyVentaDirecta.updateMany({
        where: { id: { in: ventas }, estado: 'INICIADA' },
        data: { estado: 'CANCELADA', canceladaAt: new Date(), canceladaMotivo: 'El pedido expiró sin pago.' },
      })
    }
    return r.count
  })
}

// ── La cola de Membego ──────────────────────────────────────────────────────

export interface PedidoEnCola {
  id: string
  numero: string
  cliente: string
  producto: string
  proveedor: string
  monto: number
  moneda: string
  comprobantePath: string | null
  comprobanteNota: string | null
  comprobanteAt: Date | null
  expiraAt: Date
}

/** Lo que espera a que Membego lo mire, lo más viejo primero. */
export async function colaDeRevision(limite = 100): Promise<PedidoEnCola[]> {
  const filas = await sinEmpresa('Membego Supply: cola de pedidos por revisar', (tx) =>
    tx.supplyPedido.findMany({
      where: { estado: 'EN_REVISION' },
      orderBy: { comprobanteAt: 'asc' },
      take: limite,
      select: {
        id: true,
        numero: true,
        monto: true,
        moneda: true,
        comprobantePath: true,
        comprobanteNota: true,
        comprobanteAt: true,
        expiraAt: true,
        cliente: { select: { nombre: true } },
        derecho: {
          select: {
            lote: { select: { snapshotItemNombre: true, proveedor: { select: { name: true } } } },
          },
        },
        venta: { select: { itemNombre: true, proveedor: { select: { name: true } } } },
      },
    })
  )

  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    cliente: f.cliente.nombre,
    producto: f.derecho?.lote.snapshotItemNombre ?? f.venta?.itemNombre ?? '—',
    proveedor: f.derecho?.lote.proveedor.name ?? f.venta?.proveedor.name ?? '—',
    monto: Number(f.monto),
    moneda: f.moneda,
    comprobantePath: f.comprobantePath,
    comprobanteNota: f.comprobanteNota,
    comprobanteAt: f.comprobanteAt,
    expiraAt: f.expiraAt,
  }))
}

/** Los pedidos de una persona, para su propia pantalla. */
export async function pedidosDelCliente(clienteId: string, limite = 50) {
  return sinEmpresa('Membego Supply: pedidos de un cliente', (tx) =>
    tx.supplyPedido.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true,
        numero: true,
        estado: true,
        monto: true,
        moneda: true,
        motivoRechazo: true,
        expiraAt: true,
        createdAt: true,
        derecho: { select: { lote: { select: { snapshotItemNombre: true } } } },
        venta: { select: { itemNombre: true } },
      },
    })
  )
}

/**
 * Membego devolvió el dinero de un pedido PAGADO. El pedido pasa a REEMBOLSADO
 * (estado final propio, con motivo y revisor); el derecho que financiaba se
 * cancela y vuelve al pool si nadie lo canjeó; una venta sin precompra pasa a
 * REEMBOLSADA (y su cuenta por pagar, si nació, se cancela).
 */
export async function reembolsarPedido(
  pedidoId: string,
  motivo: string,
  revisorId: string
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  if (!motivo.trim()) return { ok: false, mensaje: 'Reembolsar exige un motivo.' }
  const pedido = await sinEmpresa('Membego Supply: leer pedido a reembolsar', (tx) =>
    tx.supplyPedido.findUnique({
      where: { id: pedidoId },
      select: { id: true, estado: true, derechoId: true, ventaId: true, derecho: { select: { estado: true } } },
    })
  )
  if (!pedido) return { ok: false, mensaje: 'Pedido no encontrado.' }
  if (pedido.estado !== 'PAGADO') return { ok: false, mensaje: `Solo se reembolsa un pedido pagado; este está ${pedido.estado}.` }

  if (pedido.derechoId && pedido.derecho && (pedido.derecho.estado === 'ACTIVO' || pedido.derecho.estado === 'RETENIDO')) {
    const { cancelarDerecho } = await import('./derechos')
    await cancelarDerecho(pedido.derechoId, `Reembolso: ${motivo.trim()}`, true, revisorId)
  }
  if (pedido.ventaId) {
    const { cerrarVenta } = await import('./ventas')
    await cerrarVenta(pedido.ventaId, 'REEMBOLSADA', motivo.trim(), revisorId)
  }
  await sinEmpresa('Membego Supply: marcar el pedido como reembolsado', (tx) =>
    tx.supplyPedido.update({
      where: { id: pedidoId },
      data: { estado: 'REEMBOLSADO', reembolsadoAt: new Date(), reembolsoMotivo: motivo.trim(), revisadoPor: revisorId },
    })
  )
  return { ok: true }
}
