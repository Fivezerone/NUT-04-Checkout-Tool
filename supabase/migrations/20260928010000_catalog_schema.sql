-- P2: Catalog schema for thin-client sync
-- Source of truth for all product data served to the extension.

CREATE SEQUENCE IF NOT EXISTS public.catalog_seq;

CREATE TABLE public.catalog_products (
  retailer    text    NOT NULL CHECK (retailer IN ('CARREFOUR','NAIVAS')),
  product_id  text    NOT NULL,
  seq         bigint  NOT NULL DEFAULT nextval('public.catalog_seq'),
  record      jsonb   NOT NULL,           -- full pipeline record (all 7 blocks)
  record_hash text    NOT NULL,           -- sha256 hex of stableStringify(record)
  review_state text,
  deleted     boolean NOT NULL DEFAULT false,  -- tombstone; record = '{}' when true
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (retailer, product_id));
CREATE UNIQUE INDEX catalog_products_seq_idx ON public.catalog_products(seq);

CREATE TABLE public.catalog_premium (
  retailer    text    NOT NULL CHECK (retailer IN ('CARREFOUR','NAIVAS')),
  product_id  text    NOT NULL,
  seq         bigint  NOT NULL DEFAULT nextval('public.catalog_seq'),
  assessments jsonb   NOT NULL,           -- {diabetes:{...}, hypertension:{...}, renal:{...}, obesity:{...}}
  record_hash text    NOT NULL,           -- sha256 hex of stableStringify(assessments)
  deleted     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (retailer, product_id));
CREATE UNIQUE INDEX catalog_premium_seq_idx ON public.catalog_premium(seq);

CREATE TABLE public.catalog_releases (
  id          bigserial   PRIMARY KEY,
  manifest    jsonb       NOT NULL,   -- the exact object that was signed
  signature   text        NOT NULL,   -- base64url ES256 (raw r||s) over stableStringify(manifest)
  key_id      text        NOT NULL,
  is_current  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_current_release ON public.catalog_releases(is_current) WHERE is_current;

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_premium  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_releases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.catalog_products, public.catalog_premium, public.catalog_releases FROM anon, authenticated;
GRANT SELECT ON public.catalog_products, public.catalog_premium, public.catalog_releases TO authenticated;

CREATE POLICY cp_read  ON public.catalog_products FOR SELECT TO authenticated USING (true);
CREATE POLICY cr_read  ON public.catalog_releases FOR SELECT TO authenticated USING (true);
CREATE POLICY cpr_read ON public.catalog_premium  FOR SELECT TO authenticated
  USING (public.is_premium_active(auth.uid()));

-- Close the public scrape of the legacy table (do not drop the table yet)
DROP POLICY IF EXISTS "Products are publicly readable" ON public.products;
REVOKE ALL ON public.products FROM anon;

-- ─── Service-role-only write helpers ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.catalog_upsert(p_rows jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; inserted int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO public.catalog_products
      (retailer, product_id, record, record_hash, review_state, deleted, updated_at)
    VALUES (
      r->>'retailer', r->>'product_id', r->'record',
      r->>'record_hash', r->>'review_state', false, now())
    ON CONFLICT (retailer, product_id) DO UPDATE
      SET record       = EXCLUDED.record,
          record_hash  = EXCLUDED.record_hash,
          review_state = EXCLUDED.review_state,
          deleted      = false,
          seq          = nextval('public.catalog_seq'),
          updated_at   = now()
      WHERE catalog_products.record_hash IS DISTINCT FROM EXCLUDED.record_hash
         OR catalog_products.deleted;
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END $$;

CREATE OR REPLACE FUNCTION public.catalog_premium_upsert(p_rows jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; inserted int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO public.catalog_premium
      (retailer, product_id, assessments, record_hash, deleted, updated_at)
    VALUES (
      r->>'retailer', r->>'product_id', r->'assessments', r->>'record_hash', false, now())
    ON CONFLICT (retailer, product_id) DO UPDATE
      SET assessments  = EXCLUDED.assessments,
          record_hash  = EXCLUDED.record_hash,
          deleted      = false,
          seq          = nextval('public.catalog_seq'),
          updated_at   = now()
      WHERE catalog_premium.record_hash IS DISTINCT FROM EXCLUDED.record_hash
         OR catalog_premium.deleted;
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END $$;

CREATE OR REPLACE FUNCTION public.catalog_tombstone_missing(p_retailer text, p_keep text[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cnt int;
BEGIN
  UPDATE public.catalog_products
    SET deleted = true, record = '{}', seq = nextval('public.catalog_seq'), updated_at = now()
   WHERE retailer = p_retailer AND NOT (product_id = ANY(p_keep)) AND NOT deleted;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END $$;

CREATE OR REPLACE FUNCTION public.catalog_premium_tombstone_missing(p_retailer text, p_keep text[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cnt int;
BEGIN
  UPDATE public.catalog_premium
    SET deleted = true, assessments = '{}', seq = nextval('public.catalog_seq'), updated_at = now()
   WHERE retailer = p_retailer AND NOT (product_id = ANY(p_keep)) AND NOT deleted;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END $$;

CREATE OR REPLACE FUNCTION public.catalog_release_publish(
  p_manifest jsonb, p_signature text, p_key_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max_seq   bigint;
  v_manifest_max bigint;
  v_id        bigint;
BEGIN
  -- Verify max_seq in manifest matches current catalog state
  SELECT GREATEST(
    COALESCE((SELECT MAX(seq) FROM public.catalog_products WHERE NOT deleted), 0),
    COALESCE((SELECT MAX(seq) FROM public.catalog_premium  WHERE NOT deleted), 0)
  ) INTO v_max_seq;
  v_manifest_max := (p_manifest->>'max_seq')::bigint;
  IF v_manifest_max <> v_max_seq THEN
    RAISE EXCEPTION 'manifest max_seq % does not match current catalog max_seq %',
      v_manifest_max, v_max_seq;
  END IF;
  -- Clear previous current release
  UPDATE public.catalog_releases SET is_current = false WHERE is_current;
  -- Insert new current release
  INSERT INTO public.catalog_releases (manifest, signature, key_id, is_current)
    VALUES (p_manifest, p_signature, p_key_id, true)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Revoke all write functions from non-service roles
REVOKE ALL ON FUNCTION public.catalog_upsert(jsonb)               FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_premium_upsert(jsonb)       FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_tombstone_missing(text,text[])         FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_premium_tombstone_missing(text,text[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_release_publish(jsonb,text,text)       FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.catalog_upsert(jsonb)               TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_premium_upsert(jsonb)       TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_tombstone_missing(text,text[])         TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_premium_tombstone_missing(text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_release_publish(jsonb,text,text)       TO service_role;
