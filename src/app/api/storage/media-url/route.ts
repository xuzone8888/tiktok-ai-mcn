/**
 * 超级画布 · 渲染层 object key → URL 解析端点(P0 · S6,#28 渲染半)
 *
 * 画布节点只持久化 OSS object key(schema 层拒 dataURL/签名 URL 入库)。渲染层拿到 key 后经本
 * 端点换成可取用的 URL,再由客户端内存缓存/去重/TTL 消费(见 media-url-cache.ts)。**解析出的
 * 临时 URL 绝不写回节点/持久层**——那是渲染层瞬态。
 *
 * 安全约束:
 *   1) 认证闸——未登录 401(与 /canvas 硬鉴权同口径),匿名不可解析。
 *   2) key 严格校验——复用 schema.describeMediaKeyRejection(拒 dataURL/协议相对/完整或签名
 *      URL/含 query 或 fragment/绝对路径/非法字符/超长)。校验通过的 key 是**相对对象键**,
 *      故输出 host 恒为 OSS 自定义域,绝无法被诱导指向任意主机(防 SSRF/URL 泄露)。
 *   3) **归属闸(#28 不泄露跨用户对象)**——isOwnedObjectKey 只放行请求者**拥有**的对象
 *      (owner 段 === user.id,含 videos/slideshow/{userId} 等布局);非归属 403。fail-closed,
 *      无「对象本来公开」豁免。
 *   4) 响应只回**服务端由合法且归属的 key 构造**的 URL,**不回显 key**,绝不回显任意入参。
 *
 * P0 现状:画布上传走 OSS 自定义域(media.toryxai.com)公有对象(inline + 1 年缓存),故解析=
 * 直取 getPublicUrl 公有 URL,无需签名。P1 若需私有媒体,可在此换签名 URL,**客户端契约
 *(key→{url,expiresInMs})不变**;若 P1 需共享/公共资产,须在 ownership.ts 加显式白名单契约。
 */
import { NextResponse } from "next/server";

import { getPublicUrl } from "@/lib/oss";
import { createClient } from "@/lib/supabase/server";
import { describeMediaKeyRejection } from "@/lib/canvas/schema";

import { isOwnedObjectKey } from "./ownership";

export const runtime = "nodejs";

/**
 * 公有 OSS 自定义域对象无过期,但给客户端一个有界 TTL,使缓存周期性刷新;P1 换真正的签名 URL
 * 过期后,只需在此回真实 expiresInMs,客户端缓存逻辑零改动即适配。
 */
const PUBLIC_URL_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const key = new URL(request.url).searchParams.get("key");
  const rejection = describeMediaKeyRejection(key);
  if (rejection) {
    return NextResponse.json({ error: `非法 object key:${rejection}` }, { status: 400 });
  }
  const objectKey = key as string;

  // 归属闸(#28):只放行请求者拥有的对象;fail-closed,无「对象公开」豁免。
  if (!isOwnedObjectKey(objectKey, user.id)) {
    return NextResponse.json({ error: "无权访问该对象" }, { status: 403 });
  }

  // objectKey 已校验合法且归属请求者 → 输出恒为可信 OSS 自定义域公有 URL;不回显 key。
  const url = getPublicUrl(objectKey);
  return NextResponse.json({ url, expiresInMs: PUBLIC_URL_TTL_MS });
}
