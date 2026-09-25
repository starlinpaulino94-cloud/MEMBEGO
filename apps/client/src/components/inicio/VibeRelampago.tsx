import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Image } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Clock, Timer, ChevronRight } from 'lucide-react-native'
import { rnHref } from '../../lib/rutas'
import { Card } from '../ui/Card'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent } from '../layout/InicioAccentContext'

function fechaCorta(d: string) {
  try {
    const date = new Date(d)
    const day = date.getDate()
    const month = date.toLocaleString('es-DO', { month: 'short' })
    return `${day} ${month}`
  } catch (e) {
    return d
  }
}

function VibeCountdown({ hasta, accentColor }: { hasta: string; accentColor: string }) {
  const calculateTimeLeft = () => {
    const now = new Date().getTime()
    const end = new Date(hasta).getTime()
    const distance = end - now

    if (distance < 0) {
      return 'Expirado'
    }

    const hours = Math.floor(distance / (1000 * 60 * 60))
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((distance % (1000 * 60)) / 1000)

    const dH = hours < 10 ? '0' + hours : hours
    const dM = minutes < 10 ? '0' + minutes : minutes
    const dS = seconds < 10 ? '0' + seconds : seconds

    return `${dH}:${dM}:${dS}`
  }

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft)

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => clearInterval(timer)
  }, [hasta])

  return <Text className="text-overline font-inter-bold tracking-tight" style={{ color: accentColor }}>{timeLeft}</Text>
}

export function VibeRelampago({ relampago }: { relampago: any }) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  if (!relampago || !relampago.promos || relampago.promos.length === 0) return null

  return (
    <View className="mt-6 px-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-price-lg text-foreground">Experiencias y excursiones</Text>
        <Link href="/explorar" asChild>
          <TouchableOpacity activeOpacity={0.7} className="rounded-full p-1">
            <ChevronRight size={20} color={accent.color} />
          </TouchableOpacity>
        </Link>
      </View>

      <Card className="bg-vibe-lavanda p-4 shadow-none">
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Timer size={20} color={accent.color} />
            <Text className="text-h3 text-foreground">Ofertas Relámpago</Text>
          </View>
          <View className="rounded-full border border-vibe-chip bg-card px-2.5 py-1">
            <VibeCountdown hasta={relampago.hasta} accentColor={accent.color} />
          </View>
        </View>

        <View className="gap-3">
          {relampago.promos.map((p: any, i: number) => (
            <MarketplaceCard
              variant="horizontal"
              key={p.id}
              onPress={() => router.push(rnHref(p.href) as any)}
              accessibilityLabel={`Ver ${p.titulo}`}
            >
                <View className="relative h-28 w-28 overflow-hidden rounded-lg bg-vibe-niebla">
                  {p.imagen ? (
                    <Image source={{ uri: p.imagen }} style={{ flex: 1 }} resizeMode="cover" />
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <Text className="text-4xl font-inter-bold" style={{ color: accent.color }}>
                        {p.titulo.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  {p.descuento ? (
                    <LinearGradient
                      colors={accent.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      className="absolute bottom-1 left-1 rounded px-1.5 py-0.5"
                    >
                      <Text className="text-overline font-inter-bold text-white">{p.descuento}</Text>
                    </LinearGradient>
                  ) : null}
                </View>

                <View className="flex-1 justify-between py-1 pr-1">
                  <View>
                    <View className="flex-row items-center gap-1">
                      <Clock size={14} color={accent.color} />
                      <Text className="text-overline font-inter-medium text-muted-foreground">
                        Hasta el {fechaCorta(p.hasta)}
                      </Text>
                    </View>
                    <Text className="text-h4 text-foreground mt-1" numberOfLines={2}>
                      {p.titulo}
                    </Text>
                    <Text className="text-small text-muted-foreground mt-0.5" numberOfLines={1}>
                      {p.empresa}
                    </Text>
                  </View>
                  
                  <View className="mt-2 flex-row items-end justify-between">
                    {p.precio ? (
                      <Text className="text-price-sm font-inter-bold" style={{ color: accent.color }}>
                        {p.precio}
                      </Text>
                    ) : (
                      <View />
                    )}
                    <LinearGradient
                      colors={accent.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      className="rounded-full px-3 min-h-11 justify-center"
                    >
                      <Text className="text-overline font-inter-bold text-white">Canjear</Text>
                    </LinearGradient>
                  </View>
                </View>
            </MarketplaceCard>
          ))}
        </View>
      </Card>
    </View>
  )
}
