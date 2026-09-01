import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Check } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { entradaDeCatalogo } from '@/modules/connect/catalogo'
import { registrosDeEmpresa } from '@/modules/connect/bitacora'
import { configuracionVisible } from '@/modules/connect/alta'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import { permiteConectar } from '@/modules/connect/proveedores/tipos'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBanner } from '@/components/ui/status-banner'
import { EstadoIntegracion } from '@/components/connect/EstadoIntegracion'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'
import { DesconectarIntegracion } from '@/components/connect/DesconectarIntegracion'
import { HistorialIntegracion } from '@/components/connect/HistorialIntegracion'

export const dynamic = 'force-dynamic'

/**
 * LA PÁGINA DE UNA INTEGRACIÓN (Connect · Fase 10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PÁGINA Y NO VENTANA FLOTANTE
 *
 * Un flujo OAuth SALE del navegador y vuelve en una petición nueva. Una
 * ventana flotante no sobrevive esa vuelta: al regresar de Google el usuario
 * aterrizaría en la rejilla sin saber si funcionó. Con una ruta propia, la
 * vuelta cae exactamente donde estaba.
 *
 * En esta fase la página enseña el estado, lo que la integración sabe hacer,
 * los pasos que vienen y el alta que ya existía. El asistente guiado paso a
 * paso —con progreso, atrás y recuperación de errores— es la Fase 12: hasta
 * entonces esta pantalla no finge tenerlo.
 */
export default async function IntegracionPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')

  const entrada = await entradaDeCatalogo(user.metadata.companyId, slug)
  if (!entrada) notFound()

  const proveedor = proveedorDe(slug)

  // Una integración ADAPTADA no se administra aquí: su estado vive en el
  // módulo que la gestiona de verdad. Llevar allí es lo correcto; pintar una
  // segunda pantalla de gestión sería empezar a duplicar.
  if (proveedor?.clase === 'ADAPTADA' && proveedor.rutaGestionExterna) {
    redirect(proveedor.rutaGestionExterna)
  }

  // El historial de ESTA conexión, en idioma de negocio. Solo si existe fila:
  // sin conexión no hay nada que contar, y una consulta más tampoco.
  const historial = entrada.conexionId
    ? await registrosDeEmpresa(user.metadata.companyId, {
        origenId: entrada.conexionId,
        origen: 'CONEXION',
        limite: 20,
      })
    : []

  // La configuración operativa de una conexión terminada, para poder verla sin
  // tener que abrir el asistente otra vez.
  const configuracion = await configuracionVisible(user.metadata.companyId, slug)

  const puedeConectar = permiteConectar(entrada.estado)
  const conectada = entrada.estado !== 'DISPONIBLE' && entrada.conexionId !== null
  const provisional = proveedor?.autorizacion.provisional

  return (
    <div className="space-y-6">
      <Link
        href="/admin/integraciones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Integraciones
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <LogoIntegracion
          slug={entrada.slug}
          nombre={entrada.nombre}
          marca={entrada.marca}
          className="h-14 w-14 text-xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h2 font-bold">{entrada.nombre}</h1>
            <EstadoIntegracion estado={entrada.estado} />
          </div>
          <p className="mt-1 text-muted-foreground">{entrada.descripcion}</p>
        </div>
        {conectada && entrada.conexionId && (
          <DesconectarIntegracion
            conexionId={entrada.conexionId}
            nombre={entrada.nombre}
            consecuencia={
              slug === 'google-calendar'
                ? 'Las citas confirmadas dejarán de aparecer en tu agenda de Google.'
                : 'Tus automatizaciones dejarán de enviar por este canal.'
            }
          />
        )}
      </div>

      {entrada.detalle && entrada.estado !== 'CONECTADA' && (
        <StatusBanner
          variant={
            entrada.estado === 'CON_PROBLEMAS' || entrada.estado === 'REAUTORIZAR'
              ? 'destructive'
              : 'warning'
          }
          title={entrada.etiqueta}
        >
          {entrada.detalle}
        </StatusBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {puedeConectar && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {entrada.estado === 'REAUTORIZAR'
                    ? 'Vuelve a conectar'
                    : entrada.estado === 'ALTA_SIN_TERMINAR'
                      ? 'Continúa donde lo dejaste'
                      : 'Conectar'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {provisional && (
                  <StatusBanner variant="info" title="Conexión manual, por ahora">
                    {provisional.motivo} Cuando esté disponible, esto se sustituye por{' '}
                    {provisional.sustituyePor} y no tendrás que volver a tocar ningún token.
                  </StatusBanner>
                )}

                {/* El alta la lleva el asistente, en su propia ruta. Una ruta y
                    no una ventana flotante porque el paso de autorización SE VA
                    del navegador y una ventana no sobrevive la vuelta. */}
                {proveedor && proveedor.pasos.length > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Son {proveedor.pasos.length} pasos y se pueden dejar a medias: al volver,
                      sigues donde lo dejaste.
                    </p>
                    <Button asChild>
                      <Link href={`/admin/integraciones/${slug}/conectar`}>
                        {entrada.accion ?? 'Conectar'}
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Esta integración todavía no tiene un alta guiada.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {conectada && configuracion.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuración</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-border/60">
                  {configuracion.map((c) => (
                    <div
                      key={c.etiqueta}
                      className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                    >
                      <dt className="text-sm text-muted-foreground">{c.etiqueta}</dt>
                      <dd className="break-all text-sm font-medium">{c.valor}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          <HistorialIntegracion
            registros={historial.map((r) => ({
              id: r.id,
              evento: r.evento,
              createdAt: r.createdAt.toISOString(),
            }))}
          />

          {proveedor && proveedor.pasos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">¿Qué ocurrirá a continuación?</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {proveedor.pasos.map((paso, i) => (
                    <li key={paso.id} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-bold">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{paso.titulo}</p>
                        <p className="text-caption text-muted-foreground">{paso.descripcion}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        {entrada.capacidades.length > 0 && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Qué podrá hacer</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {entrada.capacidades.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    <span>{ETIQUETA_CAPACIDAD[c] ?? c}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * Las capacidades, dichas en el idioma de quien administra un negocio. Sin
 * esto la tarjeta diría «calendario.escribir», que no significa nada para
 * quien tiene que decidir si concede el permiso.
 */
const ETIQUETA_CAPACIDAD: Record<string, string> = {
  'calendario.leer': 'Ver los calendarios de tu cuenta',
  'calendario.escribir': 'Crear eventos con tus citas confirmadas',
  'disponibilidad.leer': 'Consultar tus horas ocupadas',
  'mensajes.enviar': 'Enviar mensajes a tus clientes',
  'pagos.tarjeta': 'Cobrar con tarjeta de crédito y débito',
}
