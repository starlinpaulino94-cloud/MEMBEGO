export function useRouter() {
  return {
    push(href) {
      Reflect.get(globalThis, '__comprarPromoPushes').push(href)
    },
  }
}
