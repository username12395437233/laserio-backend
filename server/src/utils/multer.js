// server/src/utils/multer.js
import multer from "multer";
import path from "node:path";
import fs from "node:fs";

export function uploadToProduct() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const productId = String(req.params.id || req.params.productId || "").replace(/[^0-9]/g, "");
      const dir = path.join("/app/uploads/products", productId || "unknown");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
      cb(null, name);
    },
  });
  return multer({ storage });
}

// для media library
export function uploadToMediaLibrary() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join("/app/uploads/media-library");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
      cb(null, name);
    },
  });
  return multer({ storage });
}

// универсальный (если где-то ещё пригодится)
export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = "/app/uploads";
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
      cb(null, name);
    },
  }),
});
