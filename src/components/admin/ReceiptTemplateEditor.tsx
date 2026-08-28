'use client'

/**
 * Editor de la plantilla del comprobante (Fase E4, mejora obligatoria):
 * cada empresa personaliza su ticket — logo, encabezado, pie, orden de
 * bloques, campos opcionales y ancho de papel — SIN tocar código. Los
 * cambios se guardan como datos (receipt_templates.config) y la vista
 * previa se genera con el mismo builder que imprime el ticket real.
 */

import { useMemo, useState, useTransition } from 'react'
import {
  Loader2,
  Save,
  ArrowUp,
  ArrowDown,
  ReceiptText,
  QrCode,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  buildReceiptDoc,
  DEFAULT_RECEIPT_TEMPLATE,
  PAPER_COLS,
  type ReceiptBlockId,
  type ReceiptTemplateConfig,
} from '@/lib/receipts'
import { guardarPlantillaRecibo } from '@/modules/transacciones/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const BLOCK_LABELS: Record<ReceiptBlockId, string> = {
  encabezado: 'Encabezado (empresa, fecha, TX-ID)',
  cliente: 'Bloque del cliente',
  servicio: 'Bloque del servicio',
  qr: 'QR de la transacción',
  pie: 'Pie (mensaje, redes, políticas)',
}

const TOGGLES: { key: keyof ReceiptTemplateConfig; label: string }[] = [
  { key: 'mostrarLogo', label: 'Mostrar logo' },
  { key: 'mostrarVehiculo', label: 'Vehículo y placa' },
  { key: 'mostrarNivel', label: 'Nivel del cliente' },
  { key: 'mostrarPuntos', label: 'Puntos' },
  { key: 'mostrarPromocion', label: 'Promoción aplicada' },
  { key: 'mostrarBeneficio', label: 'Beneficio aplicado' },
  { key: 'mostrarTotales', label: 'Totales (descuento/subtotal/total)' },
  { key: 'mostrarQr', label: 'QR de consulta de la operación' },
  { key: 'mostrarPromosActivas', label: 'Promociones activas en el pie' },
]

// Transacción de muestra para la vista previa (nunca se persiste).
const SAMPLE_TX = {
  codigo: 'TX-20260711-000123',
  ticketNumero: 'TCK-000045',
  fecha: new Date('2026-07-11T15:30:00-04:00'),
  caja: 'Caja 1',
  empleado: 'empleado@tuempresa.com',
  cliente: 'Juan Pérez',
  vehiculo: 'Toyota Corolla 2022',
  placa: 'A123456',
  membresia: 'Plan Premium',
  nivel: 'Oro',
  puntos: 120,
  servicio: 'Lavado premium',
  promocion: '2x1 de verano',
  beneficio: 'Aromatizante gratis',
  restantes: 7 as const,
  observaciones: null,
  promosActivas: ['2x1 los martes', 'Referidos: 1 uso gratis'],
}

export function ReceiptTemplateEditor({
  companyId,
  initial,
  empresa,
}: {
  companyId: string
  initial: ReceiptTemplateConfig
  empresa: {
    nombre: string
    direccion?: string | null
    telefono?: string | null
    web?: string | null
    logoUrl?: string | null
  }
}) {
  const [config, setConfig] = useState<ReceiptTemplateConfig>(initial)
  const [saving, startSaving] = useTransition()

  const merged = useMemo(() => ({ ...DEFAULT_RECEIPT_TEMPLATE, ...config }), [config])

  const set = <K extends keyof ReceiptTemplateConfig>(key: K, value: ReceiptTemplateConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }))

  const moveBlock = (index: number, dir: -1 | 1) => {
    const order = [...merged.blockOrder]
    const j = index + dir
    if (j < 0 || j >= order.length) return
    ;[order[index], order[j]] = [order[j], order[index]]
    set('blockOrder', order)
  }

  // Vista previa con el MISMO builder que genera el ticket real.
  const previewDoc = useMemo(
    () =>
      buildReceiptDoc({
        empresa: { ...empresa, sucursal: 'Sucursal Principal' },
        transaccion: SAMPLE_TX,
        template: config,
      }),
    [config, empresa]
  )
  const cols = PAPER_COLS[previewDoc.paperWidthMm]

  function guardar() {
    startSaving(async () => {
      const res = await guardarPlantillaRecibo(companyId, config)
      if (res.error) toast.error(res.error)
      else toast.success('Plantilla del comprobante guardada.')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptText className="h-4 w-4 text-primary" />
          Comprobante impreso (ticket)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-5 text-sm text-muted-foreground">
          Personaliza el ticket que se imprime al registrar cada uso: encabezado,
          pie, campos visibles y orden de los bloques. La vista previa usa datos
          de ejemplo.
        </p>

        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(260px,320px)]">
          {/* ── Formulario ── */}
          <div className="space-y-6">
            {/* Papel */}
            <div className="space-y-2">
              <Label className="text-xs">Ancho del papel</Label>
              <div className="flex gap-2">
                {([58, 80] as const).map((mm) => (
                  <Button
                    key={mm}
                    type="button"
                    variant={merged.paperWidthMm === mm ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => set('paperWidthMm', mm)}
                  >
                    {mm} mm
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                80 mm es el estándar de impresoras POS (p. ej. 2Connect POS80); 58 mm
                para impresoras compactas.
              </p>
            </div>

            {/* Encabezado */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rt-rnc" className="text-xs">RNC / identificador fiscal (opcional)</Label>
                <Input
                  id="rt-rnc"
                  value={config.rnc ?? ''}
                  onChange={(e) => set('rnc', e.target.value || undefined)}
                  placeholder="Ej. 1-31-12345-6"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-web" className="text-xs">Web en el pie (opcional)</Label>
                <Input
                  id="rt-web"
                  value={config.web ?? ''}
                  onChange={(e) => set('web', e.target.value || undefined)}
                  placeholder="www.tuempresa.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-encabezado" className="text-xs">
                Líneas extra del encabezado (una por línea, máx. 4)
              </Label>
              <Textarea
                id="rt-encabezado"
                rows={2}
                value={(config.lineasEncabezado ?? []).join('\n')}
                onChange={(e) =>
                  set(
                    'lineasEncabezado',
                    e.target.value ? e.target.value.split('\n').slice(0, 4) : undefined
                  )
                }
                placeholder={'Ej. Av. Principal #12\nHorario: L-S 8am-6pm'}
              />
            </div>

            {/* Pie */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rt-pie" className="text-xs">Mensaje de agradecimiento</Label>
                <Input
                  id="rt-pie"
                  value={config.mensajePie ?? ''}
                  onChange={(e) => set('mensajePie', e.target.value || undefined)}
                  placeholder={DEFAULT_RECEIPT_TEMPLATE.mensajePie}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-redes" className="text-xs">Redes sociales (opcional)</Label>
                <Input
                  id="rt-redes"
                  value={config.redes ?? ''}
                  onChange={(e) => set('redes', e.target.value || undefined)}
                  placeholder="@tuempresa · IG/FB"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-proxima" className="text-xs">Próxima visita (opcional)</Label>
                <Input
                  id="rt-proxima"
                  value={config.proximaVisita ?? ''}
                  onChange={(e) => set('proximaVisita', e.target.value || undefined)}
                  placeholder="¡Te esperamos pronto!"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-politicas" className="text-xs">Políticas (opcional)</Label>
                <Input
                  id="rt-politicas"
                  value={config.politicas ?? ''}
                  onChange={(e) => set('politicas', e.target.value || undefined)}
                  placeholder="No válido como comprobante fiscal"
                />
              </div>
            </div>

            {/* Campos visibles */}
            <div className="space-y-2">
              <Label className="text-xs">Campos visibles</Label>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {TOGGLES.map((t) => (
                  <label key={t.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{t.label}</span>
                    <Switch
                      checked={Boolean(merged[t.key])}
                      onCheckedChange={(v) => set(t.key, v as never)}
                      aria-label={t.label}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Orden de bloques */}
            <div className="space-y-2">
              <Label className="text-xs">Orden de los bloques</Label>
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
                {merged.blockOrder.map((b, i) => (
                  <li key={b} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-foreground">{BLOCK_LABELS[b]}</span>
                    <span className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === 0}
                        onClick={() => moveBlock(i, -1)}
                        aria-label={`Subir ${BLOCK_LABELS[b]}`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === merged.blockOrder.length - 1}
                        onClick={() => moveBlock(i, 1)}
                        aria-label={`Bajar ${BLOCK_LABELS[b]}`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <Button onClick={guardar} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar plantilla
            </Button>
          </div>

          {/* ── Vista previa ── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Vista previa ({previewDoc.paperWidthMm} mm)
            </p>
            <div
              className={cn(
                'mx-auto overflow-hidden rounded-lg border border-border bg-white p-3 font-mono text-xs leading-[1.5] text-foreground shadow-inner',
                previewDoc.paperWidthMm === 58 ? 'max-w-[220px]' : 'max-w-[300px]'
              )}
            >
              {previewDoc.lines.map((line, i) => {
                switch (line.kind) {
                  case 'text':
                    return (
                      <div
                        key={i}
                        className={cn(
                          line.align === 'center' && 'text-center',
                          line.align === 'right' && 'text-right',
                          line.bold && 'font-bold',
                          'break-words'
                        )}
                        style={line.size === 'double' ? { fontSize: '1.35em' } : undefined}
                      >
                        {line.text}
                      </div>
                    )
                  case 'pair':
                    return (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="shrink-0">{line.label}:</span>
                        <span className={cn('break-all text-right', line.boldValue && 'font-bold')}>
                          {line.value}
                        </span>
                      </div>
                    )
                  case 'separator':
                    return (
                      <div key={i} className="overflow-hidden whitespace-nowrap">
                        {(line.char ?? '-').repeat(cols)}
                      </div>
                    )
                  case 'qr':
                    return (
                      <div key={i} className="my-1 text-center">
                        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded border border-dashed border-border">
                          <QrCode className="h-8 w-8 text-muted-foreground" />
                        </span>
                        {line.caption && <div className="text-[0.85em]">{line.caption}</div>}
                      </div>
                    )
                  case 'logo':
                    return empresa.logoUrl ? (
                      <div key={i} className="mb-1 text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={empresa.logoUrl} alt="" className="mx-auto max-h-10 object-contain grayscale" />
                      </div>
                    ) : (
                      <div key={i} className="mb-1 text-center text-muted-foreground">[logo]</div>
                    )
                  case 'feed':
                    return <div key={i} style={{ height: `${(line.lines ?? 1) * 0.8}em` }} />
                  default:
                    return null
                }
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
