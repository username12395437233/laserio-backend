import jwt from "jsonwebtoken";

export function signAdminJwt(user) {
  const payload = { sub: String(user.id), role: user.role };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: Number(process.env.JWT_TTL_SECONDS || 86400),
  });
}

export function requireAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "UNAUTHORIZED" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "admin") throw new Error("forbidden");
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
}
