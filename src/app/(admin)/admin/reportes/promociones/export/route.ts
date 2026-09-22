import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { conEmpresa } from '@/lib/tenant'
import { TZ_PLATAFORMA } from '@/lib/format'
import { armarCsvBloques, respuestaCsv } from '@/lib/csv'
import { armarXlsxBloques, pideXlsx, respuestaXlsx } from '@/lib/xlsx'
import { leerRango } from '@/modules/reportes/rango'
import { getReportePromociones } from '@/modules/reportes/promociones'

export const dynamic = 'force-dynamic'

/**
 * Promociones en CSV, con EL MISMO periodo que la pantalla.
 *
 * `ver_financieros` se vuelve a comprobar AQUÍ: con solo `exportar`, el dinero
 * que la pantalla esconde se sacaría cambiando de ruta. Y los tres relojes
 * viajan DENTRO del archivo: descargadas, «adquiridas» y «usadas» puestas en
 * columnas contiguas se leen como la misma cosa medida dos veces.
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
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const rango = leerRango(sp, timeZone)
  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  const r = await getReportePromociones(companyId, rango, timeZone, { verFinancieros })

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
          'Los tres relojes',
          'ADQUIRIDA se fecha cuando el cliente la pide, ENTREGADA cuando queda activa con su QR, USADA cuando se canjea en el mostrador. Casi nunca son el mismo dia',
        ],
        [
          'Usadas',
          'Salen de las transacciones PROMOTION_USE del mostrador. Regalar usos a otra persona NO cuenta como uso',
        ],
        [
          'Canjes de Operacion',
          'El reporte de Operacion llama canjes a las VISITAS de membresia: son otra cosa y no incluyen estos usos',
        ],
        ['Dinero', r.ingresos ? 'Incluido - fechado por la ENTREGA' : 'OMITIDO - sin permiso ver_financieros'],
        ['Foto de hoy', 'Catalogo, cola de trabajo y vitrina NO dependen del periodo elegido'],
        [
          'Vitrina',
          'Vistas y compartidos son acumulados DESDE SIEMPRE y con tope por navegador: son un suelo, no un conteo exacto',
        ],
        [
          'Promocion.canjes',
          'NO se usa: la columna existe y no la escribe nadie, vale 0 para todas',
        ],
      ],
    },
    {
      titulo: 'El ciclo en el periodo',
      encabezados: ['Metrica', 'Periodo', 'Comparacion', 'Variacion %'],
      filas: [
        ['Adquiridas', r.adquiridas.valor, r.adquiridas.anterior, r.adquiridas.variacion ?? ''],
        ['Entregadas', r.entregadas.valor, r.entregadas.anterior, r.entregadas.variacion ?? ''],
        ['Usadas en el mostrador', r.usadas.valor, r.usadas.anterior, r.usadas.variacion ?? ''],
        ...(r.ingresos
          ? [
              [
                'Dinero de promociones',
                r.ingresos.valor.toFixed(2),
                r.ingresos.anterior.toFixed(2),
                r.ingresos.variacion ?? '',
              ],
            ]
          : [['Dinero de promociones', 'OMITIDO - sin permiso', '', '']]),
        ['De pedida a entregada %', r.tasaEntrega ?? 'sin dato', '', ''],
        ['Regaladas a otra persona', r.regalos, '', ''],
      ],
    },
    {
      titulo: 'Que se movio, estado por estado (veces que una compra ENTRO al estado)',
      encabezados: ['Estado', 'Veces que entro'],
      filas: r.porEstado.map((e) => [e.nombre, e.movimientos]),
    },
    {
      titulo: 'Por promocion',
      encabezados: ['Promocion', 'Adquiridas', 'Usadas'],
      filas: r.topPromociones.map((p) => [p.titulo, p.adquiridas, p.usadas]),
    },
    {
      titulo: 'Dia a dia',
      encabezados: ['Dia', 'Adquiridas', 'Usadas'],
      filas: r.serie.map((p) => [p.dia, p.adquiridas, p.usadas]),
    },
    {
      titulo: 'Foto de hoy - catalogo (NO depende del periodo)',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Publicadas', r.catalogo.publicadas],
        ['Comprables', r.catalogo.comprables],
        ['Vencen esta semana', r.catalogo.vencenPronto],
        ['Archivadas', r.catalogo.archivadas],
      ],
    },
    {
      titulo: 'Foto de hoy - cola de trabajo (NO depende del periodo)',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Comprobantes por validar', r.esperando.enValidacion],
        ['Esperando el pago del cliente', r.esperando.pendientePago],
        ['Entregadas y sin usar', r.activasSinUsar],
      ],
    },
    {
      titulo: 'Vitrina publica (acumulado desde siempre, es un suelo)',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Vistas acumuladas', r.vitrina.vistas],
        ['Compartidos acumulados', r.vitrina.compartidos],
      ],
    },
  ]

  // El MISMO reporte, en un libro de Excel con una hoja por bloque.
  // El CSV no se toca: quien ya automatizó una descarga sigue igual.
  if (pideXlsx(req.nextUrl.searchParams)) {
    return respuestaXlsx(await armarXlsxBloques(bloques), `promociones-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
  }

  const csv = armarCsvBloques(bloques)

  return respuestaCsv(csv, `promociones-${rango.desdeDia}-a-${rango.hastaDia}`, { fechar: false })
}
