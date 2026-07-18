import { hash, verify } from "@node-rs/argon2";

// Section 10.1 — argon2id password hashing. `@node-rs/argon2`'s `Algorithm`
// export is a `const enum`, which TypeScript can't reference under
// `isolatedModules` (Section 2.6). Argon2id's numeric value (2) is stable
// across the package's public API; used directly here, once, instead of
// importing the const enum from every call site.
const ARGON2ID = 2;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, { algorithm: ARGON2ID });
}
