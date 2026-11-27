"use client";

/** Last-resort boundary (the root layout itself failed). Plain HTML: no shared components that could fail again. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#ffffff", color: "#09090b", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>XS-Hunt could not load</h1>
          <p style={{ color: "#52525b", fontSize: 14 }}>Please try again. If it keeps happening, restart the dev server.</p>
          <button onClick={reset} style={{ marginTop: 16, background: "#4f46e5", color: "#fff", border: 0, borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
