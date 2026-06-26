import { useState } from "react";
import type { ViewModel } from "@/lib/viewModel";

const MONO = "'JetBrains Mono',monospace";
const DISPLAY = "'Space Grotesk',sans-serif";
// user · role · plan · status · calls · spend · joined · actions
const GRID = "minmax(150px,1.4fr) 88px 92px 96px 56px 78px 78px 188px";

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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 10,
  border: "1px solid var(--border-2)",
  background: "var(--surface-2)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 13,
  outline: "none",
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  letterSpacing: ".02em",
  marginBottom: 6,
};

const PLAN_IDS: ("free" | "pro" | "team" | "ent")[] = ["free", "pro", "team", "ent"];
const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", team: "Team", ent: "Enterprise" };

type CreateForm = { name: string; email: string; password: string; role: "user" | "admin"; planId: "free" | "pro" | "team" | "ent" };
const EMPTY_FORM: CreateForm = { name: "", email: "", password: "", role: "user", planId: "free" };

export default function UsersView({ vm }: { vm: ViewModel }) {
  const { t } = vm;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
  const formReady = form.name.trim().length > 0 && emailOk && form.password.length >= 8;

  const submitCreate = async () => {
    if (!formReady || submitting) return;
    setSubmitting(true);
    const ok = await vm.onAdminCreateUser({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      planId: form.planId,
    });
    setSubmitting(false);
    if (ok) {
      setForm(EMPTY_FORM);
      setShowForm(false);
    }
  };

  const resetPw = (id: string) => {
    const pw = window.prompt(t.resetPwPrompt);
    if (pw == null) return; // cancelled
    if (pw.length < 8) {
      window.alert(t.passwordTooShort);
      return;
    }
    vm.onAdminResetPassword(id, pw);
  };

  const toggleStatus = (u: ViewModel["users"][number]) => {
    if (u.suspended) {
      vm.onAdminSetStatus(u.id, "active");
    } else if (window.confirm(t.confirmSuspend)) {
      vm.onAdminSetStatus(u.id, "suspended");
    }
  };

  const actionBtn = (color: string, enabled = true): React.CSSProperties => ({
    padding: "5px 9px",
    borderRadius: 8,
    border: "1px solid var(--border-2)",
    background: "transparent",
    color,
    font: "inherit",
    fontSize: 11,
    fontWeight: 700,
    cursor: enabled ? "pointer" : "not-allowed",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "30px 30px 60px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, letterSpacing: "-.02em" }}>
              {t.userMgmtTitle}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{t.userMgmtSub}</div>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{
              flex: "none",
              padding: "10px 16px",
              borderRadius: 10,
              border: `1px solid ${showForm ? "var(--border-2)" : "var(--accent)"}`,
              background: showForm ? "var(--surface-2)" : "var(--accent)",
              color: showForm ? "var(--muted)" : "#fff",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {showForm ? t.cancel : `+ ${t.newUser}`}
          </button>
        </div>

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

        {/* create-user form */}
        {showForm && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              marginTop: 18,
              padding: "20px 22px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, fontFamily: DISPLAY }}>{t.createUserTitle}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
              <div>
                <div style={fieldLabel}>{t.formName}</div>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
              <div>
                <div style={fieldLabel}>{t.formEmail}</div>
                <input
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  style={inputStyle}
                  autoComplete="off"
                  type="email"
                />
              </div>
              <div>
                <div style={fieldLabel}>{t.formPassword}</div>
                <input
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  style={inputStyle}
                  autoComplete="new-password"
                  type="password"
                  placeholder="••••••••"
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={fieldLabel}>{t.formRole}</div>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "user" | "admin" }))}
                    style={{ ...selectStyle, padding: "9px 10px", fontSize: 12.5 }}
                  >
                    <option value="user">{t.roleUser}</option>
                    <option value="admin">{t.roleAdmin}</option>
                  </select>
                </div>
                <div>
                  <div style={fieldLabel}>{t.formPlan}</div>
                  <select
                    value={form.planId}
                    onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value as CreateForm["planId"] }))}
                    style={{ ...selectStyle, padding: "9px 10px", fontSize: 12.5 }}
                  >
                    {PLAN_IDS.map((p) => (
                      <option key={p} value={p}>
                        {PLAN_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
              <button
                onClick={submitCreate}
                disabled={!formReady || submitting}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: `1px solid ${formReady && !submitting ? "var(--accent)" : "var(--border-2)"}`,
                  background: formReady && !submitting ? "var(--accent)" : "var(--surface-2)",
                  color: formReady && !submitting ? "#fff" : "var(--faint)",
                  font: "inherit",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: formReady && !submitting ? "pointer" : "default",
                }}
              >
                {submitting ? t.creating : t.create}
              </button>
              <button
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setShowForm(false);
                }}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "1px solid var(--border-2)",
                  background: "transparent",
                  color: "var(--muted)",
                  font: "inherit",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t.cancel}
              </button>
              {form.password.length > 0 && form.password.length < 8 && (
                <span style={{ fontSize: 11.5, color: "var(--warn)", fontWeight: 600 }}>{t.passwordTooShort}</span>
              )}
            </div>
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
            <div>{t.colStatus}</div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, opacity: u.suspended ? 0.55 : 1 }}>
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
                disabled={u.isSystem}
                onChange={(e) => vm.onAdminSetRole(u.id, e.target.value as "user" | "admin")}
                style={{ ...selectStyle, opacity: u.isSystem ? 0.5 : 1, cursor: u.isSystem ? "not-allowed" : "pointer" }}
              >
                <option value="user">{t.roleUser}</option>
                <option value="admin">{t.roleAdmin}</option>
              </select>

              {/* plan */}
              <select
                value={u.planId}
                disabled={u.isSystem}
                onChange={(e) =>
                  vm.onAdminSetPlan(u.id, e.target.value as "free" | "pro" | "team" | "ent")
                }
                style={{ ...selectStyle, opacity: u.isSystem ? 0.5 : 1, cursor: u.isSystem ? "not-allowed" : "pointer" }}
              >
                {PLAN_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABEL[p]}
                  </option>
                ))}
              </select>

              {/* status */}
              <div>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 9px",
                    borderRadius: 7,
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: u.suspended ? "rgba(255,106,106,.12)" : "rgba(58,209,155,.14)",
                    color: u.suspended ? "var(--danger)" : "var(--success)",
                  }}
                >
                  {u.statusLabel}
                </span>
              </div>

              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--muted)" }}>
                {u.callsStr}
              </div>
              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--text)", fontWeight: 600 }}>
                {u.spendStr}
              </div>
              <div style={{ fontFamily: MONO, color: "var(--faint)", fontSize: 11 }}>{u.joined}</div>

              {/* actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                {u.resettable && (
                  <button onClick={() => resetPw(u.id)} title={t.resetPassword} style={actionBtn("var(--muted)")}>
                    {t.resetPassword}
                  </button>
                )}
                {u.suspendable && (
                  <button
                    onClick={() => toggleStatus(u)}
                    title={u.suspended ? t.reactivate : t.suspend}
                    style={actionBtn(u.suspended ? "var(--success)" : "var(--warn)")}
                  >
                    {u.suspended ? t.reactivate : t.suspend}
                  </button>
                )}
                <button
                  disabled={!u.deletable}
                  onClick={() => {
                    if (!u.deletable) return;
                    if (window.confirm(t.confirmDelete)) vm.onAdminDeleteUser(u.id);
                  }}
                  title={t.deleteUser}
                  style={{
                    ...actionBtn(u.deletable ? "var(--danger)" : "var(--faint)", u.deletable),
                    border: `1px solid ${u.deletable ? "var(--border-2)" : "var(--border)"}`,
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
