const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, moduleMap = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const loadedModule = { exports: {} }
  const localRequire = (request) => moduleMap[request] || require(request)
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    process,
  }, { filename })

  return loadedModule.exports
}

const platformMedia = loadTypeScriptModule('src/lib/publish/platform-media.ts')
const mediaValidation = loadTypeScriptModule('src/lib/instagram/media-validation.ts', {
  '@/lib/publish/platform-media': platformMedia,
})

function compliantProbe(overrides = {}) {
  return {
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      size: '921600',
      duration: '5.55',
      bit_rate: '1450000',
      ...overrides.format,
    },
    streams: overrides.streams || [
      {
        codec_type: 'video',
        codec_name: 'h264',
        profile: 'High',
        pix_fmt: 'yuv420p',
        width: 1080,
        height: 1920,
        avg_frame_rate: '30/1',
        field_order: 'progressive',
        bit_rate: '1300000',
      },
      {
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: '48000',
        channels: 2,
        bit_rate: '128000',
      },
    ],
  }
}

test('parses and accepts a compliant Instagram Reel probe', () => {
  const metadata = mediaValidation.parseInstagramFfprobeOutput(compliantProbe())
  const validation = mediaValidation.validateInstagramMediaMetadata(metadata)
  assert.equal(metadata.video.codec, 'h264')
  assert.equal(metadata.video.frameRate, 30)
  assert.equal(metadata.audio.sampleRate, 48000)
  assert.equal(validation.valid, true)
  assert.deepEqual([...validation.errors], [])
})

test('rejects unsupported codec, frame rate, duration, and dimensions', () => {
  const metadata = mediaValidation.parseInstagramFfprobeOutput(compliantProbe({
    format: { duration: '2.5' },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'vp9',
        pix_fmt: 'yuv444p',
        width: 2160,
        height: 3840,
        avg_frame_rate: '15/1',
        bit_rate: '26000000',
      },
      {
        codec_type: 'audio',
        codec_name: 'opus',
        sample_rate: '44100',
        channels: 2,
        bit_rate: '192000',
      },
    ],
  }))
  const validation = mediaValidation.validateInstagramMediaMetadata(metadata)
  assert.equal(validation.valid, false)
  for (const code of [
    'duration_out_of_range',
    'video_codec_unsupported',
    'frame_rate_out_of_range',
    'horizontal_pixels_exceeded',
    'video_bitrate_exceeded',
    'audio_codec_unsupported',
    'audio_sample_rate_unsupported',
    'audio_bitrate_exceeded',
  ]) {
    assert.equal(validation.errors.includes(code), true)
  }
  assert.equal(validation.warnings.includes('pixel_format_unconfirmed'), true)
})

test('fails closed when the probe has no video stream', () => {
  const metadata = mediaValidation.parseInstagramFfprobeOutput(compliantProbe({
    streams: [{
      codec_type: 'audio',
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
      bit_rate: '128000',
    }],
  }))
  const validation = mediaValidation.validateInstagramMediaMetadata(metadata)
  assert.equal(validation.valid, false)
  assert.equal(validation.errors.includes('video_stream_missing'), true)
})

test('rejects unsupported containers and oversized files', () => {
  const metadata = mediaValidation.parseInstagramFfprobeOutput(compliantProbe({
    format: {
      format_name: 'matroska,webm',
      size: String(1024 * 1024 * 1024 + 1),
    },
  }))
  const validation = mediaValidation.validateInstagramMediaMetadata(metadata)
  assert.equal(validation.errors.includes('container_unsupported'), true)
  assert.equal(validation.errors.includes('file_too_large'), true)
})

test('wires PUT MIME rejection before any file write and probes before commit', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/instagram/upload/local-video/[id]/route.ts'),
    'utf8'
  )
  const mimeCheck = route.indexOf('isInstagramMediaTypeAllowed(id, contentType)')
  const writeBody = route.indexOf('await writeRequestBody(request, tempPath)')
  const probe = route.indexOf('await probeInstagramMedia(tempPath)')
  const commit = route.indexOf('await rename(tempPath, filePath)')
  assert.ok(mimeCheck >= 0 && mimeCheck < writeBody)
  assert.ok(writeBody < probe && probe < commit)
  assert.ok(route.includes("if (code === 'probe_unavailable') return 503"))
  assert.ok(route.includes("if (code === 'probe_timeout') return 504"))
  assert.ok(route.includes("if (code === 'media_unreadable') return 422"))
  assert.ok(route.includes("status: error.code === 'media_not_supported' ? 422 : 400"))
})
