export const normalizeName = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
