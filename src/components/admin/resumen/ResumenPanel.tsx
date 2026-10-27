import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { BarrasSimples } from '@/components/ui/barras-simples'
import { formatMoney } from '@/lib/format'
import type { DatosResumen } from '@/modules/admin/resumen/consultas'
import type { BloquesResumen } from '@/modules/admin/resumen/bloques'
import { TarjetaAccion, type FilaAccion } from './TarjetaAccion'

/**
 * La composición del Resumen (auditoría admin · fase 5, tarea 5.1), tal como la aprobó el prototipo:
 *
 *   «Hoy · requiere acción»  →  hasta 3 bloques, los que la persona puede resolver
 *   «Este mes · 1–20 oct»    →  hasta 4 cifras, cada una con su ventana escrita
 *   una gráfica de 14 días   →  con eje, valor del pico y tabla alternativa
 *
 * Quién ve qué lo decide `bloques.ts`, y qué se consulta lo decide `consultas.ts` con esa misma decisión: este componente
 * solo pinta lo que le llegó. Una cifra que la persona no puede ver NO viene en `datos` (05 · D-01): no hay hueco que decir
 * «Sin permiso», el bloque no existe. Los enlaces solo se ponen si `ve(href)` (D-07).
 */

interface Props {
  datos: DatosResumen
  bloques: BloquesResumen
  ve: (href: string) => boolean
  company: { moneda: string; idioma: string; zonaHoraria: string }
  /** «martes 20 de octubre de 2026». */
  fecha: string
  /** Lo que va justo debajo de la cabecera y antes de los bloques (el asistente de configuración, si toca). */
  trasCabecera?: React.ReactNode
  /** Lo que va debajo de la gráfica: resúmenes de otros módulos, que cargan por su cuenta. */
  alFinal?: React.ReactNode
}

const LETRA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const etiquetaDia = (fecha: string) => `${Number(fecha.slice(8))} ${LETRA[new Date(`${fecha}T12:00:00Z`).getUTCDay()]}`

export function ResumenPanel({ datos, bloques, ve, company, fecha, trasCabecera, alFinal }: Props) {
  const dinero = (n: number) => formatMoney(n, company)
  const corta = (d: Date) =>
    new Intl.DateTimeFormat(company.idioma || 'es-DO', { day: 'numeric', month: 'short', timeZone: company.zonaHoraria }).format(d).replace('.', '')
  const enlace = (href: string) => (ve(href) ? href : undefined)

  const tarjetas: Record<string, React.ReactNode> = {}

  if (datos.pagos) {
    const p = datos.pagos
    const colas = [
      { clave: 'transferencias', etiqueta: 'Transferencias', n: p.transferencias, extra: p.montoTransferencias !== null && p.transferencias > 0 ? ` · ${dinero(p.montoTransferencias)}` : '' },
      { clave: 'sucursal', etiqueta: 'En sucursal', n: p.sucursal, extra: '' },
      { clave: 'compras', etiqueta: 'Compras', n: p.compras, extra: '' },
      { clave: 'cambios', etiqueta: 'Cambios de plan', n: p.cambios, extra: '' },
    ]
    const filas: FilaAccion[] = colas
      .filter((f) => f.n > 0)
      .map((f) => ({ etiqueta: f.etiqueta, valor: `${f.n}${f.extra}`, href: enlace(`/admin/pagos?cola=${f.clave}`) }))
    tarjetas.pagos = (
      <TarjetaAccion
        id="h-pagos"
        titulo="Pagos por validar"
        total={p.total}
        filas={filas.length ? filas : [{ etiqueta: 'Nada pendiente de validar', atenuada: true }]}
        ir={enlace('/admin/pagos') ? { href: '/admin/pagos', texto: 'Ir a Pagos' } : undefined}
      />
    )
  }
  if (datos.vencen) {
    const v = datos.vencen
    const filas: FilaAccion[] = v.proximos.map((x) => ({
      etiqueta: x.nombre,
      valor: <span className="font-normal text-muted-foreground">{corta(x.fecha)}</span>,
      href: enlace('/admin/riesgo?vence=7&sinVisitas=0'),
    }))
    if (v.total > v.proximos.length) filas.push({ etiqueta: `y ${v.total - v.proximos.length} más`, atenuada: true, href: enlace('/admin/riesgo?vence=7&sinVisitas=0') })
    tarjetas.vencen = (
      <TarjetaAccion
        id="h-vencen"
        titulo="Vencen en 7 días"
        total={v.total}
        filas={filas.length ? filas : [{ etiqueta: 'Ninguna vence esta semana', atenuada: true }]}
        ir={enlace('/admin/riesgo') ? { href: '/admin/riesgo?vence=7&sinVisitas=0', texto: 'Ver en riesgo' } : undefined}
      />
    )
  }
  if (datos.riesgo) {
    tarjetas.riesgo = (
      <TarjetaAccion
        id="h-riesgo"
        titulo="Clientes en riesgo"
        filas={[
          { etiqueta: 'Vencen en 7 días', valor: datos.riesgo.vencen7, href: enlace('/admin/riesgo?vence=7&sinVisitas=0') },
          { etiqueta: 'Sin visitas en 30 días', valor: datos.riesgo.sinVisitas30, href: enlace('/admin/riesgo?sinVisitas=30&vence=0') },
        ]}
        ir={enlace('/admin/audiencia') ? { href: '/admin/audiencia', texto: 'Dirigir una campaña' } : undefined}
      />
    )
  }
  if (datos.mostrador) {
    const m = datos.mostrador
    const filas: FilaAccion[] = (m.porEmpleado ?? []).map((e) => ({ etiqueta: e.nombre, valor: e.total }))
    if (m.canjesHoy !== null && filas.length === 0) filas.push({ etiqueta: 'Canjes validados hoy', valor: m.canjesHoy, href: enlace('/admin/scanner') })
    if (m.citasHoy !== null) filas.push({ etiqueta: 'Citas de hoy', valor: m.citasHoy, href: enlace('/admin/citas') })
    tarjetas.mostrador = (
      <TarjetaAccion
        id="h-mostrador"
        titulo={m.canjesHoy !== null ? 'Canjes de hoy' : 'Citas de hoy'}
        total={m.canjesHoy ?? m.citasHoy ?? undefined}
        filas={filas}
        ir={m.canjesHoy !== null && enlace('/admin/scanner') ? { href: '/admin/scanner', texto: 'Ir al escáner' } : undefined}
      />
    )
  }
  if (datos.promosVencen) {
    const b = datos.promosVencen
    tarjetas.promosVencen = (
      <TarjetaAccion
        id="h-promos"
        titulo="Beneficios por vencer"
        total={b.total}
        filas={
          b.items.length
            ? b.items.map((x) => ({ etiqueta: x.titulo, valor: <span className="font-normal text-muted-foreground">{corta(x.hasta)}</span>, href: enlace('/admin/promociones') }))
            : [{ etiqueta: 'Ninguno vence esta semana', atenuada: true }]
        }
        ir={enlace('/admin/promociones') ? { href: '/admin/promociones', texto: 'Ver beneficios' } : undefined}
      />
    )
  }

  const m = datos.mes
  const cifras: Record<string, React.ReactNode> = {}
  if (m.ingresos) {
    const { valor, anterior, variacion } = m.ingresos
    cifras.ingresos = (
      <StatCard
        variante="panel"
        label="Ingresos del mes"
        value={dinero(valor)}
        ventana={datos.ventanaMes}
        pie={
          variacion === null
            ? { texto: `Sin cobros en ${datos.ventanaAnterior} con qué comparar` }
            : { texto: `${variacion >= 0 ? '▲' : '▼'} ${Math.abs(variacion)} % frente a ${datos.ventanaAnterior} (${dinero(anterior)})`, tono: variacion >= 0 ? 'exito' : 'aviso' }
        }
        href={enlace('/admin/reportes')}
        hrefLabel="Ver los reportes"
      />
    )
  }
  if (m.membresias) {
    cifras.membresias = (
      <StatCard
        variante="panel"
        label="Membresías activas"
        value={m.membresias.vigentes.toLocaleString('es-DO')}
        ventana="al cierre de hoy"
        pie={m.membresias.porVencer7 > 0 ? { texto: `${m.membresias.porVencer7} vencen en 7 días`, tono: 'aviso' } : { texto: 'Ninguna vence esta semana' }}
        href={enlace('/admin/membresias')}
        hrefLabel="Ver las membresías"
      />
    )
  }
  if (m.canjes) {
    cifras.canjes = (
      <StatCard variante="panel" label="Canjes del mes" value={m.canjes.mes.toLocaleString('es-DO')} ventana={datos.ventanaMes} pie={{ texto: `${m.canjes.hoy.toLocaleString('es-DO')} hoy` }} />
    )
  }
  if (m.clientesNuevos !== undefined) {
    cifras.clientesNuevos = (
      <StatCard
        variante="panel"
        label="Clientes nuevos"
        value={m.clientesNuevos.toLocaleString('es-DO')}
        ventana={datos.ventanaMes}
        pie={{ texto: 'Todos los orígenes' }}
        href={enlace('/admin/clientes')}
        hrefLabel="Ver los clientes"
      />
    )
  }
  if (m.registros) {
    cifras.registros = (
      <StatCard
        variante="panel"
        label="Registros nuevos"
        value={m.registros.total.toLocaleString('es-DO')}
        ventana={datos.ventanaMes}
        pie={{ texto: m.registros.porOrigen.slice(0, 4).map((o) => `${o.origen} ${o.total}`).join(' · ') || 'Sin registros este mes' }}
      />
    )
  }
  if (m.seguidores !== undefined) {
    cifras.seguidores = <StatCard variante="panel" label="Seguidores nuevos" value={m.seguidores.toLocaleString('es-DO')} ventana="últimos 30 días" />
  }
  if ('beneficioLider' in m) {
    const b = m.beneficioLider
    cifras.beneficioLider = (
      <StatCard
        variante="panel"
        label="Beneficio con más interacción"
        value={<span className="text-h3">{b?.titulo ?? '—'}</span>}
        ventana="acumulado de por vida"
        pie={b ? { texto: `${b.vistas.toLocaleString('es-DO')} vistas · ${b.compartidas.toLocaleString('es-DO')} compartidas` } : undefined}
      />
    )
  }
  if (bloques.mes.includes('interacciones')) {
    // Los contadores de vistas no guardan fecha (05 · D-29): un periodo mensual sería inventado. Se dice, no se calcula.
    cifras.interacciones = (
      <StatCard
        variante="panel"
        label="Interacciones del mes"
        value="Sin dato"
        ventana={datos.ventanaMes}
        pie={{ texto: 'Hoy los contadores de vistas no guardan fecha: no se puede medir un periodo sin inventarlo.' }}
      />
    )
  }

  const serie = datos.serie
  const tituloSerie = serie?.tipo === 'registros' ? 'Registros nuevos · últimos 14 días' : 'Canjes · últimos 14 días'
  const hrefSerie = serie?.tipo === 'registros' ? '/admin/adquisicion' : '/admin/reportes'

  return (
    <div className="space-y-6">
      <PageHeader title="Resumen" description={`Lo que necesita tu atención hoy y cómo va el mes. ${fecha}.`} />
      {trasCabecera}

      {bloques.hoy.length > 0 ? (
        <section aria-labelledby="h-hoy" className="grid gap-3">
          <h2 id="h-hoy" className="text-overline text-muted-foreground">Hoy · requiere acción</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{bloques.hoy.map((b) => <div key={b} className="contents">{tarjetas[b]}</div>)}</div>
        </section>
      ) : null}

      {bloques.mes.length > 0 ? (
        <section aria-labelledby="h-mes" className="grid gap-3">
          <h2 id="h-mes" className="text-overline text-muted-foreground">Este mes · {datos.ventanaMes}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{bloques.mes.map((c) => <div key={c} className="contents">{cifras[c]}</div>)}</div>
        </section>
      ) : null}

      {serie ? (
        <section aria-labelledby="h-serie" className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="h-serie" className="text-h3 text-foreground">{tituloSerie}</h2>
            {enlace(hrefSerie) ? (
              <Link href={hrefSerie} className="text-small font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {serie.tipo === 'registros' ? 'Ver origen de los registros' : 'Ver reportes'} →
              </Link>
            ) : null}
          </div>
          <BarrasSimples
            titulo={tituloSerie}
            unidad={serie.tipo === 'registros' ? 'registros' : 'canjes'}
            valores={serie.dias.map((d) => d.total)}
            etiquetas={serie.dias.map((d) => etiquetaDia(d.fecha))}
          />
        </section>
      ) : null}

      {alFinal}
    </div>
  )
}
