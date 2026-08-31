-- Nonces are authorization replay evidence and must not be publicly readable
-- or writable through Supabase's Data API.
ALTER TABLE "SpendMandateNonce" ENABLE ROW LEVEL SECURITY;
