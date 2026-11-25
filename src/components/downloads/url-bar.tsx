import { useEffect, useMemo, useState } from 'react'
import { ClipboardPasteIcon, DownloadIcon, LockIcon, WandSparklesIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { BACKEND_META, BACKEND_ORDER } from '@/lib/backend'
import { detectBackend, looksLikeUrl } from '@/lib/detect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'

export function UrlBar() {
  const url = useAppStore((s) => s.url)
  const setUrl = useAppStore((s) => s.setUrl)
  const submit = useAppStore((s) => s.submit)
  const detected = useAppStore((s) => s.detected)
  const detectedReason = useAppStore((s) => s.detectedReason)
  const probing = useAppStore((s) => s.probing)
  const override = useAppStore((s) => s.override)
  const setOverride = useAppStore((s) => s.setOverride)
  const [busy, setBusy] = useState(false)

  const effective = override ?? detected
  const meta = BACKEND_META[effective]

  const autoResult = useMemo(() => (url.trim() ? detectBackend(url) : null), [url])

  async function handleSubmit() {
    if (!url.trim() || busy) return
    setBusy(true)
    try {
      await submit()
    } finally {
      setBusy(false)
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      /* clipboard access denied — the user can paste manually */
    }
  }

  // Enter submits from anywhere in the bar.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === 'Enter' &&
        (event.metaKey || event.ctrlKey) &&
        !event.defaultPrevented
      ) {
        event.preventDefault()
        void handleSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WandSparklesIcon className="text-muted-foreground" />
          Paste a link
        </CardTitle>
        <CardDescription>
          aio-dl picks the right backend automatically. You can override it before starting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="url-input" className="sr-only">
              URL or search query
            </FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="url-input"
                placeholder="https://…  ·  or a song name for spotDL"
                value={url}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                    event.preventDefault()
                    void handleSubmit()
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => void pasteFromClipboard()}
                  aria-label="Paste from clipboard"
                  title="Paste from clipboard"
                >
                  <ClipboardPasteIcon />
                </InputGroupButton>
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!url.trim() || busy}
                  size="sm"
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <DownloadIcon data-icon="inline-start" />
                  )}
                  Download
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              {url.trim()
                ? autoResult?.reason ?? detectedReason
                : 'Enter ↵ to start · Ctrl/⌘+Enter works from anywhere'}
            </FieldDescription>
          </Field>

          <Separator />

          <Field orientation="responsive">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="backend-select">Backend</FieldLabel>
              <FieldDescription>
                {override
                  ? `Forced to ${BACKEND_META[override].label}.`
                  : `Auto-detected: ${BACKEND_META[detected].label}.`}
              </FieldDescription>
            </div>

            <div className="flex items-center gap-2">
              {probing ? (
                <Badge variant="outline" className="gap-1">
                  <Spinner data-icon="inline-start" />
                  Checking…
                </Badge>
              ) : (
                <Badge variant={override ? 'secondary' : 'outline'} className="gap-1">
                  <meta.icon />
                  {meta.label}
                </Badge>
              )}

              <Select
                value={override ?? 'auto'}
                onValueChange={(value) =>
                  setOverride(value === 'auto' ? null : (value as typeof detected))
                }
              >
                <SelectTrigger id="backend-select" size="sm" aria-label="Choose backend">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="auto">
                      <LockIcon />
                      Auto ({BACKEND_META[detected].label})
                    </SelectItem>
                    {BACKEND_ORDER.map((backend) => {
                      const itemMeta = BACKEND_META[backend]
                      return (
                        <SelectItem key={backend} value={backend}>
                          <itemMeta.icon />
                          {itemMeta.label}
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </Field>

          <FieldDescription>
            {looksLikeUrl(url)
              ? `${meta.description} · ${meta.accepts}`
              : 'Plain text is treated as a spotDL search query.'}
          </FieldDescription>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
