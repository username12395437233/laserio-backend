import { Router } from "express";
import { q } from "../db.js";

const r = Router();

r.get("/health", (req, res) => res.json({ status: "ok" }));

/** ---------- ПУБЛИЧНЫЕ КАТЕГОРИИ ---------- */

/** GET /categories/tree — получить все категории в виде дерева
 *  Пример:
 *  curl http://localhost:8000/categories/tree
 *  Ответ: [{ id, name, slug, desc_product_count, sort_order, children: [...] }, ...]
 */
r.get("/categories/tree", async (req, res) => {
  // Получаем все активные категории
  const { rows } = await q(
    `SELECT id, name, slug, parent_id, desc_product_count, sort_order, description
     FROM categories
     WHERE is_active=true
     ORDER BY sort_order, name`
  );

  // Создаем Map для быстрого доступа по id
  const map = new Map();
  const roots = [];

  // Сначала создаем все узлы без children
  for (const cat of rows) {
    const node = {
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      desc_product_count: cat.desc_product_count,
      sort_order: cat.sort_order,
      children: [],
    };
    map.set(cat.id, node);
  }

  // Затем связываем детей с родителями
  for (const cat of rows) {
    const node = map.get(cat.id);
    if (cat.parent_id === null) {
      roots.push(node);
    } else {
      const parent = map.get(cat.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // Если родитель не найден (неактивен), добавляем в корень
        roots.push(node);
      }
    }
  }

  // Сортируем корневые категории
  roots.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });

  // Рекурсивно сортируем детей
  function sortChildren(node) {
    node.children.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  }
  roots.forEach(sortChildren);

  res.json(roots);
});

/** GET /categories
 *  Параметры (опц.): parent_slug — тогда вернём только детей указанной категории.
 *  Примеры:
 *  - Все активные категории:
 *    curl http://localhost:8000/categories
 *  - Дети конкретной категории:
 *    curl "http://localhost:8000/categories?parent_slug=laptops"
 */
r.get("/categories", async (req, res) => {
  const { parent_slug } = req.query;
  if (parent_slug) {
    const { rows: parent } = await q(
      "SELECT id FROM categories WHERE slug=$1 AND is_active=true",
      [parent_slug]
    );
    if (!parent[0]) return res.json([]);
    const { rows } = await q(
      `SELECT id, name, slug, desc_product_count, sort_order, description
       FROM categories
       WHERE parent_id=$1 AND is_active=true
       ORDER BY sort_order, name`,
      [parent[0].id]
    );
    return res.json(rows);
  }
  // Все активные категории (для дерева на фронте можно сгруппировать по parent_id)
  const { rows } = await q(
    `SELECT id, name, slug, parent_id, desc_product_count, sort_order, description
     FROM categories
     WHERE is_active=true
     ORDER BY parent_id NULLS FIRST, sort_order, name`
  );
  res.json(rows);
});

/** GET /categories/:slug/products — товары категории (всего поддерева)
 *  Параметры: page, limit, sort=(price_asc|price_desc|name_asc|name_desc|new)
 *  Пример:
 *    curl "http://localhost:8000/categories/laptops/products?sort=price_desc&page=2"
 */
r.get("/categories/:slug/products", async (req, res) => {
  const slug = req.params.slug;
  const { rows: catRows } = await q(
    `SELECT id, name, slug, path, featured_only, description
     FROM categories
     WHERE slug=$1 AND is_active=true`,
    [slug]
  );
  const category = catRows[0];
  if (!category) return res.status(404).json({ error: "NOT_FOUND" });

  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit || "20", 10))
  );
  const offset = (page - 1) * limit;

  const sortMap = {
    price_asc: "p.price ASC",
    price_desc: "p.price DESC",
    name_asc: "p.name ASC",
    name_desc: "p.name DESC",
    new: "p.id DESC",
  };
  const sortKey = (req.query.sort || "new").toLowerCase();
  const orderBy = sortMap[sortKey] || sortMap.new;

  const onlyFeatured = !!category.featured_only;

  const listParams = [category.path, limit, offset];
  const featuredCond = onlyFeatured ? "AND p.is_featured=true" : "";

  const { rows: products } = await q(
    `SELECT p.id, p.name, p.slug, p.price, p.primary_image_url, p.doc_url
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true
       AND (c.path = $1 OR c.path LIKE $1 || '/%')
       ${featuredCond}
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`,
    listParams
  );

  const { rows: cntRows } = await q(
    `SELECT COUNT(*)::int AS cnt
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true
       AND (c.path = $1 OR c.path LIKE $1 || '/%')
       ${featuredCond}`,
    [category.path]
  );
  const total = cntRows[0]?.cnt || 0;

  res.json({
    category: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
    },
    products,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/** GET /categories/:slug — данные категории
 *  Если есть подкатегории → {category, children[], featured[]}
 *  Если лист → {category, products[], featured[]}
 *  Параметры листа: page, limit, sort=(price_asc|price_desc|name_asc|name_desc|new)
 *  Примеры:
 *  - Категория с подкатегориями:
 *    curl http://localhost:8000/categories/electronics
 *  - Лист с товарами, сортировка по цене по возрастанию и пагинация:
 *    curl "http://localhost:8000/categories/laptops?sort=price_asc&page=1&limit=20"
 */
r.get("/categories/:slug", async (req, res) => {
  const slug = req.params.slug;
  const { rows: catRows } = await q(
    `SELECT id, name, slug, path, featured_only, desc_product_count, description
     FROM categories
     WHERE slug=$1 AND is_active=true`,
    [slug]
  );
  const category = catRows[0];
  if (!category) return res.status(404).json({ error: "NOT_FOUND" });

  // 1) Подкатегории
  const { rows: children } = await q(
    `SELECT id, name, slug, desc_product_count, sort_order, description
     FROM categories
     WHERE parent_id=$1 AND is_active=true
     ORDER BY sort_order, name`,
    [category.id]
  );

  // 2) Featured товары в поддереве (как у тебя)
  const { rows: featured } = await q(
    `SELECT p.id, p.name, p.slug, p.price, p.primary_image_url, p.doc_url
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true AND p.is_featured=true
       AND (c.path = $1 OR c.path LIKE $1 || '/%')
     ORDER BY p.id DESC
     LIMIT 3`,
    [category.path]
  );

  if (children.length > 0) {
    // 3) Превью товаров для каждого child: 1–3 шт
    const childIds = children.map((c) => c.id);

    const { rows: previews } = await q(
      `
      WITH child_paths AS (
        SELECT id AS child_id, path AS child_path
        FROM categories
        WHERE id = ANY($1)
      ),
      ranked AS (
        SELECT
          cp.child_id,
          p.id,
          p.name,
          p.slug,
          p.primary_image_url,
          ROW_NUMBER() OVER (
            PARTITION BY cp.child_id
            ORDER BY p.is_featured DESC, p.id DESC
          ) AS rn
        FROM child_paths cp
        JOIN categories c ON (c.path = cp.child_path OR c.path LIKE cp.child_path || '/%')
        JOIN products p ON p.category_id = c.id
        WHERE p.is_active = true
      )
      SELECT child_id AS category_id, id, name, slug, primary_image_url
      FROM ranked
      WHERE rn <= 3
      ORDER BY category_id, rn;
      `,
      [childIds]
    );

    // 4) Склеиваем превьюшки с children
    const byCat = new Map();
    for (const row of previews) {
      if (!byCat.has(row.category_id)) byCat.set(row.category_id, []);
      byCat.get(row.category_id).push({
        name: row.name,
        slug: row.slug,
        primary_image_url: row.primary_image_url,
      });
    }

    const childrenWithPreview = children.map((ch) => ({
      ...ch,
      products_preview: byCat.get(ch.id) || [],
    }));

    return res.json({ category, children: childrenWithPreview, featured });
  }

  // --- дальше у тебя листовая логика без изменений ---
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit || "20", 10))
  );
  const offset = (page - 1) * limit;

  const sortMap = {
    price_asc: "price ASC",
    price_desc: "price DESC",
    name_asc: "name ASC",
    name_desc: "name DESC",
    new: "id DESC",
  };
  const sortKey = (req.query.sort || "new").toLowerCase();
  const orderBy = sortMap[sortKey] || sortMap.new;

  const onlyFeatured = !!category.featured_only;

  const { rows: products } = await q(
    `SELECT p.id, p.name, p.slug, p.price, p.primary_image_url, p.gallery, p.doc_url
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true
       AND (c.path = $1 OR c.path LIKE $1 || '/%')
       ${onlyFeatured ? "AND p.is_featured=true" : ""}
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`,
    [category.path, limit, offset]
  );

  const { rows: cntRows } = await q(
    `SELECT COUNT(*)::int AS cnt
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true
       AND (c.path = $1 OR c.path LIKE $1 || '/%')
       ${onlyFeatured ? "AND p.is_featured=true" : ""}`,
    [category.path]
  );
  const total = cntRows[0]?.cnt || 0;

  return res.json({
    category,
    featured,
    products,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/** ---------- ПУБЛИЧНЫЕ ТОВАРЫ / ПОИСК ---------- */
/** GET /products
 *  Параметры:
 *   - q: строка поиска по name (ILIKE)
 *   - category (slug): ограничить поддеревом категории
 *   - page, limit, sort=(price_asc|price_desc|name_asc|name_desc|new)
 *  Примеры:
 *  - Последние товары:
 *    curl http://localhost:8000/products
 *  - Поиск по строке:
 *    curl "http://localhost:8000/products?q=mac"
 *  - Поиск в категории (slug):
 *    curl "http://localhost:8000/products?category=laptops&sort=price_desc&page=2&limit=12"
 */
r.get("/products", async (req, res) => {
  const qStr = (req.query.q || "").trim();
  const catSlug = (req.query.category || "").trim();

  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit || "20", 10))
  );
  const offset = (page - 1) * limit;

  const sortMap = {
    price_asc: "p.price ASC",
    price_desc: "p.price DESC",
    name_asc: "p.name ASC",
    name_desc: "p.name DESC",
    new: "p.id DESC",
  };
  const sortKey = (req.query.sort || "new").toLowerCase();
  const orderBy = sortMap[sortKey] || sortMap.new;

  // если пришёл category=slug — найдём path
  let pathCond = "";
  let params = [];
  if (catSlug) {
    const { rows: cat } = await q(
      "SELECT path FROM categories WHERE slug=$1 AND is_active=true",
      [catSlug]
    );
    if (!cat[0])
      return res.json({
        products: [],
        pagination: { page, limit, total: 0, pages: 0 },
      });
    params.push(cat[0].path);
    pathCond = "AND (c.path = $1 OR c.path LIKE $1 || '/%')";
  }

  // строка поиска
  let searchCond = "";
  if (qStr) {
    params.push(`%${qStr}%`);
    searchCond += ` AND p.name ILIKE $${params.length}`;
  }

  // данные
  params.push(limit);
  params.push(offset);
  const { rows: products } = await q(
    `SELECT p.id, p.name, p.slug, p.primary_image_url AS image
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true
       ${pathCond}
       ${searchCond}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // count
  const countParams = params.slice(0, params.length - 2); // без limit/offset
  const { rows: cntRows } = await q(
    `SELECT COUNT(*)::int AS cnt
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active=true
       ${pathCond}
       ${searchCond}`,
    countParams
  );
  const total = cntRows[0]?.cnt || 0;

  res.json({
    products,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/** ---------- КАРТОЧКА ТОВАРА ---------- */
/**
 * GET /products/:slug — карточка
 * Пример:
 * curl http://localhost:8000/products/mbp-14
 */
r.get("/products/:slug", async (req, res) => {
  const { rows } = await q(
    "SELECT * FROM products WHERE slug=$1 AND is_active=true",
    [req.params.slug]
  );
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** ---------- ОФОРМЛЕНИЕ ЗАКАЗА ---------- */
/**
 * POST /orders — создать заказ
 * Пример:
 * curl -X POST http://localhost:8000/orders \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "customer_name":"Иван",
 *     "email":"ivan@example.com",
 *     "phone":"+79990000000",
 *     "comment":"Позвонить перед доставкой",
 *     "items":[{"product_id":1,"qty":2},{"product_id":2,"qty":1}]
 *   }'
 */
r.post("/orders", async (req, res) => {
  const {
    idempotency_key = null,
    customer_name,
    email,
    phone,
    comment,
    address_json = null,
    items,
  } = req.body || {};
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "ITEMS_REQUIRED" });

  if (idempotency_key) {
    const { rows: ex } = await q(
      "SELECT id FROM orders WHERE idempotency_key=$1",
      [idempotency_key]
    );
    if (ex[0])
      return res.status(200).json({ order_id: ex[0].id, status: "duplicate" });
  }

  const ids = items.map((it) => Number(it.product_id)).filter(Boolean);
  const { rows: prods } = await q(
    `SELECT id, price, is_active FROM products WHERE id = ANY($1::int[])`,
    [ids]
  );
  const map = new Map(prods.map((p) => [p.id, p]));
  let total = 0;
  for (const it of items) {
    const p = map.get(Number(it.product_id));
    if (!p || !p.is_active)
      return res
        .status(400)
        .json({ error: "INVALID_PRODUCT", product_id: it.product_id });
    const qty = Number(it.qty || 0);
    if (!Number.isInteger(qty) || qty <= 0)
      return res
        .status(400)
        .json({ error: "INVALID_QTY", product_id: it.product_id });
    total += p.price * qty;
  }

  const { rows: ord } = await q(
    `INSERT INTO orders(customer_name,email,phone,comment,address_json,total_amount,idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [customer_name, email, phone, comment, address_json, total, idempotency_key]
  );
  const orderId = ord[0].id;

  const values = [];
  const params = [];
  let i = 1;
  for (const it of items) {
    const p = map.get(Number(it.product_id));
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(orderId, Number(it.product_id), Number(it.qty), p.price);
  }
  await q(
    `INSERT INTO order_items(order_id, product_id, qty, price_at_purchase)
     VALUES ${values.join(",")}`,
    params
  );

  return res.status(201).json({ order_id: orderId, total_amount: total });
});

export default r;
