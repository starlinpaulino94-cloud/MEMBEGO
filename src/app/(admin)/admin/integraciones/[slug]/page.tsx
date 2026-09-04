import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  Activity,
  ArrowLeft,
  CircleCheck,
  ExternalLink,
  Hourglass,
  Workflow,
  Zap,
} from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { plural } from '@/lib/plural'
import { entradaDeCatalogo } from '@/modules/connect/catalogo'
import { registrosDeEmpresa } from '@/modules/connect/bitacora'
import { configuracionVisible } from '@/modules/connect/alta'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import { permiteConectar } from '@/modules/connect/proveedores/tipos'
import { nombreDelDestino, origenSeguro } from '@/modules/connect/oauthNucleo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBanner } from '@/components/ui/status-banner'
import { EstadoIntegracion } from '@/components/connect/EstadoIntegracion'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'
import { DesconectarIntegracion } from '@/components/connect/DesconectarIntegracion'
import { HistorialIntegracion } from '@/components/connect/HistorialIntegracion'

export const dynamic = 'force-dynamic'

/**
 * LA PÁGINA DE UNA INTEGRACIÓN (Connect · Fase 10, rediseño «hub»).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PÁGINA Y NO VENTANA FLOTANTE
 *
 * Un flujo OAuth SALE del navegador y vuelve en una petición nueva. Una
 * ventana flotante no sobrevive esa vuelta: al regresar de Google el usuario
 * aterrizaría en la rejilla sin saber si funcionó. Con una ruta propia, la
 * vuelta cae exactamente donde estaba.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS LECTURAS DE LA MISMA PANTALLA
 *
 * Antes de conectar, la pregunta es «¿me sirve?»: el héroe lleva la acción a
 * la derecha, y debajo van qué podrá hacer, el proceso de alta como pasos y la
 * ficha técnica. Ya conectada, la pregunta es «¿va bien?»: el mismo héroe
 * enseña la configuración operativa como recuadros, las acciones (reconectar,
 * desconectar) en su fila, y a la derecha el estado de la conexión con su
 * última actividad. Es la misma página con las prioridades cambiadas, no dos
 * páginas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PINTA
 *
 * El diseño de referencia lleva un anillo de «salud óptima» con una tasa de
 * éxito y un contador de eventos de hoy. MembeGo no mide nada de eso por
 * conexión: lo que sí sabe —el estado, el contexto del catálogo, cuándo fue la
 * última actividad y cuántos apuntes hay— es lo que se enseña. Un «100 %»
 * pintado a mano tranquiliza sin motivo.
 */
export default async function IntegracionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ volver?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  // NUNCA se acepta el origen tal cual viene: `origenSeguro` solo deja pasar
  // rutas internas de /admin/, y devuelve null para todo lo demás. Un destino
  // elegido por quien llama es la forma clásica de convertir un enlace nuestro
  // en un redirector abierto hacia el sitio de otro.
  const volver = origenSeguro(sp.volver)
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')

  const entrada = await entradaDeCatalogo(user.metadata.companyId, slug)
  if (!entrada) notFound()

  const proveedor = proveedorDe(slug)
  // El guion depende del despliegue, así que se resuelve una vez y se usa.
  const pasos = proveedor?.pasos() ?? []

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

  /**
   * LA FICHA TÉCNICA — cuatro datos, y los cuatro se leen de la definición del
   * proveedor. Un proveedor sin definición (una entrada del roadmap) solo
   * aporta su categoría, y la ficha lo dice en vez de inventarse el resto.
   */
  const fichaTecnica: { etiqueta: string; valor: string; mono?: boolean }[] = [
    ...(proveedor
      ? [
          {
            etiqueta: 'Autorización',
            valor: proveedor.autorizacion.tipo === 'OAUTH2' ? 'OAuth 2.0' : 'Clave de API',
            mono: true,
          },
          {
            etiqueta: 'Tipo',
            valor: proveedor.clase === 'NATIVA' ? 'Conexión nativa' : 'Módulo adaptado',
          },
          {
            etiqueta: 'Pasos del alta',
            valor: pasos.length > 0 ? String(pasos.length) : 'Sin alta guiada',
          },
        ]
      : [{ etiqueta: 'Estado', valor: entrada.etiqueta }]),
  ]
  const sitioUrl = proveedor?.metadatos.sitioUrl ?? null

  const puedeConectar = permiteConectar(entrada.estado)
  const conectada = entrada.estado !== 'DISPONIBLE' && entrada.conexionId !== null
  const conAltaGuiada = proveedor !== null && pasos.length > 0
  const provisional = proveedor?.autorizacion.provisional
  const hrefConectar = `/admin/integraciones/${slug}/conectar${
    volver ? `?volver=${encodeURIComponent(volver)}` : ''
  }`

  /**
   * LA ÚLTIMA ACTIVIDAD, del propio historial: el apunte más reciente. Se busca
   * el máximo y no se confía en el orden de la lista; si mañana la consulta
   * ordenara al revés, aquí no cambiaría nada.
   */
  const ultimaActividad = historial.reduce<Date | null>(
    (max, r) => (max === null || r.createdAt > max ? r.createdAt : max),
    null
  )

  /**
   * LA ACCIÓN PRINCIPAL. Cuando se puede conectar y hay alta guiada, un botón
   * al asistente. Cuando NO se puede, un botón apagado que DICE por qué —«en
   * preparación», «no disponible»— en lugar de desaparecer: quien entra aquí
   * quiere saber si podrá, y un hueco no responde.
   */
  const accionPrincipal =
    puedeConectar && conAltaGuiada ? (
      <Button size="lg" asChild>
        <Link href={hrefConectar}>{entrada.accion ?? 'Conectar'}</Link>
      </Button>
    ) : conectada ? null : (
      <Button size="lg" variant="secondary" disabled>
        <Hourglass className="mr-2 h-4 w-4" aria-hidden />
        {entrada.estado === 'PROXIMAMENTE'
          ? 'Conectar (en preparación)'
          : puedeConectar
            ? 'Sin alta guiada todavía'
            : 'No disponible'}
      </Button>
    )

  return (
    <div className="space-y-6">
      <Link
        href={volver ?? '/admin/integraciones'}
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Volver a {volver ? nombreDelDestino(volver) : 'Integraciones'}
      </Link>

      {/* EL HÉROE. Una tarjeta y no texto suelto sobre el fondo: separa la
          identidad de la integración —logotipo, nombre, estado y qué hace— del
          resto de bloques, que son detalles. Conectada, la misma tarjeta lleva
          además la configuración y las acciones: es donde se mira primero. */}
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-5">
              <LogoIntegracion
                slug={entrada.slug}
                nombre={entrada.nombre}
                marca={entrada.marca}
                className={conectada ? 'h-16 w-16 text-xl' : 'h-20 w-20 text-2xl'}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-h1 font-extrabold tracking-tight">{entrada.nombre}</h1>
                  <EstadoIntegracion estado={entrada.estado} />
                </div>
                <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                  {entrada.descripcion}
                </p>
              </div>
            </div>
            {accionPrincipal && (
              <div className="flex shrink-0 flex-col items-stretch gap-2 md:items-end">
                {accionPrincipal}
              </div>
            )}
          </div>

          {conectada && configuracion.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {configuracion.map((c) => (
                <div
                  key={c.etiqueta}
                  className="rounded-xl border border-border/60 bg-muted/30 p-4"
                >
                  <p className="text-overline">{c.etiqueta}</p>
                  <p className="mt-1 break-all text-sm font-medium text-foreground">{c.valor}</p>
                </div>
              ))}
            </div>
          )}

          {conectada && entrada.conexionId && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
              {puedeConectar && conAltaGuiada && (
                <Button asChild>
                  <Link href={hrefConectar}>{entrada.accion ?? 'Reconectar'}</Link>
                </Button>
              )}
              <DesconectarIntegracion
                conexionId={entrada.conexionId}
                nombre={entrada.nombre}
                consecuencia={
                  slug === 'google-calendar'
                    ? 'Las citas confirmadas dejarán de aparecer en tu agenda de Google.'
                    : 'Tus automatizaciones dejarán de enviar por este canal.'
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

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

      {puedeConectar && provisional && (
        <StatusBanner variant="info" title="Conexión manual, por ahora">
          {provisional.motivo} Cuando esté disponible, esto se sustituye por{' '}
          {provisional.sustituyePor} y no tendrás que volver a tocar ningún token.
        </StatusBanner>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Lo primero que hay que saber de una integración es qué VA A HACER.
              Va en la columna ancha y arriba: quien entra a decidir si conectar
              no debería leer primero la ficha y después para qué sirve. */}
          {entrada.capacidades.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-h3">
                  <Zap className="h-5 w-5 text-primary" aria-hidden />
                  {conectada ? 'Qué hace' : 'Qué podrá hacer'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {entrada.capacidades.map((c) => (
                    <li key={c} className="flex items-start gap-3 text-sm">
                      <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                      <span className="font-medium">{ETIQUETA_CAPACIDAD[c] ?? c}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* EL PROCESO, como pasos sobre una línea. Solo antes de conectar:
              conectada, ya no hay proceso que explicar. */}
          {!conectada && pasos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-h3">
                  <Workflow className="h-5 w-5 text-primary" aria-hidden />
                  Proceso de configuración
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="relative ml-3 space-y-7 border-l-2 border-border pl-8">
                  {pasos.map((paso, i) => (
                    <li key={paso.id} className="relative">
                      <span
                        aria-hidden
                        className="absolute -left-[41px] top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-border bg-card text-caption font-bold text-muted-foreground"
                      >
                        {i + 1}
                      </span>
                      <p className="text-sm font-semibold">{paso.titulo}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{paso.descripcion}</p>
                    </li>
                  ))}
                </ol>
                {conAltaGuiada && (
                  <p className="mt-5 text-caption text-muted-foreground">
                    Son {plural(pasos.length, 'paso', 'pasos')} y se pueden dejar a medias: al
                    volver, sigues donde lo dejaste.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {!conectada && puedeConectar && !conAltaGuiada && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Esta integración todavía no tiene un alta guiada.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* EL ESTADO DE LA CONEXIÓN. Sin anillo ni porcentaje: el estado que
              decide el catálogo, su contexto, y lo que el historial sabe. */}
          {conectada && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-h3">
                  <Activity className="h-5 w-5 text-primary" aria-hidden />
                  Estado de la conexión
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <EstadoIntegracion estado={entrada.estado} />
                  <p className="text-caption text-muted-foreground">
                    {entrada.detalle ?? 'Funcionando con normalidad.'}
                  </p>
                </div>
                <dl className="divide-y divide-border/60 border-t border-border/60">
                  <div className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="text-sm text-muted-foreground">Última actividad</dt>
                    <dd className="text-right text-sm font-medium">
                      {ultimaActividad ? formatDateTime(ultimaActividad) : 'Sin registros'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="text-sm text-muted-foreground">Apuntes recientes</dt>
                    <dd className="text-right text-sm font-medium">{historial.length}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          {/* FICHA TÉCNICA. Los datos salen de la definición del proveedor y
              del catálogo — no hay ninguno redactado a mano aquí. Es lo que
              pregunta quien tiene que decidir si esto encaja en su operación:
              de qué tipo es, cómo se autoriza y cuánto trabajo cuesta. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-overline">Detalles técnicos</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border/60">
                <div className="flex items-center justify-between gap-3 py-2 first:pt-0">
                  <dt className="text-sm text-muted-foreground">Categoría</dt>
                  <dd>
                    <Badge variant="secondary">{entrada.categoriaLabel}</Badge>
                  </dd>
                </div>
                {fichaTecnica.map((f) => (
                  <div
                    key={f.etiqueta}
                    className="flex items-baseline justify-between gap-3 py-2 last:pb-0"
                  >
                    <dt className="text-sm text-muted-foreground">{f.etiqueta}</dt>
                    <dd
                      className={
                        f.mono
                          ? 'text-right font-mono text-caption font-medium'
                          : 'text-right text-sm font-medium'
                      }
                    >
                      {f.valor}
                    </dd>
                  </div>
                ))}
                {sitioUrl && (
                  <div className="flex items-baseline justify-between gap-3 py-2 last:pb-0">
                    <dt className="text-sm text-muted-foreground">Proveedor</dt>
                    <dd>
                      <a
                        href={sitioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        Sitio oficial
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* El historial a lo ancho, debajo de todo: es lo que se consulta
            cuando algo no cuadra, no lo primero que se mira. */}
        <div className="lg:col-span-3">
          <HistorialIntegracion
            registros={historial.map((r) => ({
              id: r.id,
              evento: r.evento,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        </div>
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
  'mensajes.recibir': 'Recibir los mensajes de tus clientes en Membego',
  'paginas.leer': 'Ver las Páginas de Facebook que administras',
  'pagos.tarjeta': 'Cobrar con tarjeta de crédito y débito',
}
