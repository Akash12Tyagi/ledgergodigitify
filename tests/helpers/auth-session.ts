import { getAuth } from "@/server/auth/auth";

/** Extracts a `Cookie:` header value from a Response's `Set-Cookie`
 * header(s), so a test can replay an authenticated session on the next
 * `auth.api.*` call without knowing Better Auth's cookie name. */
export function cookieHeaderFromResponse(response: Response): string {
  const setCookieHeaders =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);

  return setCookieHeaders
    .map((raw) => raw.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

/** Signs in via Better Auth's real API (the same path loginAction uses) and
 * returns request Headers carrying the resulting session cookie. */
export async function signInAndGetHeaders(email: string, password: string): Promise<Headers> {
  const auth = await getAuth();
  const response = (await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  })) as Response;

  if (!response.ok) {
    throw new Error(`signInEmail failed in test helper: ${response.status}`);
  }

  return new Headers({ cookie: cookieHeaderFromResponse(response) });
}
