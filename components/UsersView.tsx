import type { ViewModel } from "@/lib/viewModel";

const MONO = "'JetBrains Mono',monospace";
const DISPLAY = "'Space Grotesk',sans-serif";
const GRID = "1.7fr 104px 116px 78px 92px 96px 70px";

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--border-2)",
  background: "var(--surface-2)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  outline: "none",
};

const PLAN_IDS: ("free" | "pro" | "team" | "ent")[] = ["free", "pro", "team", "ent"];
const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", team: "Team", ent: "Enterprise" };

export default function UsersView({ vm }: { vm: ViewModel }) {
  const { t } = vm;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "30px 30px 60px" }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, letterSpacing: "-.02em" }}>
          {t.userMgmtTitle}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{t.userMgmtSub}</div>

        {vm.usersError && (
          <div
            style={{
              marginTop: 16,
              padding: "11px 14px",
              borderRadius: 11,
              border: "1px solid var(--border-2)",
              background: "rgba(255,106,106,.10)",
              fontSize: 12.5,
              color: "var(--danger)",
              fontWeight: 600,
            }}
          >
            {vm.usersError}
          </div>
        )}

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            marginTop: 22,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 10,
              padding: "12px 20px",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--faint)",
              letterSpacing: ".03em",
              borderBottom: "1px solid var(--border)",
              textTransform: "uppercase",
            }}
          >
            <div>{t.colUser}</div>
            <div>{t.colRole}</div>
            <div>{t.colPlan}</div>
            <div style={{ textAlign: "right" }}>{t.colCalls}</div>
            <div style={{ textAlign: "right" }}>{t.colSpend}</div>
            <div>{t.colJoined}</div>
            <div style={{ textAlign: "right" }}>{t.colActions}</div>
          </div>

          {vm.users.map((u) => (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 10,
                padding: "12px 20px",
                fontSize: 12,
                alignItems: "center",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {/* user */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: u.avatarColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 12,
                    flex: "none",
                    fontFamily: DISPLAY,
                  }}
                >
                  {u.initial}
                </div>
                <div style={{ lineHeight: 1.25, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 12.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {u.name}
                    {u.isSelf && (
                      <span style={{ color: "var(--accent)", fontSize: 10.5, marginLeft: 6 }}>•</span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--faint)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {u.email}
                  </div>
                </div>
              </div>

              {/* role */}
              <select
                value={u.role}
                onChange={(e) => vm.onAdminSetRole(u.id, e.target.value as "user" | "admin")}
                style={selectStyle}
              >
                <option value="user">{t.roleUser}</option>
                <option value="admin">{t.roleAdmin}</option>
              </select>

              {/* plan */}
              <select
                value={u.planId}
                onChange={(e) =>
                  vm.onAdminSetPlan(u.id, e.target.value as "free" | "pro" | "team" | "ent")
                }
                style={selectStyle}
              >
                {PLAN_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABEL[p]}
                  </option>
                ))}
              </select>

              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--muted)" }}>
                {u.callsStr}
              </div>
              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--text)", fontWeight: 600 }}>
                {u.spendStr}
              </div>
              <div style={{ fontFamily: MONO, color: "var(--faint)", fontSize: 11 }}>{u.joined}</div>

              {/* actions */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  disabled={!u.deletable}
                  onClick={() => {
                    if (!u.deletable) return;
                    if (window.confirm(t.confirmDelete)) vm.onAdminDeleteUser(u.id);
                  }}
                  title={t.deleteUser}
                  style={{
                    padding: "6px 11px",
                    borderRadius: 8,
                    border: `1px solid ${u.deletable ? "var(--border-2)" : "var(--border)"}`,
                    background: "transparent",
                    color: u.deletable ? "var(--danger)" : "var(--faint)",
                    font: "inherit",
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: u.deletable ? "pointer" : "not-allowed",
                    opacity: u.deletable ? 1 : 0.5,
                  }}
                >
                  {t.deleteUser}
                </button>
              </div>
            </div>
          ))}

          {vm.usersLoaded && vm.users.length === 0 && (
            <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--faint)", fontSize: 13 }}>
              {t.noUsers}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
