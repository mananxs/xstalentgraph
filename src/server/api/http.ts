import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createLogger } from "@/server/logger";

const log = createLogger("api");

/** An error that carries the HTTP status we want to send back. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Sends a JSON success response. */
export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Wraps a route handler so every error becomes a clean JSON response:
 * ApiError -> its status, bad input (Zod) -> 400, anything else -> 500 (logged, details hidden).
 */
export async function handleRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
      return NextResponse.json({ error: `Invalid request: ${detail}` }, { status: 400 });
    }
    const setupProblem = describeSetupProblem(error);
    if (setupProblem) {
      log.error({ err: error }, setupProblem);
      return NextResponse.json({ error: setupProblem }, { status: 500 });
    }
    log.error({ err: error }, "unhandled error in route");
    return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
  }
}

/**
 * Recognises the common setup mistakes (migration not applied, Prisma client not regenerated, database down)
 * and returns a message that says how to fix them, instead of a generic 500.
 */
function describeSetupProblem(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";

  if (code === "P2021" || code === "P2022" || /column .* does not exist|relation .* does not exist|table .* does not exist/i.test(message)) {
    return "The database is missing the latest tables/columns. Run: npx prisma migrate deploy  (then restart npm run dev)";
  }
  if (name === "PrismaClientValidationError" && /Unknown (field|argument)/i.test(message)) {
    return "The Prisma client is out of date. Run: npx prisma generate  (then restart npm run dev)";
  }
  if (name === "PrismaClientInitializationError" || code === "P1001" || code === "P1002") {
    return "Cannot reach the database. Check DATABASE_URL in .env (Neon may be waking up: try again in a few seconds).";
  }
  return null;
}
