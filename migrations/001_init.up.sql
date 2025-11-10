CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users (только админ на старте; позже добавим регистрацию, если надо)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- categories (materialized path)
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  featured_only BOOLEAN NOT NULL DEFAULT FALSE,
  desc_product_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_parent_sort ON categories(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_path ON categories(path);

-- products (медиа внутри товара: одно поле документа + галерея)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sku  TEXT UNIQUE,
  price INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  primary_image_url TEXT,
  gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
  doc_url TEXT,
  doc_meta JSONB,
  content_html TEXT,
  specs_html TEXT,
  has_docs BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);

-- orders / order_items
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_name TEXT,
  email TEXT,
  phone TEXT,
  comment TEXT,
  address_json JSONB,
  total_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  idempotency_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  price_at_purchase INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- updated_at триггеры
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_categories_updated_at
BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================
-- Counters for categories.desc_product_count
-- =====================

-- Full recompute for all categories
CREATE OR REPLACE FUNCTION recalc_desc_product_counts() RETURNS VOID AS $$
BEGIN
  WITH cat_counts AS (
    SELECT c.id,
           (
             SELECT COUNT(*)
             FROM products p
             JOIN categories pc ON pc.id = p.category_id
             WHERE p.is_active = TRUE
               AND (pc.path = c.path OR pc.path LIKE c.path || '/%')
           )::int AS cnt
    FROM categories c
  )
  UPDATE categories c
  SET desc_product_count = cc.cnt,
      updated_at = NOW()
  FROM cat_counts cc
  WHERE c.id = cc.id;
END;
$$ LANGUAGE plpgsql;

-- Increment along ancestors for a given path
CREATE OR REPLACE FUNCTION inc_desc_product_count_by_path(cat_path TEXT, delta INTEGER) RETURNS VOID AS $$
BEGIN
  UPDATE categories c
  SET desc_product_count = GREATEST(0, desc_product_count + delta),
      updated_at = NOW()
  WHERE (cat_path = c.path OR cat_path LIKE c.path || '/%');
END;
$$ LANGUAGE plpgsql;

-- Trigger function on products
CREATE OR REPLACE FUNCTION trg_products_update_category_counts() RETURNS TRIGGER AS $$
DECLARE
  old_cat_path TEXT;
  new_cat_path TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active THEN
      SELECT path INTO new_cat_path FROM categories WHERE id = NEW.category_id;
      IF new_cat_path IS NOT NULL THEN
        PERFORM inc_desc_product_count_by_path(new_cat_path, 1);
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_active THEN
      SELECT path INTO old_cat_path FROM categories WHERE id = OLD.category_id;
      IF old_cat_path IS NOT NULL THEN
        PERFORM inc_desc_product_count_by_path(old_cat_path, -1);
      END IF;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT path INTO old_cat_path FROM categories WHERE id = OLD.category_id;
    SELECT path INTO new_cat_path FROM categories WHERE id = NEW.category_id;

    IF COALESCE(OLD.is_active, FALSE) <> COALESCE(NEW.is_active, FALSE) THEN
      IF NEW.is_active THEN
        IF new_cat_path IS NOT NULL THEN
          PERFORM inc_desc_product_count_by_path(new_cat_path, 1);
        END IF;
      ELSE
        IF old_cat_path IS NOT NULL THEN
          PERFORM inc_desc_product_count_by_path(old_cat_path, -1);
        END IF;
      END IF;
    END IF;

    IF NEW.category_id <> OLD.category_id THEN
      IF NEW.is_active THEN
        IF old_cat_path IS NOT NULL THEN
          PERFORM inc_desc_product_count_by_path(old_cat_path, -1);
        END IF;
        IF new_cat_path IS NOT NULL THEN
          PERFORM inc_desc_product_count_by_path(new_cat_path, 1);
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_counts ON products;
CREATE TRIGGER trg_products_counts
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION trg_products_update_category_counts();

-- Recompute on category path changes
CREATE OR REPLACE FUNCTION trg_categories_after_update_recalc() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.path <> OLD.path OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.slug <> OLD.slug THEN
    PERFORM recalc_desc_product_counts();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_categories_recalc ON categories;
CREATE TRIGGER trg_categories_recalc
AFTER UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION trg_categories_after_update_recalc();

-- Initial recompute on fresh DB
SELECT recalc_desc_product_counts();
