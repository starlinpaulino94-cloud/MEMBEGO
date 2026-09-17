import {
  CABECERA_ENTREGA,
  CABECERA_FIRMA_EMPRESA,
  CABECERA_FIRMA_EMPRESA_V2,
  CABECERA_TIMESTAMP,
  INVENTARIO_API,
  TIPO_V2,
  VENTANA_REPLAY_SEGUNDOS,
} from '@membego/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BloqueCodigo } from '@/components/connect/BloqueCodigo'

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
 * Es servidor: no hay estado ni interacción. Solo lectura. Los bloques de
 * código vienen de `BloqueCodigo`, que es el único dueño de ese estilo (y del
 * botón de copiar, que sí es cliente).
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

export function GuiaDesarrolladores({ base }: { base: string }) {
  const areas = porArea()
  const eventos = Object.values(TIPO_V2)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">Para tu desarrollador</CardTitle>
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
          <BloqueCodigo
            codigo={`curl "${base}/api/platform/v1/customers/search?q=809" \\
  -H "Authorization: Bearer mbk_xxxxxxxxxxxx.tu-secreto"`}
          />
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
                      {/* `break-all`: una ruta con parámetros es más larga que
                          la pantalla de un teléfono y desbordaba la tarjeta. */}
                      <span className="break-all font-mono text-caption">{r.ruta}</span>
                      {r.scope && (
                        <span className="break-all font-mono text-caption text-muted-foreground">
                          {r.scope}
                        </span>
                      )}
                      {r.paginado && <Badge variant="outline">paginado</Badge>}
                      <span className="w-full text-caption text-muted-foreground">{r.resumen}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-muted-foreground">
            Los listados marcados <strong>paginado</strong> devuelven como mucho 50 filas (hasta
            200 con <code className="font-mono">?limit=</code>) y un bloque{' '}
            <code className="font-mono">page</code>. Si trae{' '}
            <code className="font-mono">page.nextCursor</code>, hay más: vuelve a pedir la misma
            ruta con <code className="font-mono">?cursor=</code> ese valor hasta que{' '}
            <code className="font-mono">nextCursor</code> sea <code className="font-mono">null</code>.
            No construyas el cursor a mano: es opaco y su formato puede cambiar.
          </p>
          <BloqueCodigo
            codigo={`# Primera página
curl -H "Authorization: Bearer mbk_xxxxxxxxxxxx.tu-secreto" \\
  "${base}/api/platform/v1/appointments?limit=50"

# La respuesta: { "appointments": [...], "page": { "limit": 50, "nextCursor": "mbc1..." } }
# Siguiente página (si nextCursor no es null):
curl -H "Authorization: Bearer mbk_xxxxxxxxxxxx.tu-secreto" \\
  "${base}/api/platform/v1/appointments?limit=50&cursor=mbc1..."`}
          />
        </Bloque>

        <Bloque titulo="3. Especificación completa (OpenAPI)">
          <p className="text-caption text-muted-foreground">
            Impórtala en Postman, Zapier o Make. No necesita credenciales para leerse.
          </p>
          <BloqueCodigo codigo={`${base}/api/platform/v1/openapi`} />
        </Bloque>

        <Bloque titulo="4. Verificar la firma de un webhook">
          <p className="text-caption text-muted-foreground">
            Cada aviso llega firmado con el secreto de tu webhook. Compruébalo antes de fiarte del
            contenido — sin esta comprobación, cualquiera que conozca tu URL puede mandarte datos
            falsos.
          </p>
          <p className="text-caption text-muted-foreground">
            La firma cubre el momento del envío y el identificador de la entrega, además del
            cuerpo. Por eso hay que comprobar también que el aviso es <strong>reciente</strong>:
            sin eso, un aviso tuyo que alguien capture hoy se te puede volver a mandar mañana.
          </p>
          <BloqueCodigo
            codigo={`import { createHmac, timingSafeEqual } from 'node:crypto'

// El cuerpo CRUDO, tal cual llegó: si lo parseas y lo vuelves a serializar,
// cualquier diferencia de formato rompe la firma de un aviso legítimo.
// En Express: express.raw({ type: 'application/json' }) ANTES de express.json().
function avisoValido(cuerpoCrudo, cabeceras, secreto) {
  const ts = Number(cabeceras['${CABECERA_TIMESTAMP.toLowerCase()}'])
  const entrega = cabeceras['${CABECERA_ENTREGA.toLowerCase()}']
  if (!ts || !entrega) return false

  // 1. ¿Es reciente? ${VENTANA_REPLAY_SEGUNDOS} s de margen, por si los relojes no coinciden.
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > ${VENTANA_REPLAY_SEGUNDOS}) return false

  // 2. ¿La firma cuadra? Se firma el timestamp, la entrega y el cuerpo, unidos
  //    por puntos y en ese orden.
  const material = \`\${ts}.\${entrega}.\${cuerpoCrudo}\`
  const esperada = createHmac('sha256', secreto).update(material, 'utf8').digest()

  // La cabecera trae una LISTA separada por comas. Normalmente una sola firma;
  // durante una rotación de secreto, dos. Acepta si alguna cuadra con el
  // secreto que tengas: así una rotación no te obliga a desplegar a la vez que
  // nosotros. Recórrela desde el primer día aunque hoy venga una.
  const firmas = (cabeceras['${CABECERA_FIRMA_EMPRESA_V2.toLowerCase()}'] ?? '').split(',')
  const alguna = firmas.some((f) => {
    const recibida = Buffer.from(f.trim(), 'hex')
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
  })
  if (!alguna) return false

  // 3. ¿Ya lo procesaste? Guarda los ids de entrega que ya viste: reintentamos,
  //    así que el mismo aviso puede llegarte más de una vez.
  return true
}`}
          />
          <p className="text-caption text-muted-foreground">
            Si ya verificabas con <code className="font-mono">{CABECERA_FIRMA_EMPRESA}</code> (el
            cuerpo a secas), sigue funcionando: mandamos las dos mientras dure el cambio. Pero esa
            no protege contra un aviso repetido, así que migra a la de arriba y avísanos cuando lo
            hayas hecho.
          </p>
          <p className="text-caption text-muted-foreground">
            <strong>Y una razón más para migrar:</strong> la cabecera de arriba admite varias
            firmas, así que cuando rotes el secreto te seguimos firmando con el viejo y con el
            nuevo durante unos días y no se te cae nada. La antigua solo lleva una firma —la del
            secreto vigente—, de modo que con ella una rotación sí te corta el día que vence el
            plazo.
          </p>
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
