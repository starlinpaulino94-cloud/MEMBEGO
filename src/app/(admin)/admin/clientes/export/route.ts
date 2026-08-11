import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { armarCsv, fechaCsv, respuestaCsv, TOPE_EXPORTACION } from '@/lib/csv'
import { whereClientes } from '@/modules/admin/clientesFiltro'

export const dynamic = 'force-dynamic'

/**
 * Export CSV de clientes con el MISMO filtro que la pantalla.
 *
 * Antes esto lo hacía el navegador con las filas que la tabla tenía cargadas:
 * 50 de 98, sin avisar (auditoría · B-9). El `where` sale del mismo módulo que
 * usa la página, así que lo que se descarga es exactamente lo que se ve — ni
 * más ni menos.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('clientes')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Cuenta sin empresa.' }, { status: 400 })
  }

  // TODOS los filtros de la pantalla, no solo la búsqueda: el CSV tiene que
  // llevarse exactamente lo que se está viendo.
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const where = whereClientes(companyId, sp)

  const { clientes, total, zonaHoraria } = await conEmpresa(companyId, async (tx) => {
    const [filas, cuenta, empresa] = await Promise.all([
      tx.cliente.findMany({
        where,
        select: {
          nombre: true,
          email: true,
          telefono: true,
          createdAt: true,
          memberships: {
            select: {
              estado: true,
              fechaInicio: true,
              fechaVencimiento: true,
              lavadosRestantes: true,
              plan: { select: { nombre: true, esIlimitado: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          visits: {
            select: { fechaVisita: true },
            orderBy: { fechaVisita: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: TOPE_EXPORTACION,
      }),
      tx.cliente.count({ where }),
      tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } }),
    ])
    return { clientes: filas, total: cuenta, zonaHoraria: empresa?.zonaHoraria }
  })

  const tz = zonaHoraria || 'America/Santo_Domingo'
  const filas = clientes.map((c) => {
    const m = c.memberships[0]
    return [
      c.nombre,
      c.email,
      c.telefono ?? '',
      fechaCsv(c.createdAt, tz),
      m?.plan.nombre ?? '',
      m?.estado ?? 'Sin membresía',
      fechaCsv(m?.fechaInicio ?? null, tz),
      fechaCsv(m?.fechaVencimiento ?? null, tz),
      m ? (m.plan.esIlimitado ? 'Ilimitado' : String(m.lavadosRestantes)) : '',
      fechaCsv(c.visits[0]?.fechaVisita ?? null, tz, true),
    ]
  })

  // Un recorte se DICE. El archivo no puede parecer completo si no lo está.
  if (total > TOPE_EXPORTACION) {
    filas.push([
      `AVISO: se exportaron los ${TOPE_EXPORTACION} más recientes de ${total} clientes. Afina el filtro para llevártelos todos.`,
    ])
  }

  return respuestaCsv(
    armarCsv(
      [
        'Nombre',
        'Correo',
        'Teléfono',
        'Registrado',
        'Plan',
        'Estado membresía',
        'Inicio',
        'Vencimiento',
        'Usos restantes',
        'Última visita',
      ],
      filas
    ),
    'clientes'
  )
}
