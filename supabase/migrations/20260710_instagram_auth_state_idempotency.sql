BEGIN;

UPDATE public.instagram_auth_states
SET status = 'expired',
    code_verifier = NULL
WHERE status = 'pending'
  AND expires_at <= NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.instagram_auth_states
    WHERE status = 'pending'
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce Instagram auth state uniqueness while a user has multiple active pending states.',
      HINT = 'Wait for the duplicate pending states to expire, then run this migration again.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_auth_states_one_pending_per_user
  ON public.instagram_auth_states(user_id)
  WHERE status = 'pending';

COMMIT;
