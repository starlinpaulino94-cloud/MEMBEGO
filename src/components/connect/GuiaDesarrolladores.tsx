import { INVENTARIO_API, TIPO_V2 } from '@membego/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Guía para quien va a integrar (Connect · Fase 8).
 *
 * Todo lo que aparece aquí sale del INVENTARIO y del catálogo de eventos, no
 * de una lista escrita en este archivo. Una documentación copiada a mano se
 * separa del código a la tercera semana, y entonces es peor que no tenerla:
 * quien integra confía en ella y falla por una razón que no está en ningún
 * sitio. Una prueba compara el inventario con las rutas reales, así que esto
 * no puede quedarse viejo.
 *
 * Es servidor: no hay estado ni interacción. Solo lectura.
 */

/** Los recursos que una clave de empresa puede usar, agrupados por área. */
function porArea() {
  const grupos = new Map<string, typeof INVENTARIO_API[number][]>()
  for (const r of INVENTARIO_API) {
    if (r.principal !== 'sistema-o-empresa') continue
    const area = r.ruta.split('/').filter(Boolean)[0] ?? 'general'
    grupos.set(area, [...(grupos.get(area) ?? []), r])
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children}
    </section>
  )
}

function Codigo({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-muted px-3 py-2 font-mono text-caption">
      <code>{children}</code>
    </pre>
  )
}

export function GuiaDesarrolladores({ base }: { base: string }) {
  const areas = porArea()
  const eventos = Object.values(TIPO_V2)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Para tu desarrollador</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-caption text-muted-foreground">
          Con una clave de API puedes consultar los datos de tu empresa desde cualquier
          herramienta. Todo lo de abajo sale del propio código: si algo cambia, esta página
          cambia con ello.
        </p>

        <Bloque titulo="1. Autenticación">
          <p className="text-caption text-muted-foreground">
            Manda tu clave como <span className="font-mono">Bearer</span>. La empresa va atada a la
            clave, así que no hace falta indicarla.
          </p>
          <Codigo>{`curl "${base}/api/platform/v1/customers/search?q=809" \\
  -H "Authorization: Bearer mbk_xxxxxxxxxxxx.tu-secreto"`}</Codigo>
        </Bloque>

        <Bloque titulo="2. Qué puedes consultar">
          <ul className="space-y-3">
            {areas.map(([area, recursos]) => (
              <li key={area}>
                <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                  {area}
                </p>
                <ul className="mt-1 space-y-1">
                  {recursos.map((r) => (
                    <li key={`${r.metodo} ${r.ruta}`} className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{r.metodo}</Badge>
                      <span className="font-mono text-caption">{r.ruta}</span>
                      {r.scope && (
                        <span className="font-mono text-caption text-muted-foreground">
                          {r.scope}
                        </span>
                      )}
                      <span className="w-full text-caption text-muted-foreground">{r.resumen}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Bloque>

        <Bloque titulo="3. Especificación completa (OpenAPI)">
          <p className="text-caption text-muted-foreground">
            Impórtala en Postman, Zapier o Make. No necesita credenciales para leerse.
          </p>
          <Codigo>{`${base}/api/platform/v1/openapi`}</Codigo>
        </Bloque>

        <Bloque titulo="4. Verificar la firma de un webhook">
          <p className="text-caption text-muted-foreground">
            Cada aviso llega firmado con el secreto de tu webhook. Compruébalo antes de fiarte del
            contenido — sin esta comprobación, cualquiera que conozca tu URL puede mandarte datos
            falsos.
          </p>
          <Codigo>{`import { createHmac, timingSafeEqual } from 'node:crypto'

// El cuerpo CRUDO, tal cual llegó: si lo parseas y lo vuelves a serializar,
// cualquier diferencia de formato rompe la firma de un aviso legítimo.
function firmaValida(cuerpoCrudo, cabecera, secreto) {
  const esperada = createHmac('sha256', secreto).update(cuerpoCrudo, 'utf8').digest()
  const recibida = Buffer.from(cabecera ?? '', 'hex')
  return (
    recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
  )
}

// cabecera: X-Membego-Signature`}</Codigo>
        </Bloque>

        <Bloque titulo="5. Eventos que puedes recibir">
          <div className="flex flex-wrap gap-1">
            {eventos.map((e) => (
              <span key={e} className="rounded-lg bg-muted px-2 py-1 font-mono text-caption">
                {e}
              </span>
            ))}
          </div>
          <p className="text-caption text-muted-foreground">
            Los que nacen de tus automatizaciones llegan como{' '}
            <span className="font-mono">automation.&lt;nombre&gt;</span>.
          </p>
        </Bloque>
      </CardContent>
    </Card>
  )
}
