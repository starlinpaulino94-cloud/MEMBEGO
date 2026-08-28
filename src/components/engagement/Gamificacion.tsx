import Link from 'next/link'
import {
  Sparkles,
  Gift,
  CheckCircle2,
  Crown,
  Users,
  Layers,
  Flame,
  Trophy,
  Lock,
  RotateCw,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import type { GamificacionData, LogroData } from '@/modules/engagement/gamificacion'

const ICONOS: Record<LogroData['icono'], LucideIcon> = {
  sparkles: Sparkles,
  gift: Gift,
  check: CheckCircle2,
  crown: Crown,
  users: Users,
  layers: Layers,
  flame: Flame,
}

function LogroBadge({ logro }: { logro: LogroData }) {
  const Icon = ICONOS[logro.icono] ?? Sparkles
  const enProgreso = !logro.desbloqueado && logro.objetivo > 1
  return (
    <div
      className={`flex w-20 shrink-0 flex-col items-center gap-1.5 text-center ${
        logro.desbloqueado ? '' : 'opacity-55'
      }`}
      title={`${logro.nombre} — ${logro.desc}`}
    >
      <span
        className={`relative flex h-12 w-12 items-center justify-center rounded-2xl ${
          logro.desbloqueado
            ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md'
            : 'border border-dashed border-border bg-muted/40 text-muted-foreground'
        }`}
      >
        <Icon className="h-6 w-6" />
        {!logro.desbloqueado && (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-card">
            <Lock className="h-2.5 w-2.5" />
          </span>
        )}
      </span>
      <span className="text-xs font-semibold leading-tight text-foreground">{logro.nombre}</span>
      {enProgreso && (
        <span className="text-xs text-muted-foreground">
          {logro.valor}/{logro.objetivo}
        </span>
      )}
    </div>
  )
}

/**
 * Engagement Engine · Fase 6A — Tarjeta de gamificación (datos reales).
 * Muestra nivel, puntos, progreso al siguiente nivel y logros. Los puntos se
 * derivan de hechos reales, así que la tarjeta siempre es honesta.
 */
export function Gamificacion({ data, color }: { data: GamificacionData; color?: string }) {
  const { nivel, puntos, siguiente, progreso, faltan, logros } = data
  const accent = color || '#0ea5e9'

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      {/* Cabecera: nivel + puntos */}
      <div
        className="relative overflow-hidden p-5 text-white"
        style={{ background: `linear-gradient(120deg, ${nivel.color}, ${nivel.color}bb)` }}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-3xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              <Trophy className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/80">
                Nivel {nivel.nivel}
              </p>
              <p className="text-xl font-extrabold leading-tight">{nivel.nombre}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold tabular-nums">{puntos.toLocaleString('es-DO')}</p>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/80">puntos</p>
          </div>
        </div>

        {/* Progreso al siguiente nivel */}
        <div className="relative mt-4">
          <div className="mb-1 flex justify-between text-xs font-medium text-white/85">
            <span>{siguiente ? `Rumbo a ${siguiente.nombre}` : '¡Nivel máximo!'}</span>
            {siguiente && <span>Faltan {faltan.toLocaleString('es-DO')} pts</span>}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white transition-all duration-celebration"
              style={{ width: `${progreso}%` }}
            />
          </div>
        </div>
      </div>

      {/* Logros */}
      <div className="p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Trophy className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-foreground">Tus logros</h3>
          <span className="ml-auto text-xs text-muted-foreground">
            {logros.filter((l) => l.desbloqueado).length}/{logros.length}
          </span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
          {logros.map((l) => (
            <LogroBadge key={l.id} logro={l} />
          ))}
        </div>
      </div>

      {/* Ruleta: acceso solo si la empresa configuró premios (Fase 6B) */}
      {data.hayRuleta && (
        <Link
          href="/cliente/ruleta"
          className="group flex items-center gap-3 border-t border-border/60 px-4 py-3 transition"
          style={{ backgroundColor: `${accent}0f` }}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${accent}1f`, color: accent }}
          >
            <RotateCw className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">Ruleta de premios</span>
            <span className="block text-xs text-muted-foreground">
              Tienes {data.saldo.toLocaleString('es-DO')} pts para gastar
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      )}
    </div>
  )
}
