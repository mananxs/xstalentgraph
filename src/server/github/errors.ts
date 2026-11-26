/** Thrown when GitHub rejects the token (HTTP 401). Never retried. */
export class GitHubAuthError extends Error {
  constructor() {
    super(
      "GitHub rejected the token (401 Bad credentials). The GITHUB_PAT is wrong, expired, or revoked. " +
        "Create a new classic token (no scopes), put it in .env, and run `npx prisma db seed` again.",
    );
    this.name = "GitHubAuthError";
  }
}

/** Thrown when we would have to wait longer than we allow for a rate limit to reset. */
export class GitHubRateLimitError extends Error {
  constructor(
    message: string,
    /** When the limit resets (epoch ms), if known. */
    public readonly resetAtMs: number | null,
  ) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
}

/** Any other GitHub failure (bad request, permission problem, retries exhausted). */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    /** HTTP status when there was one. */
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/**
 * GitHub timed out (HTTP 502/504, or a GraphQL "something went wrong" error) while running our query.
 * This almost always means the page was too expensive, so the client retries with fewer users per page.
 */
export class GitHubQueryTooHeavyError extends GitHubApiError {
  constructor(message: string, status: number | null = null) {
    super(message, status);
    this.name = "GitHubQueryTooHeavyError";
  }
}
