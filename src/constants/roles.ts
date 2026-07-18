// Section 1.2 — roles & rank. Lives outside database/models so
// components/shared (nav, role chips) can use the type/rank without
// reaching into the data layer (Section 3 layering, enforced by
// eslint.config.mjs's no-restricted-imports).
export const USER_ROLES = ["owner", "admin", "staff", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** owner > admin > staff > viewer — used by requireUser's rank comparison
 * and by the sidebar's cosmetic role-based filtering. */
export const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  staff: 1,
  admin: 2,
  owner: 3,
};
