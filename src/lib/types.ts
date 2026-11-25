export type Backend = 'ytdlp' | 'galleryDl' | 'aria2' | 'spotDl'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface JobSnapshot {
  id: string
  url: string
  title: string
  backend: Backend
  status: JobStatus
  percent: number | null
  downloadedBytes: number
  totalBytes: number | null
  speedBytesPerSec: number | null
  etaSeconds: number | null
  itemsDone: number
  itemsTotal: number | null
  outputPath: string | null
  message: string | null
  error: string | null
  createdAt: number
  finishedAt: number | null
  logTail: string[]
  format?: FormatOverride | null
}

export interface JobRequest {
  url: string
  backend: Backend
  outputDir?: string | null
  title?: string | null
  format?: FormatOverride | null
}

/** Per-download yt-dlp format choice; unset fields fall back to Settings. */
export interface FormatOverride {
  format?: string | null
  audioOnly?: boolean | null
  audioFormat?: string | null
  container?: string | null
}

export interface BackendArgs {
  ytdlp: string
  galleryDl: string
  aria2: string
  spotDl: string
}

export interface Settings {
  outputDir: string
  maxConcurrent: number
  retries: number
  aria2Connections: number
  cookieFile: string | null
  cookieBrowser: string | null
  videoFormat: string
  audioOnly: boolean
  audioFormat: string
  videoContainer: string
  spotifyFormat: string
  spotifyBitrate: string
  extraArgs: BackendArgs
  openFolderOnComplete: boolean
  insecureTls: boolean
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  backend: Backend
  status: JobStatus
  outputPath: string | null
  totalBytes: number | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export interface BinaryStatus {
  key: string
  name: string
  ok: boolean
  version: string | null
  path: string | null
  error: string | null
  hint: string | null
}

export interface ProbeResult {
  status: number
  contentType: string | null
  contentLength: number | null
  fileName: string | null
  isHtml: boolean
  ok: boolean
  error: string | null
}

export interface AppInfo {
  version: string
  targetTriple: string
  dataDir: string
}

export interface LogEvent {
  id: string
  line: string
}
