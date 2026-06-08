export const MAINLINE_ROUTE_VALUE = "yes"
export const DEFAULT_BRANCH_ROUTE_VALUE = "no"

export const normalizeRouteListWithDefaults = (routes: string[]): string[] => {
  const normalized = new Set<string>([MAINLINE_ROUTE_VALUE, DEFAULT_BRANCH_ROUTE_VALUE])
  for (const route of routes) {
    const trimmed = route.trim()
    if (!trimmed) continue
    normalized.add(trimmed)
  }
  return [...normalized]
}
