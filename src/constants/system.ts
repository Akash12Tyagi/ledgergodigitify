// A reserved, all-zero ObjectId used to attribute AuditLog entries and
// Notifications to cron-driven system actions (Section 6.8's daily jobs)
// where no real signed-in user exists to be the actor. Never a real user
// document; Mongoose doesn't enforce `ref` as a foreign key, so this is a
// safe, valid-format sentinel rather than a fabricated user account.
export const SYSTEM_ACTOR_ID = "000000000000000000000000";
export const SYSTEM_ACTOR_NAME = "System (Cron)";
