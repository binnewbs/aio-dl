import { useEffect } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/toast'
import { AppSidebar } from '@/components/app-sidebar'
import { UrlBar } from '@/components/downloads/url-bar'
import { JobList } from '@/components/downloads/job-list'
import { HistoryView } from '@/components/history/history-view'
import { DoctorView } from '@/components/doctor/doctor-view'
import { SettingsView } from '@/components/settings/settings-view'

const VIEW_TITLES: Record<string, string> = {
  downloads: 'Downloads',
  history: 'History',
  doctor: 'Doctor',
  settings: 'Settings',
}

export default function App() {
  const view = useAppStore((s) => s.view)
  const initialize = useAppStore((s) => s.initialize)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)

  useEffect(() => {
    void initialize()
  }, [initialize])

  return (
    <Toaster>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <h1 className="text-sm font-medium">{VIEW_TITLES[view] ?? 'aio-dl'}</h1>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span>{error}</span>
                  <button
                    type="button"
                    className="w-fit text-xs underline underline-offset-4"
                    onClick={() => setError(null)}
                  >
                    Dismiss
                  </button>
                </AlertDescription>
              </Alert>
            ) : null}

            {view === 'downloads' ? (
              <>
                <UrlBar />
                <JobList />
              </>
            ) : null}
            {view === 'history' ? <HistoryView /> : null}
            {view === 'doctor' ? <DoctorView /> : null}
            {view === 'settings' ? <SettingsView /> : null}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </Toaster>
  )
}
