/**
 * HF Spaces renders your app inside a cross-origin iframe. Safari + Firefox
 * (strict tracking protection) throw a SecurityError on any localStorage access
 * there, which would crash the app on first render. Always go through this.
 */

const memory = new Map<string, string>();
let available: boolean | null = null;

function probe(): boolean {
  if (available !== null) return available;
  try {
    const k = "__probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const storage = {
  get(key: string, fallback = ""): string {
    try {
      if (probe()) return window.localStorage.getItem(key) ?? fallback;
    } catch {
      /* ignore */
    }
    return memory.get(key) ?? fallback;
  },
  set(key: string, value: string) {
    memory.set(key, value);
    try {
      if (probe()) window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    memory.delete(key);
    try {
      if (probe()) window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  get persistent() {
    return probe();
  },
};

/** True when the page is embedded (HF Space page wraps apps in an iframe). */
export function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
