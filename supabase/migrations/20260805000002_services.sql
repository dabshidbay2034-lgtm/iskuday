-- =============================================================================
-- Migration: 20260805000002_services.sql
-- Description: Services catalog & service inquiries tables with Clerk RLS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  image_url TEXT,
  price_from NUMERIC NULL,
  price_note TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES public.services(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_inquiries ENABLE ROW LEVEL SECURITY;

-- Idempotent policy cleanup
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('services', 'service_inquiries')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- RLS Policies: services
-- -----------------------------------------------------------------------------

-- Public SELECT only where is_published = true; platform admins can select all
CREATE POLICY "Public or admin select services" ON public.services
  FOR SELECT USING (
    is_published = true OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- INSERT / UPDATE / DELETE for platform admins only
CREATE POLICY "Admin insert services" ON public.services
  FOR INSERT WITH CHECK (
    public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Admin update services" ON public.services
  FOR UPDATE USING (
    public.has_role(auth.jwt()->>'sub', 'admin')
  ) WITH CHECK (
    public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Admin delete services" ON public.services
  FOR DELETE USING (
    public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- -----------------------------------------------------------------------------
-- RLS Policies: service_inquiries
-- -----------------------------------------------------------------------------

-- Public INSERT (anyone may enquire)
CREATE POLICY "Public insert service_inquiries" ON public.service_inquiries
  FOR INSERT WITH CHECK (true);

-- SELECT / UPDATE / DELETE for platform admins only
CREATE POLICY "Admin select service_inquiries" ON public.service_inquiries
  FOR SELECT USING (
    public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Admin update service_inquiries" ON public.service_inquiries
  FOR UPDATE USING (
    public.has_role(auth.jwt()->>'sub', 'admin')
  ) WITH CHECK (
    public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Admin delete service_inquiries" ON public.service_inquiries
  FOR DELETE USING (
    public.has_role(auth.jwt()->>'sub', 'admin')
  );
