import Link from 'next/link'

import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

interface FacebookDataDeletionPageProps {
  searchParams: { code?: string }
}

export default async function FacebookDataDeletionPage({
  searchParams,
}: FacebookDataDeletionPageProps) {
  const code = typeof searchParams.code === 'string' ? searchParams.code.trim() : ''
  let status: 'completed' | 'processing' | 'failed' | 'not_found' = 'not_found'
  let completedAt: string | null = null

  if (code) {
    // The generated Database type is refreshed after the migration is deployed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data } = await admin
      .from('facebook_data_deletion_requests')
      .select('status,completed_at')
      .eq('confirmation_code', code)
      .maybeSingle()
    if (data?.status === 'completed' || data?.status === 'processing' || data?.status === 'failed') {
      status = data.status
      completedAt = typeof data.completed_at === 'string' ? data.completed_at : null
    }
  }

  const copy = {
    completed: {
      title: 'Facebook data deletion completed',
      description: 'The Facebook-related account bindings, tokens, publishing records, and cached comments associated with this authorization have been deleted from Star Gaze.',
    },
    processing: {
      title: 'Facebook data deletion is processing',
      description: 'Your request has been received. Please revisit this page using the same confirmation link.',
    },
    failed: {
      title: 'Facebook data deletion needs attention',
      description: 'We could not complete the request automatically. Contact toryxai@outlook.com and include the confirmation code below.',
    },
    not_found: {
      title: 'Facebook data deletion request not found',
      description: 'Check that the complete confirmation link was opened, or contact toryxai@outlook.com for assistance.',
    },
  }[status]

  return (
    <main className="min-h-screen bg-[#09090b] px-6 py-20 text-white">
      <section className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.04] p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Star Gaze</p>
        <h1 className="mt-4 text-3xl font-bold">{copy.title}</h1>
        <p className="mt-4 leading-7 text-white/65">{copy.description}</p>
        {code && (
          <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-wider text-white/40">Confirmation code</p>
            <p className="mt-2 break-all font-mono text-sm text-white/85">{code}</p>
            {completedAt && (
              <p className="mt-2 text-xs text-white/40">Completed: {completedAt}</p>
            )}
          </div>
        )}
        <div className="mt-8 flex gap-4 text-sm">
          <Link href="/privacy" className="text-cyan-300 hover:underline">Privacy Policy</Link>
          <Link href="/" className="text-white/60 hover:text-white">Return to Star Gaze</Link>
        </div>
      </section>
    </main>
  )
}
