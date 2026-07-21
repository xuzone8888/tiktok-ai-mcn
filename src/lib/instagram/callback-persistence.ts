export class InstagramCallbackPersistenceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InstagramCallbackPersistenceError'
    this.code = code
  }
}

interface PersistInstagramCallbackAccountInput {
  account: Record<string, unknown>
  token: Record<string, unknown>
  userId: string
  now: string
}

async function setInstagramAccountUnavailable(admin: any, accountId: string, userId: string, now: string) {
  const { data, error } = await admin
    .from('instagram_accounts')
    .update({ status: 'revoked', updated_at: now })
    .eq('id', accountId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new InstagramCallbackPersistenceError(
      'account_compensation_failed',
      'Instagram account could not be returned to a safe state.'
    )
  }
}

export async function persistInstagramCallbackAccount(
  admin: any,
  input: PersistInstagramCallbackAccountInput
): Promise<string> {
  const { data: savedAccount, error: accountError } = await admin
    .from('instagram_accounts')
    .upsert({
      ...input.account,
      user_id: input.userId,
      status: 'revoked',
      updated_at: input.now,
    }, {
      onConflict: 'user_id,channel_id',
    })
    .select('id')
    .single()

  if (accountError || !savedAccount?.id) {
    throw new InstagramCallbackPersistenceError(
      'account_persistence_failed',
      'Instagram account could not be saved.'
    )
  }

  const accountId = String(savedAccount.id)
  const { error: tokenError } = await admin
    .from('instagram_account_tokens')
    .upsert({
      ...input.token,
      account_id: accountId,
      updated_at: input.now,
    }, {
      onConflict: 'account_id',
    })

  if (tokenError) {
    // The staging write already made this account unavailable.
    throw new InstagramCallbackPersistenceError(
      'token_persistence_failed',
      'Instagram authorization could not be saved.'
    )
  }

  const { data: activatedAccount, error: activationError } = await admin
    .from('instagram_accounts')
    .update({ status: 'active', updated_at: input.now })
    .eq('id', accountId)
    .eq('user_id', input.userId)
    .eq('status', 'revoked')
    .select('id')
    .maybeSingle()

  if (activationError || !activatedAccount) {
    await setInstagramAccountUnavailable(admin, accountId, input.userId, input.now)
    throw new InstagramCallbackPersistenceError(
      'account_activation_failed',
      'Instagram account activation could not be completed.'
    )
  }

  return accountId
}

export async function revokeInstagramCallbackAccounts(
  admin: any,
  accountIds: string[],
  userId: string,
  now: string
) {
  for (const accountId of accountIds) {
    await setInstagramAccountUnavailable(admin, accountId, userId, now)
  }
}

export async function completeInstagramAuthState(admin: any, state: string, now: string) {
  const { data, error } = await admin
    .from('instagram_auth_states')
    .update({
      status: 'completed',
      code_verifier: null,
      completed_at: now,
      error_code: null,
      error_message: null,
    })
    .eq('state', state)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new InstagramCallbackPersistenceError(
      'auth_state_completion_failed',
      'Instagram authorization completion could not be recorded.'
    )
  }
}

export async function failInstagramAuthState(
  admin: any,
  state: string,
  input: { code: string; message: string; now: string; status?: 'failed' | 'expired' }
) {
  const { data, error } = await admin
    .from('instagram_auth_states')
    .update({
      status: input.status || 'failed',
      error_code: input.code,
      error_message: input.message,
      code_verifier: null,
      completed_at: input.now,
    })
    .eq('state', state)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new InstagramCallbackPersistenceError(
      'auth_state_failure_persistence_failed',
      'Instagram authorization failure could not be recorded.'
    )
  }
}
