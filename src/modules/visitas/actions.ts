'use server'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { qrScanLimiter } from '@/lib/rate-limit'
import { SCANNER_ROLES } from '@/types'
import {
  crearTransaccionAplicada,
  getByQrUsado,
  isTransactionCodigo,
} from '@/lib/transactions'
import {
  consultarTransaccionPorCodigo,
  type TicketPayload,
  type TransaccionScanInfo,
} from '@/modules/transacciones/actions'
import { validarConsumoCompra, registrarTransicionCompra } from '@/modules/promociones/compra'
import { registrarHitoInvitacion } from '@/modules/invitaciones/hitosConversion'
import { anotarFallo } from '@/lib/prisma-errors'
import { nuevoTokenQr, qrVencido, vencimientoQr } from '@/modules/qr/token'
import { primerErrorZod } from '@/lib/validacion'
import { capturarErrorInesperado } from '@/lib/sentry'
import { confirmarVisitaSchema } from '@/modules/visitas/schema'

export interface VisitaReciente {
  id: string
  servicio: string
  fecha: string
  descontado: boolean
}

export interface ClienteLookup {
  clienteId: string
  nombre: string
  email: string
  avatarUrl: string | null
  empresa: string
  empresaType: string
  membershipId: string | null
  qrTokenId: string | null
  planNombre: string | null
  planBeneficios: string[]
  estado: string | null
  esIlimitado: boolean
  lavadosIncluidos: number
  lavadosRestantes: number
  fechaInicio: string | null
  fechaVencimiento: string | null
  vehiculos: { id: string; label: string }[]
  puedeUsar: boolean
  mensaje?: string
  alertas: string[]
  visitasRecientes: VisitaReciente[]
  totalVisitas: number
  ultimoUso: string | null
  promocionesActivas: number
}

/** Fase E5: lookup de un QR de compra de promoción (mismo escáner). */
export interface PromoCompraLookup {
  compraId: string
  qrTokenId: string
  clienteId: string
  nombre: string
  avatarUrl: string | null
  empresa: string
  promoTitulo: string
  promoDescripcion: string
  promoTipo: string
  descuento: number | null
  codigo: string | null
  estado: string
  usosIncluidos: number
  usosRestantes: number
  fechaActivacion: string | null
  fechaVencimiento: string | null
  puedeUsar: boolean
  mensaje?: string
  alertas: string[]
}

export interface LookupResult {
  error?: string
  errorCode?: 'QR_NOT_FOUND' | 'QR_INACTIVE' | 'WRONG_COMPANY' | 'NO_MEMBERSHIP' | 'MEMBERSHIP_INACTIVE' | 'MEMBERSHIP_EXPIRED' | 'NO_USES_LEFT' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'INTERNAL'
  cliente?: ClienteLookup
  /** Fase E4: al escanear un QR ya utilizado o un QR de transacción (TX-…),
   *  se devuelve el registro oficial completo de la operación. */
  transaccion?: TransaccionScanInfo
  /** Fase E5: QR de una promoción comprada (canje). */
  promoCompra?: PromoCompraLookup
}

export async function buscarPorToken(token: string): Promise<LookupResult> {
  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
      return { error: 'No tienes permisos para escanear códigos QR.', errorCode: 'UNAUTHORIZED' }
    }

    const clientId = user.metadata.dbUserId || 'anonymous'
    if (!(await qrScanLimiter(clientId))) {
      return { error: 'Demasiadas búsquedas. Espera un momento e intenta de nuevo.', errorCode: 'RATE_LIMITED' }
    }

    // Los lectores físicos "escriben" el código como teclado: espacios/saltos
    // colados y símbolos cambiados por la distribución (ES vs EN) son lo normal,
    // no la excepción.
    const clean = token.trim().replace(/\s+/g, '')
    if (!clean) return { error: 'El código QR está vacío.', errorCode: 'QR_NOT_FOUND' }

    // El QR de "Mi ID MembeGo" (@código, para regalos) no es el de visitas:
    // guiar al empleado en vez de un "no existe" seco.
    if (clean.startsWith('@')) {
      return {
        error:
          'Ese QR es el ID de regalos del cliente, no el de su membresía. Pídele que abra su membresía (el botón de QR del centro) y muestre ese código.',
        errorCode: 'QR_NOT_FOUND',
      }
    }

    // Fase E4: el QR impreso en el ticket codifica el Transaction ID (TX-…).
    // Escanearlo consulta el historial oficial de esa operación.
    if (isTransactionCodigo(clean)) {
      const res = await consultarTransaccionPorCodigo(clean)
      if (res.transaccion) return { transaccion: res.transaccion }
      return { error: res.error ?? 'Transacción no encontrada.', errorCode: 'QR_NOT_FOUND' }
    }

    // Tolerancia al lector físico con distribución de teclado cambiada: los
    // tokens son base64url (letras, números, "-" y "_"); un lector en EN sobre
    // Windows en ES teclea "-"→"'" y "_"→"?". Si la búsqueda exacta falla, se
    // intenta UNA variante corregida (mapeo determinista, sin adivinar).
    const corregido = clean.replace(/'/g, '-').replace(/[?¿]/g, '_').replace(/´/g, '-')
    const candidatos = corregido !== clean ? [clean, corregido] : [clean]

    let qr = null
    for (const candidato of candidatos) {
      qr = await sinEmpresa('visitas: buscar QR por token (cross-tenant)', (tx) =>
        tx.qrToken.findUnique({
          where: { token: candidato },
          include: {
            cliente: {
              include: {
                company: true,
                vehiculos: true,
                visits: { orderBy: { fechaVisita: 'desc' }, take: 5 },
                _count: { select: { visits: true } },
              },
            },
            membership: {
              include: { plan: true },
            },
            // Fase E5: el mismo QR puede pertenecer a una compra de promoción.
            compra: {
              include: {
                promocion: true,
                company: { select: { name: true, zonaHoraria: true } },
              },
            },
          },
        })
      )
      if (qr) break
    }

    // Caducidad (auditoría · A-02). Va ANTES de cualquier otra comprobación
    // de estado para que el mensaje sea el correcto: decirle al empleado
    // "membresía sin usos" cuando el problema es un QR de hace ocho meses lo
    // manda a resolver algo que no está roto.
    if (qr && qrVencido(qr.expiraAt)) {
      await logScanInvalido(user.metadata.dbUserId, clean, 'QR_VENCIDO')
      return {
        error:
          'Este código QR ya venció. Pídele al cliente que abra su membresía en la app para generar uno nuevo.',
        errorCode: 'QR_NOT_FOUND',
      }
    }

    if (!qr) {
      await logScanInvalido(user.metadata.dbUserId, clean, 'QR_NOT_FOUND')
      return {
        error:
          'Este código QR no existe. Verifica que sea el QR de la membresía del cliente. Si usas lector físico y falla seguido, prueba con la cámara: algunos lectores cambian símbolos según el idioma del teclado.',
        errorCode: 'QR_NOT_FOUND',
      }
    }

    if (!qr.activo) {
      await logScanInvalido(user.metadata.dbUserId, clean, 'QR_INACTIVE')
      // Fase E4 · Historial del QR: un QR usado no es solo un error — es una
      // transacción registrada. Se muestra el registro oficial completo.
      const tx = await getByQrUsado(qr.id).catch(() => null)
      if (tx) {
        const res = await consultarTransaccionPorCodigo(tx.codigo)
        if (res.transaccion) {
          return { errorCode: 'QR_INACTIVE', transaccion: res.transaccion }
        }
      }
      return { error: 'Este código QR ya fue utilizado. Pide al cliente que muestre su QR actualizado.', errorCode: 'QR_INACTIVE' }
    }

    const cliente = qr.cliente

    // ── Fase E5: QR de una compra de promoción — flujo de canje propio ──────
    if (qr.compra) {
      const compra = qr.compra
      if (
        user.metadata.role !== 'SUPERADMIN' &&
        user.metadata.companyId &&
        compra.companyId !== user.metadata.companyId
      ) {
        await logScanInvalido(user.metadata.dbUserId, clean, 'WRONG_COMPANY')
        return { error: 'Esta promoción pertenece a otra empresa.', errorCode: 'WRONG_COMPANY' }
      }
      const promo = compra.promocion
      const validacion = promo
        ? validarConsumoCompra(
            compra,
            { diasPermitidos: promo.diasPermitidos, horaDesde: promo.horaDesde, horaHasta: promo.horaHasta },
            new Date(),
            compra.company.zonaHoraria
          )
        : { puedeUsar: false, mensaje: 'La promoción de esta compra ya no existe.' as string, expiro: false }

      // Vencimiento detectado al escanear: se marca EXPIRADA (lazy) y queda
      // registrado en la bitácora de transiciones.
      if (validacion.expiro) {
        await conEmpresa(compra.companyId, async (tx) => {
          const upd = await tx.productoCompra.updateMany({
            where: { id: compra.id, estado: 'ACTIVA' },
            data: { estado: 'EXPIRADA' },
          })
          if (upd.count > 0) {
            await registrarTransicionCompra(tx, {
              compraId: compra.id,
              desde: 'ACTIVA',
              hacia: 'EXPIRADA',
              motivo: 'Vencimiento detectado al escanear',
              userId: user.metadata.dbUserId ?? null,
            })
          }
        }).catch(anotarFallo('visitas:vencimiento-membresia'))
      }

      return {
        promoCompra: {
          compraId: compra.id,
          qrTokenId: qr.id,
          clienteId: cliente.id,
          nombre: cliente.nombre,
          avatarUrl: cliente.avatarUrl ?? null,
          empresa: compra.company.name,
          promoTitulo: promo?.titulo ?? 'Promoción',
          promoDescripcion: promo?.descripcion ?? '',
          promoTipo: promo?.tipo ?? 'general',
          descuento: promo?.descuento ?? null,
          codigo: promo?.codigo ?? null,
          estado: validacion.expiro ? 'EXPIRADA' : compra.estado,
          usosIncluidos: compra.usosIncluidos,
          usosRestantes: compra.usosRestantes,
          fechaActivacion: compra.fechaActivacion?.toISOString() ?? null,
          fechaVencimiento: compra.fechaVencimiento?.toISOString() ?? null,
          puedeUsar: validacion.puedeUsar,
          mensaje: validacion.mensaje,
          alertas:
            compra.usosRestantes === 1 && validacion.puedeUsar
              ? ['Este es el último uso disponible de la promoción.']
              : [],
        },
      }
    }

    const membership = qr.membership
    if (!membership) {
      // QR sin membresía ni compra (no debería existir): trato como sin membresía.
      await logScanInvalido(user.metadata.dbUserId, clean, 'NO_MEMBERSHIP')
      return { error: 'Este código no está asociado a una membresía ni a una promoción.', errorCode: 'NO_MEMBERSHIP' }
    }

    // Validate scanner's company matches membership's company
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      user.metadata.companyId &&
      membership.companyId !== user.metadata.companyId
    ) {
      await logScanInvalido(user.metadata.dbUserId, clean, 'WRONG_COMPANY')
      return { error: 'Este cliente pertenece a otra empresa.', errorCode: 'WRONG_COMPANY' }
    }

    const now = new Date()
    const m = membership

    const promocionesActivas = await conEmpresa(membership.companyId, (tx) =>
      tx.promocion.count({
        where: { companyId: membership.companyId, activo: true, vigenciaDesde: { lte: now }, OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }] },
      })
    ).catch(() => 0)

    let puedeUsar = false
    let mensaje: string | undefined
    let errorCode: LookupResult['errorCode'] | undefined

    if (m.estado !== 'ACTIVA') {
      const estadoMap: Record<string, string> = {
        PENDIENTE: 'La membresía está pendiente de activación.',
        PENDIENTE_PAGO: 'La membresía está esperando confirmación de pago.',
        RECHAZADA: 'El pago de la membresía fue rechazado.',
        VENCIDA: 'La membresía ha vencido. El cliente debe renovar.',
        CANCELADA: 'La membresía fue cancelada.',
      }
      mensaje = estadoMap[m.estado] ?? 'La membresía no está activa.'
      errorCode = 'MEMBERSHIP_INACTIVE'
    } else if (m.fechaVencimiento && m.fechaVencimiento <= now) {
      mensaje = 'La membresía ha vencido.'
      errorCode = 'MEMBERSHIP_EXPIRED'
    } else if (!m.plan.esIlimitado && m.lavadosRestantes <= 0) {
      mensaje = 'No quedan usos disponibles en este período.'
      errorCode = 'NO_USES_LEFT'
    } else {
      puedeUsar = true
    }

    const alertas: string[] = []
    if (m.estado === 'ACTIVA') {
      if (m.fechaVencimiento) {
        const daysLeft = Math.ceil(
          (m.fechaVencimiento.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        )
        if (daysLeft <= 7 && daysLeft > 0) {
          alertas.push(`La membresía vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}.`)
        }
      }
      if (!m.plan.esIlimitado && m.lavadosRestantes === 1) {
        alertas.push('Este es el último uso disponible.')
      }
    }

    const lastVisit = cliente.visits[0]

    return {
      errorCode,
      cliente: {
        clienteId: cliente.id,
        nombre: cliente.nombre,
        email: cliente.email,
        avatarUrl: cliente.avatarUrl ?? null,
        empresa: cliente.company.name,
        empresaType: cliente.company.type,
        membershipId: m.id,
        qrTokenId: qr.id,
        planNombre: m.plan.nombre,
        planBeneficios: m.plan.beneficios,
        estado: m.estado,
        esIlimitado: m.plan.esIlimitado ?? false,
        lavadosIncluidos: m.plan.lavadosIncluidos ?? 0,
        lavadosRestantes: m.lavadosRestantes ?? 0,
        fechaInicio: m.fechaInicio?.toISOString() ?? null,
        fechaVencimiento: m.fechaVencimiento?.toISOString() ?? null,
        vehiculos: cliente.vehiculos.map((v) => ({
          id: v.id,
          label: `${v.marca} ${v.modelo} (${v.anio})${v.placa ? ` · ${v.placa}` : ''}`,
        })),
        puedeUsar,
        mensaje,
        alertas,
        visitasRecientes: cliente.visits.map((v) => ({
          id: v.id,
          servicio: v.servicio,
          fecha: v.fechaVisita.toISOString(),
          descontado: v.descontado,
        })),
        totalVisitas: cliente._count.visits,
        ultimoUso: lastVisit?.fechaVisita.toISOString() ?? null,
        promocionesActivas,
      },
    }
  } catch (e) {
    console.error('[visitas] buscarPorToken error:', e)
    return { error: 'Error interno al verificar el código QR. Intenta de nuevo.', errorCode: 'INTERNAL' }
  }
}

export interface ConfirmState {
  error?: string
  success?: boolean
  restantes?: number
  visitId?: string
  servicio?: string
  /** Fase E4: registro oficial de la operación + datos del ticket. */
  transaccionId?: string
  codigo?: string
  ticketNumero?: string
  ticket?: TicketPayload
}

export async function confirmarVisita(
  _prev: ConfirmState,
  formData: FormData
): Promise<ConfirmState> {
  const t0 = Date.now()
  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
      return { error: 'No tienes permisos para confirmar visitas.' }
    }

    const parsed = confirmarVisitaSchema.safeParse({
      membershipId: String(formData.get('membershipId') ?? ''),
      servicio: String(formData.get('servicio') ?? ''),
      vehiculoId: String(formData.get('vehiculoId') ?? ''),
      notas: String(formData.get('notas') ?? ''),
      sucursalId: String(formData.get('sucursalId') ?? ''),
      qrTokenId: String(formData.get('qrTokenId') ?? ''),
    })
    if (!parsed.success) return { error: primerErrorZod(parsed.error) }
    const { membershipId, servicio, vehiculoId, notas, sucursalId, qrTokenId } = parsed.data

    const meta = await getRequestMeta()

    // Documento comercial: SIEMPRE el nombre del empleado, nunca su correo
    // (el correo queda solo como dato interno de auditoría).
    const dbUserId = user.metadata.dbUserId
    const empleadoNombre =
      (dbUserId
        ? (
            await sinEmpresa('visitas: buscar nombre de empleado', (tx) =>
              tx.user.findUnique({
                where: { id: dbUserId },
                select: { name: true },
              })
            )
          )?.name
        : null) ??
      user.email ??
      null

    // ── Validaciones de solo lectura FUERA de la transacción ────────────────
    // En pgBouncer transaction-mode cada transacción interactiva retiene
    // ("pin") una conexión real durante todo el callback; antes eran ~10
    // round-trips dentro de la transacción. Las invariantes críticas (QR de
    // un solo uso, descuento de saldo) se protegen con updates guardados
    // dentro del núcleo atómico de abajo.
    const membership = await sinEmpresa('visitas: buscar membresía para confirmar', (tx) =>
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
        },
      })
    )
    if (!membership) {
      return { error: 'La membresía no fue encontrada. Puede haber sido eliminada.' }
    }

    if (
      user.metadata.role !== 'SUPERADMIN' &&
      user.metadata.companyId &&
      membership.companyId !== user.metadata.companyId
    ) {
      return { error: 'Este cliente pertenece a otra empresa.' }
    }

    let sucursalNombre: string | null = null
    if (sucursalId) {
      const sucursal = await conEmpresa(membership.companyId, (tx) =>
        tx.sucursal.findUnique({
          where: { id: sucursalId },
        })
      )
      if (!sucursal) {
        return { error: 'La sucursal no fue encontrada.' }
      }
      if (sucursal.companyId !== membership.companyId) {
        return { error: 'La sucursal no pertenece a la empresa del cliente.' }
      }
      sucursalNombre = sucursal.nombre
    }

    // Etiquetas del vehículo para el snapshot/ticket (lectura fuera del tx).
    let vehiculoLabel: string | null = null
    let vehiculoPlaca: string | null = null
    if (vehiculoId) {
      const v = await sinEmpresa('visitas: buscar vehículo', (tx) =>
        tx.vehiculo.findUnique({ where: { id: vehiculoId } })
      )
      if (v) {
        vehiculoLabel = `${v.marca} ${v.modelo}${v.anio ? ` (${v.anio})` : ''}`
        vehiculoPlaca = v.placa ?? null
      }
    }

    const now = new Date()
    if (membership.estado !== 'ACTIVA') {
      return { error: `La membresía no está activa (estado: ${membership.estado}).` }
    }
    if (membership.fechaVencimiento && membership.fechaVencimiento <= now) {
      return { error: 'La membresía ha vencido.' }
    }

    const ilimitado = membership.plan.esIlimitado
    if (!ilimitado && membership.lavadosRestantes <= 0) {
      return { error: 'No quedan usos disponibles en este período.' }
    }

    if (qrTokenId) {
      // Verify qrToken belongs to the correct membership
      const qrTokenData = await sinEmpresa('visitas: verificar qrToken', (tx) =>
        tx.qrToken.findUnique({
          where: { id: qrTokenId },
        })
      )
      if (!qrTokenData || qrTokenData.membresiaId !== membership.id) {
        return { error: 'Este código QR no es válido para esta membresía.' }
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
    // La auditoría va DENTRO (un solo createMany, más barato que 3 creates):
    // una visita no puede quedar registrada sin su rastro de auditoría.
    const auditBase = {
      companyId: membership.companyId,
      userId: user.metadata.dbUserId ?? null,
      ...meta,
    }

    const result = await conEmpresa(membership.companyId, async (tx) => {
      if (qrTokenId) {
        const invalidado = await tx.qrToken.updateMany({
          where: { id: qrTokenId, activo: true, membresiaId: membership.id },
          data: { activo: false },
        })
        if (invalidado.count === 0) {
          throw new TxError('Este código QR ya fue utilizado. Pide al cliente que muestre su QR actualizado.')
        }
      }

      // Guard de estado/vencimiento (+ saldo si aplica) atómico con el commit.
      const guardVigente = {
        id: membership.id,
        estado: 'ACTIVA' as const,
        OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: now } }],
      }
      const upd = descontado
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
      if (upd.count === 0) {
        throw new TxError(
          descontado
            ? 'No se pudo registrar la visita: la membresía ya no está vigente o sin usos disponibles.'
            : 'No se pudo registrar la visita: la membresía ya no está vigente.'
        )
      }

      // Saldo real tras el decremento (no el valor leído, que sería stale
      // frente a escaneos concurrentes).
      let restantes = membership.lavadosRestantes
      if (descontado) {
        const fresco = await tx.membership.findUnique({
          where: { id: membership.id },
          select: { lavadosRestantes: true },
        })
        restantes = fresco?.lavadosRestantes ?? Math.max(0, restantes - 1)
      }

      const visit = await tx.visit.create({
        data: {
          clienteId: membership.clienteId,
          vehiculoId,
          membershipId: membership.id,
          sucursalId,
          empleadoId: user.metadata.dbUserId || null,
          servicio,
          descontado,
          notas,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      })

      // Regenerar el QR solo si el beneficio SIGUE teniendo usos. Al agotarse
      // (planes con saldo) no se emite uno nuevo: la membresía queda "Sin usos
      // disponibles" hasta la renovación (alinea con las promociones, que no
      // regeneran QR tras el último uso). Los planes ilimitados siempre regeneran.
      const regenerar = qrTokenId != null && (!descontado || restantes > 0)
      let nuevoQrId: string | null = null
      if (regenerar) {
        const nuevoQr = await tx.qrToken.create({
          data: {
            clienteId: membership.clienteId,
            membresiaId: membership.id,
            token: nuevoTokenQr(), expiraAt: vencimientoQr(),
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
            restantes,
            sucursalId,
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
        // La regeneración solo ocurre si quedaban usos.
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

      // Fase E4: la operación queda registrada como TRANSACCIÓN OFICIAL
      // dentro del mismo núcleo atómico (o entra todo, o no entra nada).
      const snapshot = {
        empresa: membership.cliente.company.name,
        cliente: membership.cliente.nombre,
        vehiculo: vehiculoLabel ?? undefined,
        placa: vehiculoPlaca ?? undefined,
        servicio,
        membresia: membership.plan.nombre,
        plan: membership.plan.nombre,
        empleado: empleadoNombre ?? undefined,
        sucursal: sucursalNombre ?? undefined,
        restantes: ilimitado ? ('ilimitado' as const) : restantes,
      }
      const transaccion = await crearTransaccionAplicada(tx, {
        tipo: 'MEMBERSHIP_REDEMPTION',
        companyId: membership.companyId,
        sucursalId,
        clienteId: membership.clienteId,
        empleadoId: user.metadata.dbUserId || null,
        membershipId: membership.id,
        visitId: visit.id,
        qrTokenUsadoId: qrTokenId,
        snapshot,
        auditoria: { ...meta },
        resultado: notas,
        executionMs: Date.now() - t0,
        timeZone: membership.cliente.company.zonaHoraria,
        userId: user.metadata.dbUserId || null,
      })

      return { restantes, visitId: visit.id, transaccion }
    })

    // Bus de estrategias: la visita quedó confirmada. Se emite fuera de la
    // transacción y nunca rompe el flujo (el helper captura sus errores).
    const totalVisitas = await conEmpresa(membership.companyId, (tx) =>
      tx.visit.count({ where: { clienteId: membership.clienteId } })
    ).catch(() => 0)
    const factsCliente = {
      nombre: membership.cliente.nombre,
      visitas: totalVisitas,
      totalVisitas,
    }
    await emitirEventoEstrategia({
      companyId: membership.companyId,
      type: 'cliente.visita',
      subjectId: membership.clienteId,
      payload: { cliente: factsCliente, visita: { servicio, sucursalId } },
    })
    if (totalVisitas === 1) {
      await emitirEventoEstrategia({
        companyId: membership.companyId,
        type: 'cliente.primera_visita',
        subjectId: membership.clienteId,
        payload: { cliente: factsCliente },
      })
    }

    // Growth Engine: primer canje de un cliente atribuido a una campaña de
    // invitación (deduplicado internamente; nunca rompe la visita).
    await registrarHitoInvitacion(membership.clienteId, 'PRIMER_CANJE')

    // Payload del ticket (Receipt Engine): plantilla de la empresa + snapshot.
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
        empleado: empleadoNombre,
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
      success: true,
      restantes: result.restantes,
      visitId: result.visitId,
      servicio,
      transaccionId: result.transaccion.id,
      codigo: result.transaccion.codigo,
      ticketNumero: result.transaccion.ticketNumero,
      ticket,
    }
  } catch (e) {
    if (e instanceof TxError) {
      return { error: e.message }
    }
    capturarErrorInesperado('visitas:confirmar', e)
    return { error: 'Error interno al confirmar la visita. Intenta de nuevo.' }
  }
}

export interface ImpresionState {
  error?: string
  success?: boolean
}

export async function registrarImpresion(visitId: string): Promise<ImpresionState> {
  try {
    const user = await getUser()
    if (!user || !SCANNER_ROLES.includes(user.metadata.role)) {
      return { error: 'No autorizado.' }
    }
    const meta = await getRequestMeta()
    const visit = await sinEmpresa('visitas: buscar visita a imprimir', (tx) =>
      tx.visit.findUnique({
        where: { id: visitId },
        include: { membership: { include: { cliente: true } } },
      })
    )
    if (!visit) return { error: 'Visita no encontrada.' }

    const companyId = visit.membership?.cliente.companyId
    const registrarAuditoria = (tx: Parameters<typeof conEmpresa>[1]) =>
      tx.auditLog.create({
        data: {
          companyId: companyId ?? null,
          userId: user.metadata.dbUserId ?? null,
          accion: 'COMPROBANTE_IMPRESO',
          entidadTipo: 'Visit',
          entidadId: visitId,
          payload: { visitId },
          ...meta,
        },
      })
    await (companyId
      ? conEmpresa(companyId, registrarAuditoria)
      : sinEmpresa('visitas: auditar impresión sin empresa', registrarAuditoria))
    return { success: true }
  } catch {
    return { error: 'No se pudo registrar la impresión.' }
  }
}

class TxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TxError'
  }
}

async function logScanInvalido(userId: string | undefined, token: string, reason: string) {
  try {
    const meta = await getRequestMeta()
    await sinEmpresa('visitas: auditar scan inválido', (tx) =>
      tx.auditLog.create({
        data: {
          userId: userId ?? null,
          accion: 'QR_USADO',
          entidadTipo: 'QrToken',
          entidadId: token.slice(0, 25),
          payload: { reason, token: token.slice(0, 10) + '…', valido: false },
          ...meta,
        },
      })
    )
  } catch {
    // best-effort logging
  }
}
