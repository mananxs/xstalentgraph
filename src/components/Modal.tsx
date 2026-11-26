"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Tailwind max-width class. Default max-w-2xl. */
  widthClass?: string;
  /** Block closing (e.g. while an upload is running). */
  busy?: boolean;
}

/** Accessible dialog: Escape and backdrop close it, focus moves inside and returns afterwards. */
export function Modal({ open, onClose, title, description, children, widthClass = "max-w-2xl", busy = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const timer = setTimeout(() => panelRef.current?.focus(), 30);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose, busy]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 px-4 py-10 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={`card-surface w-full ${widthClass} rounded-2xl border border-zinc-200 shadow-2xl outline-none`}
          >
            <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
                {description && <p className="mt-0.5 text-sm text-zinc-600">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
                className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>
            <div className="px-6 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
