'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { aplicarImportacion, previsualizarImportacion, type InformeVista } from '@/modules/inventory/actions'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import type { SucursalOpcionForm } from './EntradaMultipleForm'

/** Tamaño máximo del archivo; el servidor lo vuelve a comprobar (`MAX_CARACTERES_IMPORTACION`). */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Importar existencias desde un CSV, en dos pasos y TODO O NADA:
 *
 *   1. «Revisar»: el servidor lee el archivo y dice, fila por fila, qué
 *      encontró y qué falla. No escribe nada.
 *   2. «Registrar»: solo si no hay un solo error. El servidor vuelve a leer y a
 *      validar el archivo (no se fía de la revisión que viajó por el navegador).
 */
export function ImportarForm({ sucursales, conCostos = false }: { sucursales: SucursalOpcionForm[]; conCostos?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '')
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string } | null>(null)
  const [informe, setInforme] = useState<InformeVista | null>(null)
  const clave = useRef(nuevaClave())
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
    // Un archivo nuevo es una operación nueva: otra clave de idempotencia.
    clave.current = nuevaClave()
  }

  function revisar() {
    if (!archivo) return
    start(async () => {
      const r = await previsualizarImportacion({ texto: archivo.texto })
      if (!r.ok) {
        setInforme(null)
        toast.error(r.error)
        return
      }
      setInforme(r.informe)
    })
  }

  function registrar() {
    if (!archivo || !informe?.ok) return
    start(async () => {
      const r = await aplicarImportacion({ sucursalId, texto: archivo.texto, referencia, clave: clave.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (!r.aplicada) {
        setInforme(r.informe)
        toast.error('El archivo tiene filas con problemas. No se registró nada.')
        return
      }
      toast.success(`Entrada ${r.entrada.numero} registrada: ${formatearCantidad(r.entrada.unidades)} unidades.`)
      router.push(`/admin/inventario/entradas/${r.entrada.entradaId}`)
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  const sucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? ''
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            1 · Elige la sucursal y el archivo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="im-sucursal">Sucursal que recibe</Label>
              <select id="im-sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campo}>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="im-referencia">Referencia (opcional)</Label>
              <Input id="im-referencia" value={referencia} maxLength={120} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej: Inventario inicial octubre" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="im-archivo">Archivo CSV</Label>
            <Input id="im-archivo" ref={entrada} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={alElegirArchivo} />
            <p className="text-xs text-muted-foreground">
              Columnas: <code>sku</code> o <code>codigo_de_barras</code>, y <code>cantidad</code> (entero)
              {conCostos && (
                <>
                  , y <code>costo</code> unitario opcional (sin impuestos, con punto decimal; vacío = sin costo)
                </>
              )}
              . Separado por punto y coma o coma. Hasta 1.000 filas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={revisar} disabled={!archivo || pending}>
              {pending && !informe && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Revisar archivo
            </Button>
            <BotonExportar href="/admin/inventario/importar/plantilla" label="Descargar plantilla" variant="outline" size="sm" />
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
                <p className="text-xs text-muted-foreground">Productos</p>
                <p className="text-lg font-semibold tabular-nums">{formatearCantidad(informe.productos)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Unidades</p>
                <p className="text-lg font-semibold tabular-nums">{formatearCantidad(informe.unidades)}</p>
              </div>
            </div>

            {informe.totalErrores > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium">
                    {formatearCantidad(informe.totalErrores)} fila{informe.totalErrores === 1 ? '' : 's'} con problemas. No se registra nada hasta que el archivo esté limpio: corrígelo y vuelve a subirlo.
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
            ) : (
              <Alert>
                <AlertDescription>
                  El archivo está limpio. Revisa que los nombres sean los productos que esperabas (Excel a veces se come los ceros de un código) y registra la entrada.
                  {informe.conCosto !== undefined && ` ${formatearCantidad(informe.conCosto)} de ${formatearCantidad(informe.productos)} línea${informe.productos === 1 ? '' : 's'} traen costo; las demás entran sin él y no cambian el costo promedio.`}
                </AlertDescription>
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
                  Lo que entraría
                  {informe.productos > informe.vistaPrevia.length && <Badge variant="outline">primeras {informe.vistaPrevia.length}</Badge>}
                </p>
                <ul className="divide-y rounded-lg border text-sm" aria-label="Vista previa de la entrada">
                  {informe.vistaPrevia.map((l) => (
                    <li key={l.fila} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                      <span>
                        {l.nombre} <span className="text-xs text-muted-foreground">SKU {l.sku} · fila {l.fila}</span>
                      </span>
                      <span className="text-right">
                        <span className="font-semibold tabular-nums text-success">+{formatearCantidad(l.cantidad)}</span>
                        {l.costo !== undefined && <span className="block text-xs text-muted-foreground">a {l.costo} c/u</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {informe.ok && (
              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Button type="button" onClick={registrar} disabled={pending}>
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  Registrar entrada de {formatearCantidad(informe.productos)} producto{informe.productos === 1 ? '' : 's'} en {sucursal}
                </Button>
                <p className="text-xs text-muted-foreground">Se registra todo junto. Una entrada registrada no se edita.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
