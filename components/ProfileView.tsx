import { useState } from "react";
import type { ViewModel } from "@/lib/viewModel";

const MONO = "'JetBrains Mono',monospace";
const DISPLAY = "'Space Grotesk',sans-serif";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-2)",
  background: "var(--surface-2)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 13,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: "var(--muted)",
  letterSpacing: ".02em",
};

export default function ProfileView({ vm }: { vm: ViewModel }) {
  const { t, profile } = vm;
  const ro = profile.isDemo;

  const [name, setName] = useState(profile.name);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const nameDirty = name.trim().length > 0 && name.trim() !== profile.name;
  const pwReady = curPw.length > 0 && newPw.length > 0;

  const saveName = () => {
    if (ro || !nameDirty) return;
    vm.onSaveProfile({ name: name.trim() });
  };
  const savePw = () => {
    if (ro || !pwReady) return;
    vm.onSaveProfile({ currentPassword: curPw, newPassword: newPw });
    setCurPw("");
    setNewPw("");
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "30px 30px 60px" }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, letterSpacing: "-.02em" }}>
          {t.profileTitle}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{t.profileSub}</div>

        {/* identity card */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "22px 24px",
            marginTop: 24,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(135deg,#ff8a5b,#ff5b9c)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 26,
              fontFamily: DISPLAY,
              flex: "none",
            }}
          >
            {profile.initial}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 700,
                  fontSize: 19,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {profile.name}
              </span>
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: 7,
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: profile.roleIsAdmin ? "var(--accent-soft)" : "var(--surface-2)",
                  color: profile.roleIsAdmin ? "var(--accent)" : "var(--muted)",
                }}
              >
                {profile.roleLabel}
              </span>
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: 7,
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: "rgba(58,209,155,.14)",
                  color: "var(--success)",
                }}
              >
                {profile.planLabel}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>{profile.email}</div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 3, fontFamily: MONO }}>
              {t.memberSince} {profile.memberSince}
            </div>
          </div>
        </div>

        {/* usage stats */}
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 28 }}>{t.usageStats}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 14 }}>
          {profile.stats.map((s, i) => (
            <div
              key={i}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "15px 16px",
              }}
            >
              <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 21, marginTop: 8, color: s.color }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* context memory */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "20px 22px",
            marginTop: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{profile.memory.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {profile.memory.updatedLabel && (
                <span style={{ fontSize: 11, color: "var(--faint)", fontFamily: MONO }}>{profile.memory.updatedLabel}</span>
              )}
              {profile.memory.facts.length > 0 && !ro && (
                <button
                  onClick={profile.memory.onClear}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 9,
                    border: "1px solid var(--border-2)",
                    background: "var(--surface-2)",
                    color: "var(--muted)",
                    font: "inherit",
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {profile.memory.clearLabel}
                </button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, maxWidth: 620, lineHeight: 1.55 }}>{profile.memory.hint}</div>

          {profile.memory.facts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
              {profile.memory.facts.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 13px",
                    borderRadius: 11,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--text)",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginTop: 7, flex: "none" }} />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 16, fontStyle: "italic" }}>
              {profile.memory.loaded ? profile.memory.emptyText : "…"}
            </div>
          )}
        </div>

        {/* edit card */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "20px 22px",
            marginTop: 24,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>{t.accountInfo}</div>

          {ro && (
            <div
              style={{
                marginTop: 14,
                padding: "11px 14px",
                borderRadius: 11,
                border: "1px solid var(--border-2)",
                background: "var(--surface-2)",
                fontSize: 12.5,
                color: "var(--warn)",
                fontWeight: 600,
              }}
            >
              {t.demoReadonly}
            </div>
          )}

          {vm.profileError && (
            <div
              style={{
                marginTop: 14,
                padding: "11px 14px",
                borderRadius: 11,
                border: "1px solid var(--border-2)",
                background: "rgba(255,106,106,.10)",
                fontSize: 12.5,
                color: "var(--danger)",
                fontWeight: 600,
              }}
            >
              {vm.profileError}
            </div>
          )}

          {/* name */}
          <div style={{ marginTop: 18, maxWidth: 460 }}>
            <div style={labelStyle}>{t.changeName}</div>
            <div style={{ display: "flex", gap: 9, marginTop: 7 }}>
              <input
                value={name}
                disabled={ro}
                onChange={(e) => setName(e.target.value)}
                style={{ ...inputStyle, opacity: ro ? 0.5 : 1 }}
              />
              <button
                onClick={saveName}
                disabled={ro || !nameDirty}
                style={{
                  flex: "none",
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "1px solid var(--accent)",
                  background: !ro && nameDirty ? "var(--accent)" : "var(--surface-2)",
                  color: !ro && nameDirty ? "#fff" : "var(--faint)",
                  font: "inherit",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: !ro && nameDirty ? "pointer" : "default",
                }}
              >
                {t.save}
              </button>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

          {/* password */}
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.changePassword}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12, maxWidth: 600 }}>
            <div>
              <div style={labelStyle}>{t.currentPassword}</div>
              <input
                type="password"
                value={curPw}
                disabled={ro}
                onChange={(e) => setCurPw(e.target.value)}
                autoComplete="current-password"
                style={{ ...inputStyle, marginTop: 7, opacity: ro ? 0.5 : 1 }}
              />
            </div>
            <div>
              <div style={labelStyle}>{t.newPassword}</div>
              <input
                type="password"
                value={newPw}
                disabled={ro}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                style={{ ...inputStyle, marginTop: 7, opacity: ro ? 0.5 : 1 }}
              />
            </div>
          </div>
          <button
            onClick={savePw}
            disabled={ro || !pwReady}
            style={{
              marginTop: 14,
              padding: "10px 18px",
              borderRadius: 10,
              border: `1px solid ${!ro && pwReady ? "var(--accent)" : "var(--border-2)"}`,
              background: !ro && pwReady ? "var(--accent)" : "var(--surface-2)",
              color: !ro && pwReady ? "#fff" : "var(--faint)",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: !ro && pwReady ? "pointer" : "default",
            }}
          >
            {t.changePassword}
          </button>
        </div>
      </div>
    </div>
  );
}
