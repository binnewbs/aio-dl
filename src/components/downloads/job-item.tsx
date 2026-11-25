import { useState } from 'react'
import {
  AlertCircleIcon,
  BanIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  RotateCcwIcon,
} from 'lucide-react'
import type { JobSnapshot } from '@/lib/types'
import { BACKEND_META, STATUS_META } from '@/lib/backend'
import { formatBytes, formatCount, formatEta, formatSpeed, shortUrl } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import * as ipc from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'

function progressValue(job: JobSnapshot): number {
  if (job.percent != null) return Math.min(100, Math.max(0, job.percent))
  if (job.itemsTotal && job.itemsTotal > 0) {
    return Math.min(100, (job.itemsDone / job.itemsTotal) * 100)
  }
  return 0
}

function detailLine(job: JobSnapshot): string {
  if (job.status === 'failed') return job.error ?? 'Download failed'
  if (job.status === 'cancelled') return 'Cancelled'
  if (job.status === 'interrupted') return 'Interrupted by app restart'
  if (job.status === 'queued') return 'Waiting for a free slot'

  if (job.status === 'completed') {
    return `Saved ${formatBytes(job.totalBytes ?? job.downloadedBytes)}`
  }

  const parts: string[] = []
  if (job.itemsTotal) {
    parts.push(`${formatCount(job.itemsDone, job.itemsTotal)} items`)
  } else if (job.totalBytes) {
    parts.push(`${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}`)
  } else if (job.downloadedBytes > 0) {
    parts.push(formatBytes(job.downloadedBytes))
  }
  if (job.speedBytesPerSec) parts.push(formatSpeed(job.speedBytesPerSec))
  if (job.etaSeconds != null) parts.push(`${formatEta(job.etaSeconds)} left`)
  return parts.length > 0 ? parts.join(' · ') : job.message ?? 'Starting…'
}

export function JobItem({ job }: { job: JobSnapshot }) {
  const cancel = useAppStore((s) => s.cancel)
  const retry = useAppStore((s) => s.retry)
  const [logOpen, setLogOpen] = useState(false)

  const backendMeta = BACKEND_META[job.backend]
  const statusMeta = STATUS_META[job.status]
  const isActive = job.status === 'running' || job.status === 'queued'
  const canRetry = job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted'
  const hasOutput = Boolean(job.outputPath)

  return (
    <Item variant="outline" className="flex-col items-stretch gap-0">
      <div className="flex w-full flex-wrap items-center gap-3">
        <ItemMedia variant="icon">
          <backendMeta.icon />
        </ItemMedia>

        <ItemContent>
          <ItemTitle>
            <span className="truncate">{shortUrl(job.title, 80)}</span>
            <Badge variant="outline">{backendMeta.label}</Badge>
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
          </ItemTitle>
          <ItemDescription>{detailLine(job)}</ItemDescription>
        </ItemContent>

        <ItemActions>
          {hasOutput ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Open containing folder"
              aria-label="Open containing folder"
              onClick={() => void ipc.revealPath(job.outputPath as string)}
            >
              <FolderOpenIcon />
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Retry"
              aria-label="Retry download"
              onClick={() => void retry(job.id)}
            >
              <RotateCcwIcon />
            </Button>
          ) : null}
          {isActive ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Cancel"
              aria-label="Cancel download"
              onClick={() => void cancel(job.id)}
            >
              <BanIcon />
            </Button>
          ) : null}
        </ItemActions>
      </div>

      <div className="mt-2 w-full">
        <Progress
          value={progressValue(job)}
          aria-label={`Download progress for ${job.title}`}
          className={job.status === 'running' && job.percent == null ? 'opacity-60' : undefined}
        />
      </div>

      <ItemFooter className="mt-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {job.percent != null ? (
            <span>{Math.floor(job.percent)}%</span>
          ) : isActive ? (
            <span>Working…</span>
          ) : null}
          {job.outputPath ? (
            <span className="truncate" title={job.outputPath}>
              {job.outputPath.split(/[\\/]/).pop()}
            </span>
          ) : null}
        </div>

        {job.logTail.length > 0 || job.error ? (
          <Collapsible open={logOpen} onOpenChange={setLogOpen}>
            <CollapsibleTrigger
              render={
                <Button variant="ghost" size="sm">
                  {job.error ? <AlertCircleIcon data-icon="inline-start" /> : null}
                  {logOpen ? 'Hide log' : 'Show log'}
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              }
            />
            <CollapsibleContent>
              <Separator className="my-2" />
              <pre className="max-h-48 overflow-auto border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-all text-muted-foreground">
                {job.logTail.slice(-60).join('\n')}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </ItemFooter>
    </Item>
  )
}
