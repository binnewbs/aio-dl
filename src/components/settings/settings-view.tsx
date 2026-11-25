import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpenIcon, SaveIcon, SettingsIcon } from 'lucide-react'
import type { Settings } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { BACKEND_META, BACKEND_ORDER } from '@/lib/backend'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'best']
const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm', 'any']
const SPOTIFY_FORMATS = ['mp3', 'flac', 'ogg', 'opus', 'm4a', 'wav']
const SPOTIFY_BITRATES = ['auto', 'disable', '128k', '192k', '256k', '320k']

export function SettingsView() {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [saving, setSaving] = useState(false)

  // Re-seed the draft when settings arrive from the backend, using the
  // "adjust state during render" pattern instead of an effect.
  const [seededFrom, setSeededFrom] = useState<Settings | null>(settings)
  if (settings !== seededFrom) {
    setSeededFrom(settings)
    setDraft(settings)
  }

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="text-muted-foreground" />
            Settings
          </CardTitle>
          <CardDescription>Loading preferences…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  function patch(update: Partial<Settings>) {
    setDraft((current) => (current ? { ...current, ...update } : current))
  }

  function patchArgs(backend: 'ytdlp' | 'galleryDl' | 'aria2' | 'spotDl', value: string) {
    setDraft((current) =>
      current ? { ...current, extraArgs: { ...current.extraArgs, [backend]: value } } : current
    )
  }

  async function pickOutputDir() {
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked === 'string') patch({ outputDir: picked })
  }

  async function pickCookieFile() {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Cookies', extensions: ['txt'] }],
    })
    if (typeof picked === 'string') patch({ cookieFile: picked })
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    try {
      await saveSettings(draft)
      toast.add({ title: 'Settings saved', type: 'success' })
    } catch (err) {
      toast.add({
        title: 'Could not save settings',
        description: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="text-muted-foreground" />
          Settings
        </CardTitle>
        <CardDescription>Defaults applied to every new download.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="downloads">Downloads</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <FieldGroup className="pt-4">
              <Field>
                <FieldLabel htmlFor="output-dir">Output directory</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="output-dir"
                    value={draft.outputDir}
                    spellCheck={false}
                    onChange={(event) => patch({ outputDir: event.target.value })}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      onClick={() => void pickOutputDir()}
                      aria-label="Choose output directory"
                      title="Choose output directory"
                    >
                      <FolderOpenIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Files are saved directly here. Created automatically if missing.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="cookie-file">Cookies file (optional)</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="cookie-file"
                    placeholder="cookies.txt"
                    value={draft.cookieFile ?? ''}
                    spellCheck={false}
                    onChange={(event) =>
                      patch({ cookieFile: event.target.value.trim() || null })
                    }
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      onClick={() => void pickCookieFile()}
                      aria-label="Choose cookies file"
                      title="Choose cookies file"
                    >
                      <FolderOpenIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Needed for private or age-restricted content (yt-dlp, gallery-dl, spotDL).
                </FieldDescription>
              </Field>

              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="open-folder">Open folder when finished</FieldLabel>
                  <FieldDescription>
                    Reveal the download location once a job completes.
                  </FieldDescription>
                </div>
                <Switch
                  id="open-folder"
                  checked={draft.openFolderOnComplete}
                  onCheckedChange={(checked) => patch({ openFolderOnComplete: checked })}
                />
              </Field>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="downloads">
            <FieldGroup className="pt-4">
              <Field>
                <FieldLabel htmlFor="concurrency">
                  Simultaneous downloads: {draft.maxConcurrent}
                </FieldLabel>
                <Slider
                  id="concurrency"
                  min={1}
                  max={6}
                  step={1}
                  value={draft.maxConcurrent}
                  onValueChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value
                    if (typeof next === 'number') patch({ maxConcurrent: next })
                  }}
                />
                <FieldDescription>
                  How many jobs run at once. Higher values use more bandwidth.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="retries">Retries per request</FieldLabel>
                <Input
                  id="retries"
                  type="number"
                  min={0}
                  max={50}
                  value={draft.retries}
                  onChange={(event) =>
                    patch({ retries: Number(event.target.value) || 0 })
                  }
                />
                <FieldDescription>Passed to each backend's retry flag.</FieldDescription>
              </Field>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend variant="label">yt-dlp</FieldLegend>
                <FieldGroup>
                  <Field orientation="horizontal">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="audio-only">Audio only</FieldLabel>
                      <FieldDescription>
                        Extract audio and convert instead of saving video.
                      </FieldDescription>
                    </div>
                    <Switch
                      id="audio-only"
                      checked={draft.audioOnly}
                      onCheckedChange={(checked) => patch({ audioOnly: checked })}
                    />
                  </Field>

                  {draft.audioOnly ? (
                    <Field>
                      <FieldLabel htmlFor="audio-format">Audio format</FieldLabel>
                      <Select
                        value={draft.audioFormat}
                        onValueChange={(value) =>
                          patch({ audioFormat: String(value) })
                        }
                      >
                        <SelectTrigger id="audio-format" className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {AUDIO_FORMATS.map((format) => (
                              <SelectItem key={format} value={format}>
                                {format}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <>
                      <Field>
                        <FieldLabel htmlFor="video-format">Format selector</FieldLabel>
                        <Input
                          id="video-format"
                          value={draft.videoFormat}
                          spellCheck={false}
                          onChange={(event) => patch({ videoFormat: event.target.value })}
                        />
                        <FieldDescription>
                          yt-dlp `-f` expression. `bv*+ba/b` picks the best video and audio.
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="video-container">Container</FieldLabel>
                        <Select
                          value={draft.videoContainer}
                          onValueChange={(value) =>
                            patch({ videoContainer: String(value) })
                          }
                        >
                          <SelectTrigger id="video-container" className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {VIDEO_CONTAINERS.map((container) => (
                                <SelectItem key={container} value={container}>
                                  {container}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    </>
                  )}
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend variant="label">spotDL</FieldLegend>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="spotify-format">Audio format</FieldLabel>
                    <Select
                      value={draft.spotifyFormat}
                      onValueChange={(value) => patch({ spotifyFormat: String(value) })}
                    >
                      <SelectTrigger id="spotify-format" className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SPOTIFY_FORMATS.map((format) => (
                            <SelectItem key={format} value={format}>
                              {format}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="spotify-bitrate">Bitrate</FieldLabel>
                    <Select
                      value={draft.spotifyBitrate}
                      onValueChange={(value) => patch({ spotifyBitrate: String(value) })}
                    >
                      <SelectTrigger id="spotify-bitrate" className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SPOTIFY_BITRATES.map((bitrate) => (
                            <SelectItem key={bitrate} value={bitrate}>
                              {bitrate}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      `disable` keeps the original stream without re-encoding.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <Field>
                <FieldLabel htmlFor="aria2-conns">aria2c connections per file</FieldLabel>
                <Slider
                  id="aria2-conns"
                  min={1}
                  max={16}
                  step={1}
                  value={draft.aria2Connections}
                  onValueChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value
                    if (typeof next === 'number') patch({ aria2Connections: next })
                  }}
                />
                <FieldDescription>
                  {draft.aria2Connections} parallel connections (`-x`/`-s`).
                </FieldDescription>
              </Field>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="advanced">
            <FieldGroup className="pt-4">
              {BACKEND_ORDER.map((backend) => {
                const meta = BACKEND_META[backend]
                return (
                  <Field key={backend}>
                    <FieldLabel htmlFor={`extra-${backend}`}>
                      {meta.label} extra arguments
                    </FieldLabel>
                    <Input
                      id={`extra-${backend}`}
                      placeholder="--limit-rate 2M"
                      value={draft.extraArgs[backend]}
                      spellCheck={false}
                      onChange={(event) => patchArgs(backend, event.target.value)}
                    />
                    <FieldDescription>
                      Appended verbatim to every {meta.label} command.
                    </FieldDescription>
                  </Field>
                )
              })}

              <FieldSeparator />

              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="insecure">Skip TLS verification</FieldLabel>
                  <FieldDescription>
                    Only for aria2c. Use when a server has a broken certificate.
                  </FieldDescription>
                </div>
                <Switch
                  id="insecure"
                  checked={draft.insecureTls}
                  onCheckedChange={(checked) => patch({ insecureTls: checked })}
                />
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {isDirty ? 'Unsaved changes' : 'All changes saved'}
          </p>
          <Button onClick={() => void handleSave()} disabled={!isDirty || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
