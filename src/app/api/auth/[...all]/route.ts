import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth/auth";

// Section 1.1 — `/api/auth/[...all]` is the Better Auth handler. Our
// instance is behind an async singleton (server/auth/auth.ts), so the
// handler awaits it before delegating.
export const { GET, POST } = toNextJsHandler(async (request: Request) => {
  const auth = await getAuth();
  return auth.handler(request);
});
