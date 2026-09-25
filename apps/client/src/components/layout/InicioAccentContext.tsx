import React, { createContext, useContext, useMemo, useState } from 'react'
import { colors } from '../../theme/tokens'

export interface InicioAccent {
  gradient: readonly [string, string, ...string[]]
  color: string
  shadow: string
}

const DEFAULT_ACCENT: InicioAccent = {
  gradient: [colors.vibe.deep, colors.vibe.violet, colors.vibe.cobalt, colors.retail.cyan],
  color: colors.vibe.deep,
  shadow: colors.vibe.deep,
}

const ACCENT_COLORS = [
  colors.vibe.deep,
  colors.categoryText.orange,
  colors.categoryText.teal,
  colors.categoryText.sky,
  colors.categoryText.blue,
  colors.categoryText.rose,
] as const

function accentForIndex(index: number | null): InicioAccent {
  if (index === null || index === 0) return DEFAULT_ACCENT

  const gradient = colors.gradient.categories[index]
  const color = ACCENT_COLORS[index]

  if (!gradient || !color) return DEFAULT_ACCENT

  return { gradient, color, shadow: gradient[0] }
}

interface InicioAccentContextValue {
  accent: InicioAccent
  setAccentIndex: (index: number | null) => void
}

const InicioAccentContext = createContext<InicioAccentContextValue>({
  accent: DEFAULT_ACCENT,
  setAccentIndex: () => undefined,
})

export function InicioAccentProvider({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const [accentIndex, setAccentIndex] = useState<number | null>(null)
  const accent = active ? accentForIndex(accentIndex) : DEFAULT_ACCENT
  const value = useMemo(() => ({ accent, setAccentIndex }), [accent])

  return <InicioAccentContext.Provider value={value}>{children}</InicioAccentContext.Provider>
}

export function useInicioAccent() {
  return useContext(InicioAccentContext)
}

export function withAccentOpacity(color: string, opacity: number): string {
  const hex = color.replace('#', '')
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}
