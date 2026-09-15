import React, { useState, useMemo } from 'react'
import { View, Text, Pressable, ScrollView, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowLeft, ArrowRight, Car, Check, Loader2 } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Card } from '../ui/Card'
import {
  validarAnio,
  validarPlaca,
  normalizarPlaca,
  buscarMarcas,
  COLORES_FRECUENTES,
} from '../../lib/vehiculo'
import { useCrearVehiculo } from '../../hooks/useVehiculos'
import type { VehiculoTipo } from '../../lib/api'

/**
 * Asistente de 7 pasos para registrar un vehículo (port de web AgregarVehiculoWizard.tsx).
 *
 * Pasos: categoría → marca → modelo → año → color → placa → confirmar.
 * Usa useCrearVehiculo para guardar y router.back() al éxito.
 */
export interface AgregarVehiculoWizardProps {
  tipos: VehiculoTipo[]
  onSuccess?: () => void
}

type Paso = 'categoria' | 'marca' | 'modelo' | 'anio' | 'color' | 'placa' | 'confirmar'
const PASOS: Paso[] = ['categoria', 'marca', 'modelo', 'anio', 'color', 'placa', 'confirmar']

const TITULOS: Record<Paso, string> = {
  categoria: '¿Qué tipo de vehículo tienes?',
  marca: '¿Qué marca es?',
  modelo: '¿Qué modelo?',
  anio: '¿De qué año?',
  color: '¿De qué color?',
  placa: 'La placa de tu vehículo',
  confirmar: 'Revisa y confirma',
}

interface Datos {
  tipoVehiculoId: string
  marca: string
  modelo: string
  anio: string
  color: string
  placa: string
}

export function AgregarVehiculoWizard({ tipos, onSuccess }: AgregarVehiculoWizardProps) {
  const router = useRouter()
  const mutation = useCrearVehiculo()
  const [idx, setIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [datos, setDatos] = useState<Datos>({
    tipoVehiculoId: '',
    marca: '',
    modelo: '',
    anio: '',
    color: '',
    placa: '',
  })

  const paso = PASOS[idx]
  const tipoElegido = tipos.find((t) => t.id === datos.tipoVehiculoId)
  const sugerencias = useMemo(() => buscarMarcas(datos.marca), [datos.marca])

  function validar(p: Paso): string | null {
    switch (p) {
      case 'categoria':
        return datos.tipoVehiculoId ? null : 'Elige la categoría de tu vehículo.'
      case 'marca':
        return datos.marca.trim() ? null : 'Indica la marca (o escríbela si no aparece).'
      case 'modelo':
        return datos.modelo.trim() ? null : 'Indica el modelo de tu vehículo.'
      case 'anio': {
        const r = validarAnio(datos.anio)
        return r.ok ? null : r.error!
      }
      case 'color':
        return datos.color.trim() ? null : 'Indica el color de tu vehículo.'
      case 'placa': {
        const r = validarPlaca(datos.placa)
        return r.ok ? null : r.error!
      }
      case 'confirmar':
        return null
    }
  }

  function avanzar() {
    const problema = validar(paso)
    if (problema) return setError(problema)
    setError(null)
    setIdx((i) => Math.min(i + 1, PASOS.length - 1))
  }

  function enviar() {
    if (mutation.isPending) return
    const body = {
      tipoVehiculoId: datos.tipoVehiculoId,
      marca: datos.marca,
      modelo: datos.modelo,
      anio: Number(datos.anio),
      color: datos.color,
      placa: datos.placa,
      pais: 'DO',
    }
    mutation.mutate(body, {
      onSuccess: () => {
        Alert.alert('Vehículo guardado', 'Tu vehículo se registró correctamente.')
        onSuccess?.()
        router.back()
      },
      onError: (err: Error) => {
        Alert.alert('Error', err.message || 'No se pudo guardar el vehículo.')
      },
    })
  }

  const pct = Math.round(((idx + 1) / PASOS.length) * 100)
  const set = (k: keyof Datos) => (v: string) => {
    setError(null)
    setDatos((d) => ({ ...d, [k]: v }))
  }

  const chip = (activo: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-sm transition',
      activo
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border bg-card active:bg-muted'
    )

  return (
    <View className="gap-4">
      {/* Progress bar */}
      <View className="gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-muted-foreground">
            Paso {idx + 1} de {PASOS.length}
          </Text>
          <Text className="text-xs text-muted-foreground">{pct}%</Text>
        </View>
        <View className="h-1.5 overflow-hidden rounded-full bg-muted">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </View>
      </View>

      <Card>
        <View className="gap-5 pt-2">
          <Text className="text-2xl font-inter-bold tracking-tight text-foreground">
            {TITULOS[paso]}
          </Text>

          {error && (
            <View className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <Text className="text-small text-destructive">{error}</Text>
            </View>
          )}

          {/* Paso: categoría */}
          {paso === 'categoria' && (
            <View className="flex-row flex-wrap gap-3">
              {tipos.map((tv) => {
                const activo = datos.tipoVehiculoId === tv.id
                return (
                  <Pressable
                    key={tv.id}
                    onPress={() => set('tipoVehiculoId')(tv.id)}
                    className={cn(
                      'w-[48%] rounded-xl border p-4',
                      activo
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card active:bg-muted/50'
                    )}
                  >
                    <Car size={24} color={activo ? '#0284c7' : '#71717a'} />
                    <Text className="mt-2 font-inter-semibold text-foreground">
                      {tv.nombre}
                    </Text>
                    {tv.descripcion && (
                      <Text className="mt-0.5 text-xs text-muted-foreground">
                        {tv.descripcion}
                      </Text>
                    )}
                    {activo && <Check size={16} color="#0284c7" className="mt-1" />}
                  </Pressable>
                )
              })}
            </View>
          )}

          {/* Paso: marca */}
          {paso === 'marca' && (
            <View className="gap-3">
              <Input
                value={datos.marca}
                onChangeText={set('marca')}
                autoFocus
                placeholder="Busca o escribe la marca"
                className="h-12 text-lg"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
                {sugerencias.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => set('marca')(m)}
                    className={chip(datos.marca === m)}
                  >
                    <Text>{m}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text className="text-xs text-muted-foreground">
                ¿No aparece? Escríbela tal cual — vale cualquier marca.
              </Text>
            </View>
          )}

          {/* Paso: modelo */}
          {paso === 'modelo' && (
            <Input
              value={datos.modelo}
              onChangeText={set('modelo')}
              autoFocus
              placeholder={datos.marca ? `Modelo de tu ${datos.marca}` : 'Modelo'}
              className="h-12 text-lg"
            />
          )}

          {/* Paso: año */}
          {paso === 'anio' && (
            <Input
              value={datos.anio}
              onChangeText={set('anio')}
              autoFocus
              keyboardType="numeric"
              placeholder={String(new Date().getFullYear())}
              className="h-12 text-lg"
            />
          )}

          {/* Paso: color */}
          {paso === 'color' && (
            <View className="gap-3">
              <Input
                value={datos.color}
                onChangeText={set('color')}
                autoFocus
                placeholder="Color del vehículo"
                className="h-12 text-lg"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
                {COLORES_FRECUENTES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => set('color')(c)}
                    className={chip(datos.color === c)}
                  >
                    <Text>{c}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Paso: placa */}
          {paso === 'placa' && (
            <View className="gap-2">
              <Input
                value={datos.placa}
                onChangeText={set('placa')}
                autoFocus
                placeholder="A123456"
                autoCapitalize="characters"
                className="h-12 text-lg"
              />
              <Text className="text-xs text-muted-foreground">
                Con ella identificamos tu vehículo al llegar.
                {datos.placa.trim() && normalizarPlaca(datos.placa) !== datos.placa.trim() && (
                  <> Se guardará como <Text className="font-mono">{normalizarPlaca(datos.placa)}</Text>.</>
                )}
              </Text>
            </View>
          )}

          {/* Paso: confirmar */}
          {paso === 'confirmar' && (
            <View className="rounded-xl border border-border bg-muted/30 p-4 gap-2">
              {[
                ['Categoría', tipoElegido?.nombre ?? '—'],
                ['Vehículo', `${datos.marca} ${datos.modelo} ${datos.anio}`],
                ['Color', datos.color],
                ['Placa', normalizarPlaca(datos.placa)],
              ].map(([k, v]) => (
                <View key={k} className="flex-row justify-between gap-4">
                  <Text className="text-muted-foreground">{k}</Text>
                  <Text className="text-right font-inter-medium text-foreground">{v}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Navigation buttons */}
          <View className="flex-row items-center gap-3">
            {idx > 0 && (
              <Button
                variant="outline"
                onPress={() => {
                  setError(null)
                  setIdx((i) => i - 1)
                }}
                disabled={mutation.isPending}
                icon={<ArrowLeft size={16} color="#111827" />}
              >
                Atrás
              </Button>
            )}
            <View className="flex-1" />
            <Button
              onPress={paso === 'confirmar' ? enviar : avanzar}
              disabled={mutation.isPending}
              loading={mutation.isPending}
              size="lg"
              icon={paso !== 'confirmar' ? <ArrowRight size={16} color="#ffffff" /> : undefined}
            >
              {paso === 'confirmar' ? 'Guardar vehículo' : 'Continuar'}
            </Button>
          </View>
        </View>
      </Card>
    </View>
  )
}
