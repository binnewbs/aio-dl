export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'aio-dl-theme'

export function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function persistTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
}

/** Applies the stored theme before first paint to avoid a flash. */
export function initTheme() {
  applyTheme(initialTheme())
}
