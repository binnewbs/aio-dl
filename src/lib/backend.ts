import { CircleDotIcon, FilmIcon, ImageIcon, MusicIcon, type LucideIcon } from 'lucide-react'
import type { Backend, JobStatus } from './types'

export interface BackendMeta {
  label: string
  icon: LucideIcon
  description: string
  accepts: string
}

export const BACKEND_META: Record<Backend, BackendMeta> = {
  ytdlp: {
    label: 'yt-dlp',
    icon: FilmIcon,
    description: 'Video and audio from ~1800 sites',
    accepts: 'YouTube, Vimeo, Twitch, SoundCloud…',
  },
  galleryDl: {
    label: 'gallery-dl',
    icon: ImageIcon,
    description: 'Image galleries and social posts',
    accepts: 'x.com, Pixiv, Instagram, Danbooru…',
  },
  aria2: {
    label: 'aria2c',
    icon: CircleDotIcon,
    description: 'Direct file downloads with many connections',
    accepts: '.zip, .pdf, .iso, raw media…',
  },
  spotDl: {
    label: 'spotDL',
    icon: MusicIcon,
    description: 'Spotify tracks, albums and playlists',
    accepts: 'open.spotify.com, or a song name',
  },
}

export const BACKEND_ORDER: Backend[] = ['ytdlp', 'galleryDl', 'aria2', 'spotDl']

export interface StatusMeta {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

export const STATUS_META: Record<JobStatus, StatusMeta> = {
  queued: { label: 'Queued', variant: 'outline' },
  running: { label: 'Downloading', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  interrupted: { label: 'Interrupted', variant: 'outline' },
}
