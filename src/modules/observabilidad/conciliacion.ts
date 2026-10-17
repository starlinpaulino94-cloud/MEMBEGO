import 'server-only'

import { conEmpresa } from '@/lib/tenant'
import { ETIQUETA_CANAL, esCanalDeCobro } from '@/modules/pagos/comprobante-tarjeta'
import {
  CAMBIO_DE_PLAN_PAGADO,
  DEMORA_SOSPECHOSA_MS,
  describirDemora,
  entregaRequierePersona,
  evidenciaDeEntrega,
  situacionDeEntrega,
  type EstadoDeEntrega,
} from '@/modules/observabilidad/conciliacion-entrega'

/**
 * CONCILIACIÓN DIARIA — que el descuadre lo encuentre el sistema, no el cliente.
 *
 * El panel tiene tres registros de la misma realidad: **Membresías** dice quién
 * pagó, **Transacciones** es el libro oficial de operaciones y **Caja** es el
 * arqueo del turno. Nada comprobaba que contaran lo mismo. Un cobro que entra en
 * uno y no en otro no produce ningún error: produce un informe que no cuadra
 * dentro de tres meses, cuando ya nadie recuerda el día.
 *
 * Esto no arregla nada por su cuenta a propósito. Cada hallazgo es una lista de
 * CASOS que una persona mira y resuelve con una acción explícita y auditada
 * (generar el comprobante, reintentar la entrega, cerrar el registro con una
 * nota): corregir en automático un descuadre de dinero es la forma más rápida
 * de convertir un error visible en uno invisible. Esta lectura NO escribe nada;
 * las acciones viven en `conciliacion-servicio.ts`.
 *
 * TODO SE DEDUCE de las tablas: sin columnas nuevas.
 */

export type Severidad = 'ALTA' | 'MEDIA'

/**
 * Qué se puede HACER con un caso. Cada valor es una acción que la pantalla ofrece; el servidor la vuelve a comprobar.
 */
export type AccionDeCaso =
  | 'GENERAR_COMPROBANTE'
  | 'REINTENTAR_ENTREGA'
  | 'MARCAR_ENTREGADA'
  | 'ABRIR_FICHA'
  | 'ABRIR_CAJA'
  | 'VER_CIERRE'

export type TipoDeCaso =
  | 'TARJETA_SIN_COMPROBANTE'
  | 'MEMBRESIA_SIN_TRANSACCION'
  | 'CLIENTE_ESPERANDO'
  | 'REGISTRO_SIN_CERRAR'
  | 'CAJA_ABIERTA'
  | 'CAJA_DESCUADRADA'

/** Una fila concreta de un hallazgo: lo que alguien mira y resuelve. */
export interface CasoDeConciliacion {
  /** Id de lo que se actúa: el cobro (`PagoIntento`), la membresía o la caja, según `tipo`. */
  id: string
  tipo: TipoDeCaso
  /** «Ana Pérez · Membresía Plan Oro». */
  titulo: string
  /** Lo que ayuda a decidir: «Tarjeta en la app · Aut. A1», «Entrega fallida: …». */
  detalle: string | null
  monto: number | null
  fecha: Date
  clienteId: string | null
  acciones: AccionDeCaso[]
}

export interface Hallazgo {
  clave: string
  titulo: string
  /** Qué significa y por qué importa, en una frase que se enseña tal cual. */
  explicacion: string
  cantidad: number
  severidad: Severidad
  /** Importe implicado, cuando el descuadre es de dinero. */
  monto: number | null
  /** A dónde ir a resolverlo cuando el hallazgo no trae lista de casos propia. */
  href: string | null
  /** Los casos concretos (los más recientes primero), hasta `CASOS_POR_HALLAZGO`. Vacío = solo cifra y enlace. */
  casos: CasoDeConciliacion[]
  /**
   * Resolver todos los casos de tarjeta de una vez («Generar los N comprobantes»): la cifra y el importe que se enseñan
   * ANTES de pulsar. Solo en el hallazgo de cobros sin transacción y solo cuando hay más de uno.
   */
  lote?: { cantidad: number; monto: number }
}

export interface Conciliacion {
  hallazgos: Hallazgo[]
  /** Días analizados hacia atrás. */
  ventanaDias: number
  /** true = ninguna comprobación encontró nada. */
  cuadra: boolean
}

/** Cuántos casos se enseñan por hallazgo. La cifra del hallazgo es la real; la lista es lo que cabe en pantalla. */
export const CASOS_POR_HALLAZGO = 25
const LECTURA_MAX = 500


function nombreDelProducto(plan?: string | null, promocion?: string | null): string {
  if (plan) return `Membresía ${plan}`
  if (promocion) return `Promoción ${promocion}`
  return 'Compra'
}

const etiquetaDeEntrega = (estado: string) => (estado === 'FALLIDA' ? 'fallida' : estado === 'PROCESANDO' ? 'atascada procesando' : 'pendiente')

/**
 * Ventana por defecto. Una semana: lo bastante corta para que el descuadre se
 * pueda reconstruir de memoria, y lo bastante larga para que un fin de semana
 * largo no se escape.
 */
const VENTANA = 7

export async function conciliar(
  companyId: string,
  ventanaDias = VENTANA,
  ahora: Date = new Date()
): Promise<Conciliacion> {
  const desde = new Date(ahora.getTime() - ventanaDias * 86_400_000)
  const hallazgos: Hallazgo[] = []

  try {
    await conEmpresa(companyId, async (tx) => {
      const [
        tarjetaSinComprobante,
        membresiasSinTransaccion,
        visitasSinTransaccion,
        atascadas,
        cajasAbiertas,
        descuadres,
        sinEntregar,
      ] = await Promise.all([
          // 1a · Cobros con tarjeta de la pasarela ya ENTREGADOS cuya venta (el comprobante) no está en el libro.
          // Se miran desde el cobro, no desde la membresía: así también se ve una renovación cuyo pago no dejó venta
          // aunque la membresía tenga otras ventas de meses anteriores.
          tx.pagoIntento.findMany({
            where: {
              companyId,
              estado: 'APROBADO',
              fulfillmentEstado: 'COMPLETADA',
              transaccion: { is: null },
              activadoAt: { gte: desde },
            },
            select: {
              id: true,
              monto: true,
              canal: true,
              autorizacion: true,
              activadoAt: true,
              clienteId: true,
              cliente: { select: { nombre: true } },
              membership: { select: { plan: { select: { nombre: true } } } },
              compra: { select: { promocion: { select: { titulo: true } } } },
            },
            orderBy: { activadoAt: 'desc' },
            take: LECTURA_MAX,
          }),

          // 1b · Dinero en Membresías que no llegó al libro de transacciones y que NO fue un cobro de pasarela (esos
          // se cuentan arriba, una sola vez).
          tx.membership.findMany({
            where: {
              companyId,
              pagoConfirmado: true,
              montoPagado: { gt: 0 },
              fechaPago: { gte: desde },
              transacciones: { none: {} },
              pagoIntentos: { none: { estado: 'APROBADO' } },
            },
            select: {
              id: true,
              montoPagado: true,
              fechaPago: true,
              clienteId: true,
              cliente: { select: { nombre: true } },
              plan: { select: { nombre: true } },
            },
            orderBy: { fechaPago: 'desc' },
            take: LECTURA_MAX,
          }),

          // 2 · Servicio prestado que no dejó rastro contable.
          tx.visit.count({
            where: {
              cliente: { companyId },
              fechaVisita: { gte: desde },
              transaccion: { is: null },
            },
          }),

          // 3 · Operaciones que se empezaron y nunca se cerraron. No son un
          // descuadre todavía: son el descuadre de mañana.
          tx.transaction.count({
            where: {
              companyId,
              estado: { in: ['PENDING', 'VALIDATING'] },
              createdAt: { lt: new Date(ahora.getTime() - 86_400_000) },
            },
          }),

          // 4 · Cajas que nadie cerró. El arqueo de un turno que sigue abierto
          // dos días después no compara nada con nada.
          tx.cajaSesion.findMany({
            where: {
              companyId,
              estado: 'ABIERTA',
              abiertaAt: { lt: new Date(ahora.getTime() - 86_400_000) },
            },
            select: {
              id: true,
              abiertaAt: true,
              sucursal: { select: { nombre: true } },
              abiertaPor: { select: { name: true } },
              _count: { select: { cobros: true } },
            },
            orderBy: { abiertaAt: 'asc' },
            take: LECTURA_MAX,
          }),

          // 5 · Turnos cerrados con faltante o sobrante de efectivo.
          tx.cajaSesion.findMany({
            where: {
              companyId,
              estado: { not: 'ABIERTA' },
              cerradaAt: { gte: desde },
              NOT: { diferencia: 0 },
              diferencia: { not: null },
            },
            select: {
              id: true,
              diferencia: true,
              cerradaAt: true,
              sucursal: { select: { nombre: true } },
              cerradaPor: { select: { name: true } },
            },
            orderBy: { cerradaAt: 'desc' },
            take: LECTURA_MAX,
          }),

          // 6 · El cliente pagó y no recibió.
          //
          // Es el único descuadre que el cliente descubre ANTES que el negocio,
          // y por eso no se acota a la ventana: un pago atascado hace tres
          // semanas sigue siendo un cliente esperando hoy. Los demás hallazgos
          // miran los últimos días porque son cosas que se corrigen en caliente;
          // éste no caduca.
          //
          // Se miran los TRES estados sin cerrar —PENDIENTE, PROCESANDO y FALLIDA—:
          // antes solo `PENDIENTE`, y un cobro con la entrega fallida y el cliente sin su
          // producto salía como «Todo cuadra». La clasificación (esperando vs registro sin
          // cerrar) se hace después, con `situacionDeEntrega`.
          tx.pagoIntento.findMany({
            where: {
              companyId,
              estado: 'APROBADO',
              fulfillmentEstado: { in: ['PENDIENTE', 'PROCESANDO', 'FALLIDA'] },
            },
            select: {
              id: true,
              monto: true,
              canal: true,
              activadoAt: true,
              updatedAt: true,
              fulfillmentEstado: true,
              fulfillmentError: true,
              fulfillmentIntentos: true,
              clienteId: true,
              cliente: { select: { nombre: true } },
              membership: {
                select: { pagoConfirmado: true, fechaPago: true, estado: true, planIdSolicitado: true, plan: { select: { nombre: true } } },
              },
              compra: { select: { pagoConfirmado: true, fechaActivacion: true, promocion: { select: { titulo: true } } } },
            },
            orderBy: { activadoAt: 'desc' },
            take: LECTURA_MAX,
          }),
        ])

      const tope = (casos: CasoDeConciliacion[]) => casos.slice(0, CASOS_POR_HALLAZGO)
      const suma = (casos: CasoDeConciliacion[]) => casos.reduce((t, c) => t + (c.monto ?? 0), 0)

      // 1 · Cobros sin transacción: los de tarjeta se arreglan con un clic (se genera el comprobante); los demás
      // necesitan que alguien mire la ficha, porque el método y quién cobró no se pueden inventar.
      const casosCobro: CasoDeConciliacion[] = [
        ...tarjetaSinComprobante.map((i): CasoDeConciliacion => {
          const canal = esCanalDeCobro(i.canal) ? ETIQUETA_CANAL[i.canal] : null
          return {
            id: i.id,
            tipo: 'TARJETA_SIN_COMPROBANTE',
            titulo: `${i.cliente?.nombre ?? 'Cliente'} · ${nombreDelProducto(i.membership?.plan.nombre, i.compra?.promocion?.titulo)}`,
            detalle: ['Tarjeta', canal, i.autorizacion ? `Aut. ${i.autorizacion}` : null].filter(Boolean).join(' · '),
            monto: Number(i.monto),
            fecha: i.activadoAt ?? ahora,
            clienteId: i.clienteId,
            acciones: ['GENERAR_COMPROBANTE', 'ABRIR_FICHA'],
          }
        }),
        ...membresiasSinTransaccion.map((m): CasoDeConciliacion => ({
          id: m.id,
          tipo: 'MEMBRESIA_SIN_TRANSACCION',
          titulo: `${m.cliente?.nombre ?? 'Cliente'} · Membresía ${m.plan.nombre}`,
          detalle: 'Cobro sin venta en el libro y sin cobro de pasarela: revisa cómo se pagó',
          monto: Number(m.montoPagado ?? 0),
          fecha: m.fechaPago ?? ahora,
          clienteId: m.clienteId,
          acciones: ['ABRIR_FICHA'],
        })),
      ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime())

      if (casosCobro.length > 0) {
        hallazgos.push({
          clave: 'cobro-sin-transaccion',
          titulo: 'Cobros sin transacción registrada',
          explicacion:
            'El cobro existe, pero no hay ninguna operación en el libro. El dinero está en un sitio y no en el otro: los reportes de caja y los de membresías no van a cuadrar. Un pago con tarjeta se corrige con «Generar comprobante»; el resto se revisa en la ficha del cliente.',
          cantidad: casosCobro.length,
          severidad: 'ALTA',
          monto: suma(casosCobro),
          href: null,
          casos: tope(casosCobro),
          ...(tarjetaSinComprobante.length > 1
            ? { lote: { cantidad: tarjetaSinComprobante.length, monto: tarjetaSinComprobante.reduce((t, i) => t + Number(i.monto), 0) } }
            : {}),
        })
      }

      // 6 · Cobros aprobados cuya entrega no se cerró. Se separan por lo que hay que hacer: un cliente esperando se
      // reintenta; un registro sin cerrar (el producto ya está activo) se cierra con una nota.
      const sinCerrar = sinEntregar
        .map((i) => ({
          i,
          situacion: situacionDeEntrega(
            {
              estado: i.fulfillmentEstado as EstadoDeEntrega,
              actualizadoAt: i.updatedAt,
              activadoAt: i.activadoAt,
              membership: i.membership,
              compra: i.compra,
            },
            ahora
          ),
        }))
        .filter((x) => x.situacion === 'CLIENTE_ESPERANDO' || x.situacion === 'REGISTRO_SIN_CERRAR')

      const aCaso = (x: (typeof sinCerrar)[number]): CasoDeConciliacion => {
        const { i, situacion } = x
        const esperando = situacion === 'CLIENTE_ESPERANDO'
        const motivo = i.fulfillmentError ? `: ${i.fulfillmentError}` : ''
        const intentos = i.fulfillmentIntentos > 0 ? ` (${i.fulfillmentIntentos} ${i.fulfillmentIntentos === 1 ? 'intento' : 'intentos'})` : ''
        // Un cambio de plan pagado no se reintenta: lo aplica una persona, y el caso debe decirlo en vez de ofrecer un botón que falla.
        const laAplicaUnaPersona = esperando && entregaRequierePersona({ canal: i.canal, membership: i.membership })
        // Lo que prueba que el producto está activo, con cuánto tardó: quien cierra el registro firma una nota sobre ESTA evidencia.
        const evidencia = esperando ? null : evidenciaDeEntrega({ activadoAt: i.activadoAt, membership: i.membership, compra: i.compra })
        const evidenciaTexto = evidencia
          ? ` Se activó ${describirDemora(evidencia.demoraMs)} después del cobro.` +
            (evidencia.demoraMs >= DEMORA_SOSPECHOSA_MS
              ? ' Tardó mucho: antes de cerrarlo, comprueba en la ficha que esa activación corresponde a este pago.'
              : '')
          : ''
        return {
          id: i.id,
          tipo: esperando ? 'CLIENTE_ESPERANDO' : 'REGISTRO_SIN_CERRAR',
          titulo: `${i.cliente?.nombre ?? 'Cliente'} · ${nombreDelProducto(i.membership?.plan.nombre, i.compra?.promocion?.titulo)}`,
          detalle: laAplicaUnaPersona
            ? `El cliente pagó y no tiene su cambio de plan. ${CAMBIO_DE_PLAN_PAGADO}`
            : esperando
              ? `El cliente pagó y no tiene su producto. Entrega ${etiquetaDeEntrega(i.fulfillmentEstado)}${motivo}${intentos}`
              : `El producto ya está activo; el cobro quedó sin marcar como entregado (${etiquetaDeEntrega(i.fulfillmentEstado)}).${evidenciaTexto}`,
          monto: Number(i.monto),
          fecha: i.activadoAt ?? i.updatedAt,
          clienteId: i.clienteId,
          acciones: laAplicaUnaPersona
            ? ['ABRIR_FICHA']
            : esperando
              ? ['REINTENTAR_ENTREGA', 'ABRIR_FICHA']
              : ['MARCAR_ENTREGADA', 'ABRIR_FICHA'],
        }
      }
      const esperando = sinCerrar.filter((x) => x.situacion === 'CLIENTE_ESPERANDO').map(aCaso)
      const registroSinCerrar = sinCerrar.filter((x) => x.situacion === 'REGISTRO_SIN_CERRAR').map(aCaso)

      if (esperando.length > 0) {
        hallazgos.push({
          clave: 'cobrado-sin-entregar',
          titulo: 'Pagos cobrados con entrega pendiente',
          explicacion:
            'El cliente pagó y todavía no tiene lo que compró: su entrega falló o quedó atascada. No depende del periodo: se revisa todo lo que siga abierto, porque un pago atascado hace semanas sigue siendo un cliente esperando. «Reintentar entrega» vuelve a activar el producto sin volver a cobrar.',
          cantidad: esperando.length,
          severidad: 'ALTA',
          monto: suma(esperando),
          href: null,
          casos: tope(esperando),
        })
      }

      if (registroSinCerrar.length > 0) {
        hallazgos.push({
          clave: 'entrega-sin-registrar',
          titulo: 'Cobros entregados que quedaron sin cerrar',
          explicacion:
            'El producto ya está activo, pero el cobro nunca se marcó como entregado (cobros anteriores a ese control, o activados a mano por otra vía). Ningún cliente espera nada: solo falta cerrar el registro. «Marcar entregada» exige una nota y queda en la bitácora.',
          cantidad: registroSinCerrar.length,
          severidad: 'MEDIA',
          monto: suma(registroSinCerrar),
          href: null,
          casos: tope(registroSinCerrar),
        })
      }

      if (visitasSinTransaccion > 0) {
        hallazgos.push({
          clave: 'visita-sin-transaccion',
          titulo: 'Visitas sin transacción',
          explicacion:
            'Se prestó el servicio y no quedó comprobante. No hay dinero perdido, pero sí un uso que no se puede reimprimir ni reclamar si el cliente lo discute.',
          cantidad: visitasSinTransaccion,
          severidad: 'MEDIA',
          monto: null,
          href: '/admin/registros',
          casos: [],
        })
      }

      if (atascadas > 0) {
        hallazgos.push({
          clave: 'transaccion-atascada',
          titulo: 'Operaciones sin cerrar de más de un día',
          explicacion:
            'Alguien empezó una operación y nunca la terminó. Todavía no descuadran nada; si se quedan así, mañana sí.',
          cantidad: atascadas,
          severidad: 'MEDIA',
          monto: null,
          href: '/admin/registros',
          casos: [],
        })
      }

      if (cajasAbiertas.length > 0) {
        const casos = cajasAbiertas.map((c): CasoDeConciliacion => ({
          id: c.id,
          tipo: 'CAJA_ABIERTA',
          titulo: `${c.sucursal.nombre} · abrió ${c.abiertaPor.name ?? 'sin nombre'}`,
          detalle: `${c._count.cobros} ${c._count.cobros === 1 ? 'cobro' : 'cobros'} en el turno. Se cierra contando el efectivo en la caja`,
          monto: null,
          fecha: c.abiertaAt,
          clienteId: null,
          acciones: ['ABRIR_CAJA'],
        }))
        hallazgos.push({
          clave: 'caja-abierta',
          titulo: 'Cajas abiertas de días anteriores',
          explicacion:
            'Un turno que sigue abierto no se ha arqueado, así que su efectivo no se ha comparado con nada. Cuanto más tarde se cierre, menos se recuerda. «Abrir caja» lleva a esa caja para contar el efectivo y cerrarla.',
          cantidad: casos.length,
          severidad: 'ALTA',
          monto: null,
          href: null,
          casos: tope(casos),
        })
      }

      if (descuadres.length > 0) {
        const monto = descuadres.reduce((t, c) => t + Number(c.diferencia ?? 0), 0)
        const casos = descuadres.map((c): CasoDeConciliacion => ({
          id: c.id,
          tipo: 'CAJA_DESCUADRADA',
          titulo: `${c.sucursal.nombre} · cerró ${c.cerradaPor?.name ?? 'sin nombre'}`,
          detalle: Number(c.diferencia) < 0 ? 'Faltante de efectivo' : 'Sobrante de efectivo',
          monto: Number(c.diferencia ?? 0),
          fecha: c.cerradaAt ?? ahora,
          clienteId: null,
          acciones: ['VER_CIERRE'],
        }))
        hallazgos.push({
          clave: 'caja-descuadrada',
          titulo: 'Turnos cerrados con faltante o sobrante',
          explicacion:
            'El efectivo contado no coincidió con el esperado. Un sobrante importa tanto como un faltante: los dos significan que algo no se registró como pasó. «Ver cierre» abre el reporte del turno para imprimirlo.',
          cantidad: descuadres.length,
          severidad: 'ALTA',
          monto,
          href: null,
          casos: tope(casos),
        })
      }
    })
  } catch (e) {
    console.error('[conciliacion]', e)
    // Sin datos no se afirma que todo cuadra: eso sería el peor resultado
    // posible de una comprobación —un visto bueno que nadie ha comprobado—.
    return { hallazgos: [], ventanaDias, cuadra: false }
  }

  return { hallazgos, ventanaDias, cuadra: hallazgos.length === 0 }
}
