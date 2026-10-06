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

export function withCompanyBrandColor(config: unknown, color: string | null): Record<string, unknown> {
  const next = config && typeof config === 'object' && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {}

  if (color) next.color = color
  else delete next.color

  return next
}
