import { NextResponse, type NextRequest } from 'next/server'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { respuestaCsv } from '@/lib/csv'
import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { movimientosEmpresaEnTx, sucursalesDeLaEmpresaEnTx, usuariosParaFiltroEnTx } from '@/modules/inventory/queries'
import { USUARIO_SISTEMA, leerFiltrosMovimientos, type ParametrosUrl } from '@/modules/inventory/filtros'
import { ETIQUETA_MOVIMIENTO, nombreCompleto } from '@/modules/inventory/formato'
import { TOPE_FILAS_MOVIMIENTOS, movimientosToCsv, type FilaExportada } from '@/modules/inventory/exportacion'

export const dynamic = 'force-dynamic'

/**
 * Exporta a CSV los movimientos de inventario de la empresa con LOS MISMOS
 * filtros de la pantalla (`leerFiltrosMovimientos` lee la URL igual que ella),
 * hasta `TOPE_FILAS_MOVIMIENTOS`. Si el tope corta el resultado, el archivo lo
 * dice en su bloque de alcance: nunca un recorte callado.
 *
 * Un route handler NO pasa por el layout de la sección, así que se guarda solo:
 * sesión, rol, permisos por empleado y capacidad (`requireSection('inventario')`),
 * y la empresa sale de la sesión, jamás de la URL.
 */
export async function GET(request: NextRequest) {
  const user = await requireSection('inventario')
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  const companyId = await resolveCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'Selecciona una empresa activa.' }, { status: 400 })

  // El primer valor de cada parámetro, igual que la pantalla (`new URLSearchParams().get`).
  const sp = request.nextUrl.searchParams
  const crudo: ParametrosUrl = {}
  for (const k of new Set(sp.keys())) crudo[k] = sp.get(k) ?? undefined
  const { filtros } = leerFiltrosMovimientos(crudo)

  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const usuarios = await usuariosParaFiltroEnTx(tx, companyId)
      const sucursal = sucursales.find((s) => s.id === filtros.sucursalId)
      const f = { ...filtros }
      if (!sucursal) delete f.sucursalId
      const pagina = await movimientosEmpresaEnTx(tx, companyId, f, { zonaHoraria: zona, limite: TOPE_FILAS_MOVIMIENTOS })
      const descripcion: Array<readonly [string, string]> = []
      if (f.q) descripcion.push(['Producto', f.q])
      if (f.tipo) descripcion.push(['Movimiento', ETIQUETA_MOVIMIENTO[f.tipo]])
      if (sucursal) descripcion.push(['Sucursal', sucursal.nombre])
      if (f.usuario) descripcion.push(['Hecho por', f.usuario === USUARIO_SISTEMA ? 'Sistema' : (usuarios.find((u) => u.id === f.usuario)?.nombre ?? f.usuario)])
      if (f.desde) descripcion.push(['Desde', f.desde])
      if (f.hasta) descripcion.push(['Hasta', f.hasta])
      return { zona, pagina, descripcion }
    })
    const filas: FilaExportada[] = r.pagina.filas.map((m) => ({
      creadoEn: m.creadoEn,
      sucursal: m.sucursalNombre,
      producto: nombreCompleto(m.itemNombre, m.nombreVariante, m.esDefault),
      sku: m.sku,
      tipo: m.tipo,
      cantidad: m.cantidad,
      efecto: m.efectoOnHand,
      existenciaAntes: m.previousOnHand,
      existenciaDespues: m.newOnHand,
      motivo: m.motivo,
      usuario: m.usuarioNombre,
      referenciaTipo: m.referenciaTipo,
      referenciaId: m.referenciaId,
    }))
    const csv = movimientosToCsv(filas, { zonaHoraria: r.zona, generadoEn: new Date(), filtros: r.descripcion, truncado: r.pagina.siguiente !== null, tope: TOPE_FILAS_MOVIMIENTOS })
    return respuestaCsv(csv, 'movimientos-inventario')
  } catch (e) {
    console.error('[admin-inventario-exportar]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo generar el archivo. Intenta de nuevo.' }, { status: 500 })
  }
}
