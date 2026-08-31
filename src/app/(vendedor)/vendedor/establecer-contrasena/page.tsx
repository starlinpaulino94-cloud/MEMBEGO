'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { establecerContrasenaVendedor } from '@/modules/excursiones/vendedores/actions'

const MIN_PASSWORD = 8

function EstablecerContrasenaForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  if (!token) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-2xl">Enlace inválido</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              No se encontró el token de acceso. Revisa el enlace del correo que
              recibiste.
            </AlertDescription>
          </Alert>
          <p className="mt-4 text-center text-small text-muted-foreground">
            <a href="/login" className="text-primary hover:underline">
              Volver a iniciar sesión
            </a>
          </p>
        </CardContent>
      </Card>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const result = await establecerContrasenaVendedor(token, password)
    setLoading(false)

    if ('error' in result && result.error) {
      setError(result.error)
      return
    }

    setSuccess(true)
    setTimeout(() => router.replace('/login'), 2000)
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-2xl">Establece tu contraseña</CardTitle>
        <CardDescription>
          Elige una contraseña segura para acceder a tu panel de vendedor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Contraseña establecida. Te llevamos a iniciar sesión…
              </AlertDescription>
            </Alert>
            <p className="text-center text-small text-muted-foreground">
              <a href="/login" className="text-primary hover:underline">
                Iniciar sesión
              </a>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Nueva contraseña</Label>
              <PasswordInput
                id="password"
                required
                minLength={MIN_PASSWORD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar contraseña</Label>
              <PasswordInput
                id="confirm"
                required
                minLength={MIN_PASSWORD}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Establecer contraseña
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export default function EstablecerContrasenaPage() {
  return (
    <Suspense
      fallback={
        <Card className="border-border">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Cargando…
          </CardContent>
        </Card>
      }
    >
      <EstablecerContrasenaForm />
    </Suspense>
  )
}
