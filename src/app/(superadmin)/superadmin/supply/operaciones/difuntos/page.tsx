import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dato, Edad, ErrorCorto, Momento, Paginador, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { ReintentarEfecto } from '@/components/supply-v2/operaciones/acciones'
import { difuntosDeLaCola, efectosMuertos } from '@/modules/supply-v2/operations/panel-queries'
import { RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sin salida · Operaciones' }

/**
 * SLICE 9 · BLOQUE 4 · §18 · LO QUE AGOTÓ SUS INTENTOS.
 *
 * Dos cosas distintas en una pantalla, porque el operador no debería tener que
 * saber de antemano cuál de las dos le falló:
 *
 *   · EFECTOS del outbox de Supply (`supply_v2_outbox_events`), con su
 *     reintento manual, que existe desde el bloque 1 y devuelve la escalera.
 *   · TRABAJOS de la cola general (`trabajos_muertos`), cuyas acciones de
 *     reencolar y descartar ya existían en el panel de integraciones y NO se
 *     reimplementan aquí: se enlaza allí.
 */
export default async function DifuntosPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  await requireRole('SUPERADMIN')
  const q = await searchParams
  const base = `${RUTA_OPERACIONES}/difuntos`
  const [efectos, trabajos] = await Promise.all([efectosMuertos(Number(q.pagina) || 1), difuntosDeLaCola(25)])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sin salida"
        description="Efectos y trabajos que agotaron sus intentos. Nada se pierde: esperan una decisión."
        eyebrow="Operaciones"
        action={<Link href={RUTA_OPERACIONES} className="text-sm underline">← Centro de Operaciones</Link>}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Efectos del outbox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {efectos.filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-efectos-muertos">Ningún efecto sin salida.</p>
          ) : (
            <Tabla cabeceras={['Efecto', 'Compra', 'Intentos', 'Primer intento', 'Último', 'Último error', 'Edad', '', '']}>
              {efectos.filas.map((e) => (
                <tr key={e.id} data-testid={`muerto-${e.id}`}>
                  <td className="px-2 py-1.5 text-xs">{e.eventType}</td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={e.orderNumber} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums" data-testid={`muerto-intentos-${e.id}`}>{e.attempts}</td>
                  <td className="px-2 py-1.5"><Momento valor={e.createdAt} /></td>
                  <td className="px-2 py-1.5"><Momento valor={e.claimedAt} /></td>
                  <td className="px-2 py-1.5"><ErrorCorto texto={e.lastError} /></td>
                  <td className="px-2 py-1.5"><Edad minutos={e.edadMin} /></td>
                  <td className="px-2 py-1.5">
                    <Link href={`${RUTA_OPERACIONES}/buscar?q=${encodeURIComponent(e.correlationId)}`} className="text-xs underline">
                      Historia
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <ReintentarEfecto outboxId={e.id} />
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
          <Paginador base={base} pagina={efectos.pagina} porPagina={efectos.porPagina} total={efectos.total} />
          <p className="text-xs text-muted-foreground">
            El reintento de un efecto devuelve la escalera completa (ocho intentos) a propósito: un difunto agotó los
            suyos, y reenviarlo sin escalera moriría al primer fallo. Vive en el servicio del bloque 1.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Trabajos de la cola</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {trabajos.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-trabajos-muertos">Ningún trabajo difunto pendiente.</p>
          ) : (
            <Tabla cabeceras={['Tipo', 'Intentos', 'Error', 'Cuándo']}>
              {trabajos.map((t) => (
                <tr key={t.id} data-testid={`trabajo-muerto-${t.id}`}>
                  <td className="px-2 py-1.5 text-xs font-medium">{t.tipo}</td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{t.intentos}</td>
                  <td className="px-2 py-1.5"><ErrorCorto texto={t.error} /></td>
                  <td className="px-2 py-1.5"><Momento valor={t.createdAt} /></td>
                </tr>
              ))}
            </Tabla>
          )}
          <p className="text-xs text-muted-foreground">
            Reencolar y descartar están en{' '}
            <Link href="/superadmin/integraciones" className="underline">el panel de la cola</Link>, donde ya existían
            con su auditoría. No se duplican aquí.
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Falta un tercer sitio donde algo puede quedarse sin salida: los <strong>eventos externos</strong> que la
        pasarela mandó y no se pudieron procesar. Viven en{' '}
        <Link href={`${RUTA_OPERACIONES}/inbox?status=DEAD_LETTER`} className="underline" data-testid="ir-inbox-muertos">
          el inbox, filtrado por «Sin salida»
        </Link>
        , con su propio reintento. No se traen aquí porque allí se ven junto a su pasarela, su tipo y su compra, que es
        lo que hace falta para decidir.
      </p>
    </div>
  )
}
