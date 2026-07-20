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
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: (request) => moduleMap[request] || require(request),
    setTimeout,
    clearTimeout,
  }, { filename })
  return loadedModule.exports
}

const core = loadTypeScriptModule('src/lib/social-comments/translation-core.ts')

test('canonicalizes common Chinese and English provider language labels', () => {
  assert.equal(core.canonicalizeLanguage('zh-CN'), 'zh')
  assert.equal(core.canonicalizeLanguage('Mandarin Chinese'), 'zh')
  assert.equal(core.canonicalizeLanguage('en-US'), 'en')
  assert.equal(core.canonicalizeLanguage('Spanish'), null)
})

test('does not render a duplicate translation when source already matches target language', () => {
  assert.equal(core.resolveTranslationStatus('已经很好了', '已经很好了', 'zh-CN', 'zh'), 'same_language')
  assert.equal(core.resolveTranslationStatus('Great video!', 'Great video!', 'English', 'en'), 'same_language')
  assert.equal(core.resolveTranslationStatus('Great video!', '视频很棒！', 'English', 'zh'), 'translated')
})

test('translation request chunks are unique and bounded', () => {
  const chunks = core.chunkTranslationIds(['a', 'b', 'a', 'c', 'd'], 2)
  assert.deepEqual(JSON.parse(JSON.stringify(chunks)), [['a', 'b'], ['c', 'd']])
})

test('translation rate limiting delegates to the shared database quota', async () => {
  let rpcCalls = 0
  const limiter = loadTypeScriptModule('src/lib/social-comments/translation-rate-limit.ts', {
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        rpc: async (name, params) => {
          rpcCalls += 1
          assert.equal(name, 'consume_social_comment_translation_quota')
          assert.equal(params.p_user_id, 'user-a')
          return { data: rpcCalls === 1, error: null }
        },
      }),
    },
  })
  assert.equal(await limiter.consumeCommentTranslationRequest('user-a'), true)
  assert.equal(await limiter.consumeCommentTranslationRequest('user-a'), false)
})

test('concurrent cold-cache requests share one paid provider call', async () => {
  const comment = { id: '11111111-1111-4111-8111-111111111111', message: 'hello' }
  const coreModule = core
  const makeQuery = (result) => {
    const query = {
      select() { return query },
      eq() { return query },
      in() { return query },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
    }
    return query
  }
  const admin = {
    claimed: new Set(),
    translationRows: new Map(),
    async rpc(name, params) {
      if (name === 'claim_social_comment_translations') {
        const claimed = []
        for (const claim of params.p_claims) {
          const key = `${params.p_user_id}:${params.p_target_language}:${claim.comment_id}:${claim.source_message_hash}`
          if (!this.claimed.has(key)) {
            this.claimed.add(key)
            claimed.push({ comment_id: claim.comment_id })
          }
        }
        return { data: claimed, error: null }
      }
      if (name === 'renew_social_comment_translation_claims') {
        return { data: params.p_comment_ids.map((comment_id) => ({ comment_id })), error: null }
      }
      if (name === 'complete_social_comment_translations') {
        for (const row of params.p_results) {
          this.translationRows.set(row.comment_id, {
            ...row,
            target_language: params.p_target_language,
          })
        }
        return { data: params.p_results.map(({ comment_id }) => ({ comment_id })), error: null }
      }
      if (name === 'fail_social_comment_translation_claims') return { data: [], error: null }
      throw new Error(`unexpected rpc: ${name}`)
    },
    from(table) {
      if (table === 'social_comments') return makeQuery({ data: [comment], error: null })
      if (table === 'social_comment_translations') {
        const query = makeQuery({ data: [], error: null })
        query.maybeSingle = async () => ({
          data: this.translationRows.values().next().value || null,
          error: null,
        })
        return query
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  const service = loadTypeScriptModule('src/lib/social-comments/translation-service.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/social-comments/translation-core': coreModule,
    '@/lib/social-comments/translation-provider': { createConfiguredCommentTranslationProvider: () => { throw new Error('unused') } },
  })
  let providerCalls = 0
  const provider = {
    name: 'test',
    model: 'test-model',
    async translateBatch(inputs) {
      providerCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return inputs.map((input) => ({ id: input.id, detected_source_language: 'en', translated_text: '你好' }))
    },
  }

  const [first, second] = await Promise.all([
    service.getOrCreateCommentTranslations('user-1', [comment.id], 'zh', provider),
    service.getOrCreateCommentTranslations('user-1', [comment.id], 'zh', provider),
  ])
  assert.equal(providerCalls, 1)
  assert.equal(first[0].translated_text, '你好')
  assert.equal(second[0].translated_text, '你好')
})

test('shared translation implementation covers all platforms without touching platform-specific clients', () => {
  const client = fs.readFileSync(path.join(process.cwd(), 'src/components/social-comments/SocialCommentsClient.tsx'), 'utf8')
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/social-comments/translations/route.ts'), 'utf8')
  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260720_social_comment_translations.sql'), 'utf8')
  const upgradeMigration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260720123000_social_comment_translation_claim_fencing.sql'), 'utf8')

  assert.match(client, /\/api\/social-comments\/translations/)
  assert.match(client, /CommentTranslationLine comment=\{comment\}/)
  assert.match(client, /CommentTranslationLine comment=\{reply\}/)
  assert.match(route, /getOrCreateCommentTranslations/)
  assert.match(route, /consumeCommentTranslationRequest/)
  assert.match(migration, /UNIQUE\(comment_id, target_language\)/)
  assert.match(migration, /source_message_hash/)
  assert.match(migration, /claim_social_comment_translations/)
  assert.match(migration, /consume_social_comment_translation_quota/)
  assert.match(migration, /lease_token/)
  assert.match(migration, /complete_social_comment_translations/)
  assert.match(upgradeMigration, /ADD COLUMN IF NOT EXISTS lease_token/)
  assert.match(upgradeMigration, /DROP CONSTRAINT IF EXISTS social_comment_translations_status_check/)
  assert.match(upgradeMigration, /translations\.source_message_hash = results\.source_message_hash/)
  assert.match(upgradeMigration, /translations\.lease_token = p_lease_token/)
  assert.match(upgradeMigration, /fail_social_comment_translation_claims/)
})
