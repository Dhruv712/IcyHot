"use client";

interface Tab {
  key: string;
  label: string;
  icon?: string;
}

interface TabsProps {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export default function Tabs({ tabs, activeKey, onChange, className = "" }: TabsProps) {
  return (
    <div className={`flex gap-1 overflow-x-auto ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
            activeKey === tab.key
              ? "bg-[var(--amber-ghost-bg)] text-[var(--amber)] font-medium"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          }`}
        >
          {tab.icon && <span>{tab.icon}</span>}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
