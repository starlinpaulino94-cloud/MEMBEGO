'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { solicitarRecuperacion } from '@/modules/auth/recuperarActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function RecuperarPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // La petición a Supabase la hace el servidor (ver recuperarActions.ts): el
    // navegador solo necesita llegar al dominio de la app, no a supabase.co.
    try {
      const resultado = await solicitarRecuperacion(email)
      if (!resultado.ok) {
        setError(resultado.error ?? 'No pudimos enviar el correo. Intenta de nuevo.')
        return
      }
      setSuccess(true)
    } catch {
      // La propia llamada a la app falló: sin conexión o red inestable.
      setError('No pudimos conectar. Revisa tu conexión a internet e intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-2xl">Recuperar contraseña</CardTitle>
        <CardDescription>
          Te enviaremos un enlace para restablecer tu contraseña.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Si existe una cuenta con ese correo, te enviamos un enlace para
                restablecer tu contraseña. Revisa tu bandeja de entrada.
              </AlertDescription>
            </Alert>
            <p className="text-center text-small text-muted-foreground">
              <a href="/login" className="text-primary hover:underline">
                Volver a iniciar sesión
              </a>
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary/90"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar enlace
              </Button>
            </form>
            <p className="mt-4 text-center text-small text-muted-foreground">
              <a href="/login" className="text-primary hover:underline">
                Volver a iniciar sesión
              </a>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
