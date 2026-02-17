import { type ReactNode } from "react";

type BadgeVariant = "default" | "amber" | "success" | "danger" | "muted";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]",
  amber: "bg-[var(--amber-ghost-bg)] text-[var(--amber)] border-[var(--amber)]/20",
  success: "bg-[#5cb870]/15 text-[#5cb870] border-[#5cb870]/20",
  danger: "bg-[#c45c5c]/15 text-[#c45c5c] border-[#c45c5c]/20",
  muted: "bg-[var(--bg-elevated)] text-[var(--text-muted)] border-transparent",
};

export default function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
