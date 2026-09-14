'use client'

import { Share2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

interface ShareButtonProps {
  title: string
  text: string
  /**
   * URL a compartir. Si es relativa (`/promocion/x`) se resuelve contra el
   * dominio actual; si ya es absoluta (`https://…`) se usa tal cual. Para
   * contenido público compartido desde el app conviene pasar `landingUrlFor()`
   * para que el enlace apunte a la landing y lo abra quien no tenga sesión.
   */
  path: string
  /** Se llama tras compartir con éxito (p. ej. registrar shareCount). */
  onShared?: () => void
  className?: string
  label?: string
}

/**
 * Compartir con el sistema nativo del teléfono (navigator.share) y respaldo
 * de copiar el enlace al portapapeles en escritorio.
 */
export function ShareButton({
  title,
  text,
  path,
  onShared,
  className,
  label = 'Compartir',
}: ShareButtonProps) {
  const { copied, copy } = useCopyToClipboard()

  async function handleShare() {
    const url = path.startsWith('http') ? path : `${window.location.origin}${path}`
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        onShared?.()
        return
      }
      const ok = await copy(url, {
        successMessage: 'Enlace copiado al portapapeles.',
        errorMessage: null,
      })
      if (ok) onShared?.()
      else toast.error('No se pudo compartir.')
    } catch (e) {
      // El usuario canceló el share nativo: no es un error.
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error('[share]', e)
      toast.error('No se pudo compartir.')
    }
  }

  return (
    <button
      onClick={handleShare}
      className={
        className ??
        'inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-label-lg text-muted-foreground transition-colors duration-fast hover:border-primary/40 hover:text-foreground sm:w-auto'
      }
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Share2 className="h-4 w-4" />}
      {label}
    </button>
  )
}
