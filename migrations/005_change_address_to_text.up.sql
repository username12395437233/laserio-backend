-- Меняем address_json на address (TEXT)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS address TEXT;

-- Копируем данные из address_json в address (если есть)
UPDATE orders
SET address = CASE
  WHEN address_json IS NULL THEN NULL
  WHEN jsonb_typeof(address_json) = 'string' THEN address_json::text
  ELSE address_json::text
END
WHERE address IS NULL;

-- Удаляем старую колонку address_json
ALTER TABLE orders
DROP COLUMN IF EXISTS address_json;

