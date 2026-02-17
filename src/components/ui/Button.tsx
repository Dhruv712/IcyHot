import { type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--amber)] hover:bg-[var(--amber-hover)] active:bg-[var(--amber-active)] text-[#0a0a0f] font-medium",
  secondary:
    "border border-[var(--border-medium)] hover:border-[var(--amber)] text-[var(--text-secondary)] hover:text-[var(--amber)] bg-transparent",
  ghost:
    "bg-transparent hover:bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium",
  danger:
    "bg-transparent hover:bg-[#c45c5c]/15 text-[var(--danger)] font-medium",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 rounded-lg",
  md: "text-sm px-4 py-2 rounded-xl",
  lg: "text-sm px-5 py-2.5 rounded-xl",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
