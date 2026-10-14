'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { importarConteo, previsualizarConteoImportado, type InformeVista } from '@/modules/inventory/actions'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Tamaño máximo del archivo; el servidor lo vuelve a comprobar. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Cargar en el conteo abierto lo contado en una hoja (CSV), en dos pasos y TODO O
 * NADA: «Revisar» explica fila por fila sin escribir nada; «Cargar» solo aparece
 * con el archivo limpio y el servidor vuelve a leerlo y validarlo. Las celdas de
 * `contado` vacías significan «no se contó» y no se tocan.
 */
export function ImportarConteoForm({ conteoId }: { conteoId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string } | null>(null)
  const [informe, setInforme] = useState<InformeVista | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  async function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    setInforme(null)
    if (!f) {
      setArchivo(null)
      return
    }
    if (f.size > MAX_BYTES) {
      toast.error('El archivo pasa de 2 MB. Divídelo en varios.')
      setArchivo(null)
      if (entrada.current) entrada.current.value = ''
      return
    }
    setArchivo({ nombre: f.name, texto: await f.text() })
  }

  function revisar() {
    if (!archivo) return
    start(async () => {
      const r = await previsualizarConteoImportado({ texto: archivo.texto })
      if (!r.ok) {
        setInforme(null)
        toast.error(r.error)
        return
      }
      setInforme(r.informe)
    })
  }

  function cargar() {
    if (!archivo || !informe?.ok) return
    start(async () => {
      const r = await importarConteo({ conteoId, texto: archivo.texto })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (!r.aplicada) {
        setInforme(r.informe)
        toast.error('El archivo tiene filas con problemas. No se cargó nada.')
        return
      }
      toast.success(`Se cargaron ${formatearCantidad(r.nuevas + r.reemplazadas)} productos (${formatearCantidad(r.nuevas)} nuevos, ${formatearCantidad(r.reemplazadas)} reemplazados).`)
      router.push(`/admin/inventario/conteos/${conteoId}`)
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            1 · Elige la hoja contada
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ci-archivo">Archivo CSV</Label>
            <Input id="ci-archivo" ref={entrada} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={alElegirArchivo} />
            <p className="text-xs text-muted-foreground">
              Columnas: <code>sku</code> o <code>codigo_de_barras</code>, y <code>contado</code> (entero; 0 si lo buscaste y no hay). Deja vacía la celda de lo que no contaste. Hasta 1.000 productos con algo contado. Un producto que ya
              tenía línea en este conteo se reemplaza.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={revisar} disabled={!archivo || pending}>
              {pending && !informe && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Revisar archivo
            </Button>
            <BotonExportar href={`/admin/inventario/conteos/${conteoId}/hoja`} label="Descargar hoja en blanco" variant="outline" size="sm" />
            {archivo && <span className="text-xs text-muted-foreground">{archivo.nombre}</span>}
          </div>
        </CardContent>
      </Card>

      {informe && (
        <Card aria-label="Resultado de la revisión">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2 · Resultado de la revisión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Filas leídas</p>
                <p className="text-lg font-semibold tabular-nums">{formatearCantidad(informe.filasLeidas)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Con algo contado</p>
                <p className="text-lg font-semibold tabular-nums">{formatearCantidad(informe.productos)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sin contar (se ignoran)</p>
                <p className="text-lg font-semibold tabular-nums">{formatearCantidad(informe.omitidas ?? 0)}</p>
              </div>
            </div>

            {informe.totalErrores > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium">
                    {formatearCantidad(informe.totalErrores)} fila{informe.totalErrores === 1 ? '' : 's'} con problemas. No se carga nada hasta que el archivo esté limpio: corrígelo y vuelve a subirlo.
                  </p>
                  <ul className="mt-2 max-h-72 list-disc space-y-1 overflow-auto pl-5 text-sm" aria-label="Filas con problemas">
                    {informe.errores.map((e, i) => (
                      <li key={`${e.fila}-${i}`}>
                        {e.fila > 0 && <strong>Fila {e.fila}: </strong>}
                        {e.mensaje}
                      </li>
                    ))}
                  </ul>
                  {informe.totalErrores > informe.errores.length && <p className="mt-2 text-xs">Y {formatearCantidad(informe.totalErrores - informe.errores.length)} más.</p>}
                </AlertDescription>
              </Alert>
            ) : informe.productos === 0 ? (
              <Alert>
                <AlertDescription>El archivo no trae ningún producto con algo contado. Escribe lo contado en la columna «contado».</AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertDescription>El archivo está limpio. Revisa que los nombres sean los productos que esperabas (Excel a veces se come los ceros de un código) y cárgalo.</AlertDescription>
              </Alert>
            )}

            {informe.avisos.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" aria-label="Avisos">
                {informe.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}

            {informe.vistaPrevia.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  Lo que se cargaría
                  {informe.productos > informe.vistaPrevia.length && <Badge variant="outline">primeras {informe.vistaPrevia.length}</Badge>}
                </p>
                <ul className="divide-y rounded-lg border text-sm" aria-label="Vista previa de lo contado">
                  {informe.vistaPrevia.map((l) => (
                    <li key={l.fila} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                      <span>
                        {l.nombre} <span className="text-xs text-muted-foreground">SKU {l.sku} · fila {l.fila}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{formatearCantidad(l.cantidad)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {informe.ok && (
              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Button type="button" onClick={cargar} disabled={pending}>
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  Cargar {formatearCantidad(informe.productos)} producto{informe.productos === 1 ? '' : 's'} contado{informe.productos === 1 ? '' : 's'}
                </Button>
                <p className="text-xs text-muted-foreground">Todavía no se ajusta ninguna existencia: eso pasa al aplicar el conteo.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
