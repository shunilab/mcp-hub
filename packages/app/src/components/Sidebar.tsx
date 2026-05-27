import { Package, Search, Settings } from "lucide-react";

export type View = "library" | "discover" | "settings";

interface Props {
  current: View;
  onChange: (v: View) => void;
}

const NAV: { id: View; icon: React.ReactNode; label: string }[] = [
  { id: "library", icon: <Package size={20} />, label: "Library" },
  { id: "discover", icon: <Search size={20} />, label: "Discover" },
  { id: "settings", icon: <Settings size={20} />, label: "Settings" },
];

export function Sidebar({ current, onChange }: Props) {
  return (
    <nav className="sidebar" aria-label="メインナビゲーション">
      {NAV.map(({ id, icon, label }) => (
        <button
          key={id}
          className={`nav-item ${current === id ? "active" : ""}`}
          onClick={() => onChange(id)}
          aria-label={label}
          aria-current={current === id ? "page" : undefined}
          title={label}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
