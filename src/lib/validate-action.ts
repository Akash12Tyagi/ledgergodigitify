import type { z } from "zod";

import { AppError } from "@/lib/errors";
import { MAX_ACTION_PAYLOAD_BYTES } from "@/constants/finance";

/** Section 8.1 — Zod field errors, flattened to the `fields` shape the
 * ApiResult envelope carries. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

/** Section 10.6 — NoSQL injection guard: deep-reject any key starting with
 * "$" or containing "." before Zod ever sees the input, so a crafted
 * payload can never reach a repository's query builder as an operator. */
function assertNoInjectionKeys(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoInjectionKeys(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("$") || key.includes(".")) {
        throw new AppError("VALIDATION", "Invalid input.", {
          fields: { [path || key]: "Contains disallowed characters" },
        });
      }
      assertNoInjectionKeys(nested, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * The shared entry point every Server Action uses to turn raw input into a
 * typed, validated value (Law 8 — same schema validates client and server;
 * server is authoritative). Combines the Section 10.11 payload-size cap,
 * the Section 10.6 injection-key guard, and the Zod parse itself.
 */
export function parseActionInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown
): z.infer<Schema> {
  const serialized = JSON.stringify(input ?? {});
  if (new TextEncoder().encode(serialized).length > MAX_ACTION_PAYLOAD_BYTES) {
    throw new AppError("VALIDATION", "Request payload is too large.");
  }

  assertNoInjectionKeys(input);

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Check the highlighted fields.", {
      fields: zodFieldErrors(parsed.error),
    });
  }
  return parsed.data;
}
