import { useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'
import { applyTheme, initialTheme, persistTheme, type Theme } from '@/lib/theme'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = initialTheme()
    applyTheme(current)
    return current
  })

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    persistTheme(next)
    setTheme(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
