export default function BriefingSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{icon}</span>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
