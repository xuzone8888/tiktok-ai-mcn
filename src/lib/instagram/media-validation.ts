import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { INSTAGRAM_MAX_VIDEO_FILE_SIZE_BYTES } from '@/lib/publish/platform-media'

const execFileAsync = promisify(execFile)
const FFPROBE_TIMEOUT_MS = 15_000
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024
const MIN_DURATION_SECONDS = 3
const MAX_DURATION_SECONDS = 15 * 60
const MIN_FRAME_RATE = 23
const MAX_FRAME_RATE = 60
const MAX_HORIZONTAL_PIXELS = 1920
const MAX_VIDEO_BIT_RATE = 25_000_000
const MAX_AUDIO_BIT_RATE = 128_000

export interface InstagramMediaStream {
  codec_type?: string
  codec_name?: string
  profile?: string
  pix_fmt?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  field_order?: string
  bit_rate?: string
  sample_rate?: string
  channels?: number
  duration?: string
}

export interface InstagramFfprobeOutput {
  format?: {
    format_name?: string
    size?: string
    duration?: string
    bit_rate?: string
  }
  streams?: InstagramMediaStream[]
}

export interface InstagramMediaMetadata {
  formatName: string
  size: number | null
  duration: number | null
  overallBitRate: number | null
  video: {
    codec: string
    profile: string | null
    pixelFormat: string | null
    width: number | null
    height: number | null
    frameRate: number | null
    fieldOrder: string | null
    bitRate: number | null
  } | null
  audio: {
    codec: string
    sampleRate: number | null
    channels: number | null
    bitRate: number | null
  } | null
}

export interface InstagramMediaValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export class InstagramMediaProbeError extends Error {
  code: 'media_unreadable' | 'probe_unavailable' | 'probe_timeout' | 'probe_failed' | 'probe_invalid_output'

  constructor(code: InstagramMediaProbeError['code']) {
    const messageByCode = {
      media_unreadable: '视频文件损坏或无法读取',
      probe_unavailable: '视频媒体检查工具不可用',
      probe_timeout: '视频媒体检查超时',
      probe_failed: '无法读取视频媒体参数',
      probe_invalid_output: '视频媒体参数无效',
    }
    super(messageByCode[code])
    this.name = 'InstagramMediaProbeError'
    this.code = code
  }
}

function parseFiniteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseFrameRate(value: string | undefined) {
  if (!value) return null
  const [numeratorValue, denominatorValue] = value.split('/')
  const numerator = Number(numeratorValue)
  const denominator = denominatorValue === undefined ? 1 : Number(denominatorValue)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  const rate = numerator / denominator
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

export function parseInstagramFfprobeOutput(output: InstagramFfprobeOutput): InstagramMediaMetadata {
  const streams = Array.isArray(output.streams) ? output.streams : []
  const videoStream = streams.find((stream) => stream.codec_type === 'video')
  const audioStream = streams.find((stream) => stream.codec_type === 'audio')
  const formatDuration = parseFiniteNumber(output.format?.duration)

  return {
    formatName: output.format?.format_name?.trim().toLowerCase() || '',
    size: parseFiniteNumber(output.format?.size),
    duration: formatDuration ?? parseFiniteNumber(videoStream?.duration),
    overallBitRate: parseFiniteNumber(output.format?.bit_rate),
    video: videoStream ? {
      codec: videoStream.codec_name?.trim().toLowerCase() || '',
      profile: videoStream.profile?.trim() || null,
      pixelFormat: videoStream.pix_fmt?.trim().toLowerCase() || null,
      width: parseFiniteNumber(videoStream.width),
      height: parseFiniteNumber(videoStream.height),
      frameRate: parseFrameRate(videoStream.avg_frame_rate),
      fieldOrder: videoStream.field_order?.trim().toLowerCase() || null,
      bitRate: parseFiniteNumber(videoStream.bit_rate),
    } : null,
    audio: audioStream ? {
      codec: audioStream.codec_name?.trim().toLowerCase() || '',
      sampleRate: parseFiniteNumber(audioStream.sample_rate),
      channels: parseFiniteNumber(audioStream.channels),
      bitRate: parseFiniteNumber(audioStream.bit_rate),
    } : null,
  }
}

function isSupportedContainer(formatName: string) {
  const names = new Set(formatName.split(',').map((value) => value.trim()).filter(Boolean))
  return names.has('mov') || names.has('mp4')
}

function isFourTwoZeroPixelFormat(pixelFormat: string | null) {
  if (!pixelFormat) return false
  return /(?:^|_)yuvj?420p(?:\d+le|\d+be)?$/.test(pixelFormat) || pixelFormat === 'nv12'
}

export function validateInstagramMediaMetadata(metadata: InstagramMediaMetadata): InstagramMediaValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isSupportedContainer(metadata.formatName)) errors.push('container_unsupported')
  if (metadata.size === null || metadata.size <= 0) errors.push('file_size_invalid')
  else if (metadata.size > INSTAGRAM_MAX_VIDEO_FILE_SIZE_BYTES) errors.push('file_too_large')

  if (metadata.duration === null) errors.push('duration_unavailable')
  else if (metadata.duration < MIN_DURATION_SECONDS || metadata.duration > MAX_DURATION_SECONDS) {
    errors.push('duration_out_of_range')
  }

  if (!metadata.video) {
    errors.push('video_stream_missing')
  } else {
    if (!['h264', 'hevc'].includes(metadata.video.codec)) errors.push('video_codec_unsupported')
    if (metadata.video.frameRate === null) errors.push('frame_rate_unavailable')
    else if (metadata.video.frameRate < MIN_FRAME_RATE || metadata.video.frameRate > MAX_FRAME_RATE) {
      errors.push('frame_rate_out_of_range')
    }
    if (
      metadata.video.width === null ||
      metadata.video.height === null ||
      metadata.video.width <= 0 ||
      metadata.video.height <= 0
    ) {
      errors.push('dimensions_invalid')
    } else {
      if (metadata.video.width > MAX_HORIZONTAL_PIXELS) errors.push('horizontal_pixels_exceeded')
      const aspectRatio = metadata.video.width / metadata.video.height
      if (Math.abs(aspectRatio - 9 / 16) > 0.02) warnings.push('aspect_ratio_not_recommended')
    }
    if (!isFourTwoZeroPixelFormat(metadata.video.pixelFormat)) warnings.push('pixel_format_unconfirmed')
    if (metadata.video.bitRate === null) warnings.push('video_bitrate_unavailable')
    else if (metadata.video.bitRate > MAX_VIDEO_BIT_RATE) errors.push('video_bitrate_exceeded')
  }

  if (!metadata.audio) {
    warnings.push('audio_stream_missing')
  } else {
    if (metadata.audio.codec !== 'aac') errors.push('audio_codec_unsupported')
    if (metadata.audio.sampleRate !== 48_000) errors.push('audio_sample_rate_unsupported')
    if (metadata.audio.bitRate === null) warnings.push('audio_bitrate_unavailable')
    else if (metadata.audio.bitRate > MAX_AUDIO_BIT_RATE) errors.push('audio_bitrate_exceeded')
  }

  return { valid: errors.length === 0, errors, warnings }
}

export async function probeInstagramMedia(filePath: string): Promise<InstagramMediaMetadata> {
  const command = process.env.FFPROBE_CMD?.trim() || 'ffprobe'
  let stdout: string
  try {
    const result = await execFileAsync(command, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], {
      encoding: 'utf8',
      timeout: FFPROBE_TIMEOUT_MS,
      maxBuffer: FFPROBE_MAX_OUTPUT_BYTES,
    })
    stdout = result.stdout
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
    if (failure.code === 'ENOENT') throw new InstagramMediaProbeError('probe_unavailable')
    if (failure.killed || failure.signal === 'SIGTERM') throw new InstagramMediaProbeError('probe_timeout')
    if (typeof failure.code === 'number') throw new InstagramMediaProbeError('media_unreadable')
    throw new InstagramMediaProbeError('probe_failed')
  }

  let output: InstagramFfprobeOutput
  try {
    output = JSON.parse(stdout) as InstagramFfprobeOutput
  } catch {
    throw new InstagramMediaProbeError('probe_invalid_output')
  }
  return parseInstagramFfprobeOutput(output)
}
