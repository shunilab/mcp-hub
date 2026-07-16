import { useState } from "react";
import { Sidebar, View } from "./components/Sidebar";
import { LibraryView } from "./views/LibraryView";
import { DiscoverView } from "./views/DiscoverView";
import { SettingsView } from "./views/SettingsView";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");

  return (
    <div className="app">
      <Sidebar current={view} onChange={setView} />
      <main className="content">
        {view === "library" && <LibraryView onGoToDiscover={() => setView("discover")} />}
        {view === "discover" && <DiscoverView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
