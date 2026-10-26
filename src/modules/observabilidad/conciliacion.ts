import 'server-only'

import { conEmpresa } from '@/lib/tenant'
import { referenciaCobro } from '@/lib/payments/cardnet-tokens-core'
import { ETIQUETA_CANAL, esCanalDeCobro } from '@/modules/pagos/comprobante-tarjeta'
import {
  CAMBIO_DE_PLAN_PAGADO,
  DEMORA_SOSPECHOSA_MS,
  describirDemora,
  diagnosticoDeEntrega,
  entregaRequierePersona,
  evidenciaDeEntrega,
  productoEliminado,
  situacionDeEntrega,
  type EstadoDeEntrega,
} from '@/modules/observabilidad/conciliacion-entrega'
import { activacionesEnBitacora } from '@/modules/observabilidad/conciliacion-bitacora'

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
  /** Cerrar un cobro SIN entregar (reembolsado, de prueba, producto borrado…), con motivo y nota. */
  | 'CERRAR_SIN_ENTREGAR'
  | 'ABRIR_FICHA'
  | 'ABRIR_CAJA'
  | 'VER_CIERRE'

export type TipoDeCaso =
  | 'TARJETA_SIN_COMPROBANTE'
  | 'MEMBRESIA_SIN_TRANSACCION'
  | 'CLIENTE_ESPERANDO'
  | 'REGISTRO_SIN_CERRAR'
  | 'COBRO_SIN_PRODUCTO'
  | 'RENOVACION_DUDOSA'
  | 'CAJA_ABIERTA'
  | 'CAJA_DESCUADRADA'

/** Un dato del caso que se enseña en «Ver detalle»: texto tal cual, o una fecha que la pantalla escribe en la hora de la empresa. */
export interface HechoDeCaso {
  etiqueta: string
  texto?: string
  fecha?: Date
}

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
  /** POR QUÉ está aquí, en una frase (`diagnosticoDeEntrega`). Solo en los cobros cuya entrega no se cerró. */
  diagnostico?: string
  /** Los datos del cobro para decidir sin abrir la base: referencia, autorización, estado, intentos, error, evidencia. */
  hechos?: HechoDeCaso[]
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
  // Ni membresía ni compra: la relación quedó en nulo porque el producto se borró. Antes decía «Compra», que no es verdad.
  return 'Producto eliminado'
}

/** El cliente del cobro; si su ficha se borró (cuenta eliminada), se dice en vez de enseñar un «Cliente» genérico. */
const nombreDelCliente = (clienteId: string | null, nombre: string | null | undefined) =>
  nombre ?? (clienteId ? 'Cliente' : 'Cliente eliminado')

const etiquetaDeEntrega = (estado: string) => (estado === 'FALLIDA' ? 'fallida' : estado === 'PROCESANDO' ? 'atascada procesando' : 'pendiente')

const FUENTE_DE_EVIDENCIA = { BITACORA: 'bitácora (activación del producto)', MEMBRESIA: 'pago confirmado de la membresía', COMPRA: 'activación de la compra' } as const

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
        renovacionesDudosas,
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
              companyId: true,
              monto: true,
              canal: true,
              planDestinoId: true,
              activadoAt: true,
              updatedAt: true,
              autorizacion: true,
              referenciaExterna: true,
              fulfillmentEstado: true,
              fulfillmentError: true,
              fulfillmentIntentos: true,
              membershipId: true,
              compraId: true,
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

          // 7 · Renovaciones automáticas cuyo cobro NO tiene resultado confirmado.
          //
          // Un cobro que se cae sin respuesta (o que la pasarela dice que «ya se procesó») pudo haber salido, y
          // repetirlo es cobrarle dos veces al cliente: el sistema NO lo repite solo (ver `evaluarCiclo`). El caso
          // sigue abierto hasta que una persona lo compruebe en el panel de CardNET. Un cobro aprobado que no se
          // entregó NO es esto: ése ya sale arriba (6), con sus acciones.
          //
          // Mira 14 días, como el contador de Observabilidad, para que el caso no caduque antes de que alguien lo vea.
          tx.pagoIntento.findMany({
            where: {
              companyId,
              canal: 'RENOVACION_AUTOMATICA',
              createdAt: { gte: new Date(ahora.getTime() - 14 * 86_400_000) },
              OR: [
                { estado: 'ERROR', respuesta: { path: ['_clasificacion'], equals: 'incierto' } },
                // Un intento que quedó abierto y ya no puede estar en curso (el proceso murió a medias).
                { estado: 'CREADO', createdAt: { lt: new Date(ahora.getTime() - 15 * 60_000) } },
              ],
            },
            select: {
              id: true,
              monto: true,
              createdAt: true,
              motivoRechazo: true,
              clienteId: true,
              cliente: { select: { nombre: true } },
              membership: { select: { plan: { select: { nombre: true } } } },
            },
            orderBy: { createdAt: 'desc' },
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
            titulo: `${nombreDelCliente(i.clienteId, i.cliente?.nombre)} · ${nombreDelProducto(i.membership?.plan.nombre, i.compra?.promocion?.titulo)}`,
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
      // reintenta; un registro sin cerrar (el producto ya está activo) se cierra con una nota; un cobro cuyo producto ya
      // no existe se cierra sin entregar. La bitácora entra como evidencia: el estado de HOY de la membresía no basta.
      const activaciones = await activacionesEnBitacora(tx, sinEntregar)
      const sinCerrar = sinEntregar
        .map((i) => {
          const evidenciaBase = {
            activadoAt: i.activadoAt,
            membership: i.membership,
            compra: i.compra,
            activacionRegistrada: activaciones.get(i.id) ?? null,
          }
          return {
            i,
            evidenciaBase,
            situacion: situacionDeEntrega(
              { ...evidenciaBase, estado: i.fulfillmentEstado as EstadoDeEntrega, actualizadoAt: i.updatedAt },
              ahora
            ),
          }
        })
        .filter((x) => x.situacion === 'CLIENTE_ESPERANDO' || x.situacion === 'REGISTRO_SIN_CERRAR' || x.situacion === 'SIN_PRODUCTO')

      const aCaso = (x: (typeof sinCerrar)[number]): CasoDeConciliacion => {
        const { i, situacion, evidenciaBase } = x
        const esperando = situacion === 'CLIENTE_ESPERANDO'
        const sinProducto = situacion === 'SIN_PRODUCTO'
        const motivo = i.fulfillmentError ? `: ${i.fulfillmentError}` : ''
        const intentos = i.fulfillmentIntentos > 0 ? ` (${i.fulfillmentIntentos} ${i.fulfillmentIntentos === 1 ? 'intento' : 'intentos'})` : ''
        // Un cambio de plan pagado no se reintenta: lo aplica una persona, y el caso debe decirlo en vez de ofrecer un botón que falla.
        const laAplicaUnaPersona = esperando && entregaRequierePersona({ canal: i.canal, planDestinoId: i.planDestinoId, membership: i.membership })
        // Lo que prueba que el producto está activo, con cuánto tardó: quien cierra el registro firma una nota sobre ESTA evidencia.
        const evidencia = situacion === 'REGISTRO_SIN_CERRAR' ? evidenciaDeEntrega(evidenciaBase) : null
        const evidenciaTexto = evidencia
          ? ` Se activó ${describirDemora(evidencia.demoraMs)} después del cobro.` +
            (evidencia.demoraMs >= DEMORA_SOSPECHOSA_MS
              ? ' Tardó mucho: antes de cerrarlo, comprueba en la ficha que esa activación corresponde a este pago.'
              : '')
          : ''
        const eliminado = productoEliminado(i)
        const canal = esCanalDeCobro(i.canal) ? ETIQUETA_CANAL[i.canal] : null
        const hechos: HechoDeCaso[] = [
          { etiqueta: 'Cobro aprobado', ...(i.activadoAt ? { fecha: i.activadoAt } : { texto: 'sin fecha' }) },
          { etiqueta: 'Id del cobro', texto: i.id },
          ...(i.referenciaExterna ? [{ etiqueta: 'Referencia de la pasarela', texto: i.referenciaExterna }] : []),
          ...(i.autorizacion ? [{ etiqueta: 'Autorización', texto: i.autorizacion }] : []),
          ...(canal ? [{ etiqueta: 'Canal', texto: canal }] : []),
          { etiqueta: 'Estado de la entrega', texto: `${etiquetaDeEntrega(i.fulfillmentEstado)}${intentos}` },
          { etiqueta: 'Último cambio del registro', fecha: i.updatedAt },
          ...(i.fulfillmentError ? [{ etiqueta: 'Último error', texto: i.fulfillmentError }] : []),
          {
            etiqueta: 'Producto',
            texto: eliminado ? 'Ya no existe (se eliminó)' : nombreDelProducto(i.membership?.plan.nombre, i.compra?.promocion?.titulo),
          },
          ...(i.membership ? [{ etiqueta: 'Estado de la membresía hoy', texto: `${i.membership.estado}${i.membership.pagoConfirmado ? ' · pago confirmado' : ' · sin pago confirmado'}` }] : []),
          { etiqueta: 'Cliente', texto: nombreDelCliente(i.clienteId, i.cliente?.nombre) },
          ...(evidencia
            ? [{ etiqueta: `Evidencia de entrega (${FUENTE_DE_EVIDENCIA[evidencia.fuente]})`, fecha: evidencia.fecha }]
            : [{ etiqueta: 'Evidencia de entrega', texto: 'ninguna activación posterior al cobro' }]),
        ]
        return {
          id: i.id,
          tipo: esperando ? 'CLIENTE_ESPERANDO' : sinProducto ? 'COBRO_SIN_PRODUCTO' : 'REGISTRO_SIN_CERRAR',
          titulo: `${nombreDelCliente(i.clienteId, i.cliente?.nombre)} · ${nombreDelProducto(i.membership?.plan.nombre, i.compra?.promocion?.titulo)}`,
          detalle: laAplicaUnaPersona
            ? `El cliente pagó y no tiene su cambio de plan. ${CAMBIO_DE_PLAN_PAGADO}`
            : esperando
              ? `El cliente pagó y no tiene su producto. Entrega ${etiquetaDeEntrega(i.fulfillmentEstado)}${motivo}${intentos}`
              : sinProducto
                ? 'El producto de este cobro ya no existe y no hay registro de que se activara: no hay nada que entregar.'
                : `El producto ya se activó; el cobro quedó sin marcar como entregado (${etiquetaDeEntrega(i.fulfillmentEstado)}).${evidenciaTexto}`,
          monto: Number(i.monto),
          fecha: i.activadoAt ?? i.updatedAt,
          clienteId: i.clienteId,
          // «Cerrar sin entregar» existe para lo que reintentar no arregla: un reembolso, un cobro de prueba, un producto que ya
          // no existe. No para un producto que SÍ está activo hoy: eso se cierra como entregado (y factura). Si se activó y
          // después se borró, las dos salidas valen: entregado y facturado, o cerrado sin entregar si el dinero se devolvió.
          acciones: laAplicaUnaPersona
            ? ['CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']
            : esperando
              ? ['REINTENTAR_ENTREGA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']
              : sinProducto
                ? ['CERRAR_SIN_ENTREGAR']
                : eliminado
                  ? ['MARCAR_ENTREGADA', 'CERRAR_SIN_ENTREGAR', 'ABRIR_FICHA']
                  : ['MARCAR_ENTREGADA', 'ABRIR_FICHA'],
          diagnostico: diagnosticoDeEntrega({
            situacion,
            estado: i.fulfillmentEstado as EstadoDeEntrega,
            error: i.fulfillmentError,
            intentos: i.fulfillmentIntentos,
            evidencia,
            productoEliminado: eliminado,
          }),
          hechos,
        }
      }
      const esperando = sinCerrar.filter((x) => x.situacion === 'CLIENTE_ESPERANDO').map(aCaso)
      const registroSinCerrar = sinCerrar.filter((x) => x.situacion === 'REGISTRO_SIN_CERRAR').map(aCaso)
      const sinProducto = sinCerrar.filter((x) => x.situacion === 'SIN_PRODUCTO').map(aCaso)

      if (esperando.length > 0) {
        hallazgos.push({
          clave: 'cobrado-sin-entregar',
          titulo: 'Pagos cobrados con entrega pendiente',
          explicacion:
            'El cliente pagó y todavía no tiene lo que compró: su entrega falló o quedó atascada. No depende del periodo: se revisa todo lo que siga abierto, porque un pago atascado hace semanas sigue siendo un cliente esperando. «Ver detalle» dice por qué no se entregó. «Reintentar entrega» vuelve a activar el producto sin volver a cobrar; si la causa es otra (se devolvió el dinero, fue un cobro de prueba), «Cerrar sin entregar» lo quita de aquí con un motivo y una nota.',
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
            'El producto se activó, pero el cobro nunca se marcó como entregado (cobros anteriores al control de entregas del 12-sep-2026, o activados a mano por otra vía). Ningún cliente espera nada: solo falta cerrar el registro. «Ver detalle» enseña la evidencia; «Marcar entregada» exige una nota, queda en la bitácora y registra la venta con la fecha del cobro.',
          cantidad: registroSinCerrar.length,
          severidad: 'MEDIA',
          monto: suma(registroSinCerrar),
          href: null,
          casos: tope(registroSinCerrar),
        })
      }

      if (sinProducto.length > 0) {
        hallazgos.push({
          clave: 'cobro-sin-producto',
          titulo: 'Cobros cuyo producto ya no existe',
          explicacion:
            'La membresía o compra de estos cobros se eliminó (normalmente porque el cliente borró su cuenta) y no hay registro de que se activara. Nadie espera nada en la app y reintentar no puede funcionar. Comprueba en CardNET si el dinero se devolvió y ciérralo con «Cerrar sin entregar»: pide un motivo y una nota, y queda en la bitácora.',
          cantidad: sinProducto.length,
          severidad: 'MEDIA',
          monto: suma(sinProducto),
          href: null,
          casos: tope(sinProducto),
        })
      }

      if (renovacionesDudosas.length > 0) {
        const casos = renovacionesDudosas.map((i): CasoDeConciliacion => ({
          id: i.id,
          tipo: 'RENOVACION_DUDOSA',
          titulo: `${nombreDelCliente(i.clienteId, i.cliente?.nombre)} · ${nombreDelProducto(i.membership?.plan.nombre, null)}`,
          detalle: `Referencia en CardNET: ${referenciaCobro(i.id)}. ${i.motivoRechazo ?? 'El cobro quedó sin cerrar.'}`,
          monto: Number(i.monto),
          fecha: i.createdAt,
          clienteId: i.clienteId,
          acciones: ['ABRIR_FICHA'],
        }))
        hallazgos.push({
          clave: 'renovacion-dudosa',
          titulo: 'Renovaciones automáticas con resultado dudoso',
          explicacion:
            'El cobro automático se cayó sin respuesta, y pudo haber salido. El sistema no lo repite solo porque sería cobrarle dos veces al cliente. Cada día, antes de cobrar, se le pregunta a CardNET por ese cobro y se resuelve solo si contesta claro; lo que queda aquí es lo que no pudo confirmar. Busca en el panel de CardNET la transacción con esa referencia: si SÍ se cobró, hay que registrarlo como cobro aprobado (entonces aparece arriba, en «Pagos cobrados con entrega pendiente», con su botón «Reintentar entrega»); si NO se cobró, se marca como descartado y el siguiente cobro automático lo reintenta. El procedimiento está en el runbook de pagos.',
          cantidad: casos.length,
          severidad: 'ALTA',
          monto: suma(casos),
          href: null,
          casos: tope(casos),
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
