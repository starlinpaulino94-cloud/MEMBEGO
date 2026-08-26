import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { vehiculoAutorizadoEnMembresia } from '@/modules/elegibilidad/decidir'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { crearTransaccionAplicada } from '@/lib/transactions'
import { registrarHitoInvitacion } from '@/modules/invitaciones/hitosConversion'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'
import { capturarErrorInesperado } from '@/lib/sentry'
import type { TicketPayload } from '@/modules/transacciones/actions'

/**
 * CANJE DE MEMBRESÍA · el servicio, separado de quién lo pide.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Todo esto vivía dentro de `confirmarVisita`, un Server Action que empezaba
 * con `getUser()` y leía un `FormData`. Funcionaba —lleva meses en producción—
 * pero ataba la operación a UNA forma de pedirla: una sesión de navegador con
 * rol de escáner.
 *
 * Un satélite que llama por `/api/platform/v1/redemptions` no tiene sesión ni
 * rol de navegador: tiene una credencial. Con la lógica dentro del action,
 * abrirle la puerta obligaba a reimplementar el canje — y dos implementaciones
 * de la ruta del dinero terminan divergiendo, siempre, en el caso raro que
 * nadie probó.
 *
 * Aquí la operación no sabe quién la pide. Recibe un ACTOR con lo poco que
 * necesita saber: quién firma el documento y a qué empresa está acotado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE MANTUVO IGUAL, A PROPÓSITO
 *
 * · El núcleo atómico, línea por línea. QR de un solo uso con `updateMany`,
 *   guard de estado/vencimiento/saldo dentro del `where` del update, saldo
 *   releído tras el decremento. Son defensas contra carreras y se rompen
 *   reescribiéndolas «más limpias».
 * · Las lecturas pesadas FUERA de la transacción, por el pinning de pgBouncer.
 * · Los mensajes de error, palabra por palabra: el panel enseña los mismos.
 * · El orden de los eventos y el gancho de crecimiento.
 *
 * Lo único que cambia de forma es que ahora cada rechazo lleva además un
 * CÓDIGO. El panel sigue usando el mensaje; la API necesita ramificar, y
 * ramificar leyendo texto se rompe el día que alguien corrige una tilde.
 */

/** Quién ejecuta el canje. */
export interface ActorCanje {
  /** PANEL = empleado con sesión · SISTEMA = satélite con credencial. */
  origen: 'PANEL' | 'SISTEMA'
  /** Usuario de MembeGo, si lo hay. Un satélite no tiene. */
  dbUserId: string | null
  /** Nombre para el documento comercial (nunca el correo si hay nombre). */
  nombre: string | null
  /**
   * Empresa a la que el actor está acotado. Si viene, la membresía TIENE que
   * ser de ella. `null` solo para el superadmin, que opera sobre cualquiera.
   */
  companyId: string | null
  /** Slug del satélite, cuando `origen` es SISTEMA. Viaja al evento. */
  sistemaSlug?: string
}

export interface EntradaCanje {
  membershipId: string
  servicio: string
  vehiculoId: string | null
  notas: string | null
  sucursalId: string | null
  qrTokenId: string | null
}

export interface ContextoCanje {
  ipAddress: string | null
  userAgent: string | null
  /** `Date.now()` de cuando empezó la petición, para `executionMs`. */
  iniciadoEn: number
}

/**
 * Códigos de rechazo. Existen separados del mensaje porque cada uno se resuelve
 * de una forma distinta: `SIN_USOS` se arregla renovando, `QR_YA_USADO`
 * pidiendo un QR nuevo, `EMPRESA_AJENA` es un error de integración.
 */
export type MotivoRechazo =
  | 'MEMBRESIA_NO_ENCONTRADA'
  | 'VEHICULO_NO_AUTORIZADO'
  | 'EMPRESA_AJENA'
  | 'SUCURSAL_NO_ENCONTRADA'
  | 'MEMBRESIA_NO_ACTIVA'
  | 'MEMBRESIA_VENCIDA'
  | 'SIN_USOS'
  | 'QR_INVALIDO'
  | 'CONFLICTO'
  | 'ERROR_INTERNO'

export interface CanjeAplicado {
  ok: true
  visitId: string
  transaccionId: string
  codigo: string
  ticketNumero: string
  /** Saldo tras el canje. `null` en planes ilimitados. */
  restantes: number | null
  ilimitado: boolean
  servicio: string
  clienteId: string
  companyId: string
  ticket: TicketPayload
}

export interface CanjeRechazado {
  ok: false
  motivo: MotivoRechazo
  /** Texto para una persona. El panel lo enseña tal cual. */
  mensaje: string
}

export type ResultadoCanje = CanjeAplicado | CanjeRechazado

/** Error que aborta el núcleo atómico con un motivo tipado. */
class RechazoTx extends Error {
  constructor(
    readonly motivo: MotivoRechazo,
    mensaje: string
  ) {
    super(mensaje)
  }
}

const no = (motivo: MotivoRechazo, mensaje: string): CanjeRechazado => ({
  ok: false,
  motivo,
  mensaje,
})

export async function ejecutarCanje(
  actor: ActorCanje,
  entrada: EntradaCanje,
  contexto: ContextoCanje
): Promise<ResultadoCanje> {
  const { membershipId, servicio, vehiculoId, notas, sucursalId, qrTokenId } = entrada
  const meta = { ipAddress: contexto.ipAddress, userAgent: contexto.userAgent }

  try {
    // ── Validaciones de solo lectura FUERA de la transacción ────────────────
    // En pgBouncer transaction-mode cada transacción interactiva retiene
    // ("pin") una conexión real durante todo el callback. Las invariantes
    // críticas —QR de un solo uso, descuento de saldo— se protegen con updates
    // guardados dentro del núcleo atómico de abajo, no con estas lecturas.
    const membership = await sinEmpresa('canje: buscar membresía a canjear', (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: {
          plan: true,
          cliente: {
            include: {
              company: {
                select: {
                  name: true, direccion: true, telefono: true, website: true,
                  logoUrl: true, zonaHoraria: true,
                },
              },
            },
          },
          // Onboarding v2 (§13): vehículos a los que la membresía está asociada.
          vehiculos: {
            include: {
              vehiculo: {
                select: { id: true, marca: true, modelo: true, placa: true, placaNormalizada: true },
              },
            },
          },
        },
      })
    )
    if (!membership) {
      return no('MEMBRESIA_NO_ENCONTRADA', 'La membresía no fue encontrada. Puede haber sido eliminada.')
    }

    // §13: una membresía comprada para un vehículo no se usa con OTRO vehículo
    // identificado. Regla pura, con la compatibilidad dentro: sin asociaciones
    // (membresías anteriores al rediseño) o sin vehículo elegido, autoriza.
    const autorizacion = vehiculoAutorizadoEnMembresia(
      (membership.vehiculos ?? []).map((mv) => ({
        vehiculoId: mv.vehiculo.id,
        etiqueta: `${mv.vehiculo.marca} ${mv.vehiculo.modelo} (${mv.vehiculo.placaNormalizada ?? mv.vehiculo.placa ?? 'sin placa'})`,
      })),
      vehiculoId
    )
    if (!autorizacion.autorizado) {
      return no('VEHICULO_NO_AUTORIZADO', autorizacion.mensaje)
    }

    // El actor acotado a una empresa no canjea en otra. Para el superadmin
    // (`companyId: null`) no hay acotación, igual que antes; para un satélite
    // es la empresa que sus habilitaciones ya autorizaron.
    if (actor.companyId && membership.companyId !== actor.companyId) {
      return no('EMPRESA_AJENA', 'Este cliente pertenece a otra empresa.')
    }

    let sucursalNombre: string | null = null
    if (sucursalId) {
      const sucursal = await conEmpresa(membership.companyId, (tx) =>
        tx.sucursal.findUnique({ where: { id: sucursalId } })
      )
      if (!sucursal) return no('SUCURSAL_NO_ENCONTRADA', 'La sucursal no fue encontrada.')
      if (sucursal.companyId !== membership.companyId) {
        return no('SUCURSAL_NO_ENCONTRADA', 'La sucursal no pertenece a la empresa del cliente.')
      }
      sucursalNombre = sucursal.nombre
    }

    // Etiquetas del vehículo para el snapshot/ticket (lectura fuera del tx).
    let vehiculoLabel: string | null = null
    let vehiculoPlaca: string | null = null
    if (vehiculoId) {
      const v = await sinEmpresa('canje: buscar vehículo', (tx) =>
        tx.vehiculo.findUnique({ where: { id: vehiculoId } })
      )
      if (v) {
        vehiculoLabel = `${v.marca} ${v.modelo}${v.anio ? ` (${v.anio})` : ''}`
        vehiculoPlaca = v.placa ?? null
      }
    }

    const now = new Date()
    if (membership.estado !== 'ACTIVA') {
      return no('MEMBRESIA_NO_ACTIVA', `La membresía no está activa (estado: ${membership.estado}).`)
    }
    if (membership.fechaVencimiento && membership.fechaVencimiento <= now) {
      return no('MEMBRESIA_VENCIDA', 'La membresía ha vencido.')
    }

    const ilimitado = membership.plan.esIlimitado
    // El saldo es la suma de los dos contadores: los del plan y los de regalo.
    const saldoTotal = membership.lavadosRestantes + membership.lavadosBonoRestantes
    if (!ilimitado && saldoTotal <= 0) {
      return no('SIN_USOS', 'No quedan usos disponibles en este período.')
    }

    if (qrTokenId) {
      const qrTokenData = await sinEmpresa('canje: verificar qrToken', (tx) =>
        tx.qrToken.findUnique({ where: { id: qrTokenId } })
      )
      if (!qrTokenData || qrTokenData.membresiaId !== membership.id) {
        return no('QR_INVALIDO', 'Este código QR no es válido para esta membresía.')
      }
    }

    const descontado = !ilimitado

    // ── Núcleo atómico ──────────────────────────────────────────────────────
    // Una sola transacción corta con TODAS las invariantes protegidas por
    // updates guardados (no por las lecturas previas, que sufren TOCTOU):
    //  - QR de un solo uso: updateMany where activo:true
    //  - estado ACTIVA + no vencida + saldo: en el where del update de la
    //    membresía, de modo que una cancelación/vencimiento que ocurra entre
    //    la lectura y el commit hace count=0 y aborta.
    // La auditoría va DENTRO: una visita no puede quedar registrada sin su
    // rastro de auditoría.
    const auditBase = {
      companyId: membership.companyId,
      userId: actor.dbUserId,
      ...meta,
    }

    const result = await conEmpresa(membership.companyId, async (tx) => {
      if (qrTokenId) {
        const invalidado = await tx.qrToken.updateMany({
          where: { id: qrTokenId, activo: true, membresiaId: membership.id },
          data: { activo: false },
        })
        if (invalidado.count === 0) {
          throw new RechazoTx(
            'CONFLICTO',
            'Este código QR ya fue utilizado. Pide al cliente que muestre su QR actualizado.'
          )
        }
      }

      // Guard de estado/vencimiento (+ saldo si aplica) atómico con el commit.
      const guardVigente = {
        id: membership.id,
        estado: 'ACTIVA' as const,
        OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: now } }],
      }
      // ORDEN DE CONSUMO: primero los del PLAN, después los de REGALO.
      //
      // Los del plan se pierden al renovar y los de regalo no. Gastar primero
      // lo que caduca es lo único que no desperdicia nada del cliente; al
      // revés, el regalo se comería el saldo del período y los lavados
      // pagados morirían sin usarse.
      //
      // Los dos van con su guardia en el `where`, así que la condición se
      // comprueba en el commit y no en la lectura previa (TOCTOU).
      let upd = descontado
        ? await tx.membership.updateMany({
            where: { ...guardVigente, lavadosRestantes: { gt: 0 } },
            data: { lavadosRestantes: { decrement: 1 } },
          })
        : await tx.membership.updateMany({
            // Plan ilimitado: no se descuenta saldo, pero se re-valida
            // estado/vencimiento tocando updatedAt de forma atómica.
            where: guardVigente,
            data: { updatedAt: now },
          })
      // Sin saldo en el plan: se intenta el de regalo. Este segundo intento es
      // el que hace que un regalo sirva cuando los del plan ya se acabaron.
      let usoDeRegalo = false
      if (descontado && upd.count === 0) {
        upd = await tx.membership.updateMany({
          where: { ...guardVigente, lavadosBonoRestantes: { gt: 0 } },
          data: { lavadosBonoRestantes: { decrement: 1 } },
        })
        usoDeRegalo = upd.count > 0
      }
      if (upd.count === 0) {
        throw new RechazoTx(
          'CONFLICTO',
          descontado
            ? 'No se pudo registrar la visita: la membresía ya no está vigente o sin usos disponibles.'
            : 'No se pudo registrar la visita: la membresía ya no está vigente.'
        )
      }

      // Saldo real tras el decremento (no el valor leído, que sería stale
      // frente a escaneos concurrentes). Se suman los DOS contadores: lo que
      // el cliente quiere saber es cuántos lavados le quedan, no de qué bolsa
      // salieron.
      let restantes = membership.lavadosRestantes + membership.lavadosBonoRestantes
      if (descontado) {
        const fresco = await tx.membership.findUnique({
          where: { id: membership.id },
          select: { lavadosRestantes: true, lavadosBonoRestantes: true },
        })
        restantes = fresco
          ? fresco.lavadosRestantes + fresco.lavadosBonoRestantes
          : Math.max(0, restantes - 1)
      }

      const visit = await tx.visit.create({
        data: {
          clienteId: membership.clienteId,
          vehiculoId,
          membershipId: membership.id,
          sucursalId,
          empleadoId: actor.dbUserId,
          servicio,
          descontado,
          notas,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      })

      // Regenerar el QR solo si el beneficio SIGUE teniendo usos. Al agotarse
      // (planes con saldo) no se emite uno nuevo: la membresía queda "Sin usos
      // disponibles" hasta la renovación. Los ilimitados siempre regeneran.
      const regenerar = qrTokenId != null && (!descontado || restantes > 0)
      let nuevoQrId: string | null = null
      if (regenerar) {
        const nuevoQr = await tx.qrToken.create({
          data: {
            clienteId: membership.clienteId,
            membresiaId: membership.id,
            token: nuevoTokenQr(),
            expiraAt: vencimientoQr(),
          },
        })
        nuevoQrId = nuevoQr.id
      }

      const auditRows = [
        {
          ...auditBase,
          accion: 'VISITA_CONFIRMADA' as const,
          entidadTipo: 'Visit',
          entidadId: visit.id,
          payload: {
            clienteId: membership.clienteId,
            membershipId: membership.id,
            servicio,
            descontado,
            // De qué bolsa salió el uso. Sin esto, un lavado de regalo y uno
            // del plan son indistinguibles en la auditoría, y el negocio no
            // puede saber cuánto está regalando de verdad.
            usoDeRegalo,
            restantes,
            sucursalId,
            // Rastro del origen: sin esto, una visita creada por un satélite y
            // otra creada en el mostrador son indistinguibles en la auditoría.
            origen: actor.origen,
            ...(actor.sistemaSlug ? { sistema: actor.sistemaSlug } : {}),
          },
        },
        // El QR usado se invalidó siempre que existía: se audita aunque no se
        // regenere (último uso).
        ...(qrTokenId
          ? [
              {
                ...auditBase,
                accion: 'QR_USADO' as const,
                entidadTipo: 'QrToken',
                entidadId: qrTokenId,
                payload: {
                  clienteId: membership.clienteId,
                  membresiaId: membership.id,
                  visitId: visit.id,
                },
              },
            ]
          : []),
        ...(nuevoQrId
          ? [
              {
                ...auditBase,
                accion: 'QR_GENERADO' as const,
                entidadTipo: 'QrToken',
                entidadId: nuevoQrId,
                payload: {
                  clienteId: membership.clienteId,
                  membresiaId: membership.id,
                  motivo: 'regeneracion_post_uso',
                },
              },
            ]
          : []),
      ]
      await tx.auditLog.createMany({ data: auditRows })

      // La operación queda registrada como TRANSACCIÓN OFICIAL dentro del mismo
      // núcleo atómico (o entra todo, o no entra nada).
      const snapshot = {
        empresa: membership.cliente.company.name,
        cliente: membership.cliente.nombre,
        vehiculo: vehiculoLabel ?? undefined,
        placa: vehiculoPlaca ?? undefined,
        servicio,
        membresia: membership.plan.nombre,
        plan: membership.plan.nombre,
        empleado: actor.nombre ?? undefined,
        sucursal: sucursalNombre ?? undefined,
        restantes: ilimitado ? ('ilimitado' as const) : restantes,
      }
      const transaccion = await crearTransaccionAplicada(tx, {
        tipo: 'MEMBERSHIP_REDEMPTION',
        companyId: membership.companyId,
        sucursalId,
        clienteId: membership.clienteId,
        empleadoId: actor.dbUserId,
        membershipId: membership.id,
        visitId: visit.id,
        qrTokenUsadoId: qrTokenId,
        snapshot,
        auditoria: { ...meta },
        resultado: notas,
        executionMs: Date.now() - contexto.iniciadoEn,
        timeZone: membership.cliente.company.zonaHoraria,
        userId: actor.dbUserId,
      })

      return { restantes, visitId: visit.id, transaccion }
    })

    // ── Fuera de la transacción ─────────────────────────────────────────────
    // El bus de estrategias nunca rompe el flujo (el helper captura sus errores).
    const totalVisitas = await conEmpresa(membership.companyId, (tx) =>
      tx.visit.count({ where: { clienteId: membership.clienteId } })
    ).catch(() => 0)
    const factsCliente = {
      nombre: membership.cliente.nombre,
      visitas: totalVisitas,
      totalVisitas,
    }
    // `sistemaOrigen` viaja en el payload para que el despacho NO le devuelva
    // el evento al satélite que acaba de provocarlo: ya tiene la respuesta
    // síncrona, y un webhook de su propia acción es un eco —que en una
    // implementación ingenua es un bucle.
    const origen = actor.sistemaSlug ? { sistemaOrigen: actor.sistemaSlug } : {}
    await emitirEventoEstrategia({
      companyId: membership.companyId,
      type: 'cliente.visita',
      subjectId: membership.clienteId,
      payload: { cliente: factsCliente, visita: { servicio, sucursalId }, ...origen },
    })
    if (totalVisitas === 1) {
      await emitirEventoEstrategia({
        companyId: membership.companyId,
        type: 'cliente.primera_visita',
        subjectId: membership.clienteId,
        payload: { cliente: factsCliente, ...origen },
      })
    }

    // Growth Engine: primer canje atribuido a una campaña de invitación
    // (deduplicado internamente; nunca rompe el canje).
    await registrarHitoInvitacion(membership.clienteId, 'PRIMER_CANJE')

    // Ticket (Receipt Engine): plantilla de la empresa + snapshot.
    const [plantilla, promosActivas] = await conEmpresa(membership.companyId, (tx) =>
      Promise.all([
        tx.receiptTemplate
          .findUnique({ where: { companyId: membership.companyId } })
          .catch(() => null),
        tx.promocion
          .findMany({
            where: {
              companyId: membership.companyId,
              activo: true,
              archivada: false,
              vigenciaDesde: { lte: new Date() },
              OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: new Date() } }],
            },
            select: { titulo: true },
            orderBy: { prioridad: 'desc' },
            take: 3,
          })
          .catch(() => []),
      ])
    )
    const empresa = membership.cliente.company
    const ticket: TicketPayload = {
      transactionId: result.transaccion.id,
      lineas: [],
      metodoPago: null,
      esEntrega: false,
      timeZone: empresa.zonaHoraria,
      empresa: {
        nombre: empresa.name,
        sucursal: sucursalNombre,
        direccion: empresa.direccion,
        telefono: empresa.telefono,
        web: empresa.website,
        logoUrl: empresa.logoUrl,
      },
      template: (plantilla?.config ?? {}) as TicketPayload['template'],
      transaccion: {
        codigo: result.transaccion.codigo,
        ticketNumero: result.transaccion.ticketNumero,
        fecha: new Date().toISOString(),
        empleado: actor.nombre,
        cliente: membership.cliente.nombre,
        vehiculo: vehiculoLabel,
        placa: vehiculoPlaca,
        membresia: membership.plan.nombre,
        plan: membership.plan.nombre,
        servicio,
        restantes: ilimitado ? 'ilimitado' : result.restantes,
        observaciones: notas,
        promosActivas: promosActivas.map((x) => x.titulo),
      },
    }

    return {
      ok: true,
      visitId: result.visitId,
      transaccionId: result.transaccion.id,
      codigo: result.transaccion.codigo,
      ticketNumero: result.transaccion.ticketNumero,
      restantes: ilimitado ? null : result.restantes,
      ilimitado,
      servicio,
      clienteId: membership.clienteId,
      companyId: membership.companyId,
      ticket,
    }
  } catch (e) {
    if (e instanceof RechazoTx) return no(e.motivo, e.message)
    capturarErrorInesperado('canje:ejecutar', e)
    return no('ERROR_INTERNO', 'Error interno al confirmar la visita. Intenta de nuevo.')
  }
}
