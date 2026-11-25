import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AppInfo,
  Backend,
  BinaryStatus,
  HistoryEntry,
  JobRequest,
  JobSnapshot,
  LogEvent,
  ProbeResult,
  Settings,
} from './types'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function getSettings(): Promise<Settings> {
  return invoke('get_settings')
}

export function saveSettings(settings: Settings): Promise<Settings> {
  return invoke('save_settings', { settings })
}

export function getHistory(): Promise<HistoryEntry[]> {
  return invoke('get_history')
}

export function clearHistory(): Promise<HistoryEntry[]> {
  return invoke('clear_history')
}

export function removeHistory(id: string): Promise<HistoryEntry[]> {
  return invoke('remove_history', { id })
}

export function checkBinaries(): Promise<BinaryStatus[]> {
  return invoke('check_binaries')
}

export function enqueueJob(request: JobRequest): Promise<JobSnapshot> {
  return invoke('enqueue_job', { request })
}

export function listJobs(): Promise<JobSnapshot[]> {
  return invoke('list_jobs')
}

export function cancelJob(id: string): Promise<void> {
  return invoke('cancel_job', { id })
}

export function retryJob(id: string): Promise<JobSnapshot> {
  return invoke('retry_job', { id })
}

export function clearFinishedJobs(): Promise<void> {
  return invoke('clear_finished_jobs')
}

export function getAppInfo(): Promise<AppInfo> {
  return invoke('app_info')
}

export function revealPath(path: string): Promise<void> {
  return invoke('reveal_path', { path })
}

export function probeUrl(url: string): Promise<ProbeResult> {
  return invoke('probe_url', { url })
}

export function onJobUpdate(handler: (job: JobSnapshot) => void): Promise<UnlistenFn> {
  return listen<JobSnapshot>('job:update', (event) => handler(event.payload))
}

export function onJobLog(handler: (log: LogEvent) => void): Promise<UnlistenFn> {
  return listen<LogEvent>('job:log', (event) => handler(event.payload))
}

export function onHistoryChanged(handler: () => void): Promise<UnlistenFn> {
  return listen('history:changed', () => handler())
}

export function backendLabel(backend: Backend): string {
  switch (backend) {
    case 'ytdlp':
      return 'yt-dlp'
    case 'galleryDl':
      return 'gallery-dl'
    case 'aria2':
      return 'aria2c'
    case 'spotDl':
      return 'spotDL'
  }
}
