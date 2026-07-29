// Guards against an out-of-order async response overwriting newer state —
// e.g. a slow (first-time, uncached) fetch for selection A resolving after a
// faster fetch for a later selection B. Pair with useRef in a component:
// begin() when a request starts, isLatest() before applying its response.
export function createLatestRequestGuard<T>() {
  let latest: T | undefined;
  return {
    begin(id: T): void {
      latest = id;
    },
    isLatest(id: T): boolean {
      return latest === id;
    },
  };
}
