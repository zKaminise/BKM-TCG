-- The browser never connects directly to these application tables. A server-only
-- pooler connection enforces authenticated ownership and admin access in the API.
-- Supabase's anon/authenticated roles receive no grants or permissive RLS policy.
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN('users','sessions','card_metadata','products','variants','coupons','settings','orders','order_items','inventory_reservations','stock_movements','admin_audit','account_lists','collections','order_history','payments','payment_events','addresses','shipments','password_resets','email_outbox','bkm_migrations')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',item.tablename); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',item.tablename); END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', item.tablename);
  END LOOP;
END $$;
