import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const run = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEYLEN, (error, key) => (error ? reject(error) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await run(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, saltHex, hashHex] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) {
    await run(password, randomBytes(16)); // same cost for unknown accounts, so timing does not reveal them
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = await run(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
