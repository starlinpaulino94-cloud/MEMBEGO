import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { armarCsv, fechaCsv, respuestaCsv, TOPE_EXPORTACION } from '@/lib/csv'
import { clientesEnRiesgo, leerFiltroRiesgo } from '@/modules/riesgo'
import { diasDesde, diasHasta } from '@/modules/admin/filtrosComunes'

export const dynamic = 'force-dynamic'

/**
 * Export CSV de los clientes en riesgo, con los MISMOS umbrales de la pantalla.
 *
 * Es el formato en el que esta lista se usa de verdad: se reparte entre el
 * equipo para llamar. Por eso lleva el teléfono primero y el valor en juego al
 * final, y sale en el mismo orden que la pantalla — quien empiece por arriba
 * empieza por quien más cuesta perder.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('clientes')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = user.metadata.companyId
  if (!companyId) {
    return NextResponse.json({ error: 'Cuenta sin empresa.' }, { status: 400 })
  }

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const filtro = leerFiltroRiesgo(sp)

  const { items, total } = await clientesEnRiesgo(companyId, filtro, {
    saltar: 0,
    tomar: TOPE_EXPORTACION,
  })

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  ).catch(() => null)
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'

  const filas: unknown[][] = items.map((c) => {
    const ultima = c.ultimaVisita ? new Date(c.ultimaVisita) : null
    const vence = c.fechaVencimiento ? new Date(c.fechaVencimiento) : null
    return [
      c.nombre,
      c.telefono ?? '',
      c.email,
      c.plan,
      fechaCsv(ultima, tz),
      // «Nunca» no es lo mismo que un número grande: quien pagó y no apareció
      // jamás es un caso distinto, y el CSV tiene que poder decirlo.
      ultima ? String(diasDesde(ultima)) : 'nunca vino',
      fechaCsv(vence, tz),
      vence ? String(diasHasta(vence)) : '',
      c.esIlimitado ? 'Ilimitado' : String(c.usosRestantes),
      String(Math.round(c.valorEnJuego * 100) / 100),
    ]
  })

  if (total > TOPE_EXPORTACION) {
    filas.push([
      `AVISO: se exportaron los ${TOPE_EXPORTACION} de mayor valor en juego, de ${total}. Afina los umbrales para llevártelos todos.`,
    ])
  }

  return respuestaCsv(
    armarCsv(
      [
        'Cliente',
        'Teléfono',
        'Correo',
        'Plan',
        'Última visita',
        'Días sin venir',
        'Vencimiento',
        'Días para vencer',
        'Usos restantes',
        'Valor en juego',
      ],
      filas
    ),
    'clientes-en-riesgo'
  )
}
