export type BackAction =
  | { readonly type: 'back' }
  | { readonly type: 'replace'; readonly href: string }

export interface BackNavigationRouter {
  readonly canGoBack: () => boolean
  readonly back: () => void
  readonly replace: (href: string) => void
}

export function resolveBackAction(canGoBack: boolean, fallback: string): BackAction {
  return canGoBack ? { type: 'back' } : { type: 'replace', href: fallback }
}

export function goBackOr(router: BackNavigationRouter, fallback: string): void {
  if (router.canGoBack()) {
    router.back()
    return
  }

  router.replace(fallback)
}
