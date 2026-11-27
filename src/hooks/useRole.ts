"use client";

import { useEffect, useState } from "react";
import { hunt } from "@/lib/hunt";

/** The signed-in member's role. Viewers get read-only screens (the server enforces it too). */
export function useRole() {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    hunt.team().then((t) => setRole(t.me.role)).catch(() => setRole("recruiter"));
  }, []);
  return { role, canEdit: role !== null && role !== "viewer", isAdmin: role === "admin" };
}
