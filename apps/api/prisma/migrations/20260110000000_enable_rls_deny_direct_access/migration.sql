-- Deny-by-default row-level security on every public table.
--
-- WHY THIS EXISTS
--
-- RazorGrowth's entire security model assumes every read and write goes
-- through the governed API path: authenticate -> deterministic policy ->
-- human approval when required -> scoped execution authorization ->
-- provider verification -> audit ledger.
--
-- Managed Postgres platforms that auto-expose the `public` schema over a
-- REST layer (Supabase/PostgREST is the case that prompted this) break
-- that assumption completely. With the schema exposed and RLS off,
-- anyone holding the publishable/anon key could bypass the entire chain:
-- read `MerchantUser.passwordHash` and `Session.tokenHash`, read every
-- payment record, or INSERT an `Approval` row directly -- which would
-- defeat the project's central invariant that the LLM (or anyone else)
-- cannot manufacture financial authority.
--
-- HOW THIS WORKS
--
-- Enabling RLS with DELIBERATELY NO POLICIES is a deny-all lock. The
-- exposed roles (anon, authenticated) match no policy and are refused
-- every operation. The application is unaffected: Prisma connects as the
-- table owner, which bypasses RLS (FORCE ROW LEVEL SECURITY is not set).
--
-- On a plain self-hosted Postgres with no REST layer this migration is a
-- harmless no-op safety net -- there are no anon/authenticated roles to
-- revoke from, and the owner bypasses RLS either way.
--
-- IF A TABLE EVER NEEDS DIRECT CLIENT ACCESS: add an explicit, narrow
-- policy for that table. Never disable RLS again.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Belt and braces: strip the grants a REST layer depends on, so the
-- tables stay unreachable even if RLS were later toggled off by mistake.
-- Wrapped in a DO block because these roles only exist on platforms that
-- create them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END $$;
