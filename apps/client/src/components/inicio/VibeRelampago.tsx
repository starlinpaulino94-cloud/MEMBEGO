import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Image } from 'react-native'
import { Link } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Clock, Timer, ChevronRight } from 'lucide-react-native'
import { rnHref } from '../../lib/rutas'

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

function VibeCountdown({ hasta }: { hasta: string }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
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

    setTimeLeft(calculateTimeLeft())
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => clearInterval(timer)
  }, [hasta])

  return <Text className="text-[12px] font-bold tracking-tight text-vibe-violet">{timeLeft}</Text>
}

export function VibeRelampago({ relampago }: { relampago: any }) {
  if (!relampago || !relampago.promos || relampago.promos.length === 0) return null

  return (
    <View className="mt-6 px-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-[20px] font-bold text-foreground">Experiencias y excursiones</Text>
        <Link href="/explorar" asChild>
          <TouchableOpacity activeOpacity={0.7} className="rounded-full p-1">
            <ChevronRight size={20} color="#09090b" />
          </TouchableOpacity>
        </Link>
      </View>

      <View className="rounded-2xl bg-vibe-lavanda p-4">
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Timer size={20} color="#7c3aed" />
            <Text className="text-[17px] font-bold text-foreground">Ofertas Relámpago</Text>
          </View>
          <View className="rounded-full border border-vibe-chip bg-card px-2.5 py-1">
            <VibeCountdown hasta={relampago.hasta} />
          </View>
        </View>

        <View className="gap-3">
          {relampago.promos.map((p: any, i: number) => (
            <Link key={p.id} href={rnHref(p.href) as any} asChild>
              <TouchableOpacity
                activeOpacity={0.9}
                className="flex-row gap-2 rounded-xl border border-vibe-borde bg-card p-2 elevation-1 shadow-sm"
              >
                <View className="relative h-28 w-28 overflow-hidden rounded-lg bg-vibe-niebla">
                  {p.imagen ? (
                    <Image source={{ uri: p.imagen }} style={{ flex: 1 }} resizeMode="cover" />
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <Text className="text-4xl font-bold text-vibe-violet">
                        {p.titulo.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  {p.descuento ? (
                    <LinearGradient
                      colors={i % 2 === 0 ? ['#7c3aed', '#2563eb'] : ['#06b6d4', '#2563eb']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      className="absolute bottom-1 left-1 rounded px-1.5 py-0.5"
                    >
                      <Text className="text-[12px] font-bold text-white">{p.descuento}</Text>
                    </LinearGradient>
                  ) : null}
                </View>

                <View className="flex-1 justify-between py-1 pr-1">
                  <View>
                    <View className="flex-row items-center gap-1">
                      <Clock size={14} color="#7c3aed" />
                      <Text className="text-[12px] font-medium text-slate-500">
                        Hasta el {fechaCorta(p.hasta)}
                      </Text>
                    </View>
                    <Text className="text-[15px] font-bold text-foreground mt-1" numberOfLines={2}>
                      {p.titulo}
                    </Text>
                    <Text className="text-[14px] text-slate-500 mt-0.5" numberOfLines={1}>
                      {p.empresa}
                    </Text>
                  </View>
                  
                  <View className="mt-2 flex-row items-end justify-between">
                    {p.precio ? (
                      <Text className="text-[14px] font-bold text-vibe-violet">
                        {p.precio}
                      </Text>
                    ) : (
                      <View />
                    )}
                    <LinearGradient
                      colors={['#7c3aed', '#2563eb']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      className="rounded-full px-3 py-1.5"
                    >
                      <Text className="text-[12px] font-bold text-white">Canjear</Text>
                    </LinearGradient>
                  </View>
                </View>
              </TouchableOpacity>
            </Link>
          ))}
        </View>
      </View>
    </View>
  )
}
