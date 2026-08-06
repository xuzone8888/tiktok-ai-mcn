# Super Canvas D6 Operations

## Production migration

`supabase/migrations/20260715_generations_service_role_policy.sql` is a
follow-up repair for the generations service policy. It is committed as an
idempotent migration but has not been applied to production. An operator must
apply it through the Supabase dashboard and verify that the authenticated own
row policies remain present.

## History query consistency

The history route reads each source in bounded keyset batches with a hard cap
of 2,048 source rows. Production has no supporting RPC or snapshot table, so
multiple requests and multiple batches do not share an MVCC snapshot. Rows
inserted or updated while a read is in progress can change aggregate counts or
page membership. The route does not claim snapshot semantics.

The cap remains fail-closed: a source with more than 2,048 matching rows
returns `HISTORY_SOURCE_TOO_LARGE` instead of partial counts. The products
relation is an optional enhancement source; only an explicit relation-missing
database code marks it `unavailable`. Permission, network, and other database
failures remain hard errors.
