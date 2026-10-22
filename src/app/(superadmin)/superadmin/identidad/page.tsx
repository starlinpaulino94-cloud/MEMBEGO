import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Search, ShieldCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { BitacoraTabla } from '@/components/auditoria/BitacoraTabla'
import { AccionConTexto } from '@/components/superadmin/identidad/AccionConTexto'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { StatusChip } from '@/components/ui/status-chip'
import { getAuditoria } from '@/modules/auditoria/queries'
import { TIPOS_DE_INCIDENCIA } from '@/modules/identidad/vistaCore'
import {
  LIMITE_DE_COLA,
  buscarPersonas,
  colaDeIncidencias,
  colaDeRevision,
  resumenDeLaPlataforma,
  type IncidenciaEnCola,
  type ResumenDeLaPlataforma,
} from '@/modules/identidad/staff'
import { atenderIncidenciaAction, cambiarInterruptorAction } from '@/modules/superadmin/identidadActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Identidad' }

const ZONA = 'America/Santo_Domingo'
const fecha = (d: Date | null) => (d ? formatDateTime(d, { zonaHoraria: ZONA }) : '—')

const VISTAS = [
  { valor: 'resumen', etiqueta: 'Resumen' },
  { valor: 'revision', etiqueta: 'Casos en revisión' },
  { valor: 'incidencias', etiqueta: 'Incidencias' },
  { valor: 'personas', etiqueta: 'Buscar a una persona' },
  { valor: 'auditoria', etiqueta: 'Auditoría' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

const ETIQUETA_DE_INCIDENCIA = new Map<string, string>(TIPOS_DE_INCIDENCIA.map((t) => [t.valor, t.etiqueta]))
const ESTADO_DE_INCIDENCIA: Record<string, { tono: 'warning' | 'info' | 'success'; etiqueta: string }> = {
  abierta: { tono: 'warning', etiqueta: 'Abierta' },
  en_proceso: { tono: 'info', etiqueta: 'En proceso' },
  resuelta: { tono: 'success', etiqueta: 'Resuelta' },
}

/**
 * VERIFICACIÓN DE IDENTIDAD — el panel del equipo de Membego (Fase 4). Solo SUPERADMIN.
 *
 * Aquí el equipo ve el estado de la plataforma, enciende o apaga la verificación (con motivo), atiende los casos que
 * esperan a una persona y las incidencias, busca a una persona y consulta la bitácora. NO hay forma de ver una imagen ni
 * de aprobar a nadie desde aquí: la evidencia está en la consola del proveedor y «verificada» solo lo escribe el worker.
 */
export default async function IdentidadPage({ searchParams }: { searchParams: Promise<{ vista?: string; q?: string; inc?: string }> }) {
  const user = await requireRole('SUPERADMIN')
  const sp = await searchParams
  const vista: Vista = VISTAS.some((v) => v.valor === sp.vista) ? (sp.vista as Vista) : 'resumen'
  const actor = { userId: user.metadata.dbUserId ?? '', rol: user.metadata.role }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Plataforma"
        title="Verificación de identidad"
        description="Casos, incidencias y estado de la verificación de las personas. Cada consulta y cada acción queda registrada con tu nombre."
        nav={
          <nav aria-label="Secciones de identidad" className="flex flex-wrap gap-2">
            {VISTAS.map((v) => (
              <Link
                key={v.valor}
                href={`/superadmin/identidad?vista=${v.valor}`}
                aria-current={v.valor === vista ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  v.valor === vista ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground'
                }`}
              >
                {v.etiqueta}
              </Link>
            ))}
          </nav>
        }
      />
      {vista === 'resumen' && <Resumen resumen={await resumenDeLaPlataforma(actor)} />}
      {vista === 'revision' && <Revision cola={await colaDeRevision(actor)} />}
      {vista === 'incidencias' && <Incidencias vista={sp.inc === 'resueltas' ? 'resueltas' : 'abiertas'} datos={await colaDeIncidencias(actor, sp.inc === 'resueltas' ? 'resueltas' : 'abiertas')} />}
      {vista === 'personas' && <Personas q={sp.q ?? ''} personas={await buscarPersonas(actor, sp.q ?? '')} />}
      {vista === 'auditoria' && <Auditoria />}
    </div>
  )
}

// ── Resumen ─────────────────────────────────────────────────────────────────

function Dato({ valor }: { valor: number | null }) {
  return valor === null ? <span className="text-muted-foreground">Sin dato</span> : <>{valor}</>
}

function Resumen({ resumen }: { resumen: ResumenDeLaPlataforma }) {
  const { compuerta, interruptor } = resumen
  const lista = compuerta.habilitada ? 'success' : 'warning'
  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-h4">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
            Estado de la verificación
            <StatusChip tone={lista} className="ml-auto">
              {compuerta.habilitada ? 'Encendida' : 'Apagada'}
            </StatusChip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {compuerta.habilitada
              ? 'Las personas pueden verificarse. Para apagarla basta el interruptor.'
              : !interruptor.encendido
                ? 'El interruptor está apagado: nadie puede empezar una verificación. Lo que está en curso se sigue resolviendo.'
                : 'El interruptor está encendido, pero falta configuración y no se puede verificar a nadie.'}
          </p>
          {compuerta.faltantes.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>
                Falta configurar: <strong className="font-semibold">{compuerta.faltantes.join(', ')}</strong>. Sin eso no se puede encender.
              </span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Último cambio: {fecha(interruptor.cambiadoAt)}
            {interruptor.cambiadoPor ? ` por ${interruptor.cambiadoPor}` : ''}
            {interruptor.motivo ? ` — «${interruptor.motivo}»` : ''}
          </p>
          <AccionConTexto
            accion={cambiarInterruptorAction}
            campos={{ encender: interruptor.encendido ? 'no' : 'si' }}
            boton={interruptor.encendido ? 'Apagar la verificación' : 'Encender la verificación'}
            etiquetaTexto="Motivo del cambio"
            maximo={300}
            peligrosa={interruptor.encendido}
          />
          <p className="text-xs text-muted-foreground">
            No se enciende con documentos reales hasta tener el dictamen legal sobre la Ley 4-23 y el contrato con el proveedor.
          </p>
        </CardContent>
      </Card>

      <section aria-label="Contadores" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Intentos en 24 h" value={<Dato valor={resumen.intentos24h?.total ?? null} />} sub={resumen.intentos24h ? Object.entries(resumen.intentos24h.porEstado).map(([e, c]) => `${e.replace(/_/g, ' ')}: ${c}`).join(' · ') || 'ninguno' : undefined} />
        <StatCard label="Verificadas vigentes" value={<Dato valor={resumen.verificadasVigentes} />} sub={resumen.vencenEn30Dias === null ? undefined : `${resumen.vencenEn30Dias} vencen en 30 días`} />
        <StatCard
          label="Casos en revisión"
          value={<Dato valor={resumen.enRevision?.total ?? null} />}
          sub={resumen.enRevision ? `${resumen.enRevision.porDocumentoRepetido} por documento repetido · el más viejo: ${fecha(resumen.enRevision.masAntiguoAt)}` : undefined}
          href="/superadmin/identidad?vista=revision"
          hrefLabel="Ver los casos en revisión"
        />
        <StatCard
          label="Incidencias abiertas"
          value={<Dato valor={resumen.incidenciasAbiertas?.total ?? null} />}
          sub={resumen.incidenciasAbiertas ? `la más vieja: ${fecha(resumen.incidenciasAbiertas.masAntiguaAt)}` : undefined}
          href="/superadmin/identidad?vista=incidencias"
          hrefLabel="Ver las incidencias abiertas"
        />
      </section>

      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="text-h4">Lo que hay que vigilar</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            <Alerta ok={resumen.purgasPendientes === 0} sinDato={resumen.purgasPendientes === null}>
              <strong className="font-semibold">Borrados pendientes en el proveedor:</strong> <Dato valor={resumen.purgasPendientes} />. Son intentos ya cerrados cuya sesión (con los documentos) sigue en el proveedor; el barrido diario los reintenta.
            </Alerta>
            <Alerta ok={resumen.avisosFallidos === 0} sinDato={resumen.avisosFallidos === null}>
              <strong className="font-semibold">Avisos del proveedor sin procesar:</strong> <Dato valor={resumen.avisosFallidos} />. Si crece, algo falla entre el proveedor y Membego.
            </Alerta>
            <Alerta ok={resumen.supresionesSinCompletar?.total === 0} sinDato={resumen.supresionesSinCompletar === null}>
              <strong className="font-semibold">Borrados pedidos por las personas sin completar:</strong> <Dato valor={resumen.supresionesSinCompletar?.total ?? null} />
              {resumen.supresionesSinCompletar && resumen.supresionesSinCompletar.vencidas > 0
                ? ` — ${resumen.supresionesSinCompletar.vencidas} con más de 7 días: el plazo legal es de 10 días hábiles.`
                : '.'}
            </Alerta>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function Alerta({ ok, sinDato, children }: { ok: boolean; sinDato: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {sinDato ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
      <span className="text-foreground/90">{children}</span>
    </li>
  )
}

// ── Casos en revisión ───────────────────────────────────────────────────────

const RAZON_DE_REVISION: Record<string, string> = {
  IDENTIDAD_DUPLICADA: 'El mismo documento ya respalda a otra cuenta',
  FLUJO_INCOMPLETO: 'El flujo del proveedor aprobó sin las tres pruebas',
}

function Revision({ cola }: { cola: Awaited<ReturnType<typeof colaDeRevision>> }) {
  if (cola.casos.length === 0) {
    return <EmptyState title="No hay casos esperando" description="Cuando el proveedor mande algo a revisión, o un mismo documento aparezca en dos cuentas, saldrá aquí." />
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {cola.total} {cola.total === 1 ? 'caso' : 'casos'}, los más antiguos primero{cola.total > LIMITE_DE_COLA ? ` (se muestran ${LIMITE_DE_COLA})` : ''}. La evidencia está en la consola del proveedor: búscala por la referencia del intento. Para aprobar, hazlo allí.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Persona</th>
              <th className="px-4 py-3 font-semibold">Por qué espera</th>
              <th className="px-4 py-3 font-semibold">Desde</th>
              <th className="px-4 py-3 font-semibold">Referencia del intento</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {cola.casos.map((c) => (
              <tr key={c.intentoId} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{c.nombre}</p>
                  <p className="text-xs text-muted-foreground">{c.email}</p>
                </td>
                <td className="px-4 py-3">{(c.codigoRazon && RAZON_DE_REVISION[c.codigoRazon]) ?? c.codigoRazon ?? 'Lo pidió el proveedor'}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fecha(c.creadoAt)}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.intentoId}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/superadmin/identidad/${c.userId}?motivo=revision_de_caso`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                    Abrir el caso
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Incidencias ─────────────────────────────────────────────────────────────

function Incidencias({ vista, datos }: { vista: 'abiertas' | 'resueltas'; datos: { incidencias: IncidenciaEnCola[]; total: number } }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" aria-label="Filtro de incidencias">
        {(['abiertas', 'resueltas'] as const).map((v) => (
          <Link
            key={v}
            href={`/superadmin/identidad?vista=incidencias&inc=${v}`}
            aria-current={v === vista ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${v === vista ? 'border-primary/50 bg-primary/10 font-medium text-foreground' : 'border-border/70 text-muted-foreground'}`}
          >
            {v === 'abiertas' ? 'Abiertas' : 'Resueltas'}
          </Link>
        ))}
      </div>
      {datos.incidencias.length === 0 ? (
        <EmptyState title={vista === 'abiertas' ? 'No hay incidencias abiertas' : 'Todavía no hay incidencias resueltas'} description="Lo que las personas reporten desde su pantalla de verificación aparecerá aquí." />
      ) : (
        <ul className="space-y-3">
          {datos.incidencias.map((i) => {
            const estado = ESTADO_DE_INCIDENCIA[i.estado] ?? { tono: 'info' as const, etiqueta: i.estado }
            return (
              <li key={i.id}>
                <Card className="border-border/60 shadow-card">
                  <CardContent className="space-y-3 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={estado.tono}>{estado.etiqueta}</StatusChip>
                      <span className="text-sm font-medium text-foreground">{ETIQUETA_DE_INCIDENCIA.get(i.tipo) ?? i.tipo}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fecha(i.creadaAt)}</span>
                    </div>
                    <p className="text-sm text-foreground">
                      {i.nombre} <span className="text-muted-foreground">· {i.email}</span>
                    </p>
                    <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-relaxed text-foreground">{i.mensaje}</p>
                    {i.respuesta && (
                      <p className="whitespace-pre-wrap rounded-lg border border-success/25 bg-success/10 p-3 text-sm leading-relaxed">
                        <span className="block text-xs font-semibold text-success">Respuesta{i.atendidaPor ? ` de ${i.atendidaPor}` : ''}{i.resueltaAt ? ` · ${fecha(i.resueltaAt)}` : ''}</span>
                        {i.respuesta}
                      </p>
                    )}
                    <div className="flex flex-wrap items-start gap-2">
                      <Link href={`/superadmin/identidad/${i.userId}?motivo=incidencia`} className="inline-flex min-h-11 items-center rounded-lg border border-border/70 px-4 text-sm font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
                        Abrir el caso
                      </Link>
                      {i.estado === 'abierta' && <AccionConTexto accion={atenderIncidenciaAction} campos={{ incidenciaId: i.id, accion: 'tomar' }} boton="Tomarla" etiquetaTexto="" sinTexto />}
                      {i.estado !== 'resuelta' && (
                        <AccionConTexto
                          accion={atenderIncidenciaAction}
                          campos={{ incidenciaId: i.id, accion: 'resolver' }}
                          boton="Resolver y responder"
                          etiquetaTexto="Respuesta para la persona (la verá en su campana)"
                          nombreTexto="respuesta"
                          maximo={500}
                          multilinea
                          confirmar="Resolver"
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {datos.total > datos.incidencias.length && <p className="text-xs text-muted-foreground">Se muestran {datos.incidencias.length} de {datos.total}.</p>}
    </div>
  )
}

// ── Buscar ──────────────────────────────────────────────────────────────────

function Personas({ q, personas }: { q: string; personas: Awaited<ReturnType<typeof buscarPersonas>> }) {
  return (
    <div className="space-y-4">
      <form action="/superadmin/identidad" method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="vista" value="personas" />
        <div className="space-y-1.5">
          <label htmlFor="q" className="text-sm font-medium text-foreground">
            Correo, nombre o id
          </label>
          <input id="q" name="q" defaultValue={q} minLength={3} className="h-11 w-72 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Search className="h-4 w-4" aria-hidden />
          Buscar
        </button>
      </form>
      {q.trim().length < 3 ? (
        <p className="text-sm text-muted-foreground">Escribe al menos tres caracteres. No hay un listado completo de personas a propósito.</p>
      ) : personas.length === 0 ? (
        <EmptyState title="Sin resultados" description="Prueba con otra parte del correo o del nombre." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Persona</th>
                <th className="px-4 py-3 font-semibold">Verificación</th>
                <th className="px-4 py-3 font-semibold">Último intento</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {personas.map((p) => (
                <tr key={p.userId}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{p.nombre}</p>
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </td>
                  <td className="px-4 py-3">{p.estado ? p.estado.replace(/_/g, ' ') : 'Sin verificar'}</td>
                  <td className="px-4 py-3">{p.ultimoIntento ? `${p.ultimoIntento.estado.replace(/_/g, ' ')} · ${fecha(p.ultimoIntento.creadoAt)}` : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/superadmin/identidad/${p.userId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Abrir el caso
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Auditoría ───────────────────────────────────────────────────────────────

async function Auditoria() {
  const items = await getAuditoria(null, { accionPrefijo: 'IDENTIDAD_' }, 100)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Las últimas 100 acciones de identidad (consultas de casos, decisiones del equipo, cambios del interruptor, resultados). Sin datos personales: solo ids y códigos.{' '}
        <Link href="/superadmin/auditoria" className="underline underline-offset-4 hover:text-foreground">
          Abrir la bitácora completa
        </Link>
        .
      </p>
      {items.length === 0 ? <EmptyState title="Todavía no hay actividad" description="Aquí aparecerá lo que ocurra con la verificación de identidad." /> : <BitacoraTabla items={items} timeZone={ZONA} />}
    </div>
  )
}
