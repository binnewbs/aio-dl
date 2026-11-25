import { ActivityIcon, CircleCheckIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

export function DoctorView() {
  const binaries = useAppStore((s) => s.binaries)
  const loading = useAppStore((s) => s.binariesLoading)
  const recheck = useAppStore((s) => s.recheckBinaries)
  const appInfo = useAppStore((s) => s.appInfo)

  const missing = binaries.filter((binary) => !binary.ok)
  const ready = binaries.length > 0 && missing.length === 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="text-muted-foreground" />
            Doctor
          </CardTitle>
          <CardDescription>
            aio-dl bundles its download engines. This panel checks that each one runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant={ready ? 'default' : missing.length > 0 ? 'destructive' : 'outline'}>
              {loading
                ? 'Checking…'
                : ready
                  ? 'All tools ready'
                  : `${missing.length} of ${binaries.length} unavailable`}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void recheck()}
            >
              {loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Re-check
            </Button>
          </div>

          {!loading && missing.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Some engines are unavailable</AlertTitle>
              <AlertDescription>
                Downloads routed to a missing engine will fail. Run{' '}
                <code className="border bg-muted px-1 py-0.5">npm run sidecars</code> to fetch
                the binaries again.
              </AlertDescription>
            </Alert>
          ) : null}

          <Separator />

          <div className="flex flex-col">
            {loading && binaries.length === 0
              ? Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                    <Skeleton className="h-5 w-16" />
                  </div>
                ))
              : binaries.map((binary, index) => (
                  <div key={binary.key}>
                    {index > 0 ? <Separator /> : null}
                    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{binary.name}</span>
                          <Badge variant={binary.ok ? 'default' : 'destructive'}>
                            {binary.ok ? (
                              <CircleCheckIcon />
                            ) : (
                              <TriangleAlertIcon />
                            )}
                            {binary.ok ? 'Ready' : 'Missing'}
                          </Badge>
                        </div>
                        <span className="truncate text-xs text-muted-foreground" title={binary.path ?? undefined}>
                          {binary.version ?? binary.error ?? 'No version reported'}
                        </span>
                        {!binary.ok && binary.hint ? (
                          <span className="text-xs text-muted-foreground">{binary.hint}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
          </div>
        </CardContent>
      </Card>

      {appInfo ? (
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardDescription>Runtime details, useful when reporting a problem.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            <KeyValue label="Version" value={appInfo.version} />
            <Separator />
            <KeyValue label="Target" value={appInfo.targetTriple} />
            <Separator />
            <KeyValue label="Data directory" value={appInfo.dataDir} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </div>
  )
}
