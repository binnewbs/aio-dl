import { InboxIcon, Trash2Icon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ItemGroup } from '@/components/ui/item'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { JobItem } from './job-item'

export function JobList() {
  const jobs = useAppStore((s) => s.jobs)
  const clearFinished = useAppStore((s) => s.clearFinished)

  const ordered = [...jobs].sort((a, b) => b.createdAt - a.createdAt)
  const activeCount = ordered.filter(
    (job) => job.status === 'running' || job.status === 'queued'
  ).length
  const finishedCount = ordered.length - activeCount

  if (ordered.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing downloading</EmptyTitle>
          <EmptyDescription>
            Paste a link above and aio-dl will route it to the right tool.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {activeCount} active · {finishedCount} finished
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={finishedCount === 0}
          onClick={() => void clearFinished()}
        >
          <Trash2Icon data-icon="inline-start" />
          Clear finished
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-32rem)] min-h-64">
        <ItemGroup className="pr-3">
          {ordered.map((job) => (
            <JobItem key={job.id} job={job} />
          ))}
        </ItemGroup>
      </ScrollArea>
    </div>
  )
}
