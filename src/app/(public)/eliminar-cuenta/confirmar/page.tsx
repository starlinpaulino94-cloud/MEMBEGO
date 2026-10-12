'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ConfirmarEliminacionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/v1/auth/cuenta', { method: 'DELETE' })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'No se pudo eliminar la cuenta.')
      router.replace('/eliminar-cuenta/terminada')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la cuenta.')
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-16">
      <h1 className="text-h1 text-foreground">Confirma la eliminación</h1>
      <p className="mt-4 text-muted-foreground">Esta acción elimina tus fichas y cierra el acceso. Los registros contables que deban conservarse por ley quedarán sin vincular a tu perfil.</p>
      <button type="button" onClick={confirm} disabled={loading} className="mt-8 rounded-lg bg-destructive px-5 py-3 font-semibold text-white disabled:opacity-60">
        {loading ? 'Eliminando…' : 'Eliminar mi cuenta definitivamente'}
      </button>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </main>
  )
}
