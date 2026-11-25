import { create } from 'zustand'
import * as ipc from './ipc'
import type {
  Backend,
  BinaryStatus,
  HistoryEntry,
  JobSnapshot,
  Settings,
} from './types'
import { detectBackend, normalizeInput, refineWithProbe } from './detect'

export type ViewKey = 'downloads' | 'history' | 'doctor' | 'settings'

/** Backends that are only used when the user forces them. */
export interface OverrideState {
  backend: Backend | null
}

interface AppState {
  view: ViewKey
  setView: (view: ViewKey) => void

  url: string
  setUrl: (url: string) => void

  detected: Backend
  detectedReason: string
  probing: boolean
  override: Backend | null
  setOverride: (backend: Backend | null) => void
  effectiveBackend: () => Backend

  jobs: JobSnapshot[]
  settings: Settings | null
  history: HistoryEntry[]
  binaries: BinaryStatus[]
  binariesLoading: boolean
  appInfo: { version: string; targetTriple: string; dataDir: string } | null
  error: string | null

  initialize: () => Promise<void>
  submit: () => Promise<void>
  cancel: (id: string) => Promise<void>
  retry: (id: string) => Promise<void>
  clearFinished: () => Promise<void>
  refreshHistory: () => Promise<void>
  deleteHistory: (id: string) => Promise<void>
  clearHistoryAll: () => Promise<void>
  recheckBinaries: () => Promise<void>
  saveSettings: (settings: Settings) => Promise<void>
  applyJobUpdate: (job: JobSnapshot) => void
  setError: (message: string | null) => void
}

function upsertJob(jobs: JobSnapshot[], incoming: JobSnapshot): JobSnapshot[] {
  const index = jobs.findIndex((job) => job.id === incoming.id)
  if (index === -1) {
    return [...jobs, incoming]
  }
  const next = jobs.slice()
  next[index] = incoming
  return next
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'downloads',
  setView: (view) => set({ view }),

  url: '',
  setUrl: (url) => {
    const detection = detectBackend(url)
    set({
      url,
      detected: detection.backend,
      detectedReason: detection.reason,
    })

    // Ambiguous URLs get a HEAD probe in the background, debounced by the
    // input component. Only run it for URL-shaped input.
    if (detection.needsProbe && ipc.isTauri) {
      const target = normalizeInput(url)
      set({ probing: true })
      void ipc
        .probeUrl(target)
        .then((probe) => {
          // Ignore stale responses for a URL the user has already changed.
          if (get().url !== url) return
          const refined = refineWithProbe(detection, probe)
          set({ detected: refined.backend, detectedReason: refined.reason })
        })
        .catch(() => {
          /* probe is best-effort */
        })
        .finally(() => {
          if (get().url === url) set({ probing: false })
        })
    } else {
      set({ probing: false })
    }
  },

  detected: 'ytdlp',
  detectedReason: 'Waiting for a URL',
  probing: false,
  override: null,
  setOverride: (backend) => set({ override: backend }),
  effectiveBackend: () => {
    const { override, detected } = get()
    return override ?? detected
  },

  jobs: [],
  settings: null,
  history: [],
  binaries: [],
  binariesLoading: false,
  appInfo: null,
  error: null,

  initialize: async () => {
    if (!ipc.isTauri) {
      set({ error: 'This app must run inside the Tauri window (use `npm run tauri dev`).' })
      return
    }

    try {
      const [settings, jobs, history, appInfo] = await Promise.all([
        ipc.getSettings(),
        ipc.listJobs(),
        ipc.getHistory(),
        ipc.getAppInfo(),
      ])
      set({ settings, jobs, history, appInfo })

      await Promise.all([
        ipc.onJobUpdate((job) => get().applyJobUpdate(job)),
        ipc.onJobLog((log) => {
          set((state) => ({
            jobs: state.jobs.map((job) =>
              job.id === log.id
                ? { ...job, logTail: [...job.logTail, log.line].slice(-200) }
                : job
            ),
          }))
        }),
        ipc.onHistoryChanged(() => {
          void get().refreshHistory()
        }),
      ])

      void get().recheckBinaries()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  submit: async () => {
    const { url, override, detected } = get()
    const trimmed = url.trim()
    if (!trimmed) return

    const backend = override ?? detected
    const target = normalizeInput(trimmed)

    try {
      set({ error: null })
      const job = await ipc.enqueueJob({
        url: target,
        backend,
        title: trimmed.length <= 120 ? trimmed : undefined,
      })
      set((state) => ({ jobs: upsertJob(state.jobs, job), url: '', override: null }))
      get().setUrl('')
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  cancel: async (id) => {
    try {
      await ipc.cancelJob(id)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  retry: async (id) => {
    try {
      const job = await ipc.retryJob(id)
      set((state) => ({ jobs: upsertJob(state.jobs, job) }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  clearFinished: async () => {
    try {
      await ipc.clearFinishedJobs()
      const jobs = await ipc.listJobs()
      set({ jobs })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  refreshHistory: async () => {
    try {
      const history = await ipc.getHistory()
      set({ history })
    } catch {
      /* non-fatal */
    }
  },

  deleteHistory: async (id) => {
    try {
      const history = await ipc.removeHistory(id)
      set({ history })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  clearHistoryAll: async () => {
    try {
      const history = await ipc.clearHistory()
      set({ history })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  recheckBinaries: async () => {
    set({ binariesLoading: true })
    try {
      const binaries = await ipc.checkBinaries()
      set({ binaries })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ binariesLoading: false })
    }
  },

  saveSettings: async (settings) => {
    try {
      const saved = await ipc.saveSettings(settings)
      set({ settings: saved, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  applyJobUpdate: (job) => {
    set((state) => ({ jobs: upsertJob(state.jobs, job) }))
  },

  setError: (message) => set({ error: message }),
}))
