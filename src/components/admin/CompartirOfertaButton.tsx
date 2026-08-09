'use client'

import { useState } from 'react'
import { Share2, Copy, Check, MessageCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

interface CompartirOfertaButtonProps {
  /** Ruta pública relativa (se resuelve contra el dominio actual). */
  path: string
  titulo: string
  /** Texto que acompaña al enlace (WhatsApp / share nativo). */
  texto: string
  /**
   * Aviso cuando el enlace no será visible para todo el mundo (promoción
   * pausada, privada, publicación oculta…). Se muestra en el menú; compartir
   * sigue permitido (p. ej. promos privadas para clientes con cuenta).
   */
  advertencia?: string | null
  /** 'icon' = botón compacto para filas; 'full' = botón con etiqueta. */
  variant?: 'icon' | 'full'
  /** Etiqueta del botón en variant='full'. */
  label?: string
}

/**
 * Compartir una oferta (promoción, publicación, planes, perfil) desde el
 * panel admin: WhatsApp, share nativo del dispositivo o copiar el enlace.
 */
export function CompartirOfertaButton({
  path,
  titulo,
  texto,
  advertencia = null,
  variant = 'icon',
  label = 'Compartir',
}: CompartirOfertaButtonProps) {
  const [open, setOpen] = useState(false)
  const { copied, copy } = useCopyToClipboard()

  const url = () => `${window.location.origin}${path}`
  const mensaje = () => `${texto} ${url()}`

  async function compartirNativo() {
    setOpen(false)
    try {
      if (navigator.share) {
        await navigator.share({ title: titulo, text: texto, url: url() })
        return
      }
      await copiar()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.error('No se pudo compartir.')
    }
  }

  async function copiar() {
    setOpen(false)
    await copy(url(), { successMessage: 'Enlace copiado.' })
  }

  function whatsapp() {
    setOpen(false)
    window.open(
      `https://wa.me/?text=${encodeURIComponent(mensaje())}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Compartir"
        aria-label="Compartir"
        className={
          variant === 'icon'
            ? 'inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground'
            : 'inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted'
        }
      >
        {copied ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        {variant === 'full' && label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-border bg-popover py-1.5 shadow-lg">
            {advertencia && (
              <p className="mx-2 mb-1 flex items-start gap-1.5 rounded-lg bg-warning/15 px-2.5 py-2 text-xs text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {advertencia}
              </p>
            )}
            <button
              onClick={whatsapp}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-foreground transition hover:bg-muted"
            >
              <MessageCircle className="h-4 w-4 text-success" /> Enviar por WhatsApp
            </button>
            <button
              onClick={compartirNativo}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-foreground transition hover:bg-muted"
            >
              <Share2 className="h-4 w-4 text-primary" /> Compartir…
            </button>
            <button
              onClick={copiar}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-foreground transition hover:bg-muted"
            >
              <Copy className="h-4 w-4 text-muted-foreground" /> Copiar enlace
            </button>
          </div>
        </>
      )}
    </div>
  )
}
