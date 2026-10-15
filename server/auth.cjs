const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${derived.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const bits = (stored || "").split("$");
  if (bits.length !== 6 || bits[0] !== "scrypt") return false;
  const derived = await scrypt(password, bits[4], 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(bits[5], "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}
function publicUser(row) {
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null;
}
module.exports = { hashPassword, verifyPassword, hashToken, publicUser };
