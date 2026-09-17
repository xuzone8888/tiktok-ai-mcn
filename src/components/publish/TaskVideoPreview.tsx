'use client'
import { useTikTokLanguage } from '@/hooks/use-tiktok-language'


import { useEffect, useRef, useState } from 'react'
import { FileVideo, Play } from 'lucide-react'
import { playableTaskVideoUrl } from '@/lib/publish/task-presentation'
import { onLocalTaskPreviewsCleared } from '@/lib/publish/local-task-preview'
import { saveTaskPreview } from '@/lib/publish/save-task-preview'
import { createPreviewPoster } from '@/lib/publish/preview-poster'

/** Authenticated, same-origin playback. Never exposes the private storage URL. */
export function TaskVideoPreview({ taskItemId, videoUrl, title, localFile = false, ownerId = '', refreshKey = '' }: {
  refreshKey?: string
  ownerId?: string
  taskItemId: string
  videoUrl?: string | null
  title: string
  localFile?: boolean
}) {
  const { tr, isEnglish, locale } = useTikTokLanguage()

  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [signedOut, setSignedOut] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const busy = useRef(false)
  const uploadController = useRef<AbortController | null>(null)
  useEffect(() => {
    generation.current++
    setSaving(false)
    setSaveError('')
    return () => {
      generation.current++
      uploadController.current?.abort()
      uploadController.current = null
      busy.current = false
    }
  }, [taskItemId, ownerId])
  useEffect(() => { setPlaying(false); setFailed(false); setSignedOut(false) }, [taskItemId, videoUrl, ownerId])
  useEffect(() => { setFailed(false) }, [refreshKey])
  useEffect(() => onLocalTaskPreviewsCleared(reason => {
    setPlaying(false)
    generation.current++
    uploadController.current?.abort()
    uploadController.current = null
    busy.current = false
    setSaving(false)
    if (reason === 'signout') setSignedOut(true)
  }), [])
  const endpoint = `/api/publish/previews/${encodeURIComponent(taskItemId)}`
  const src = signedOut ? null : localFile ? endpoint : playableTaskVideoUrl(videoUrl)
  return (
    <div onClick={event => event.stopPropagation()} className="relative aspect-video overflow-hidden rounded-md border border-white/10 bg-black/40">
      {src && !failed ? playing || !localFile ? (
        <video src={src} aria-label={title} controls playsInline preload="metadata" autoPlay={playing}
          className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <button type="button" aria-label={`${isEnglish ? 'Play' : '播放'} ${title}`} className="relative h-full w-full" onClick={() => setPlaying(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${endpoint}?kind=poster&v=${revision}`} alt={title} className="h-full w-full object-cover" onError={() => setFailed(true)} />
          <span className="absolute inset-0 flex items-center justify-center"><Play className="h-9 w-9 rounded-full bg-black/60 p-2 text-white" /></span>
        </button>
      ) : (
        <div className="flex h-full min-h-14 items-center justify-center text-white/40">
          {localFile && !signedOut ? (
            <label className="cursor-pointer px-1 text-center text-[10px] text-cyan-300" title={isEnglish ? 'Save a private video copy and cover. This does not publish to TikTok.' : '保存私有视频副本和封面，不会再次发布到 TikTok'}>
              {saving ? (isEnglish ? 'Saving…' : '保存中…') : saveError || (isEnglish ? 'Save preview' : '补存预览')}
              <input type="file" accept="video/mp4,video/quicktime,video/webm" disabled={saving} className="sr-only" onChange={async event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file || busy.current) return
                busy.current = true
                const controller = new AbortController()
                uploadController.current = controller
                const current = generation.current
                setSaving(true)
                setSaveError('')
                try {
                  const poster = await createPreviewPoster(file, controller.signal)
                  if (current !== generation.current) return
                  await saveTaskPreview(taskItemId, file, poster, { signal: controller.signal, isEnglish })
                  if (current !== generation.current) return
                  setRevision(value => value + 1)
                  setFailed(false)
                  setPlaying(false)
                } catch {
                  if (current === generation.current) setSaveError(isEnglish ? 'Save failed; retry' : '保存失败，请重试')
                } finally {
                  if (uploadController.current === controller) {
                    uploadController.current = null
                    busy.current = false
                  }
                  if (current === generation.current) setSaving(false)
                }
              }} />
            </label>
          ) : <FileVideo className="h-6 w-6" aria-label={tr("暂无预览")} />}
        </div>
      )}
    </div>
  )
}
