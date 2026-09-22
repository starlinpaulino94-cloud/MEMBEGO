import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { armarXlsxBloques, pideXlsx, respuestaXlsx } from '@/lib/xlsx'
import { leerRango } from '@/modules/reportes/rango'
import { getReporteRegalos } from '@/modules/reportes/regalos'

export const dynamic = 'force-dynamic'

/**
 * Códigos y regalos en CSV, con EL MISMO periodo que la pantalla.
 *
 * Los dos permisos se vuelven a comprobar AQUÍ: con solo `exportar`, el dinero
 * y los nombres que la pantalla esconde se sacarían cambiando de ruta. Y el
 * aviso del saldo vivo viaja DENTRO del archivo: una columna de dinero sin la
 * línea que dice «esto es un pasivo» se suma a los ingresos sin pensarlo.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !ADMIN_ROLES.includes(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  if (!(await requireSection('reportes', 'exportar'))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return NextResponse.json({ error: 'Tu cuenta no está vinculada a una empresa.' }, { status: 400 })
  }

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { name: true, zonaHoraria: true } })
  ).catch(() => null)
  const timeZone = zonaSegura(empresa?.zonaHoraria)

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const rango = leerRango(sp, timeZone)
  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  const verDatosPersonales = await puedeFuncion('reportes', 'ver_datos_personales')
  const r = await getReporteRegalos(companyId, rango, timeZone, {
    verFinancieros,
    verDatosPersonales,
  })

  const bloques = [
    {
      titulo: 'Alcance del reporte',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Empresa', empresa?.name ?? ''],
        ['Periodo', `${rango.desdeDia} a ${rango.hastaDia}`],
        ['Dias', rango.dias],
        ['Comparado contra', rango.etiquetaComparacion],
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
        [
          'Dos cosas distintas',
          'Un REGALO lo tiene que aceptar alguien (puede rechazarse o vencerse). Una GIFT CARD es dinero que ya entro. No se suman en ninguna cifra',
        ],
        [
          'Saldo vivo',
          'Es un PASIVO, no un ingreso: ya se cobro al vender la gift card. Sumarlo a los ingresos del mes lo contaria dos veces',
        ],
        [
          'Consumos de gift card',
          'NO se pueden fechar: el saldo baja sin dejar fila propia y la transaccion la comparten cuatro flujos. Lo consumido va como acumulado',
        ],
        [
          'Tasa de aceptacion',
          'Sale de los regalos CERRADOS, y sin los retirados por quien los envio',
        ],
        ['Dinero', r.vendido ? 'Incluido' : 'OMITIDO - sin permiso ver_financieros'],
        [
          'Quien mas regala',
          r.topRemitentes === null ? 'OMITIDO - sin permiso ver_datos_personales' : 'Incluido',
        ],
        ['Foto de hoy', 'Lo pendiente y el saldo vivo NO dependen del periodo elegido'],
      ],
    },
    {
      titulo: 'Regalos entre clientes',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Enviados', r.enviados.valor, r.enviados.anterior, r.enviados.variacion ?? ''],
        ['Aceptados', r.aceptados.valor, r.aceptados.anterior, r.aceptados.variacion ?? ''],
        ['Tasa de aceptacion %', r.tasaAceptacion ?? 'sin dato', '', ''],
        ['A quien no tiene cuenta', r.aQuienNoTieneCuenta, '', ''],
      ],
    },
    {
      titulo: 'Que se regala',
      encabezados: ['Tipo', 'Enviados'],
      filas: r.porTipo.map((t) => [t.nombre, t.total]),
    },
    {
      titulo: 'Como acabaron (resueltos DENTRO del periodo)',
      encabezados: ['Desenlace', 'Total'],
      filas: r.desenlaces.map((d) => [d.nombre, d.total]),
    },
    {
      titulo: 'Gift cards',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Emitidas', r.emitidas.valor, r.emitidas.anterior, r.emitidas.variacion ?? ''],
        ['Activadas', r.activadas.valor, r.activadas.anterior, r.activadas.variacion ?? ''],
        ...(r.vendido
          ? [
              [
                'Vendido en gift cards',
                r.vendido.valor.toFixed(2),
                r.vendido.anterior.toFixed(2),
                r.vendido.variacion ?? '',
              ],
            ]
          : [['Vendido en gift cards', 'OMITIDO - sin permiso', '', '']]),
      ],
    },
    {
      titulo: 'Saldo vivo - PASIVO, no ingreso (foto de hoy)',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Gift cards activas', r.saldoVivo.tarjetas],
        [
          'Saldo pendiente de entregar',
          r.saldoVivo.monto == null ? 'OMITIDO - sin permiso' : r.saldoVivo.monto.toFixed(2),
        ],
        [
          'Consumido acumulado (sin fecha)',
          r.consumidoAcumulado == null ? 'OMITIDO - sin permiso' : r.consumidoAcumulado.toFixed(2),
        ],
      ],
    },
    {
      titulo: 'Foto de hoy - lo que espera (NO depende del periodo)',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Regalos sin responder', r.esperando.regalosPendientes],
        ['Regalos que vencen esta semana', r.esperando.regalosVencenPronto],
        ['Gift cards por pagar', r.esperando.giftCardsPorPagar],
      ],
    },
    {
      titulo: 'Dia a dia',
      encabezados: ['Dia', 'Enviados', 'Aceptados'],
      filas: r.serie.map((p) => [p.dia, p.enviados, p.aceptados]),
    },
    // Sin el permiso el bloque NO va vacío: no va. Un bloque con encabezados y
    // sin filas se lee como «nadie regaló nada».
    ...(r.topRemitentes
      ? [
          {
            titulo: 'Quien mas regala',
            encabezados: ['Cliente', 'Enviados'],
            filas: r.topRemitentes.map((t) => [t.nombre, t.enviados]),
          },
        ]
      : []),
  ]

  // El MISMO reporte, en un libro de Excel con una hoja por bloque.
  // El CSV no se toca: quien ya automatizó una descarga sigue igual.
  if (pideXlsx(req.nextUrl.searchParams)) {
    return respuestaXlsx(await armarXlsxBloques(bloques), `codigos-y-regalos-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
  }

  const csv = armarCsvBloques(bloques)

  return respuestaCsv(csv, `codigos-y-regalos-${rango.desdeDia}-a-${rango.hastaDia}`, {
    fechar: false,
  })
}
