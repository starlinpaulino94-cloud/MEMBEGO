import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { getRequestMeta } from '@/lib/server-utils'
import { BitacoraTabla } from '@/components/auditoria/BitacoraTabla'
import { AccionConTexto } from '@/components/superadmin/identidad/AccionConTexto'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { StatusChip } from '@/components/ui/status-chip'
import { Tabla } from '@/components/ui/tabla'
import { getAuditoria } from '@/modules/auditoria/queries'
import { DISPARADORES_REVALIDACION } from '@/modules/identidad/identidadCore'
import { ErrorDeIdentidad } from '@/modules/identidad/identidad'
import { MOTIVOS_DE_CONSULTA, esMotivoDeConsulta, verCasoDeIdentidad, type CasoDeIdentidad } from '@/modules/identidad/staff'
import { TIPOS_DE_INCIDENCIA } from '@/modules/identidad/vistaCore'
import {
  atenderIncidenciaAction,
  pedirRevalidacionAction,
  reabrirVerificacionAction,
  resolverRevisionAction,
  revocarVerificacionAction,
  suprimirIdentidadAction,
} from '@/modules/superadmin/identidadActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Caso de identidad' }

const ZONA = 'America/Santo_Domingo'
const fecha = (d: Date | null) => (d ? formatDateTime(d, { zonaHoraria: ZONA }) : '—')
const etiquetaDeIncidencia = new Map<string, string>(TIPOS_DE_INCIDENCIA.map((t) => [t.valor, t.etiqueta]))
const DISPARADORES = DISPARADORES_REVALIDACION.map((d) => ({ valor: d, etiqueta: d.replace(/_/g, ' ') }))
const ABIERTOS = ['creada', 'iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'en_revision']

/**
 * EL CASO DE UNA PERSONA — estado, intentos, resultado, prueba de los consentimientos, incidencias y su línea de tiempo.
 *
 * ABRIRLO DEJA ASIENTO: quién, a quién, con qué motivo (de una lista cerrada) y desde qué IP. Por eso, si la dirección no
 * trae el motivo, primero se pide; con el motivo, la lectura ya queda registrada. Nunca se enseña una imagen, la referencia
 * de la sesión del proveedor ni el hash del documento: la evidencia está en la consola del proveedor.
 */
export default async function CasoDeIdentidadPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ motivo?: string }> }) {
  const user = await requireRole('SUPERADMIN')
  const { userId } = await params
  const { motivo } = await searchParams
  const volver = (
    <Link href="/superadmin/identidad" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Verificación de identidad
    </Link>
  )

  if (!esMotivoDeConsulta(motivo)) {
    return (
      <div className="max-w-xl space-y-5">
        {volver}
        <Card className="border-border/60 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-h4">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
              Abrir un caso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">Abrir un caso queda registrado con tu nombre, a quién consultaste y por qué. Elige el motivo.</p>
              <div className="space-y-1.5">
                <label htmlFor="motivo" className="text-sm font-medium text-foreground">
                  Motivo
                </label>
                <select id="motivo" name="motivo" required defaultValue="" className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="" disabled>
                    Elige una opción
                  </option>
                  {MOTIVOS_DE_CONSULTA.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="lg">
                Abrir el caso
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  const meta = await getRequestMeta().catch(() => ({ ipAddress: null, userAgent: null }))
  let caso: CasoDeIdentidad
  try {
    caso = await verCasoDeIdentidad({ userId: user.metadata.dbUserId ?? '', rol: user.metadata.role }, userId, motivo, {
      ip: meta.ipAddress?.split(',')[0]?.trim() ?? null,
      userAgent: meta.userAgent,
    })
  } catch (e) {
    if (e instanceof ErrorDeIdentidad && e.codigo === 'persona_no_encontrada') notFound()
    throw e
  }
  const linea = await getAuditoria(null, { entidadTipo: 'IdentidadVerificacion', entidadId: userId }, 50)
  const v = caso.verificacion
  const verificada = caso.estado.estado === 'verificada'
  // «Contacta a soporte» le llega a quien quedó bloqueado (rechazo definitivo o demasiados rechazos): aquí se le reabre.
  const bloqueada = !caso.estado.puedeIniciar && ['bloqueada_por_rechazo_definitivo', 'demasiados_rechazos'].includes(caso.estado.motivoNoPuedeIniciar ?? '') && !caso.estado.intentoAbierto

  return (
    <div className="space-y-6">
      <PageHeader back={volver} title={caso.persona.nombre} description={`${caso.persona.email} · ${caso.persona.userId}`} />

      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-h4">
            Resultado de la verificación
            <StatusChip tone={verificada ? 'success' : caso.estado.estado === 'revocada' ? 'danger' : 'neutral'} className="ml-auto">
              {caso.estado.estado.replace(/_/g, ' ')}
            </StatusChip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {v ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <CampoDelResultado k="Nivel" v={v.nivel ?? '—'} />
              <CampoDelResultado k="Vía" v={v.via?.replace(/_/g, ' ') ?? '—'} />
              <CampoDelResultado k="Proveedor" v={v.proveedor ?? '—'} />
              <CampoDelResultado k="Verificada el" v={fecha(v.verificadaEn)} />
              <CampoDelResultado k="Vence el" v={fecha(v.expiraEn)} />
              {v.revocadaEn && <CampoDelResultado k="Retirada el" v={`${fecha(v.revocadaEn)}${v.motivoRevocacion ? ` — ${v.motivoRevocacion}` : ''}`} />}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No tiene un resultado guardado.</p>
          )}
          {bloqueada && (
            <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90">
              Esta persona no puede volver a intentarlo sola ({caso.estado.motivoNoPuedeIniciar === 'bloqueada_por_rechazo_definitivo' ? 'tuvo un rechazo definitivo' : 'acumuló demasiados rechazos'}).
              Si después de revisar su caso decides darle otra oportunidad, puedes reabrirle la verificación: tiene que hacerla ella, pasando de nuevo por el
              proveedor, y se le avisa.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-2">
            {bloqueada && (
              <AccionConTexto
                accion={reabrirVerificacionAction}
                campos={{ userId }}
                boton="Reabrir la verificación"
                etiquetaTexto="Motivo (queda en la bitácora con tu nombre)"
                maximo={200}
                confirmar="Reabrir"
              />
            )}
            {verificada && (
              <>
                <AccionConTexto accion={revocarVerificacionAction} campos={{ userId }} boton="Retirar la verificación" etiquetaTexto="Motivo (se guarda con el resultado)" maximo={120} peligrosa confirmar="Retirar" />
                <AccionConTexto
                  accion={pedirRevalidacionAction}
                  campos={{ userId }}
                  boton="Pedir que se verifique de nuevo"
                  etiquetaTexto=""
                  opcion={{ nombre: 'disparador', etiqueta: 'Por qué se pide', valores: DISPARADORES }}
                  confirmar="Pedir revalidación"
                />
              </>
            )}
            <AccionConTexto
              accion={suprimirIdentidadAction}
              campos={{ userId }}
              boton="Borrar sus datos de verificación"
              etiquetaTexto="Motivo (por ejemplo, el ticket de la solicitud)"
              maximo={120}
              peligrosa
              casilla={{ nombre: 'confirmo', etiqueta: 'Entiendo que es definitivo: se borra en el proveedor y en Membego, y la persona pierde su verificación.' }}
              confirmar="Borrar"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="text-h4">Intentos</CardTitle>
        </CardHeader>
        <CardContent>
          {caso.intentos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nunca ha empezado una verificación.</p>
          ) : (
            <ul className="space-y-3">
              {caso.intentos.map((i) => (
                <li key={i.id} className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={i.estado === 'aprobada' ? 'success' : i.estado.startsWith('rechazada') ? 'danger' : i.estado === 'en_revision' ? 'info' : 'neutral'}>{i.estado.replace(/_/g, ' ')}</StatusChip>
                    <span className="text-muted-foreground">
                      {i.canal.replace(/_/g, ' ')} · {i.origen} · {fecha(i.creadoAt)}
                      {i.resueltoAt ? ` → ${fecha(i.resueltoAt)}` : ''}
                    </span>
                  </div>
                  {(i.codigoRazon || i.tipoRechazo) && (
                    <p className="text-muted-foreground">
                      Motivo: <span className="font-mono text-xs">{i.codigoRazon ?? '—'}</span>
                      {i.tipoRechazo ? ` (${i.tipoRechazo})` : ''}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Referencia para buscarlo en la consola del proveedor: <span className="font-mono">{i.id}</span>
                  </p>
                  {i.estado === 'en_revision' && (
                    <AccionConTexto
                      accion={resolverRevisionAction}
                      campos={{ intentoId: i.id }}
                      boton="Resolver este caso"
                      etiquetaTexto="Motivo de tu decisión"
                      maximo={200}
                      opcion={{
                        nombre: 'decision',
                        etiqueta: 'Qué hacer',
                        valores: [
                          { valor: 'rechazar', etiqueta: 'Rechazarlo (la persona verá «contacta a soporte»)' },
                          { valor: 'pedir_repeticion', etiqueta: 'Pedir que repita la verificación (no cuenta como rechazo)' },
                        ],
                      }}
                      confirmar="Resolver"
                    />
                  )}
                  {ABIERTOS.includes(i.estado) && i.estado !== 'en_revision' && <p className="text-xs text-muted-foreground">En curso: se resuelve con el proveedor.</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Para aprobar un caso en revisión, hazlo en la consola del proveedor, donde está la evidencia: el resultado vuelve solo.</p>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="text-h4">Incidencias</CardTitle>
        </CardHeader>
        <CardContent>
          {caso.incidencias.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ha reportado nada.</p>
          ) : (
            <ul className="space-y-3">
              {caso.incidencias.map((i) => (
                <li key={i.id} className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={i.estado === 'resuelta' ? 'success' : i.estado === 'en_proceso' ? 'info' : 'warning'}>{i.estado.replace(/_/g, ' ')}</StatusChip>
                    <span className="font-medium">{etiquetaDeIncidencia.get(i.tipo) ?? i.tipo}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fecha(i.creadaAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3">{i.mensaje}</p>
                  {i.respuesta && <p className="whitespace-pre-wrap rounded-lg border border-success/25 bg-success/10 p-3">{i.respuesta}</p>}
                  {i.estado !== 'resuelta' && (
                    <div className="flex flex-wrap gap-2">
                      {i.estado === 'abierta' && <AccionConTexto accion={atenderIncidenciaAction} campos={{ incidenciaId: i.id, accion: 'tomar' }} boton="Tomarla" etiquetaTexto="" sinTexto />}
                      <AccionConTexto accion={atenderIncidenciaAction} campos={{ incidenciaId: i.id, accion: 'resolver' }} boton="Resolver y responder" etiquetaTexto="Respuesta para la persona (la verá en su campana)" nombreTexto="respuesta" maximo={500} multilinea confirmar="Resolver" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="text-h4">Permisos que dio (prueba de lo que aceptó)</CardTitle>
        </CardHeader>
        <CardContent>
          {caso.consentimientos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ha dado ningún permiso.</p>
          ) : (
            <Tabla
              caption="Permisos que dio la persona"
              claveDe={(c) => `${c.tipo}-${c.version}-${c.canal}-${c.otorgadoAt?.toISOString() ?? ''}`}
              filas={caso.consentimientos}
              columnaIdentificadora="permiso"
              className="border-0 shadow-none"
              columnas={[
                { clave: 'permiso', encabezado: 'Permiso', valor: (c) => c.tipo.replace('IDENTIDAD_', '').replace(/_/g, ' ').toLowerCase() },
                { clave: 'texto', encabezado: 'Texto', celda: (c) => <span className="font-mono text-xs">{c.version}</span> },
                { clave: 'canal', encabezado: 'Canal', valor: (c) => c.canal },
                { clave: 'dado', encabezado: 'Dado', celda: (c) => <span className="whitespace-nowrap tabular-nums">{fecha(c.otorgadoAt)}</span> },
                { clave: 'retirado', encabezado: 'Retirado', celda: (c) => <span className="whitespace-nowrap tabular-nums">{fecha(c.revocadoAt)}</span> },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <section aria-label="Línea de tiempo" className="space-y-2">
        <h2 className="text-h4 text-foreground">Línea de tiempo</h2>
        {linea.length === 0 ? <p className="text-sm text-muted-foreground">Sin actividad registrada.</p> : <BitacoraTabla items={linea} timeZone={ZONA} />}
      </section>
    </div>
  )
}

function CampoDelResultado({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{k}:</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  )
}
