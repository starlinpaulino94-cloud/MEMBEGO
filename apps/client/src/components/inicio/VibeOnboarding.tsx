import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Link } from 'expo-router'
import { CheckCircle2, Circle, Sparkles, ArrowRight } from 'lucide-react-native'
import { rnHref } from '../../lib/rutas'

export interface OnboardingItem {
  key: string
  label: string
  done: boolean
  href: string
  cta: string
}

export interface VibeOnboardingProps {
  items: OnboardingItem[]
  completados: number
  total: number
}

export function VibeOnboarding({ items, completados, total }: VibeOnboardingProps) {
  if (completados === total) return null

  const pct = Math.round((completados / total) * 100)

  return (
    <View className="mt-6 px-4">
      <View className="overflow-hidden rounded-2xl border border-info/30 bg-info/10">
        {/* Header */}
        <View className="p-4 pb-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Sparkles size={20} color="#0284c7" />
              <Text className="text-base font-inter-semibold text-info">
                Saca el máximo a MembeGo
              </Text>
            </View>
            <Text className="text-sm font-inter-semibold text-info">
              {completados}/{total}
            </Text>
          </View>

          {/* Progress bar */}
          <View className="mt-3 h-2 w-full overflow-hidden rounded-full bg-info/15">
            <View
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </View>
        </View>

        {/* Checklist */}
        <View className="gap-2 px-4 pb-4">
          {items.map((item) => (
            <View
              key={item.key}
              className="flex-row items-center justify-between rounded-lg bg-card p-2.5 shadow-card"
            >
              <View className="flex-1 flex-row items-center gap-2">
                {item.done ? (
                  <CheckCircle2 size={16} color="#00864d" />
                ) : (
                  <Circle size={16} color="#9ca3af" />
                )}
                <Text
                  className={`flex-1 text-sm ${
                    item.done
                      ? 'font-sans text-muted-foreground line-through'
                      : 'font-sans text-foreground'
                  }`}
                  numberOfLines={2}
                >
                  {item.label}
                </Text>
              </View>

              {!item.done && item.cta ? (
                <Link href={rnHref(item.href) as any} asChild>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    className="ml-2 flex-row items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5"
                  >
                    <Text className="text-xs font-inter-medium text-foreground">
                      {item.cta}
                    </Text>
                    <ArrowRight size={12} color="#111827" />
                  </TouchableOpacity>
                </Link>
              ) : null}
            </View>
          ))}
        </View>

        {/* Footer link */}
        <View className="border-t border-info/20 px-4 py-3 items-center">
          <Link href="/(tabs)/cuenta" asChild>
            <TouchableOpacity
              activeOpacity={0.7}
              className="flex-row items-center gap-1"
            >
              <Text className="text-xs font-inter-medium text-primary">
                Ver guía paso a paso
              </Text>
              <ArrowRight size={12} color="#0284c7" />
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </View>
  )
}
