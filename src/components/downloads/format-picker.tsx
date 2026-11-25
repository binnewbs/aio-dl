import { MusicIcon, SparklesIcon } from 'lucide-react'
import { useAppStore, type FormatChoice } from '@/lib/store'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** A preset maps 1:1 to a yt-dlp `-f` selector. */
interface Preset {
  id: string
  label: string
  selector: string
  audioFormat?: string
}

const VIDEO_PRESETS: Preset[] = [
  { id: 'best', label: 'Best available', selector: 'bv*+ba/b' },
  { id: '2160', label: 'Up to 4K (2160p)', selector: 'bv*[height<=2160]+ba/b[height<=2160]' },
  { id: '1440', label: 'Up to 1440p', selector: 'bv*[height<=1440]+ba/b[height<=1440]' },
  { id: '1080', label: 'Up to 1080p', selector: 'bv*[height<=1080]+ba/b[height<=1080]' },
  { id: '720', label: 'Up to 720p', selector: 'bv*[height<=720]+ba/b[height<=720]' },
  { id: '480', label: 'Up to 480p', selector: 'bv*[height<=480]+ba/b[height<=480]' },
  { id: 'small', label: 'Smallest file', selector: 'wv*+ba/w' },
]

const AUDIO_PRESETS: Preset[] = [
  { id: 'mp3', label: 'Audio · MP3', selector: '', audioFormat: 'mp3' },
  { id: 'm4a', label: 'Audio · M4A', selector: '', audioFormat: 'm4a' },
  { id: 'opus', label: 'Audio · Opus', selector: '', audioFormat: 'opus' },
  { id: 'flac', label: 'Audio · FLAC', selector: '', audioFormat: 'flac' },
  { id: 'wav', label: 'Audio · WAV', selector: '', audioFormat: 'wav' },
]

/** Sentinel select values that aren't plain presets. */
const VALUE_DEFAULT = 'default'
const VALUE_CUSTOM = 'custom'

function choiceToValue(choice: FormatChoice): string {
  switch (choice.kind) {
    case 'default':
      return VALUE_DEFAULT
    case 'preset':
      return choice.selector
    case 'audio':
      return `audio:${choice.audioFormat}`
    case 'custom':
      return VALUE_CUSTOM
  }
}

/**
 * Format picker shown in the Downloads view when the resolved backend is
 * yt-dlp, so a one-off format choice doesn't require a trip to Settings.
 */
export function FormatPicker() {
  const choice = useAppStore((s) => s.formatChoice)
  const setChoice = useAppStore((s) => s.setFormatChoice)
  const settings = useAppStore((s) => s.settings)

  const value = choiceToValue(choice)

  function onChange(next: string) {
    if (next === VALUE_DEFAULT) {
      setChoice({ kind: 'default' })
      return
    }
    if (next === VALUE_CUSTOM) {
      setChoice({
        kind: 'custom',
        selector: settings?.videoFormat ?? 'bv*+ba/b',
        container: settings?.videoContainer ?? 'mp4',
      })
      return
    }
    if (next.startsWith('audio:')) {
      setChoice({ kind: 'audio', audioFormat: next.slice('audio:'.length) })
      return
    }
    setChoice({ kind: 'preset', selector: next })
  }

  const isDefault = choice.kind === 'default'

  return (
    <Field orientation="responsive">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="format-select">Format</FieldLabel>
        <FieldDescription>
          {isDefault
            ? 'Using your saved defaults from Settings.'
            : 'Applies to this download only.'}
        </FieldDescription>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {choice.kind === 'audio' ? (
          <Badge variant="secondary" className="gap-1">
            <MusicIcon />
            audio
          </Badge>
        ) : (
          <Badge variant={isDefault ? 'outline' : 'secondary'} className="gap-1">
            <SparklesIcon />
            {isDefault ? 'default' : choice.kind === 'custom' ? 'custom' : 'video'}
          </Badge>
        )}

        <Select value={value} onValueChange={(next) => onChange(String(next))}>
          <SelectTrigger id="format-select" size="sm" aria-label="Choose download format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Default</SelectLabel>
              <SelectItem value={VALUE_DEFAULT}>Use Settings defaults</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Video</SelectLabel>
              {VIDEO_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.selector}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Audio only</SelectLabel>
              {AUDIO_PRESETS.map((preset) => (
                <SelectItem
                  key={preset.id}
                  value={`audio:${preset.audioFormat}`}
                >
                  {preset.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Advanced</SelectLabel>
              <SelectItem value={VALUE_CUSTOM}>Custom selector…</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        {choice.kind === 'custom' ? (
          <Input
            aria-label="Custom yt-dlp format selector"
            className="h-7 w-56 text-xs"
            value={choice.selector}
            spellCheck={false}
            placeholder="bv*[height<=1080]+ba/b"
            onChange={(event) =>
              setChoice({ ...choice, selector: event.target.value })
            }
          />
        ) : null}
      </div>
    </Field>
  )
}
