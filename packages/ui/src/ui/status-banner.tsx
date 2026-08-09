import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '../cn'

type StatusVariant = 'success' | 'warning' | 'info' | 'destructive'

const VARIANT: Record<StatusVariant, { icon: LucideIcon; box: string; icono: string; titulo: string }> = {
  success: {
    icon: CheckCircle2,
    box: 'border-success/25 bg-success/10',
    icono: 'text-success',
    titulo: 'text-success',
  },
  warning: {
    icon: AlertTriangle,
    box: 'border-warning/30 bg-warning/15',
    icono: 'text-warning',
    titulo: 'text-warning',
  },
  info: {
    icon: Info,
    box: 'border-info/25 bg-info/10',
    icono: 'text-info',
    titulo: 'text-info',
  },
  destructive: {
    icon: XCircle,
    box: 'border-destructive/25 bg-destructive/10',
    icono: 'text-destructive',
    titulo: 'text-destructive',
  },
}

export interface StatusBannerProps {
  variant: StatusVariant
  title: string
  children?: React.ReactNode
  /** Acción opcional (Button/Link) alineada a la derecha. */
  action?: React.ReactNode
  /** Icono alternativo al de la variante. */
  icon?: LucideIcon
  className?: string
}

/**
 * Banner de estado del design system. Único componente permitido para avisos
 * contextuales de página (éxito/advertencia/información/error) — reemplaza los
 * banners ad-hoc con paleta cruda.
 */
export function StatusBanner({
  variant,
  title,
  children,
  action,
  icon,
  className,
}: StatusBannerProps) {
  const v = VARIANT[variant]
  const Icon = icon ?? v.icon
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm', v.box, className)}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', v.icono)} />
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', v.titulo)}>{title}</p>
        {children && <div className="mt-0.5 text-foreground/80">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
