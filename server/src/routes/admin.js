import { Router } from "express";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import { q } from "../db.js";
import { signAdminJwt, requireAdmin } from "../auth.js";
import { uploadToProduct, upload } from "../utils/multer.js";


const r = Router();

/** AUTH: POST /admin/auth/login */
/**
 * Пример:
 * curl -X POST http://localhost:8000/admin/auth/login \
 *   -H "Content-Type: application/json" \
 *   -d '{"email":"admin@example.com","password":"secret"}'
 * Ответ: { access_token, expires_in }
 */
r.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "EMAIL_PASSWORD_REQUIRED" });
  const { rows } = await q("SELECT id, email, password_hash, role, is_active FROM users WHERE email=$1", [email]);
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  const token = signAdminJwt(user);
  return res.json({ access_token: token, expires_in: Number(process.env.JWT_TTL_SECONDS || 86400) });
});

/** ADMIN-ONLY BELOW */
r.use(requireAdmin);

/** POST /admin/uploads (multipart) => { url, filename, mime, size } */
/**
 * Пример:
 * curl -X POST http://localhost:8000/admin/uploads \
 *   -H "Authorization: Bearer <TOKEN>" \
 *   -F file=@./image.jpg
 */
r.post("/uploads", upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: "FILE_REQUIRED" });
  const url = `/uploads/${f.filename}`;
  return res.json({ url, filename: f.originalname, mime: f.mimetype, size: f.size });
});

/** CATEGORIES CRUD (минимум) */
/**
 * POST /admin/categories — создать категорию
 * curl -X POST http://localhost:8000/admin/categories \
 *   -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 *   -d '{"name":"Laptops","slug":"laptops","parent_id":null,"sort_order":10}'
 */
r.post("/categories", async (req, res) => {
  const { name, slug, parent_id = null, is_active = true, featured_only = false, sort_order = 0 } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "NAME_SLUG_REQUIRED" });
  // path: берём path родителя + /slug или root/slug
  let path = `root/${slug}`;
  if (parent_id) {
    const { rows: pr } = await q("SELECT path FROM categories WHERE id=$1", [parent_id]);
    if (!pr[0]) return res.status(400).json({ error: "PARENT_NOT_FOUND" });
    path = `${pr[0].path}/${slug}`;
  }
  const { rows } = await q(
    `INSERT INTO categories(name,slug,parent_id,path,is_active,featured_only,sort_order)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, slug, parent_id, path, is_active, featured_only, sort_order]
  );
  return res.status(201).json(rows[0]);
});

r.get("/categories", async (req, res) => {
  /**
   * GET /admin/categories — список всех категорий
   * curl http://localhost:8000/admin/categories -H "Authorization: Bearer <TOKEN>"
   */
  const { rows } = await q("SELECT * FROM categories ORDER BY parent_id NULLS FIRST, sort_order, id");
  res.json(rows);
});

/** PRODUCTS CRUD (минимум) */
/**
 * POST /admin/products — создать товар
 * curl -X POST http://localhost:8000/admin/products \
 *   -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 *   -d '{
 *     "name":"MacBook Pro 14", "slug":"mbp-14", "price":199000,
 *     "category_id":1,
 *     "content_html":"<p>Описание</p>",
 *     "specs_html":"<ul><li>Спека</li></ul>"
 *   }'
 */
r.post("/products", async (req, res) => {
  const {
    name, slug, sku = null, price, is_active = true, is_featured = false, category_id,
    primary_image_url = null, gallery = [], doc_url = null, doc_meta = null,
    content_html = null, specs_html = null
  } = req.body || {};

  if (!name || !slug || !Number.isInteger(price) || !category_id) {
    return res.status(400).json({ error: "REQUIRED_FIELDS: name, slug, price(int), category_id" });
  }

  try {
    const { rows } = await q(
      `INSERT INTO products(
         name, slug, sku, price, is_active, is_featured, category_id,
         primary_image_url, gallery, doc_url, doc_meta, content_html, specs_html
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [name, slug, sku, price, is_active, is_featured, category_id,
       primary_image_url, JSON.stringify(gallery || []), doc_url, doc_meta, content_html, specs_html]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: "DUPLICATE_SLUG_OR_SKU" });
    }
    throw e;
  }
});
r.post("/categories", async (req, res) => {
  const { name, slug, parent_id = null, is_active = true, featured_only = false, sort_order = 0 } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "NAME_SLUG_REQUIRED" });

  // path
  let path = `root/${slug}`;
  if (parent_id) {
    const { rows: pr } = await q("SELECT path FROM categories WHERE id=$1", [parent_id]);
    if (!pr[0]) return res.status(400).json({ error: "PARENT_NOT_FOUND" });
    path = `${pr[0].path}/${slug}`;
  }

  try {
    const { rows } = await q(
      `INSERT INTO categories(name,slug,parent_id,path,is_active,featured_only,sort_order)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, slug, parent_id, path, is_active, featured_only, sort_order]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') { // unique_violation
      return res.status(409).json({ error: "DUPLICATE_SLUG" });
    }
    throw e;
  }
});


r.get("/products", async (req, res) => {
  /**
   * GET /admin/products — список с фильтрами
   * curl "http://localhost:8000/admin/products?q=mac&is_active=true&category_id=1" \
   *   -H "Authorization: Bearer <TOKEN>"
   */
  const { q: qq, category_id, is_active } = req.query;
  const params = [];
  let sql = "SELECT id, name, slug, sku, price, is_active, is_featured, category_id, primary_image_url, doc_url, created_at, updated_at FROM products WHERE 1=1";
  if (qq) { params.push(`%${qq}%`); sql += ` AND name ILIKE $${params.length}`; }
  if (category_id) { params.push(Number(category_id)); sql += ` AND category_id = $${params.length}`; }
  if (is_active !== undefined) { params.push(is_active === "true"); sql += ` AND is_active = $${params.length}`; }
  sql += " ORDER BY id DESC LIMIT 200";
  const { rows } = await q(sql, params);
  res.json(rows);
});

/** ================== ADMIN EXTENSIONS: FULL CRUD ================== */

/** GET /admin/products/:id — прочитать один товар */
/**
 * curl http://localhost:8000/admin/products/1 -H "Authorization: Bearer <TOKEN>"
 */
r.get("/products/:id", async (req, res) => {
  const { rows } = await q("SELECT * FROM products WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** PUT /admin/products/:id — полный апдейт (замена полей) */
/**
 * curl -X PUT http://localhost:8000/admin/products/1 \
 *   -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 *   -d '{"name":"MBP 14 2023","slug":"mbp-14-2023","price":210000,"category_id":1}'
 */
r.put("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const {
    name, slug, sku = null, price, is_active = true, is_featured = false, category_id,
    primary_image_url = null, gallery = [], doc_url = null, doc_meta = null,
    content_html = null, specs_html = null
  } = req.body || {};

  if (!id || !name || !slug || !Number.isInteger(price) || !category_id) {
    return res.status(400).json({ error: "REQUIRED_FIELDS: id,path params; body: name, slug, price(int), category_id" });
  }

  const { rows } = await q(
    `UPDATE products SET
       name=$1, slug=$2, sku=$3, price=$4, is_active=$5, is_featured=$6, category_id=$7,
       primary_image_url=$8, gallery=$9, doc_url=$10, doc_meta=$11, content_html=$12, specs_html=$13,
       updated_at=NOW()
     WHERE id=$14
     RETURNING *`,
    [name, slug, sku, price, is_active, is_featured, category_id,
     primary_image_url, JSON.stringify(gallery), doc_url, doc_meta, content_html, specs_html, id]
  );
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});


/** PATCH /admin/products/:id/doc — установить/обновить документ */
/**
 * curl -X PATCH http://localhost:8000/admin/products/1/doc \
 *   -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 *   -d '{"doc_url":"https://.../manual.pdf","doc_meta":{"size":12345}}'
 */
r.patch("/products/:id/doc", async (req, res) => {
  const id = Number(req.params.id);
  const { doc_url = null, doc_meta = null } = req.body || {};
  const { rows } = await q(
    `UPDATE products SET doc_url=$1, doc_meta=$2, has_docs = ($1 IS NOT NULL),
                         updated_at=NOW()
     WHERE id=$3
     RETURNING id, doc_url, doc_meta, has_docs`,
    [doc_url, doc_meta, id]
  );
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** DELETE /admin/products/:id/doc — очистить документ */
/**
 * curl -X DELETE http://localhost:8000/admin/products/1/doc \
 *   -H "Authorization: Bearer <TOKEN>"
 */
r.delete("/products/:id/doc", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await q(
    `UPDATE products SET doc_url=NULL, doc_meta=NULL, has_docs=false, updated_at=NOW()
     WHERE id=$1
     RETURNING id, doc_url, doc_meta, has_docs`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** SOFT DELETE /admin/products/:id — деактивировать товар */
/**
 * curl -X DELETE http://localhost:8000/admin/products/1 \
 *   -H "Authorization: Bearer <TOKEN>"
 */
r.delete("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await q(
    `UPDATE products SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING id, is_active`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** --------- Категории: чтение/обновление/удаление ---------- */

/** GET /admin/categories/:id */
/**
 * curl http://localhost:8000/admin/categories/1 -H "Authorization: Bearer <TOKEN>"
 */
r.get("/categories/:id", async (req, res) => {
  const { rows } = await q("SELECT * FROM categories WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** PUT /admin/categories/:id — полная правка
 *  NB: если меняем slug или parent — переезжает path, и мы обновляем поддерево
 */
/**
 * curl -X PUT http://localhost:8000/admin/categories/1 \
 *   -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 *   -d '{"name":"Ноутбуки","slug":"notebooks","parent_id":null,"sort_order":5}'
 */
r.put("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, slug, parent_id = null, is_active = true, featured_only = false, sort_order = 0 } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "NAME_SLUG_REQUIRED" });

  // получаем старую категорию
  const { rows: oldRows } = await q("SELECT id, path FROM categories WHERE id=$1", [id]);
  if (!oldRows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const oldPath = oldRows[0].path;

  // считаем новый path
  let newPath = `root/${slug}`;
  if (parent_id) {
    const { rows: pr } = await q("SELECT path FROM categories WHERE id=$1", [parent_id]);
    if (!pr[0]) return res.status(400).json({ error: "PARENT_NOT_FOUND" });
    newPath = `${pr[0].path}/${slug}`;
  }

  // апдейт самой категории
  const { rows: upd } = await q(
    `UPDATE categories
       SET name=$1, slug=$2, parent_id=$3, path=$4, is_active=$5, featured_only=$6, sort_order=$7, updated_at=NOW()
     WHERE id=$8
     RETURNING *`,
    [name, slug, parent_id, newPath, is_active, featured_only, sort_order, id]
  );

  // если изменился path — починим поддерево
  if (oldPath !== newPath) {
    await q(
      `UPDATE categories
         SET path = regexp_replace(path, '^' || $1, $2), updated_at=NOW()
       WHERE path = $1 OR path LIKE $1 || '/%'`,
      [oldPath, newPath]
    );
  }

  res.json(upd[0]);
});

/** DELETE /admin/categories/:id — удалим только если нет детей и товаров */
/**
 * curl -X DELETE http://localhost:8000/admin/categories/1 \
 *   -H "Authorization: Bearer <TOKEN>"
 */
r.delete("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);

  const { rows: ch } = await q("SELECT 1 FROM categories WHERE parent_id=$1 LIMIT 1", [id]);
  if (ch[0]) return res.status(400).json({ error: "HAS_CHILDREN" });

  const { rows: pr } = await q("SELECT 1 FROM products WHERE category_id=$1 LIMIT 1", [id]);
  if (pr[0]) return res.status(400).json({ error: "HAS_PRODUCTS" });

  const { rowCount } = await q("DELETE FROM categories WHERE id=$1", [id]);
  if (!rowCount) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ ok: true });
});

/** ------------- IMAGES for PRODUCT ------------- */

// утилита — сгенерить imageId (чтобы не зависеть от URL)
function genImageId() {
  return "img_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** POST /admin/products/:id/images — загрузить фото и добавить в gallery */
/**
 * curl -X POST http://localhost:8000/admin/products/1/images \
 *   -H "Authorization: Bearer <TOKEN>" \
 *   -F file=@./image.jpg
 */
r.post("/products/:id/images", uploadToProduct().single("file"), async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

  // проверим, что товар существует
  const { rows: prod } = await q("SELECT id, primary_image_url FROM products WHERE id=$1", [id]);
  if (!prod[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });

  const rel = `/uploads/products/${id}/${req.file.filename}`;
  const url = `${rel}`;

  const imageItem = {
    id: genImageId(),
    url,
    alt: req.body?.alt || "",
    sort: Number(req.body?.sort || 0),
    mime: req.file.mimetype,
    size: req.file.size,
    filename: req.file.originalname,
  };

  // append в JSONB
  const { rows: updated } = await q(
    `UPDATE products
       SET gallery = COALESCE(gallery, '[]'::jsonb) || $1::jsonb,
           updated_at = NOW()
     WHERE id=$2
     RETURNING id, gallery, primary_image_url`,
    [JSON.stringify([imageItem]), id]
  );

  // если нет primary — поставим только что загруженную
  if (!updated[0].primary_image_url) {
    await q(`UPDATE products SET primary_image_url=$1 WHERE id=$2`, [url, id]);
  }

  return res.status(201).json({ image: imageItem });
});

/** PATCH /admin/products/:id/images/:imageId/primary — сделать фото главным */
/**
 * curl -X PATCH http://localhost:8000/admin/products/1/images/img_abcd/primary \
 *   -H "Authorization: Bearer <TOKEN>"
 */
r.patch("/products/:id/images/:imageId/primary", async (req, res) => {
  const id = Number(req.params.id);
  const imageId = String(req.params.imageId);

  const { rows } = await q("SELECT gallery FROM products WHERE id=$1", [id]);
  if (!rows[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
  const gallery = rows[0].gallery || [];

  const img = gallery.find(g => g.id === imageId);
  if (!img) return res.status(404).json({ error: "IMAGE_NOT_FOUND" });

  await q(`UPDATE products SET primary_image_url=$1, updated_at=NOW() WHERE id=$2`, [img.url, id]);
  res.json({ primary_image_url: img.url });
});

/** ------------- PDF DOC for PRODUCT ------------- */
/** POST /admin/products/:id/doc (multipart) — upload and set doc */
/**
 * curl -X POST http://localhost:8000/admin/products/1/doc \
 *   -H "Authorization: Bearer <TOKEN>" \
 *   -F file=@./manual.pdf
 */
r.post("/products/:id/doc", uploadToProduct().single("file"), async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

  // Validate PDF mimetype; if invalid, remove saved file and error
  if (!(req.file.mimetype === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf"))) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: "PDF_REQUIRED" });
  }

  // ensure product exists
  const { rows: prod } = await q("SELECT id FROM products WHERE id=$1", [id]);
  if (!prod[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });

  const rel = `/uploads/products/${id}/${req.file.filename}`;
  const url = `${rel}`;

  const meta = { filename: req.file.originalname, mime: req.file.mimetype, size: req.file.size };

  const { rows } = await q(
    `UPDATE products SET doc_url=$1, doc_meta=$2, has_docs = TRUE, updated_at=NOW()
     WHERE id=$3
     RETURNING id, doc_url, doc_meta, has_docs`,
    [url, meta, id]
  );
  res.status(201).json(rows[0]);
});

/** Admin tool: rebuild all category counts */
/**
 * curl -X POST http://localhost:8000/admin/tools/recalc-counts \
 *   -H "Authorization: Bearer <TOKEN>"
 */
r.post("/tools/recalc-counts", async (req, res) => {
  await q("SELECT recalc_desc_product_counts()");
  res.json({ ok: true });
});



export default r;
