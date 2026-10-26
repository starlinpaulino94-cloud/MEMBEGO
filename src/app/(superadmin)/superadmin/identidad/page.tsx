import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Search, ShieldCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { BitacoraTabla } from '@/components/auditoria/BitacoraTabla'
import { AccionConTexto } from '@/components/superadmin/identidad/AccionConTexto'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { StatusChip } from '@/components/ui/status-chip'
import { Tabla } from '@/components/ui/tabla'
import { getAuditoria } from '@/modules/auditoria/queries'
import { TIPOS_DE_INCIDENCIA } from '@/modules/identidad/vistaCore'
import {
  LIMITE_DE_COLA,
  buscarPersonas,
  colaDeIncidencias,
  colaDeRevision,
  reglasDeLaPlataforma,
  resumenDeLaPlataforma,
  type IncidenciaEnCola,
  type ReglasParaElEquipo,
  type ResumenDeLaPlataforma,
} from '@/modules/identidad/staff'
import { atenderIncidenciaAction, cambiarInterruptorAction, cambiarReglaAction } from '@/modules/superadmin/identidadActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Identidad' }

const ZONA = 'America/Santo_Domingo'
const fecha = (d: Date | null) => (d ? formatDateTime(d, { zonaHoraria: ZONA }) : '—')

const VISTAS = [
  { valor: 'resumen', etiqueta: 'Resumen' },
  { valor: 'revision', etiqueta: 'Casos en revisión' },
  { valor: 'incidencias', etiqueta: 'Incidencias' },
  { valor: 'personas', etiqueta: 'Buscar a una persona' },
  { valor: 'reglas', etiqueta: 'Reglas' },
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
 * esperan a una persona y las incidencias, busca a una persona, decide en qué operaciones se pide identidad (Fase 5) y
 * consulta la bitácora. NO hay forma de ver una imagen ni
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
      {vista === 'reglas' && <Reglas datos={await reglasDeLaPlataforma(actor)} />}
      {vista === 'auditoria' && <Auditoria />}
    </div>
  )
}

// ── Reglas por función ──────────────────────────────────────────────────────

function Reglas({ datos }: { datos: ReglasParaElEquipo }) {
  const { compuerta, reglas, proveedores, nuncaPide } = datos
  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="text-h4">Cuándo se pide identidad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            La identidad protege el dinero que sale de Membego, no las compras. Por eso hay una lista corta de operaciones que pueden pedirla, todas apagadas de serie, y una lista de lo que no la pide
            nunca. Una regla encendida solo frena esa operación, con un mensaje que dice qué falta y a quién.
          </p>
          <p>
            <strong className="font-semibold text-foreground">No la piden nunca:</strong> {nuncaPide.join(' · ')}.
          </p>
          {!compuerta.habilitada && (
            <p className="flex items-start gap-2 text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>La verificación está apagada: no se puede encender ninguna regla, y las que estén encendidas no frenan nada hasta que la verificación vuelva.</span>
            </p>
          )}
        </CardContent>
      </Card>

      {reglas.map((r) => {
        const alcance = r.alcances.find((a) => a.valor === r.alcance)
        return (
          <Card key={r.operacion} className="border-border/60 shadow-card">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-h4">
                {r.titulo}
                <StatusChip tone={r.suspendidaPorLaCompuerta ? 'warning' : r.activa ? 'success' : 'neutral'} className="ml-auto">
                  {r.suspendidaPorLaCompuerta ? 'Encendida, en pausa' : r.activa ? 'Encendida' : 'Apagada'}
                </StatusChip>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué frena</dt>
                  <dd className="mt-1 text-foreground/90">{r.descripcion}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">A quién se le pide</dt>
                  <dd className="mt-1 text-foreground/90">{r.seVerificaA}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Se aplica a</dt>
                  <dd className="mt-1 text-foreground/90">
                    {alcance?.etiqueta}
                    <span className="block text-xs text-muted-foreground">{alcance?.explicacion}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Último cambio</dt>
                  <dd className="mt-1 text-foreground/90">
                    {r.cambiadoAt ? fecha(r.cambiadoAt) : 'Nunca se ha tocado'}
                    {r.motivo && <span className="block text-xs text-muted-foreground">«{r.motivo}»</span>}
                  </dd>
                </div>
              </dl>

              {proveedores && r.operacion === 'PAGO_A_PROVEEDOR' && (
                <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90">
                  Hoy hay <strong className="font-semibold">{proveedores.activos}</strong> proveedores activos: {proveedores.representanteVerificado} con su representante ya verificado,{' '}
                  {proveedores.representanteSinVerificar} con el representante sin verificar y {proveedores.sinRepresentante} sin nadie que haya aceptado el contrato. Con la regla encendida, el pago a
                  estos dos últimos grupos no se puede confirmar hasta que se resuelva.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <AccionConTexto
                  accion={cambiarReglaAction}
                  campos={{ operacion: r.operacion, activar: 'si' }}
                  boton={r.activa ? 'Cambiar a qué pagos se aplica' : 'Encender la regla'}
                  confirmar={r.activa ? 'Guardar el cambio' : 'Encender'}
                  etiquetaTexto="Motivo del cambio"
                  maximo={300}
                  opcion={{ nombre: 'alcance', etiqueta: 'A qué pagos se aplica', valores: r.alcances.map((a) => ({ valor: a.valor, etiqueta: `${a.etiqueta} — ${a.explicacion}` })) }}
                />
                {r.activa && (
                  <AccionConTexto
                    accion={cambiarReglaAction}
                    campos={{ operacion: r.operacion, activar: 'no', alcance: r.alcance }}
                    boton="Apagar la regla"
                    confirmar="Apagar"
                    etiquetaTexto="Motivo del cambio"
                    maximo={300}
                    peligrosa
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ── Resumen ─────────────────────────────────────────────────────────────────

function ValorONada({ valor }: { valor: number | null }) {
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
        <StatCard label="Intentos en 24 h" value={<ValorONada valor={resumen.intentos24h?.total ?? null} />} sub={resumen.intentos24h ? Object.entries(resumen.intentos24h.porEstado).map(([e, c]) => `${e.replace(/_/g, ' ')}: ${c}`).join(' · ') || 'ninguno' : undefined} />
        <StatCard label="Verificadas vigentes" value={<ValorONada valor={resumen.verificadasVigentes} />} sub={resumen.vencenEn30Dias === null ? undefined : `${resumen.vencenEn30Dias} vencen en 30 días`} />
        <StatCard
          label="Casos en revisión"
          value={<ValorONada valor={resumen.enRevision?.total ?? null} />}
          sub={resumen.enRevision ? `${resumen.enRevision.porDocumentoRepetido} por documento repetido · el más viejo: ${fecha(resumen.enRevision.masAntiguoAt)}` : undefined}
          href="/superadmin/identidad?vista=revision"
          hrefLabel="Ver los casos en revisión"
        />
        <StatCard
          label="Incidencias abiertas"
          value={<ValorONada valor={resumen.incidenciasAbiertas?.total ?? null} />}
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
              <strong className="font-semibold">Borrados pendientes en el proveedor:</strong> <ValorONada valor={resumen.purgasPendientes} />. Son intentos ya cerrados cuya sesión (con los documentos) sigue en el proveedor; el barrido diario los reintenta.
            </Alerta>
            <Alerta ok={resumen.avisosFallidos === 0} sinDato={resumen.avisosFallidos === null}>
              <strong className="font-semibold">Avisos del proveedor sin procesar:</strong> <ValorONada valor={resumen.avisosFallidos} />. Si crece, algo falla entre el proveedor y Membego.
            </Alerta>
            <Alerta ok={resumen.supresionesSinCompletar?.total === 0} sinDato={resumen.supresionesSinCompletar === null}>
              <strong className="font-semibold">Borrados pedidos por las personas sin completar:</strong> <ValorONada valor={resumen.supresionesSinCompletar?.total ?? null} />
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
      <Tabla
        caption="Casos de identidad en revisión"
        claveDe={(c) => c.intentoId}
        filas={cola.casos}
        columnaIdentificadora="persona"
        columnas={[
          {
            clave: 'persona',
            encabezado: 'Persona',
            celda: (c) => (
              <>
                <p className="font-medium text-foreground">{c.nombre}</p>
                <p className="text-xs text-muted-foreground">{c.email}</p>
              </>
            ),
          },
          { clave: 'razon', encabezado: 'Por qué espera', valor: (c) => (c.codigoRazon && RAZON_DE_REVISION[c.codigoRazon]) ?? c.codigoRazon ?? 'Lo pidió el proveedor' },
          { clave: 'desde', encabezado: 'Desde', celda: (c) => <span className="whitespace-nowrap tabular-nums">{fecha(c.creadoAt)}</span> },
          { clave: 'referencia', encabezado: 'Referencia del intento', celda: (c) => <span className="font-mono text-xs">{c.intentoId}</span> },
          {
            clave: 'abrir',
            encabezado: 'Acciones',
            soloLector: true,
            alineacion: 'derecha',
            celda: (c) => (
              <Link href={`/superadmin/identidad/${c.userId}?motivo=revision_de_caso`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                Abrir el caso
              </Link>
            ),
          },
        ]}
      />
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
        <Button type="submit" size="lg">
          <Search aria-hidden />
          Buscar
        </Button>
      </form>
      {q.trim().length < 3 ? (
        <p className="text-sm text-muted-foreground">Escribe al menos tres caracteres. No hay un listado completo de personas a propósito.</p>
      ) : personas.length === 0 ? (
        <EmptyState title="Sin resultados" description="Prueba con otra parte del correo o del nombre." />
      ) : (
        <Tabla
          caption="Personas encontradas"
          claveDe={(p) => p.userId}
          filas={personas}
          columnaIdentificadora="persona"
          columnas={[
            {
              clave: 'persona',
              encabezado: 'Persona',
              celda: (p) => (
                <>
                  <p className="font-medium text-foreground">{p.nombre}</p>
                  <p className="text-xs text-muted-foreground">{p.email}</p>
                </>
              ),
            },
            { clave: 'verificacion', encabezado: 'Verificación', valor: (p) => (p.estado ? p.estado.replace(/_/g, ' ') : 'Sin verificar') },
            { clave: 'ultimo', encabezado: 'Último intento', valor: (p) => (p.ultimoIntento ? `${p.ultimoIntento.estado.replace(/_/g, ' ')} · ${fecha(p.ultimoIntento.creadoAt)}` : '—') },
            {
              clave: 'abrir',
              encabezado: 'Acciones',
              soloLector: true,
              alineacion: 'derecha',
              celda: (p) => (
                <Link href={`/superadmin/identidad/${p.userId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                  Abrir el caso
                </Link>
              ),
            },
          ]}
        />
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
