import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { validarConsumoCompra } from '@/modules/promociones/compra'
import { coberturaDeMembresia, type ContextoConsumo } from '@/modules/plataforma/cobertura'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/benefits/evaluate
 *
 * «¿Qué puede consumir este cliente AHORA MISMO, en esta empresa?»
 *
 * Es la llamada que la Fase 1a dejó apartada a propósito: la elegibilidad es la
 * única entidad del contrato que **no se proyecta**. Un vertical puede copiar
 * el nombre del cliente y el estado de su membresía para pintarlos; no puede
 * copiar esto, porque decide dinero y una copia desfasada regala un beneficio
 * ya consumido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UN POST QUE NO ESCRIBE, Y NO NECESITA CLAVE DE IDEMPOTENCIA
 *
 * POST porque lleva contexto en el cuerpo y porque su respuesta no se puede
 * cachear jamás — un GET invita a que un intermediario lo intente. Pero no
 * consume nada: llamarlo diez veces da diez respuestas y cero efectos.
 *
 * Consumir es `POST /redemptions`, que sí exige `Idempotency-Key`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE DEVUELVE ES UNA FOTO, NO UNA RESERVA
 *
 * Entre evaluar y canjear el beneficio puede consumirse en otra sucursal. Por
 * eso `POST /redemptions` vuelve a decidir en el momento del consumo y no se
 * fía de esta respuesta: aquí se dice qué se puede ofrecer, allí qué se hizo.
 *
 * `evaluatedAt` va en la respuesta justamente para eso — un satélite que la
 * guarde y la use media hora después tiene delante la fecha que lo desmiente.
 */

interface Cuerpo {
  companyId?: string
  customerId?: string
  /**
   * Qué carro hay delante. OPCIONAL: sin él la respuesta es exactamente la de
   * antes y cada `coverage.covers` viene `null` («no se preguntó»). Los
   * satélites que ya llamaban a este endpoint no se enteran.
   */
  context?: {
    vehicleLevel?: number | null
    plate?: string | null
  }
}

/** Reglas del motor puro, traducidas a un código estable para el satélite. */
function motivoDe(mensaje: string | undefined): string {
  const m = (mensaje ?? '').toLowerCase()
  if (m.includes('vencid') || m.includes('vigencia')) return 'EXPIRED'
  if (m.includes('usos')) return 'NO_USES_LEFT'
  if (m.includes('días') || m.includes('dias')) return 'DAY_NOT_ALLOWED'
  if (m.includes('hora')) return 'TIME_NOT_ALLOWED'
  if (m.includes('consumida')) return 'ALREADY_CONSUMED'
  return 'NOT_ACTIVE'
}

export async function POST(req: NextRequest) {
  const cuerpo = (await req.json().catch(() => ({}))) as Cuerpo

  const auth = await autenticarSobreEmpresa(req, 'benefits:read', cuerpo.companyId)
  if (esFallo(auth)) return auth.fallo

  const customerId = cuerpo.customerId?.trim() ?? ''
  if (!customerId) {
    return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'customerId is required.' })
  }

  const ahora = new Date()

  // El contexto se normaliza UNA vez: una placa que llegue con guiones o en
  // minúsculas no debe decidir que la membresía no cubre el carro de su dueño.
  const contexto: ContextoConsumo | undefined = cuerpo.context
    ? {
        nivelVehiculo: cuerpo.context.vehicleLevel ?? null,
        placa: cuerpo.context.plate
          ? cuerpo.context.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
          : null,
      }
    : undefined

  const datos = await conEmpresa(auth.companyId, async (tx) => {
    // La zona horaria de la empresa NO es un detalle de presentación: las
    // promociones con restricción de días y horas se evalúan en la hora del
    // negocio. Usar la del servidor haría que una promoción de «lunes» dejara
    // de valer a las 8 de la noche del domingo en Santo Domingo.
    const empresa = await tx.company.findUnique({
      where: { id: auth.companyId },
      select: { zonaHoraria: true },
    })

    const membresias = await tx.membership.findMany({
      where: { companyId: auth.companyId, clienteId: customerId, estado: 'ACTIVA' },
      select: {
        id: true,
        lavadosRestantes: true,
        fechaVencimiento: true,
        // Lo que hace falta para decir QUÉ cubre, no solo si puede consumir.
        plan: {
          select: {
            nombre: true,
            nivelTarifarioMax: true,
            esIlimitado: true,
            lavadosIncluidos: true,
          },
        },
        vehiculos: {
          select: {
            nivelTarifarioComprado: true,
            vehiculo: { select: { id: true, placaNormalizada: true } },
          },
        },
      },
      orderBy: { fechaVencimiento: 'desc' },
    })

    const compras = await tx.productoCompra.findMany({
      where: { companyId: auth.companyId, clienteId: customerId, estado: 'ACTIVA' },
      select: {
        id: true,
        estado: true,
        usosRestantes: true,
        fechaVencimiento: true,
        promocion: {
          select: { titulo: true, diasPermitidos: true, horaDesde: true, horaHasta: true },
        },
      },
      orderBy: { fechaVencimiento: 'asc' },
    })

    return { zona: empresa?.zonaHoraria ?? 'America/Santo_Domingo', membresias, compras }
  }).catch(() => null)

  if (!datos) return errorApi('INTERNAL_ERROR', auth.ctx.requestId)

  const beneficios = [
    ...datos.membresias.map((m) => {
      const vencida = m.fechaVencimiento !== null && m.fechaVencimiento <= ahora
      const sinUsos = m.lavadosRestantes <= 0
      return {
        type: 'MEMBERSHIP' as const,
        id: m.id,
        nombre: m.plan.nombre,
        eligible: !vencida && !sinUsos,
        usesLeft: m.lavadosRestantes,
        expiresAt: m.fechaVencimiento?.toISOString() ?? null,
        reason: vencida ? 'EXPIRED' : sinUsos ? 'NO_USES_LEFT' : null,
        // El veredicto sobre el carro concreto. Con el MISMO módulo puro que
        // se prueba aparte, para no tener la regla escrita dos veces.
        coverage: coberturaDeMembresia(
          {
            nivelTarifarioMax: m.plan.nivelTarifarioMax,
            esIlimitado: m.plan.esIlimitado,
            lavadosIncluidos: m.plan.lavadosIncluidos,
          },
          m.vehiculos.map((v) => ({
            vehiculoId: v.vehiculo.id,
            placa: v.vehiculo.placaNormalizada,
            nivelTarifario: v.nivelTarifarioComprado,
          })),
          m.lavadosRestantes,
          contexto
        ),
      }
    }),
    ...datos.compras.map((c) => {
      // El MISMO motor que usa el escáner de MembeGo. Reimplementar las reglas
      // aquí sería garantizar que el mostrador y el satélite den respuestas
      // distintas sobre el mismo cliente — y que nadie sepa cuál es la buena.
      const v = validarConsumoCompra(
        { estado: c.estado, usosRestantes: c.usosRestantes, fechaVencimiento: c.fechaVencimiento },
        {
          diasPermitidos: c.promocion?.diasPermitidos ?? [],
          horaDesde: c.promocion?.horaDesde ?? null,
          horaHasta: c.promocion?.horaHasta ?? null,
        },
        ahora,
        datos.zona
      )
      return {
        type: 'PROMOTION' as const,
        id: c.id,
        nombre: c.promocion?.titulo ?? 'Promoción',
        eligible: v.puedeUsar,
        usesLeft: c.usosRestantes,
        expiresAt: c.fechaVencimiento?.toISOString() ?? null,
        reason: v.puedeUsar ? null : motivoDe(v.mensaje),
        /** Una promoción no tiene tope de vehículo: cubre lo que dice su título. */
        coverage: null,
      }
    }),
  ]

  return respuestaApi(
    {
      customerId,
      companyId: auth.companyId,
      eligible: beneficios.some((b) => b.eligible),
      benefits: beneficios,
      evaluatedAt: ahora.toISOString(),
      /** Esto NO reserva nada. El canje vuelve a decidir. */
      reserved: false,
    },
    auth.ctx.requestId
  )
}
