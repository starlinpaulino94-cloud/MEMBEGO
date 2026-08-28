'use client'

/**
 * Gift card de monto abierto (Regalos P2P · extensión R4): el cliente elige
 * cuánto regalar y para quién (con cuenta o por teléfono/correo). Al crearla
 * recibe el código GC-XXXXXX, que es la referencia para pagar en sucursal o
 * por transferencia; el negocio la activa al confirmar el pago.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, CreditCard, Loader2, Search, User as UserIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { buscarDestinatario, type DestinatarioResultado } from '@/modules/regalos/actions'
import { comprarGiftCard, type GiftCardActionState } from '@/modules/regalos/giftcard-actions'

const initial: GiftCardActionState & { codigo?: string } = {}
const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

export function GiftCardForm({ montoMin, montoMax }: { montoMin: number; montoMax: number }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(comprarGiftCard, initial)

  const [monto, setMonto] = useState(montoMin)
  const sugeridos = [500, 1000, 2000, 5000].filter((v) => v >= montoMin && v <= montoMax)

  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState<DestinatarioResultado[]>([])
  const [destinatario, setDestinatario] = useState<DestinatarioResultado | null>(null)
  const [buscando, startBusqueda] = useTransition()

  const [externo, setExterno] = useState(false)
  const [contacto, setContacto] = useState('')
  const contactoValido = contacto.includes('@')
    ? /^\S+@\S+\.\S+$/.test(contacto.trim())
    : (contacto.match(/\d/g)?.length ?? 0) >= 7

  // Código creado: se deriva del resultado de la acción (sin setState en efecto).
  const codigo = state.success ? (state.codigo ?? null) : null

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success('Gift card creada.')
  }, [state])

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

  async function copiarCodigo() {
    if (!codigo) return
    await navigator.clipboard.writeText(codigo).catch(() => {})
    toast.success('Código copiado.')
  }

  if (codigo) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-6 text-center shadow-card">
        <CreditCard className="mx-auto h-10 w-10 text-success" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-foreground">¡Gift card creada!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paga en la sucursal citando este código, o haz la transferencia
          indicándolo. Al confirmarse el pago se activa y tu persona especial
          la usa mostrando el código 💳
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <code className="rounded-xl bg-background px-4 py-2 font-mono text-2xl font-bold tracking-widest text-foreground">
            {codigo}
          </code>
          <Button variant="outline" size="sm" onClick={copiarCodigo} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" /> Copiar
          </Button>
        </div>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/cliente/regalos')}>
          Ver mis regalos
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-6">
      {/* Paso 1 · Monto */}
      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-foreground">1 · ¿Cuánto regalas?</h2>
        {sugeridos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {sugeridos.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setMonto(v)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${monto === v ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/70 text-muted-foreground hover:bg-muted/40'}`}
              >
                {fmtRD(v)}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Label htmlFor="monto" className="shrink-0">Monto</Label>
          <Input
            id="monto"
            name="monto"
            type="number"
            min={montoMin}
            max={montoMax}
            step="0.01"
            value={monto}
            onChange={(e) => setMonto(Number(e.target.value) || 0)}
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">
            entre {fmtRD(montoMin)} y {fmtRD(montoMax)}
          </span>
        </div>
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
        ) : externo ? (
          <div className="space-y-2">
            <Input
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
              placeholder="Su teléfono (809 555 1234) o su correo"
              inputMode="email"
            />
            <p className="text-xs text-muted-foreground">
              La gift card quedará a nombre de ese contacto: la reclama al
              registrarse en MembeGo con ese teléfono o correo.
            </p>
            <button
              type="button"
              onClick={() => setExterno(false)}
              className="text-xs font-medium text-primary hover:underline"
            >
              ← Mejor buscarlo en MembeGo
            </button>
            {contactoValido && (
              <input type="hidden" name="destinatarioContacto" value={contacto.trim()} />
            )}
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
            <button
              type="button"
              onClick={() => setExterno(true)}
              className="mt-3 text-xs font-medium text-primary hover:underline"
            >
              ¿No está en MembeGo? Regálasela a su teléfono o correo →
            </button>
          </>
        )}
      </section>

      {/* Paso 3 · Dedicatoria + crear */}
      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-foreground">3 · Dedicatoria (opcional)</h2>
        <Textarea name="mensaje" rows={2} maxLength={200} placeholder="¡Para que te consientas! 💛" />
        <Button
          type="submit"
          disabled={pending || monto <= 0 || (!destinatario && !(externo && contactoValido))}
          className="mt-4 w-full gap-2 py-5 font-semibold"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          Crear gift card de {fmtRD(monto || 0)}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Tú pagas (transferencia o en la sucursal) citando el código. Se activa
          al confirmarse el pago y no expira.
        </p>
      </section>
    </form>
  )
}
