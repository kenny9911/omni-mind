import type { ViewModel } from "@/lib/viewModel";
import { Icon } from "@/components/Icons";

export default function Sidebar({ vm }: { vm: ViewModel }) {
  const { t } = vm;

  if (vm.sidebarClosed) {
    return (
      <aside
        style={{
          width: 56,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: "var(--bg-elev)",
          borderRight: "1px solid var(--border)",
          padding: "14px 0",
          gap: 6,
        }}
      >
        <button
          onClick={vm.onToggleSidebar}
          title={t.expand}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 6px 18px var(--accent-soft)",
          }}
        >
          <Icon name="spark" />
        </button>
        <button
          onClick={vm.onNewChat}
          title={t.newChat}
          style={{
            width: 38,
            height: 38,
            marginTop: 6,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon name="plus" />
        </button>
        <div style={{ height: 8 }} />
        {vm.navs.map((n) => (
          <button
            key={n.key}
            onClick={n.onClick}
            title={n.label}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "none",
              background: n.active ? "var(--accent-soft)" : "transparent",
              color: n.active ? "var(--accent)" : "var(--faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon name={n.icon} />
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={vm.onToggleSidebar}
          title={t.expand}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon name="panel" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: vm.sidebarWpx,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-elev)",
        borderRight: "1px solid var(--border)",
        padding: "16px 12px",
        gap: 4,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 4px 16px 8px" }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            boxShadow: "0 6px 18px var(--accent-soft)",
            flex: "none",
          }}
        >
          <Icon name="spark" />
        </div>
        <div style={{ lineHeight: 1.1, flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>
            OmniMind
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.tagline}
          </div>
        </div>
        <button
          onClick={vm.onToggleSidebar}
          title={t.collapse}
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon name="collapse" />
        </button>
      </div>

      <button
        onClick={vm.onNewChat}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 10,
          borderRadius: 11,
          border: "none",
          background: "linear-gradient(135deg,var(--accent),#8f7fff)",
          color: "#fff",
          font: "inherit",
          fontWeight: 700,
          fontSize: 13.5,
          cursor: "pointer",
          boxShadow: "0 6px 16px var(--accent-soft)",
        }}
      >
        <Icon name="plus" />
        {t.newChat}
      </button>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
        {vm.navs.map((n) => (
          <button
            key={n.key}
            onClick={n.onClick}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: 10,
              borderRadius: 10,
              border: "none",
              background: n.active ? "var(--accent-soft)" : "transparent",
              color: n.active ? "var(--accent)" : "var(--muted)",
              font: "inherit",
              fontSize: 13.5,
              fontWeight: n.active ? 700 : 600,
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
            }}
          >
            <span style={{ display: "flex", color: n.active ? "var(--accent)" : "var(--faint)" }}>
              <Icon name={n.icon} />
            </span>
            {n.label}
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 18, padding: "0 8px 6px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", color: "var(--faint)", textTransform: "uppercase" }}>
        {t.recent}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, overflow: "hidden" }}>
        {vm.recents.map((r, i) => {
          const canManage = !!r.id;
          if (r.editing === "rename") {
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 8px", borderRadius: 9, background: "var(--surface-2)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.color, flex: "none" }} />
                <input
                  autoFocus
                  value={r.draft ?? ""}
                  onChange={(e) => vm.onRecentDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") vm.onCommitRenameRecent();
                    else if (e.key === "Escape") vm.onCancelRecentEdit();
                  }}
                  onBlur={() => vm.onCommitRenameRecent()}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text)", font: "inherit", fontSize: 12.5, fontWeight: 600 }}
                />
              </div>
            );
          }
          if (r.editing === "confirmDelete") {
            return (
              <div key={i} title={vm.recentDeleteTitle} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 9, background: "var(--surface-2)", fontSize: 12 }}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{vm.recentDeleteTitle}</span>
                <button onClick={vm.onConfirmDeleteRecent} title={vm.recentDeleteTitle} style={{ display: "flex", padding: 4, borderRadius: 7, border: "none", background: "transparent", color: "var(--danger, #e5484d)", cursor: "pointer" }}>
                  <Icon name="check" />
                </button>
                <button onClick={vm.onCancelRecentEdit} style={{ display: "flex", padding: 4, borderRadius: 7, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
                  <Icon name="close" />
                </button>
              </div>
            );
          }
          return (
            <div
              key={i}
              className="recent-row"
              style={{ display: "flex", alignItems: "center", gap: 9, padding: 8, borderRadius: 9, color: r.active ? "var(--text)" : "var(--muted)", background: r.active ? "var(--surface-2)" : "transparent", fontWeight: r.active ? 700 : 400, fontSize: 12.5, cursor: r.onClick ? "pointer" : "default" }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.color, flex: "none" }} />
              <span onClick={r.onClick} title={r.title} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.title}
              </span>
              {canManage && (
                <span className="recent-actions" style={{ display: "flex", gap: 2, flex: "none" }}>
                  <button onClick={(e) => { e.stopPropagation(); vm.onBeginRenameRecent(r.id!, r.title); }} title={vm.recentRenameTitle} style={{ display: "flex", padding: 3, borderRadius: 6, border: "none", background: "transparent", color: "var(--faint)", cursor: "pointer" }}>
                    <Icon name="pen" size={13} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); vm.onBeginDeleteRecent(r.id!); }} title={vm.recentDeleteTitle} style={{ display: "flex", padding: 3, borderRadius: 6, border: "none", background: "transparent", color: "var(--faint)", cursor: "pointer" }}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          onClick={vm.onToggleTheme}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 9, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name={vm.isDark ? "sun" : "moon"} />
          {t.themeLabel}
        </button>
        <div style={{ flex: 1, position: "relative" }}>
          <button
            onClick={vm.onToggleLang}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 9, borderRadius: 10, border: `1px solid ${vm.langBtnBorder}`, background: "var(--surface)", color: "var(--muted)", font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            <Icon name="globe" />
            {vm.langLabel}
          </button>
          {vm.menuLang && (
            <div style={{ position: "absolute", bottom: "calc(100% + 7px)", left: 0, right: 0, zIndex: 60, background: "var(--bg-elev)", border: "1px solid var(--border-2)", borderRadius: 12, padding: 5, boxShadow: "var(--shadow)" }}>
              {vm.langOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={o.onClick}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, border: "none", background: "transparent", color: o.fg, font: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: o.dot, flex: "none" }} />
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        onClick={vm.onOpenProfile}
        title={t.navProfile}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}
      >
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#ff8a5b,#ff5b9c)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12, flex: "none" }}>
          {vm.userInitial}
        </div>
        <div style={{ lineHeight: 1.2, minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{vm.userName}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {vm.userEmail ? vm.userEmail + " · " : ""}
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>{vm.planLabel || t.proBadge}</span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            vm.onLogout();
          }}
          title={vm.signOutLabel}
          aria-label={vm.signOutLabel}
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon name="lock" />
        </button>
      </div>
      <div
        onMouseDown={vm.onResize}
        title={t.resize}
        style={{ position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", zIndex: 30 }}
      />
    </aside>
  );
}
