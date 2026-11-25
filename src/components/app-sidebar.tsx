import {
  ActivityIcon,
  DownloadIcon,
  HistoryIcon,
  SettingsIcon,
} from 'lucide-react'
import { useAppStore, type ViewKey } from '@/lib/store'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'

const NAV: { key: ViewKey; label: string; icon: typeof DownloadIcon }[] = [
  { key: 'downloads', label: 'Downloads', icon: DownloadIcon },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'doctor', label: 'Doctor', icon: ActivityIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
]

export function AppSidebar() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const jobs = useAppStore((s) => s.jobs)
  const binaries = useAppStore((s) => s.binaries)
  const appInfo = useAppStore((s) => s.appInfo)

  const activeCount = jobs.filter(
    (job) => job.status === 'running' || job.status === 'queued'
  ).length
  const missingCount = binaries.filter((binary) => !binary.ok).length

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>aio-dl</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={view === item.key}
                    onClick={() => setView(item.key)}
                    tooltip={item.label}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {item.key === 'downloads' && activeCount > 0 ? (
                      <Badge variant="secondary" className="ml-auto">
                        {activeCount}
                      </Badge>
                    ) : null}
                    {item.key === 'doctor' && missingCount > 0 ? (
                      <Badge variant="destructive" className="ml-auto">
                        {missingCount}
                      </Badge>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:flex-col">
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-medium">
              {appInfo ? `v${appInfo.version}` : 'aio-dl'}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {binaries.length > 0
                ? `${binaries.filter((b) => b.ok).length}/${binaries.length} tools ready`
                : 'Checking tools…'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
