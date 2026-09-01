import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { entradaDeCatalogo } from '@/modules/connect/catalogo'
import { EstadoIntegracion } from '@/components/connect/EstadoIntegracion'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'

/**
 * UNA INTEGRACIÓN, DENTRO DEL MÓDULO DONDE HACE FALTA (Connect · Fase 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA VERDAD, TRES PANTALLAS
 *
 * Este componente lee `entradaDeCatalogo`, EXACTAMENTE la misma función que
 * alimenta la rejilla de /admin/integraciones y la página de cada integración.
 * No consulta conexiones por su cuenta, no interpreta estados por su cuenta y
 * no decide el texto del botón por su cuenta: todo eso llega ya resuelto.
 *
 * Ésa es la exigencia del rediseño («no crear una segunda implementación
 * dentro de cada módulo») convertida en código: es IMPOSIBLE que Citas diga
 * «Conectar» sobre un calendario que el catálogo da por conectado, porque no
 * hay dos códigos que puedan responder distinto.
 *
 * Y tampoco hay ninguna acción de conexión aquí. El botón es un enlace a la
 * página de la integración, llevando de dónde viene para poder devolver al
 * usuario a su sitio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SI NO HAY NADA QUE ENSEÑAR, NO SE ENSEÑA NADA
 *
 * Cuando el conector no está publicado o no existe para esta empresa,
 * `entradaDeCatalogo` devuelve null y este bloque desaparece del módulo. Un
 * recuadro que dijera «Google Calendar: no disponible» en la pantalla de Citas
 * sería ruido permanente sobre algo que la empresa no pidió.
 */
export async function ConexionIntegracion({
  companyId,
  slug,
  volver,
  proposito,
}: {
  companyId: string
  slug: string
  /** Ruta del módulo desde el que se enseña, para volver después. */
  volver: string
  /** Para qué sirve AQUÍ. Lo mismo conectado en dos módulos hace dos cosas. */
  proposito: string
}) {
  const entrada = await entradaDeCatalogo(companyId, slug)
  if (!entrada) return null

  const destino = `${entrada.ruta}?volver=${encodeURIComponent(volver)}`

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center">
      <LogoIntegracion slug={entrada.slug} nombre={entrada.nombre} marca={entrada.marca} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{entrada.nombre}</p>
          <EstadoIntegracion estado={entrada.estado} />
        </div>
        {/* El propósito manda sobre la descripción del catálogo: aquí importa
            qué hace en ESTE módulo, no qué es la aplicación en general. */}
        <p className="mt-0.5 text-caption text-muted-foreground">{proposito}</p>
        {entrada.detalle && entrada.estado !== 'CONECTADA' && (
          <p className="mt-1 text-caption text-muted-foreground">{entrada.detalle}</p>
        )}
      </div>

      {entrada.accion && (
        <Link
          href={destino}
          className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline sm:ml-auto"
        >
          {entrada.accion}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  )
}
