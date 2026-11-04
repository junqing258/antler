-- These tables are accessed by the backend's PostgreSQL connection, not by
-- Supabase's public REST client. With no client policies, RLS blocks anon and
-- authenticated API roles while retaining access for the database owner.
ALTER TABLE "public"."runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."run_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."scheduled_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
