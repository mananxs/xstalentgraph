import type { Prisma } from "@prisma/client";

/** Who is asking. Every data query narrows by this, so one HR never sees another HR's work. */
export interface Viewer {
  id: string;
  role: string;
  organizationId: string;
}

/** Roles that see every HR's work in the organization. */
export const SEES_ALL = ["admin", "manager"] as const;
export const ROLES = ["admin", "manager", "recruiter", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const canSeeAll = (v: { role: string }): boolean => (SEES_ALL as readonly string[]).includes(v.role);

/** Jobs this person may open: all of the organization's for admins/managers, only their own otherwise. */
export function jobWhere(v: Viewer): Prisma.JobDescriptionWhereInput {
  return canSeeAll(v) ? { organizationId: v.organizationId } : { organizationId: v.organizationId, createdById: v.id };
}

/** Sourcing tasks this person may open (a task belongs to the HR who created it). */
export function taskWhere(v: Viewer): { organizationId: string; createdById?: string } {
  return canSeeAll(v) ? { organizationId: v.organizationId } : { organizationId: v.organizationId, createdById: v.id };
}

/** True when `email` is on the company domain (ALLOWED_EMAIL_DOMAIN, default xsassociates.com). */
export function isAllowedEmail(email: string, domain = process.env.ALLOWED_EMAIL_DOMAIN || "xsassociates.com"): boolean {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 && e.slice(at + 1) === d;
}
