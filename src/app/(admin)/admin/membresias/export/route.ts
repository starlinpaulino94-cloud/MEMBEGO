import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { armarCsv, fechaCsv, respuestaCsv, TOPE_EXPORTACION } from '@/lib/csv'
import { whereMembresias } from '@/modules/admin/membresiasFiltro'

export const dynamic = 'force-dynamic'

/**
 * Export CSV de membresías con el MISMO filtro que la pantalla.
 *
 * La exportación anterior vivía en el navegador y se llevaba las filas
 * cargadas: como mucho 200, y sin decirlo (auditoría · A-5/B-9). Lleva el
 * importe pagado y los usos restantes porque son las dos columnas por las que
 * se pide un CSV de membresías: cuánto entró y cuánto se debe en servicio.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('membresias')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Cuenta sin empresa.' }, { status: 400 })
  }

  // TODOS los filtros de la pantalla, no solo estado y búsqueda.
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const where = whereMembresias(companyId, sp)

  const { filas, total, zonaHoraria } = await conEmpresa(companyId, async (tx) => {
    const [datos, cuenta, empresa] = await Promise.all([
      tx.membership.findMany({
        where,
        select: {
          estado: true,
          fechaInicio: true,
          fechaVencimiento: true,
          lavadosRestantes: true,
          montoPagado: true,
          pagoConfirmado: true,
          createdAt: true,
          cliente: { select: { nombre: true, email: true, telefono: true } },
          plan: { select: { nombre: true, esIlimitado: true, precio: true } },
          metodoPago: { select: { nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: TOPE_EXPORTACION,
      }),
      tx.membership.count({ where }),
      tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } }),
    ])
    return { filas: datos, total: cuenta, zonaHoraria: empresa?.zonaHoraria }
  })

  const tz = zonaHoraria || 'America/Santo_Domingo'
  const ahora = Date.now()
  const cuerpo = filas.map((m) => {
    const diasParaVencer =
      m.fechaVencimiento == null
        ? ''
        : String(Math.ceil((m.fechaVencimiento.getTime() - ahora) / 86_400_000))
    return [
      m.cliente.nombre,
      m.cliente.email,
      m.cliente.telefono ?? '',
      m.plan.nombre,
      m.estado,
      fechaCsv(m.fechaInicio, tz),
      fechaCsv(m.fechaVencimiento, tz),
      diasParaVencer,
      m.plan.esIlimitado ? 'Ilimitado' : String(m.lavadosRestantes),
      // Lo pagado de VERDAD; el precio de lista solo cuando no hay cobro
      // registrado, y marcado como tal en la columna de al lado.
      String(Number(m.montoPagado ?? m.plan.precio)),
      m.pagoConfirmado ? 'Sí' : 'No',
      m.metodoPago?.nombre ?? '',
      fechaCsv(m.createdAt, tz),
    ]
  })

  if (total > TOPE_EXPORTACION) {
    cuerpo.push([
      `AVISO: se exportaron las ${TOPE_EXPORTACION} más recientes de ${total} membresías. Afina el filtro para llevártelas todas.`,
    ])
  }

  return respuestaCsv(
    armarCsv(
      [
        'Cliente',
        'Correo',
        'Teléfono',
        'Plan',
        'Estado',
        'Inicio',
        'Vencimiento',
        'Días para vencer',
        'Usos restantes',
        'Importe',
        'Pago confirmado',
        'Método de pago',
        'Creada',
      ],
      cuerpo
    ),
    'membresias'
  )
}
