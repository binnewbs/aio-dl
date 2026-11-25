import { useMemo, useState } from 'react'
import { FolderOpenIcon, HistoryIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import type { JobStatus } from '@/lib/types'
import { BACKEND_META, STATUS_META } from '@/lib/backend'
import { formatBytes, formatRelativeTime, shortUrl } from '@/lib/format'
import { backendLabel, revealPath } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type Filter = 'all' | 'completed' | 'failed'

export function HistoryView() {
  const history = useAppStore((s) => s.history)
  const retry = useAppStore((s) => s.retry)
  const deleteHistory = useAppStore((s) => s.deleteHistory)
  const clearHistoryAll = useAppStore((s) => s.clearHistoryAll)
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return history
    if (filter === 'completed') {
      return history.filter((entry) => entry.status === 'completed')
    }
    return history.filter((entry) => entry.status === 'failed')
  }, [history, filter])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="text-muted-foreground" />
          History
        </CardTitle>
        <CardDescription>
          {history.length === 0
            ? 'Completed downloads will appear here.'
            : `${history.length} recorded download${history.length === 1 ? '' : 's'}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            value={[filter]}
            onValueChange={(value) => {
              const next = value[0] as Filter | undefined
              if (next) setFilter(next)
            }}
            spacing={2}
            aria-label="Filter history"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="completed">Completed</ToggleGroupItem>
            <ToggleGroupItem value="failed">Failed</ToggleGroupItem>
          </ToggleGroup>

          <Button
            variant="ghost"
            size="sm"
            disabled={history.length === 0}
            onClick={() => void clearHistoryAll()}
          >
            <Trash2Icon data-icon="inline-start" />
            Clear history
          </Button>
        </div>

        {filtered.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>No entries</EmptyTitle>
              <EmptyDescription>
                {history.length === 0
                  ? 'Finish a download to start building history.'
                  : 'Nothing matches this filter.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Backend</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => {
                const status = STATUS_META[entry.status as JobStatus]
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="max-w-72">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate" title={entry.title}>
                          {shortUrl(entry.title, 56)}
                        </span>
                        {entry.error ? (
                          <span className="truncate text-xs text-destructive" title={entry.error}>
                            {entry.error}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {(() => {
                          const Icon = BACKEND_META[entry.backend].icon
                          return <Icon />
                        })()}
                        {backendLabel(entry.backend)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(entry.totalBytes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(entry.finishedAt ?? entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {entry.outputPath ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Open folder"
                            title="Open folder"
                            onClick={() => void revealPath(entry.outputPath as string)}
                          >
                            <FolderOpenIcon />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Download again"
                          title="Download again"
                          onClick={() => void retry(entry.id)}
                        >
                          <RotateCcwIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove from history"
                          title="Remove from history"
                          onClick={() => void deleteHistory(entry.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
