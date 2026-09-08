'use client';

import {
  AlertTriangle,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  Video,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TaskManager } from '@/components/publish/TaskManager';
import { Button } from '@/components/ui/button';
import {
  isTikTokVideoListUiEnabled,
  shouldPromptTikTokVideoListReauthorization,
} from '@/lib/tiktok/video-list-rollout';

const TIKTOK_VIDEO_LIST_UI_ENABLED = isTikTokVideoListUiEnabled();

interface TikTokVideoAccount {
  id: string;
  username: string | null;
  display_name: string | null;
  scopes: string[];
  status: string;
}

interface TikTokVideoRow {
  id: string;
  create_time?: number;
  cover_image_url?: string;
  share_url?: string;
  video_description?: string;
  duration?: number;
  title?: string;
  like_count: number;
  comment_count: number;
  share_count: number;
  view_count: number;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function accountLabel(account: TikTokVideoAccount) {
  return account.username ? `@${account.username}` : account.display_name || 'TikTok 账号';
}

function accountOptionLabel(account: TikTokVideoAccount) {
  const label = accountLabel(account);
  return account.scopes.includes('video.list') ? label : `${label}（缺少视频列表权限）`;
}

export function TikTokVideoManager() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<TikTokVideoAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [videos, setVideos] = useState<TikTokVideoRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [error, setError] = useState('');
  const videoRequestRef = useRef(0);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );
  const requiresReauthorization = Boolean(
    selectedAccount && shouldPromptTikTokVideoListReauthorization(selectedAccount.scopes)
  );

  useEffect(() => {
    if (!TIKTOK_VIDEO_LIST_UI_ENABLED) {
      setLoadingAccounts(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/publish/accounts');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取账号失败');
        if (cancelled) return;
        const available = (data.accounts || []).filter(
          (account: TikTokVideoAccount) => account.status === 'active'
        );
        setAccounts(available);
        setSelectedAccountId((current) => current || available[0]?.id || '');
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : '读取账号失败');
        }
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadVideos = useCallback(async (pageCursor: number | null, append = false) => {
    if (!TIKTOK_VIDEO_LIST_UI_ENABLED) return;
    const requestId = videoRequestRef.current + 1;
    videoRequestRef.current = requestId;
    setError('');
    if (!selectedAccountId || requiresReauthorization) {
      setVideos([]);
      setCursor(null);
      setHasMore(false);
      setLoadingVideos(false);
      return;
    }

    setLoadingVideos(true);
    if (!append) setVideos([]);
    try {
      const params = new URLSearchParams({ account_id: selectedAccountId });
      if (pageCursor !== null) params.set('cursor', String(pageCursor));
      const response = await fetch(`/api/tiktok/videos?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取 TikTok 视频失败');
      if (videoRequestRef.current !== requestId) return;
      setVideos((current) => {
        const received = (data.videos || []) as TikTokVideoRow[];
        const nextVideos = append ? [...current, ...received] : received;
        const deduplicated = new Map<string, TikTokVideoRow>();
        nextVideos.forEach((video) => deduplicated.set(video.id, video));
        return [...deduplicated.values()];
      });
      setCursor(typeof data.next_cursor === 'number' ? data.next_cursor : null);
      setHasMore(data.has_more === true);
    } catch (fetchError) {
      if (videoRequestRef.current !== requestId) return;
      setError(fetchError instanceof Error ? fetchError.message : '读取 TikTok 视频失败');
    } finally {
      if (videoRequestRef.current === requestId) setLoadingVideos(false);
    }
  }, [requiresReauthorization, selectedAccountId]);

  useEffect(() => {
    void loadVideos(null, false);
  }, [loadVideos]);

  return (
    <div className="space-y-6">
      {TIKTOK_VIDEO_LIST_UI_ENABLED ? (
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">TikTok 公开视频</h2>
            <p className="mt-1 text-sm text-white/45">按发布时间读取，并展示点赞、评论、分享和播放数据。</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={loadingAccounts}
              className="h-10 min-w-56 rounded-lg border border-white/10 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-cyan-400/40"
            >
              {accounts.length === 0 && <option value="">暂无可用账号</option>}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountOptionLabel(account)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="mermaid-ghost"
              disabled={!selectedAccountId || loadingVideos || requiresReauthorization}
              onClick={() => void loadVideos(null, false)}
            >
              {loadingVideos ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              刷新
            </Button>
          </div>
        </div>

        {requiresReauthorization && (
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <p className="text-sm font-semibold text-amber-100">该账号需要重新授权</p>
                <p className="mt-1 text-xs text-amber-100/60">已有授权不包含 video.list，暂时无法读取视频与统计数据。</p>
              </div>
            </div>
            <Button type="button" variant="mermaid-ghost" onClick={() => router.push('/tiktok-publish/accounts')}>
              前往账号管理
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loadingAccounts && accounts.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-white/40">
            请先绑定一个普通 TikTok 发布账号。
          </div>
        )}

        {!requiresReauthorization && selectedAccountId && (
          <>
            {loadingVideos && videos.length === 0 && (
              <div className="flex items-center justify-center py-16 text-white/45">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                正在读取视频数据
              </div>
            )}
            {!loadingVideos && videos.length === 0 && !error && (
              <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-14 text-white/40">
                <Video className="mb-3 h-8 w-8" />
                暂无可展示的公开视频
              </div>
            )}
            {videos.length > 0 && (
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {videos.map((video) => (
                  <article key={video.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
                    <div
                      className="aspect-video bg-white/5 bg-cover bg-center"
                      style={video.cover_image_url ? { backgroundImage: `url("${video.cover_image_url}")` } : undefined}
                    />
                    <div className="space-y-3 p-4">
                      <div>
                        <h3 className="line-clamp-1 text-sm font-semibold text-white">
                          {video.title || video.video_description || `TikTok 视频 ${video.id.slice(-6)}`}
                        </h3>
                        <p className="mt-1 text-xs text-white/35">
                          {video.create_time
                            ? new Date(video.create_time * 1000).toLocaleString('zh-CN')
                            : '发布时间未知'}
                          {video.duration ? ` · ${video.duration}s` : ''}
                        </p>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        {[
                          { Icon: Eye, value: video.view_count, label: '播放' },
                          { Icon: Heart, value: video.like_count, label: '点赞' },
                          { Icon: MessageCircle, value: video.comment_count, label: '评论' },
                          { Icon: Share2, value: video.share_count, label: '分享' },
                        ].map(({ Icon, value, label }) => (
                          <div key={label} className="rounded-lg bg-white/[0.04] px-1 py-2">
                            <Icon className="mx-auto h-3.5 w-3.5 text-cyan-300/70" />
                            <div className="mt-1 text-xs font-semibold text-white/80">{formatNumber(Number(value))}</div>
                            <div className="text-[10px] text-white/30">{label}</div>
                          </div>
                        ))}
                      </div>
                      {video.share_url && (
                        <a
                          href={video.share_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-cyan-300/80 hover:text-cyan-200"
                        >
                          在 TikTok 查看
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {hasMore && (
              <div className="mt-5 flex justify-center">
                <Button type="button" variant="mermaid-ghost" disabled={loadingVideos} onClick={() => void loadVideos(cursor, true)}>
                  {loadingVideos && <Loader2 className="h-4 w-4 animate-spin" />}
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold text-white">TikTok 公开视频</h2>
          <p className="mt-2 text-sm text-white/45">
            视频列表与统计功能当前环境暂未开放，现有发布授权和发布任务不受影响。
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">发布任务</h2>
          <p className="mt-1 text-sm text-white/40">保留现有单次发布、多任务发布与任务统计管理。</p>
        </div>
        <TaskManager />
      </section>
    </div>
  );
}
