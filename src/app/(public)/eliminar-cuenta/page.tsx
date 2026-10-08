'use client'

import { useState } from 'react'

export default function SolicitarEliminacionPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/v1/auth/solicitar-eliminacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await response.json()) as { message?: string; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'No se pudo enviar la solicitud.')
      setMessage(body.message ?? 'Revisa tu correo para continuar.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Intenta de nuevo más tarde.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-16">
      <h1 className="text-h1 text-foreground">Eliminar cuenta de MembeGo</h1>
      <p className="mt-4 text-muted-foreground">
        Escribe el correo de tu cuenta. Te enviaremos un enlace para verificar tu identidad y confirmar la solicitud.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Eliminaremos tus fichas de cliente, membresías y datos asociados. Conservaremos únicamente los registros contables que deban mantenerse por obligación legal; esos registros quedarán desvinculados de tu perfil.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label htmlFor="email" className="block text-sm font-medium text-foreground">Correo electrónico</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-3 text-foreground" />
        <button type="submit" disabled={loading} className="rounded-lg bg-destructive px-5 py-3 font-semibold text-white disabled:opacity-60">
          {loading ? 'Enviando…' : 'Enviar enlace de verificación'}
        </button>
      </form>
      {message && <p role="status" className="mt-4 text-sm text-foreground">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </main>
  )
}
