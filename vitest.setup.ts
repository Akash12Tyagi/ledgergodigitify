import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll } from "vitest";

// Section 2.4 env vars this project doesn't exercise in unit/integration
// tests get harmless placeholders so config/env.ts's boot-time Zod
// validation passes. NODE_ENV is already "test", set by Vitest itself.
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-32c";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CLOUDINARY_CLOUD_NAME ??= "test-cloud";
process.env.CLOUDINARY_API_KEY ??= "test-key";
process.env.CLOUDINARY_API_SECRET ??= "test-secret";
process.env.CRON_SECRET ??= "test-cron-secret-test-cron-secret-32chr";
process.env.APP_TIMEZONE ??= "Asia/Kolkata";

// One in-memory replica set (transactions require a replica set — Law 4)
// for the whole run. `fileParallelism: false` (vitest.config.ts) keeps
// every test file in the same worker process, so this module-level
// singleton and the MONGODB_URI it publishes are shared by all of them.
let replSet: MongoMemoryReplSet | undefined;

if (!process.env.MONGODB_URI) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri("finance-test");
}

afterAll(async () => {
  await replSet?.stop();
});
