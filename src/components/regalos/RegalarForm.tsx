'use client'

/**
 * Regalos P2P · Fase R3: regalar una promoción o membresía NUEVA (la paga el
 * regalador). Pasos: qué regalar → para quién (@ID o búsqueda enmascarada) →
 * dedicatoria → crear. Promoción → sigue al pago de la compra (transferencia
 * o sucursal); membresía → muestra la referencia POS para pagarla.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, Gift, Loader2, Search, User as UserIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  buscarDestinatario,
  regalarPromocion,
  regalarMembresia,
  type RegaloActionState,
  type DestinatarioResultado,
} from '@/modules/regalos/actions'
import type { OpcionRegalo } from '@/modules/regalos/queries'

const initialPromo: RegaloActionState & { compraId?: string } = {}
const initialMem: RegaloActionState & { referencia?: string } = {}
const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

export function RegalarForm({ opciones }: { opciones: OpcionRegalo[] }) {
  const router = useRouter()
  const [statePromo, actionPromo, pendingPromo] = useActionState(regalarPromocion, initialPromo)
  const [stateMem, actionMem, pendingMem] = useActionState(regalarMembresia, initialMem)
  const pending = pendingPromo || pendingMem

  const [opcionId, setOpcionId] = useState(opciones[0]?.id ?? '')
  const opcion = opciones.find((o) => o.id === opcionId) ?? null

  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState<DestinatarioResultado[]>([])
  const [destinatario, setDestinatario] = useState<DestinatarioResultado | null>(null)
  const [buscando, startBusqueda] = useTransition()

  // Membresía creada: la referencia de pago se DERIVA del resultado de la
  // acción (sin setState en efecto — evita renders en cascada).
  const referencia = stateMem.success ? (stateMem.referencia ?? null) : null

  useEffect(() => {
    if (statePromo.error) toast.error(statePromo.error)
    if (statePromo.success && statePromo.compraId) {
      toast.success(statePromo.detalle ?? 'Regalo creado.')
      // Continúa al pago de la compra (el flujo existente de la wallet).
      router.push(`/cliente/mis-promociones/${statePromo.compraId}`)
    }
  }, [statePromo, router])

  useEffect(() => {
    if (stateMem.error) toast.error(stateMem.error)
    if (stateMem.success) toast.success(stateMem.detalle ?? 'Regalo creado.')
  }, [stateMem])

  function buscar() {
    const q = query.trim()
    if (!q) return
    startBusqueda(async () => {
      const res = await buscarDestinatario(q)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setResultados(res.resultados ?? [])
      if ((res.resultados ?? []).length === 0) toast.info('Sin resultados. Prueba con el @ID exacto.')
    })
  }

  async function copiarReferencia() {
    if (!referencia) return
    await navigator.clipboard.writeText(referencia).catch(() => {})
    toast.success('Referencia copiada.')
  }

  // ── Pantalla de éxito para membresía (referencia de pago) ──────────────────
  if (referencia) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-6 text-center shadow-card">
        <Gift className="mx-auto h-10 w-10 text-success" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-foreground">¡Regalo creado!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paga en la sucursal mostrando esta referencia, o haz la transferencia
          indicándola. Cuando el negocio confirme el pago, tu amigo recibirá su
          membresía con una sorpresa 🎁
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <code className="rounded-xl bg-background px-4 py-2 font-mono text-2xl font-bold tracking-widest text-foreground">
            {referencia}
          </code>
          <Button variant="outline" size="sm" onClick={copiarReferencia} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" /> Copiar
          </Button>
        </div>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/cliente/regalos')}>
          Ver mis regalos
        </Button>
      </div>
    )
  }

  const formAction = opcion?.tipo === 'PLAN' ? actionMem : actionPromo

  return (
    <form action={formAction} className="space-y-6">
      {/* Paso 1 · Qué regalar */}
      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-foreground">1 · ¿Qué le regalas?</h2>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {opciones.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition ${opcionId === o.id ? 'border-primary/50 bg-primary/5' : 'border-border/70 hover:bg-muted/40'}`}
            >
              <input
                type="radio"
                name="_opcion"
                checked={opcionId === o.id}
                onChange={() => setOpcionId(o.id)}
                className="accent-[var(--primary)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{o.titulo}</span>
                {o.detalle && <span className="block text-xs text-muted-foreground">{o.detalle}</span>}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{fmtRD(o.precio)}</span>
            </label>
          ))}
        </div>
        {opcion?.tipo === 'PROMOCION' && <input type="hidden" name="promocionId" value={opcion.id} />}
        {opcion?.tipo === 'PLAN' && <input type="hidden" name="planId" value={opcion.id} />}
      </section>

      {/* Paso 2 · Destinatario */}
      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-1 text-sm font-semibold text-foreground">2 · ¿Para quién?</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Pega su <strong>@ID MembeGo</strong> o busca por nombre.
        </p>
        {destinatario ? (
          <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
            {destinatario.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={destinatario.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UserIcon className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{destinatario.nombre}</p>
              <p className="text-xs text-muted-foreground">
                {destinatario.codigo ? `@${destinatario.codigo}` : ''}
                {destinatario.telefonoMask ? ` · ${destinatario.telefonoMask}` : ''}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDestinatario(null)}>
              <X className="h-4 w-4" />
            </Button>
            <input type="hidden" name="destinatarioId" value={destinatario.clienteId} />
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="@ABC123 o nombre…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    buscar()
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={buscar} disabled={buscando} className="gap-1.5">
                {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar
              </Button>
            </div>
            {resultados.length > 0 && (
              <ul className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/70">
                {resultados.map((r) => (
                  <li key={r.clienteId}>
                    <button
                      type="button"
                      onClick={() => {
                        setDestinatario(r)
                        setResultados([])
                      }}
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                    >
                      {r.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <UserIcon className="h-4 w-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{r.nombre}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.codigo ? `@${r.codigo}` : ''}
                          {r.telefonoMask ? ` · ${r.telefonoMask}` : ''}
                        </span>
                      </span>
                      <span className="text-xs font-medium text-primary">¿Es esta persona?</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Paso 3 · Dedicatoria + crear */}
      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-foreground">3 · Dedicatoria (opcional)</h2>
        <Textarea name="mensaje" rows={2} maxLength={200} placeholder="¡Feliz cumpleaños! 🎂" />
        <Button
          type="submit"
          disabled={pending || !destinatario || !opcion}
          className="mt-4 w-full gap-2 py-5 font-semibold"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {opcion ? `Regalar por ${fmtRD(opcion.precio)}` : 'Regalar'}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Tú pagas (transferencia o en la sucursal). Tu amigo lo recibe cuando el
          negocio confirme el pago.
        </p>
      </section>
    </form>
  )
}
