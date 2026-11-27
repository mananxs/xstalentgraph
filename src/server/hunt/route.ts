import type { NextResponse } from "next/server";
import { ApiError, handleRoute } from "@/server/api/http";
import { HttpError } from "./tasks";

/** handleRoute + translation of the task engine's HttpError into API errors. */
export function huntRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  return handleRoute(async () => {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof HttpError) throw new ApiError(error.status, error.message);
      throw error;
    }
  });
}
