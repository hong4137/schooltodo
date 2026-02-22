import { useState } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import TodayPage from "./pages/TodayPage";
import CalendarPage from "./pages/CalendarPage";
import SettingsPage from "./pages/SettingsPage";

function AppContent() {
  const { user, loading } = useAuth();
  const [view, setView] = useState("today");

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "var(--bg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <span style={{ color: "var(--text-muted)", fontSize: 14 }}>로딩 중...</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const navItems = [
    { id: "today", label: "투데이", icon: "🏠" },
    { id: "calendar", label: "캘린더", icon: "📅" },
    { id: "settings", label: "설정", icon: "⚙️" },
  ];

  return (
    <div style={{ maxWidth: "var(--max-width)", margin: "0 auto", position: "relative", minHeight: "100vh", background: "var(--bg)" }}>
      {view === "today" && <TodayPage />}
      {view === "calendar" && <CalendarPage />}
      {view === "settings" && <SettingsPage />}

      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "var(--max-width)", background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-around", padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 50 }}>
        {navItems.map((item) => (
          <button key={item.id} onClick={() => setView(item.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 16px" }}>
            <span style={{ fontSize: 22 }}>{item.icon}</span>
            <span style={{ fontSize: 11, fontWeight: view === item.id ? 700 : 400, color: view === item.id ? "var(--text-primary)" : "var(--text-disabled)" }}>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
