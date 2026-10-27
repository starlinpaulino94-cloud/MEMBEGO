'use client'

/**
 * Atribución de marketing: generador de enlaces por canal. Cada enlace lleva
 * ?src=<canal>; al abrirlo se siembra la cookie y el registro queda atribuido.
 * Incluye QR descargable para la tarjeta impresa y canal personalizado.
 */

import { useState } from 'react'
import { Check, Copy, QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CompanyQRRegistro } from '@/components/admin/CompanyQRRegistro'
import { CANALES_PREDEFINIDOS, canalLabel, sanitizarCanal } from '@/modules/adquisicion/shared'

function FilaEnlace({ canal, url }: { canal: string; url: string }) {
  const [copiado, setCopiado] = useState(false)
  const [verQr, setVerQr] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      toast.success(`Enlace de ${canalLabel(canal)} copiado.`)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar. Selecciona y copia el enlace manualmente.')
    }
  }

  return (
    <div className="rounded-xl border border-border/60 p-3">
      {/* En un móvil el enlace va en su propia línea, debajo del canal y los botones: entre ellos quedaba reducido a «h…». */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-28 text-sm font-medium text-foreground">{canalLabel(canal)}</p>
        <code className="order-last w-full min-w-0 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
          {url}
        </code>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={copiar}>
          {copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          Copiar
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setVerQr((v) => !v)}>
          <QrCode className="h-3.5 w-3.5" /> QR
        </Button>
      </div>
      {verQr && (
        <div className="mt-3">
          <CompanyQRRegistro url={url} companySlug={canal} />
        </div>
      )}
    </div>
  )
}

export function EnlacesPromocion({ baseUrl }: { baseUrl: string }) {
  const [custom, setCustom] = useState('')
  const customCanal = sanitizarCanal(custom)
  const linkDe = (canal: string) => `${baseUrl}/?src=${canal}`

  return (
    <div className="space-y-3">
      {CANALES_PREDEFINIDOS.map((c) => (
        <FilaEnlace key={c} canal={c} url={linkDe(c)} />
      ))}

      <div className="rounded-xl border border-dashed border-border/70 p-3">
        <p className="text-sm font-medium text-foreground">Canal personalizado</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Para distinguir campañas: ej. <code>tarjeta-parque</code>, <code>feria-auto</code>,{' '}
          <code>radio</code>. Escribe el nombre y copia su enlace.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="nombre-del-canal"
            className="max-w-56"
          />
          {customCanal && <FilaEnlaceInline url={linkDe(customCanal)} />}
        </div>
      </div>
    </div>
  )
}

function FilaEnlaceInline({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <>
      <code className="order-last w-full min-w-0 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
        {url}
      </code>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopiado(true)
            toast.success('Enlace copiado.')
            setTimeout(() => setCopiado(false), 2000)
          } catch {
            toast.error('No se pudo copiar.')
          }
        }}
      >
        {copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        Copiar
      </Button>
    </>
  )
}
