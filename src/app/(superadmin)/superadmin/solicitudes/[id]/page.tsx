import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import {
  validarDatosSolicitud,
  horarioComoTexto,
  ESTADO_SOLICITUD_LABEL,
  TONO_SOLICITUD,
  type EstadoSolicitud,
  type ImagenSolicitud,
} from '@/modules/solicitudes/nucleo'
import { SolicitudAcciones } from '@/components/superadmin/SolicitudAcciones'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Solicitud de empresa' }

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      <div className="mt-3 space-y-1.5 text-sm">{children}</div>
    </section>
  )
}

function Dato({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null
  return (
    <p>
      <span className="font-medium text-muted-foreground">{k}: </span>
      <span className="text-foreground">{v}</span>
    </p>
  )
}

/**
 * El EXPEDIENTE de una solicitud: todo lo que el negocio llenó, sus imágenes,
 * la bitácora del superadmin y las dos palancas — cambiar de estado y CREAR
 * LA EMPRESA con un clic (la contraseña temporal se enseña una sola vez).
 */
export default async function SolicitudDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  // `sinEmpresa` y no `conEmpresa`: una solicitud es de un negocio que todavía
  // NO es empresa —de eso trata la pantalla—, así que no hay inquilino al que
  // acotarla. El acceso lo cierra `requireRole('SUPERADMIN')` de arriba.
  const solicitud = await sinEmpresa(
    'embudo de altas: la solicitud aún no pertenece a ninguna empresa',
    (tx) => tx.solicitudEmpresa.findUnique({ where: { id } })
  )
  if (!solicitud) notFound()

  const v = validarDatosSolicitud(solicitud.datos)
  const datos = v.ok ? v.datos : null
  const imagenes = (Array.isArray(solicitud.imagenes) ? solicitud.imagenes : []) as unknown as ImagenSolicitud[]
  const logo = imagenes.find((i) => i.tipo === 'logo')
  const portada = imagenes.find((i) => i.tipo === 'portada')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/superadmin/solicitudes"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Solicitudes
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{solicitud.nombreNegocio}</h1>
          <p className="text-sm text-muted-foreground">
            {solicitud.tipoNegocio} · recibida el {formatDate(solicitud.createdAt)}
          </p>
        </div>
        <StatusChip tone={TONO_SOLICITUD[solicitud.estado as EstadoSolicitud]}>
          {ESTADO_SOLICITUD_LABEL[solicitud.estado as EstadoSolicitud]}
        </StatusChip>
      </div>

      {!datos ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Esta solicitud llegó incompleta o con un formato viejo:{' '}
          {v.ok ? '' : (v as { error: string }).error} El JSON crudo sigue guardado en la base.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Bloque titulo="El negocio">
            <Dato k="Nombre" v={datos.negocio.nombre} />
            <Dato k="Tipo" v={datos.negocio.tipo === 'Otro' ? `Otro: ${datos.negocio.tipoOtro ?? ''}` : datos.negocio.tipo} />
            <Dato k="Descripción" v={datos.negocio.descripcion} />
            <Dato k="Teléfono" v={datos.negocio.telefono} />
            <Dato k="Correo" v={datos.negocio.correo} />
            <Dato k="RNC" v={datos.negocio.rnc} />
            <Dato k="Instagram" v={datos.negocio.instagram} />
            <Dato k="Web" v={datos.negocio.web} />
          </Bloque>

          <Bloque titulo="Ubicación y horario">
            <Dato k="Dirección" v={datos.ubicacion.direccion} />
            <Dato k="Ciudad" v={datos.ubicacion.ciudad} />
            {datos.ubicacion.maps ? (
              <p>
                <span className="font-medium text-muted-foreground">Google Maps: </span>
                <a href={datos.ubicacion.maps} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  abrir enlace
                </a>
              </p>
            ) : null}
            <Dato k="Horario" v={horarioComoTexto(datos.horario)} />
            {datos.sucursales.length ? (
              <div className="pt-1">
                <p className="font-medium text-muted-foreground">Sucursales adicionales:</p>
                {datos.sucursales.map((s, i) => (
                  <p key={i} className="text-foreground">
                    · {s.nombre ?? '(sin nombre)'} — {s.direccion ?? 'sin dirección'} {s.telefono ? `· ${s.telefono}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
          </Bloque>

          <Bloque titulo="Marca e imágenes">
            <div className="flex items-center gap-2">
              <span className="font-medium text-muted-foreground">Color:</span>
              {datos.marca.color ? (
                <span
                  className="inline-block h-5 w-5 rounded-full border border-border"
                  style={{ backgroundColor: datos.marca.color }}
                />
              ) : null}
              <span className="text-foreground">
                {datos.marca.color ?? 'No eligió: se usa el azul de MembeGo.'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {logo ? (
                <a href={logo.url} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- adjunto externo de tamaño libre */}
                  <img src={logo.url} alt="Logo adjunto" className="h-24 w-24 rounded-xl border border-border object-contain bg-muted" />
                  <span className="mt-1 block text-center text-xs text-muted-foreground">Logo</span>
                </a>
              ) : (
                <span className="text-muted-foreground">Sin logo adjunto.</span>
              )}
              {portada ? (
                <a href={portada.url} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- adjunto externo de tamaño libre */}
                  <img src={portada.url} alt="Portada adjunta" className="h-24 w-40 rounded-xl border border-border object-cover" />
                  <span className="mt-1 block text-center text-xs text-muted-foreground">Portada</span>
                </a>
              ) : (
                <span className="text-muted-foreground">Sin portada adjunta.</span>
              )}
            </div>
          </Bloque>

          <Bloque titulo="Administrador">
            <Dato k="Nombre" v={datos.admin.nombre} />
            <Dato k="Correo (acceso)" v={datos.admin.correo} />
            <Dato k="Teléfono" v={datos.admin.telefono} />
          </Bloque>

          <Bloque titulo={`Planes solicitados (${datos.planes.length})`}>
            {datos.planes.length === 0 ? <p className="text-muted-foreground">Ninguno por ahora.</p> : null}
            {datos.planes.map((p, i) => (
              <div key={i} className="rounded-lg bg-muted p-2.5">
                <p className="font-semibold text-foreground">
                  {p.nombre || '(sin nombre)'} — RD${p.precio || '?'}/mes
                </p>
                {p.incluye ? <p className="text-muted-foreground">{p.incluye}</p> : null}
              </div>
            ))}
          </Bloque>

          <Bloque titulo={`Promociones de arranque (${datos.promos.length})`}>
            {datos.promos.length === 0 ? <p className="text-muted-foreground">Ninguna por ahora.</p> : null}
            {datos.promos.map((p, i) => {
              const img = imagenes.find((im) => im.tipo === 'promo' && im.promoIndice === i)
              return (
                <div key={i} className="rounded-lg bg-muted p-2.5">
                  <p className="font-semibold text-foreground">{p.titulo || '(sin título)'}</p>
                  {p.oferta ? <p className="text-muted-foreground">{p.oferta}</p> : null}
                  {p.vigencia ? <p className="text-xs text-muted-foreground">Vigencia: {p.vigencia}</p> : null}
                  {p.condiciones ? <p className="text-xs text-muted-foreground">Condiciones: {p.condiciones}</p> : null}
                  {img ? (
                    <a href={img.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- adjunto externo de tamaño libre */}
                      <img src={img.url} alt={`Imagen de ${p.titulo}`} className="mt-2 h-28 w-28 rounded-lg border border-border object-cover" />
                    </a>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Sin imagen adjunta.</p>
                  )}
                </div>
              )
            })}
          </Bloque>

          <Bloque titulo="Cobros y operación">
            <Dato
              k="Métodos"
              v={[
                datos.cobros.efectivo ? 'Efectivo' : null,
                datos.cobros.transferencia ? 'Transferencia' : null,
                datos.cobros.tarjeta ? 'Tarjeta (CardNET)' : null,
              ]
                .filter(Boolean)
                .join(', ')}
            />
            {datos.cobros.transferencia ? (
              <>
                <Dato k="Banco" v={datos.cobros.banco} />
                <Dato k="Cuenta" v={[datos.cobros.cuentaTipo, datos.cobros.cuentaNum].filter(Boolean).join(' · ')} />
                <Dato k="Titular" v={datos.cobros.cuentaTitular} />
              </>
            ) : null}
            <Dato k="Citas desde la app" v={datos.cobros.usaCitas ? 'Sí' : 'No'} />
            {datos.cobros.vehiculos ? (
              <div>
                <p className="font-medium text-muted-foreground">Vehículos y precios:</p>
                <p className="whitespace-pre-line text-foreground">{datos.cobros.vehiculos}</p>
              </div>
            ) : null}
            <Dato
              k="Extras"
              v={[
                datos.extras.ruleta ? 'Ruleta' : null,
                datos.extras.gift ? 'Gift cards' : null,
                datos.extras.referidos ? 'Invita y Gana' : null,
                datos.extras.sellos ? 'Tarjeta de sellos' : null,
              ]
                .filter(Boolean)
                .join(', ')}
            />
            <Dato k="Comentarios" v={datos.extras.comentarios} />
          </Bloque>
        </div>
      )}

      <SolicitudAcciones
        id={solicitud.id}
        estado={solicitud.estado as EstadoSolicitud}
        companyId={solicitud.companyId}
        notas={solicitud.notasInternas}
        listaParaCrear={!!datos}
      />
    </div>
  )
}
