const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')
const owner = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const uploadId = '33333333-3333-4333-8333-333333333333'
function load(file, imports = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => imports[name] ?? require(name), URL, Date, process: { env: {} },
    Blob, FormData, Uint8Array, atob, AbortSignal, TextDecoder, ...globals })
  return exports
}
const contract = load('src/lib/publish/private-preview-contract.ts')
test('range parser supports seek/open/suffix and rejects multi-range/overflow/invalid bounds', () => {
  for (const [input, expected] of [[null,null],['bytes=0-3',{start:0,end:3}],['bytes=5-',{start:5,end:9}],['bytes=-3',{start:7,end:9}],['bytes=0-999',{start:0,end:9}]]) {
    assert.equal(JSON.stringify(contract.previewRange(input,10)),JSON.stringify(expected))
  }
  for (const input of ['bytes=10-','bytes=4-2','bytes=-0','bytes=0-1,4-5','bytes=-','bytes=99999999999999999-','bad']) assert.throws(() => contract.previewRange(input,10))
})
test('POST policy fixes exact length/key/MIME, private ACL and immutable writes', () => {
  const key = contract.previewKey(owner,uploadId,'video')
  const policy = contract.previewPostPolicy('private-bucket',key,'video/mp4',123,'future')
  const serialized = JSON.stringify(policy)
  for (const value of ['content-length-range', '123', 'private', 'x-oss-forbid-overwrite', 'video/mp4', key]) assert.ok(serialized.includes(value))
  assert.throws(() => contract.previewKey('../other',uploadId,'video'))
  assert.throws(() => contract.previewKey(owner,uploadId,'../x'))
})
function harness(options = {}) {
  const calls = []
  const row = { item_id:itemId, owner_id:owner, upload_id:uploadId, ready:false, video_size:10,
    video_type:'video/mp4', poster_size:4, expires_at:new Date(Date.now()+600000).toISOString(), ...options.row }
  let updating = false
  const adminQuery = {
    select() { return this }, eq() { return this }, gt() { return this },
    update() { updating=true; calls.push('update'); return this },
    maybeSingle: async () => ({ data: options.missing ? null : row, error: options.dbError ?? null }),
    then(resolve) { resolve({ data: options.zeroRows ? [] : [{item_id:itemId}], error: options.dbError ?? null }) },
  }
  const scopedQuery = { select() { return this }, eq(name,value) { calls.push([name,value]); return this },
    maybeSingle: async () => ({ data: options.notOwned ? null : {id:itemId,tiktok_transfer_method:'FILE_UPLOAD',source_video_size_bytes:10,source_video_mime_type:'video/mp4'}, error:null }) }
  const storage = {
    assertPrivate: async () => { calls.push('assertPrivate') },
    verify: async () => { calls.push('verify'); if(options.invalidObject) throw new Error('raw secret URL') },
    readUrl: () => 'https://private.invalid/signed-secret',
    upload: () => ({ url:'https://private.invalid',fields:{} }),
  }
  const route = load('src/app/api/publish/previews/[itemId]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient:async () => ({auth:{getUser:async()=>({data:{user:options.unauth?null:{id:owner}},error:null})},from:()=>scopedQuery}) },
    '@/lib/supabase/admin': { createAdminClient:() => { calls.push('admin'); return { from:()=>adminQuery } } },
    '@/lib/publish/private-preview-storage': { previewStorage:()=> {calls.push('storage');return storage} },
    '@/lib/publish/private-preview-contract': contract,
  }, { fetch: options.fetch ?? (async () => new Response('2345', {status:206,headers:{'content-length':'4','content-range':'bytes 2-5/10'}})) })
  return { route,calls,updated:()=>updating }
}
const context = { params:Promise.resolve({itemId}) }
const request = (method='GET', body, extra={}) => new NextRequest(`https://app.test/api/publish/previews/${itemId}`, {
  method, headers:{ origin:'https://app.test',...(body?{'content-type':'application/json'}:{}),...extra },
  ...(body ? {body:JSON.stringify(body)}:{}),
})
test('unauthenticated and foreign-owned requests never touch admin or storage', async () => {
  for (const opts of [{unauth:true},{notOwned:true}]) for (const method of ['GET','POST']) {
    const h=harness(opts)
    const response=await h.route[method](request(method,method==='POST'?{action:'reserve',posterSize:4}:undefined),context)
    assert.equal(response.status,opts.unauth?401:404)
    assert.equal(h.calls.includes('admin'),false)
    assert.equal(h.calls.includes('storage'),false)
    if(!opts.unauth) assert.ok(h.calls.some(call=>Array.isArray(call)&&call[0]==='publish_tasks.user_id'&&call[1]===owner))
  }
})
test('cross-origin upload capability request fails before sensitive access', async () => {
  const h=harness()
  assert.equal((await h.route.POST(request('POST',{action:'reserve',posterSize:4},{origin:'https://evil.test'}),context)).status,403)
  assert.equal(h.calls.length,0)
})
test('finalize refuses missing reservation, expired capability, failed HEAD and zero-row CAS', async () => {
  for(const opts of [{missing:true},{row:{expires_at:'2000-01-01'}},{invalidObject:true},{zeroRows:true},{dbError:{code:'db-down'}}]) {
    const h=harness(opts)
    const response=await h.route.POST(request('POST',{action:'finalize',uploadId}),context)
    assert.ok(response.status>=400)
    assert.doesNotMatch(await response.text(), /signed-secret|raw secret/)
    if(!opts.zeroRows) assert.equal(h.updated(),false)
  }
})
test('playback proxies a validated byte range without exposing object location', async () => {
  const h=harness({row:{ready:true}})
  const response=await h.route.GET(request('GET',undefined,{range:'bytes=2-5'}),context)
  assert.equal(response.status,206)
  assert.equal(response.headers.get('content-range'),'bytes 2-5/10')
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('location'),null)
  assert.equal(await response.text(),'2345')
})
test('invalid range and mismatched upstream response never stream arbitrary bytes', async () => {
  const h=harness({row:{ready:true}})
  assert.equal((await h.route.GET(request('GET',undefined,{range:'bytes=12-'}),context)).status,416)
  const mismatch=harness({row:{ready:true},fetch:async()=>new Response('oops',{status:200,headers:{'content-length':'4'}})})
  assert.equal((await mismatch.route.GET(request('GET',undefined,{range:'bytes=2-5'}),context)).status,502)
})
test('client confirms server readiness after lost upload response; never invokes provider', async () => {
  const urls=[]
  const client=load('src/lib/publish/save-task-preview.ts',{}, { fetch:async (url,init) => {
    urls.push(url)
    if(url.startsWith('https://')) throw new Error('lost response')
    const body=JSON.parse(init.body)
    if(body.action==='reserve') return {ok:true,json:async()=>({uploadId,videoSize:5,videoType:'video/mp4',video:{url:'https://private.invalid',fields:{}},poster:{url:'https://private.invalid',fields:{}}})}
    return {ok:true,json:async()=>({ready:true})}
  } })
  await client.saveTaskPreview(itemId,new Blob(['video']),'data:image/jpeg;base64,YQ==')
  assert.equal(urls.length,4)
  assert.ok(urls.every(url=>!url.includes('file-upload/init')))
})
test('migration queues cascade deletion, excludes browser ACLs, and serializes reservation quota', () => {
  const sql=fs.readFileSync('supabase/migrations/20260916_tiktok_private_previews.sql','utf8')
  for(const pattern of [/ON DELETE CASCADE/,/AFTER DELETE/,/ENABLE ROW LEVEL SECURITY/,/FROM PUBLIC, anon, authenticated/,/FOR UPDATE OF i/,/pg_advisory_xact_lock/,/21474836480/]) assert.match(sql,pattern)
  const page=fs.readFileSync('src/app/(main)/publish/page.tsx','utf8')
  assert.ok(page.indexOf('await saveTaskPreview(')<page.indexOf('const initResponse = await fetch('))
})

test('backfill refuses a different-sized source before sending any private media', async () => {
  let calls=0
  const client=load('src/lib/publish/save-task-preview.ts',{}, {fetch:async()=>{
    calls++
    return {ok:true,json:async()=>({videoSize:100,videoType:'video/mp4'})}
  }})
  await assert.rejects(client.saveTaskPreview(itemId,new Blob(['wrong']),'data:image/jpeg;base64,YQ=='))
  assert.equal(calls,1)
})

test('wrong source metadata is rejected before reserving storage or touching admin', async () => {
  for(const metadata of [{videoSize:9,videoType:'video/mp4'},{videoSize:10,videoType:'video/webm'},{videoSize:10}]) {
    const h=harness()
    assert.equal((await h.route.POST(request('POST',{action:'reserve',posterSize:4,...metadata}),context)).status,400)
    assert.equal(h.calls.includes('admin'),false)
    assert.equal(h.calls.includes('storage'),false)
  }
})

test('cancellation after reserve and during upload prevents late finalize', async () => {
  for(const phase of ['before','reserve','upload']) {
    const controller=new AbortController()
    const calls=[]
    const client=load('src/lib/publish/save-task-preview.ts',{}, {fetch:async(url,init)=>{
      calls.push(url)
      assert.ok(init.signal)
      if(url.startsWith('https:')) { controller.abort(); throw new Error('abort') }
      if(phase==='reserve')controller.abort()
      return {ok:true,json:async()=>({uploadId,videoSize:5,videoType:'video/mp4',video:{url:'https://private.invalid',fields:{}},poster:{url:'https://private.invalid',fields:{}}})}
    }})
    if(phase==='before')controller.abort()
    await assert.rejects(client.saveTaskPreview(itemId,new Blob(['video']),'data:image/jpeg;base64,YQ==',{signal:controller.signal}))
    assert.equal(calls.filter(url=>!url.startsWith('https:')).length,phase==='before'?0:1)
  }
})

test('English preview failures never expose provider raw errors or Chinese server text', async () => {
  const client=load('src/lib/publish/save-task-preview.ts',{}, {fetch:async()=>({ok:false,json:async()=>({error:'秘密 https://secret.invalid/token'})})})
  await assert.rejects(client.saveTaskPreview(itemId,new Blob(['video']),'data:image/jpeg;base64,YQ==',{isEnglish:true}),error=>{
    assert.doesNotMatch(error.message,/[\u4e00-\u9fff]|secret.invalid|token/)
    return true
  })
})

test('private storage requires dedicated credentials and fails closed on unsafe buckets', async () => {
  const base={TIKTOK_PREVIEW_OSS_BUCKET:'preview-private-test',TIKTOK_PREVIEW_OSS_REGION:'oss-us-east-1',TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID:'test-id',TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET:'test-secret'}
  for(const issue of ['legacyCredentials','public','versioned','policy']) {
    let constructed=0
    class FakeOSS {
      constructor(){constructed++}
      async getBucketACL(){return {acl:issue==='public'?'public-read':'private'}}
      async getBucketVersioning(){return {versionStatus:issue==='versioned'?'Enabled':''}}
      async getBucketPolicy(){if(issue!=='policy')throw Object.assign(new Error('missing'),{code:'NoSuchBucketPolicy'});return {}}
    }
    const env=issue==='legacyCredentials'?{...base,TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID:'',TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET:'',ALIYUN_OSS_ACCESS_KEY_ID:'legacy',ALIYUN_OSS_ACCESS_KEY_SECRET:'legacy'}:base
    const storage=load('src/lib/publish/private-preview-storage.ts',{'./private-preview-contract':contract,'ali-oss':FakeOSS},{process:{env}})
    if(issue==='legacyCredentials'){assert.throws(()=>storage.previewStorage());assert.equal(constructed,0)}
    else await assert.rejects(storage.previewStorage().assertPrivate())
  }
})

test('cleanup refuses unsafe bucket before any database mutation', async () => {
  const source=fs.readFileSync('scripts/sweep-tiktok-previews.mjs','utf8')
    .replace(/^import .*$/gm,'').replace(/main\(\)\.catch\([\s\S]*$/,'exports.main = main;')
  for(const problem of ['public','versioned','policy']) {
    let mutations=0
    const exports={}
    class FakeOSS {
      async getBucketACL(){return {acl:problem==='public'?'public-read':'private'}}
      async getBucketVersioning(){return {versionStatus:problem==='versioned'?'Enabled':''}}
      async getBucketPolicy(){return {}}
    }
    vm.runInNewContext(source,{exports,OSS:FakeOSS,createClient:()=>({from:()=>{mutations++;throw new Error('unexpected mutation')}}),process:{argv:[],env:{TIKTOK_PREVIEW_OSS_BUCKET:'private-test',TIKTOK_PREVIEW_OSS_REGION:'oss-us-east-1',TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID:'test',TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET:'test'}},console})
    await assert.rejects(exports.main())
    assert.equal(mutations,0)
  }
})

test('poster capture bounds dimensions and releases decoder and object URL on success/error/timeout', async () => {
  for (const outcome of ['success','error','timeout','abort']) {
    const events=[]
    let timeout
    let decoder
    const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,YQ=='}
    const client=load('src/lib/publish/preview-poster.ts',{}, {
      URL:{createObjectURL:()=> 'blob:local',revokeObjectURL:()=>events.push('revoke')},
      setTimeout:fn=>{timeout=fn;return 1},clearTimeout:()=>events.push('clear'),
      document:{createElement:tag=>tag==='canvas'?canvas:(decoder={videoWidth:1920,videoHeight:1080,pause:()=>events.push('pause'),removeAttribute:()=>events.push('remove'),load:()=>events.push('load')})},
    })
    const controller=new AbortController()
    const promise=client.createPreviewPoster(new Blob(['video']),controller.signal)
    if(outcome==='success') { decoder.onloadeddata(); assert.equal(await promise,'data:image/jpeg;base64,YQ=='); assert.equal(canvas.width,640); assert.equal(canvas.height,360) }
    else { if(outcome==='error')decoder.onerror();else if(outcome==='abort')controller.abort();else timeout();await assert.rejects(promise) }
    assert.deepEqual(events,['clear','pause','remove','load','revoke'])
  }
})

test('init endpoint cannot dispatch without a ready owner-scoped private preview', async () => {
  for (const ready of [false,true]) {
    let dispatched=0
    const filters=[]
    const query={select(){return this},eq(name,value){filters.push([name,value]);return this},maybeSingle:async()=>({data:ready?{item_id:itemId}:null,error:null})}
    const route=load('src/app/api/publish/tasks/[id]/items/[itemId]/file-upload/init/route.ts',{
      'next/server':{NextResponse},
      '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:owner}},error:null})}})},
      '@/lib/supabase/admin':{createAdminClient:()=>({from:()=>query})},
      '@/lib/publish-processor':{prepareTikTokFileUpload:async()=>{dispatched++;return {}}},
    })
    const response=await route.POST(request('POST',{}),{params:Promise.resolve({id:'task',itemId})})
    assert.equal(dispatched,ready?1:0)
    assert.equal(response.status,ready?200:409)
    assert.ok(filters.some(([name,value])=>name==='owner_id'&&value===owner))
    assert.ok(filters.some(([name,value])=>name==='ready'&&value===true))
  }
})
