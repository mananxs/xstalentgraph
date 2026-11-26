import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  /** Text of the main button. Leave out when there is nothing to do. */
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  icon?: ReactNode;
}

/** A friendly "nothing here yet" panel that always tells the person what to do next. */
export function EmptyState({ title, description, actionLabel, onAction, actionDisabled, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-200 px-6 py-16 text-center">
      {icon && <div className="mb-4 text-zinc-500">{icon}</div>}
      <h2 className="text-lg font-medium text-zinc-950">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-zinc-600">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
