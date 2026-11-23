-- Step 6: indexes for the two lists the app reads all day long.
--
-- 1. Order lists. Every customer list is "my orders, newest first"; every admin
--    list is "this status, newest first". The single-column indexes already cover
--    status and placedAt on their own, but the pair is what the queries actually
--    use, so PostgreSQL can filter and sort from one index.
CREATE INDEX IF NOT EXISTS "Order_status_placedAt_idx" ON "Order"("status", "placedAt");

-- 2. Catalogue browsing. The public list always filters on isActive and then
--    searches or sorts by name.
CREATE INDEX IF NOT EXISTS "Product_isActive_name_idx" ON "Product"("isActive", "name");

-- 3. Text search. Products are searched with `contains` (ILIKE '%cement%') on
--    name, brand and sku, and admin order search does the same on orderNumber.
--    A btree index cannot answer a leading wildcard, so these need trigrams.
--    pg_trgm ships with PostgreSQL, but a restricted hosting account may not be
--    allowed to create extensions: in that case the search keeps working on a
--    sequential scan instead of failing the deployment. Check the notice in the
--    migration output and install the extension by hand if you see it.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_trgm could not be installed; skipping the trigram search indexes. Run CREATE EXTENSION pg_trgm as a superuser and re-run this migration.';
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx" ON "Product" USING GIN ("brand" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Order_orderNumber_trgm_idx" ON "Order" USING GIN ("orderNumber" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);
  ELSE
    RAISE NOTICE 'pg_trgm is not installed; the trigram search indexes were skipped.';
  END IF;
END
$$;
