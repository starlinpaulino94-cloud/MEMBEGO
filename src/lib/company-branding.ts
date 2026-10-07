const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i

export function normalizeCompanyBrandColor(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const color = value.trim().toLowerCase()
  if (!HEX_COLOR.test(color)) return null
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return color
}

export function brandDisplayForeground(value: unknown, fallback: string): string {
  const resolved = normalizeCompanyBrandColor(value)
    ?? normalizeCompanyBrandColor(fallback)
    ?? '#5b21b6'
  const channels = [1, 3, 5].map((offset) => Number.parseInt(resolved.slice(offset, offset + 2), 16) / 255)
  const chroma = Math.max(...channels) - Math.min(...channels)
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2])

  if (chroma >= 0.55 && luminance <= 0.65) return '#ffffff'

  const darkContrast = (luminance + 0.05) / 0.059
  const lightContrast = 1.05 / (luminance + 0.05)
  return darkContrast >= lightContrast ? '#111827' : '#ffffff'
}

export function withCompanyBrandColor(config: unknown, color: string | null): Record<string, unknown> {
  const next = config && typeof config === 'object' && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {}

  if (color) next.color = color
  else delete next.color

  return next
}
