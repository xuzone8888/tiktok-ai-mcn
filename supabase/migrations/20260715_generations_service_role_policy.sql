-- Scope the generations service policy to service_role. The policy created by
-- 006 had no TO clause, so PostgreSQL treated it as applying to PUBLIC.

DROP POLICY IF EXISTS "Service can manage all generations" ON public.generations;

CREATE POLICY "Service can manage all generations"
    ON public.generations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

