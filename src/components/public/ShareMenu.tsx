'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, Check, Link2, Mail, MessageCircle, Send } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

export interface ShareMenuProps {
  /** Título del contenido a compartir. */
  title: string
  /** Texto que acompaña al enlace. */
  text: string
  /**
   * URL a compartir. Relativa (`/promocion/x`) se resuelve contra el dominio
   * actual; absoluta (`https://…`) se usa tal cual. Para contenido público
   * compartido desde el app, pasar `landingUrlFor()`.
   */
  path: string
  /** Se llama tras compartir con éxito (p. ej. registrar un contador). */
  onShared?: () => void
  label?: string
}

/**
 * Fase E8 · Compartir como acción primaria (genérico, reutilizable para
 * promociones y planes). En móvil usa el sistema nativo (navigator.share);
 * en escritorio abre un menú con las redes más usadas (Copiar enlace,
 * WhatsApp, Facebook, Telegram, Email, X, LinkedIn).
 */
export function ShareMenu({ title, text, path, onShared, label = 'Compartir' }: ShareMenuProps) {
  const [open, setOpen] = useState(false)
  const { copied, copy } = useCopyToClipboard()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function fullUrl() {
    return path.startsWith('http') ? path : `${window.location.origin}${path}`
  }

  async function handlePrimary() {
    const url = fullUrl()
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url })
        onShared?.()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        console.error('[share]', e)
      }
      return
    }
    setOpen((v) => !v)
  }

  async function copiar() {
    const ok = await copy(fullUrl())
    if (ok) {
      onShared?.()
      setOpen(false)
    }
  }

  function abrir(destino: string) {
    window.open(destino, '_blank', 'noopener,noreferrer')
    onShared?.()
    setOpen(false)
  }

  const url = typeof window !== 'undefined' ? fullUrl() : path
  const eUrl = encodeURIComponent(url)
  const eText = encodeURIComponent(text)

  const redes: { key: string; label: string; icon: React.ReactNode; onClick: () => void }[] = [
    {
      key: 'copiar',
      label: copied ? 'Enlace copiado' : 'Copiar enlace',
      icon: copied ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />,
      onClick: copiar,
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      icon: <MessageCircle className="h-4 w-4 text-[#25D366]" />,
      onClick: () => abrir(`https://wa.me/?text=${eText}%20${eUrl}`),
    },
    {
      key: 'facebook',
      label: 'Facebook',
      icon: <BrandGlyph label="f" bg="#1877F2" />,
      onClick: () => abrir(`https://www.facebook.com/sharer/sharer.php?u=${eUrl}`),
    },
    {
      key: 'telegram',
      label: 'Telegram',
      icon: <Send className="h-4 w-4 text-[#26A5E4]" />,
      onClick: () => abrir(`https://t.me/share/url?url=${eUrl}&text=${eText}`),
    },
    {
      key: 'email',
      label: 'Email',
      icon: <Mail className="h-4 w-4 text-muted-foreground" />,
      onClick: () => abrir(`mailto:?subject=${encodeURIComponent(title)}&body=${eText}%0A%0A${eUrl}`),
    },
    {
      key: 'x',
      label: 'X',
      icon: <BrandGlyph label="𝕏" bg="#0F172A" />,
      onClick: () => abrir(`https://twitter.com/intent/tweet?text=${eText}&url=${eUrl}`),
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      icon: <BrandGlyph label="in" bg="#0A66C2" />,
      onClick: () => abrir(`https://www.linkedin.com/sharing/share-offsite/?url=${eUrl}`),
    },
  ]

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={handlePrimary}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 font-bold text-primary-foreground shadow-premium transition hover:opacity-95 sm:w-auto"
      >
        <Share2 className="h-5 w-5" />
        {label}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-2 w-60 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-premium"
        >
          {redes.map((r) => (
            <button
              key={r.key}
              role="menuitem"
              onClick={r.onClick}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition hover:bg-muted"
            >
              <span className="flex h-6 w-6 items-center justify-center">{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Insignia cuadrada con la letra de la marca (para redes sin icono en lucide). */
function BrandGlyph({ label, bg }: { label: string; bg: string }) {
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded text-caption font-bold text-white"
      style={{ backgroundColor: bg }}
    >
      {label}
    </span>
  )
}
