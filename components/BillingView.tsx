import type { ViewModel } from "@/lib/viewModel";
import { Icon } from "@/components/Icons";

export default function BillingView({ vm }: { vm: ViewModel }) {
  const { t } = vm;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "30px 30px 60px" }}>
        <div
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: "-.02em",
          }}
        >
          {t.billTitle}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>
          {t.billSub}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr",
            gap: 16,
            marginTop: 24,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg,var(--accent),#8b7bff)",
              borderRadius: 18,
              padding: "22px 24px",
              color: "#fff",
              boxShadow: "0 14px 38px var(--accent-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  opacity: 0.85,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                }}
              >
                {t.currentPlan}
              </span>
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: 7,
                  background: "rgba(255,255,255,.22)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                Pro
              </span>
            </div>
            <div
              style={{
                fontFamily: "'Space Grotesk',sans-serif",
                fontWeight: 700,
                fontSize: 30,
                marginTop: 12,
              }}
            >
              ¥199
              <span style={{ fontSize: 14, opacity: 0.8, fontWeight: 500 }}>
                {t.perMonth}
              </span>
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 12.5,
                opacity: 0.9,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{t.included}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                ¥150.00
              </span>
            </div>
            <div
              style={{
                height: 9,
                borderRadius: 6,
                background: "rgba(255,255,255,.25)",
                marginTop: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: 6,
                  background: "#fff",
                  width: vm.usedPct,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 11.5,
                fontFamily: "'JetBrains Mono',monospace",
                opacity: 0.92,
              }}
            >
              <span>
                {t.used} {vm.monthTotal}
              </span>
              <span>
                {t.remaining} {vm.remaining}
              </span>
            </div>
          </div>
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 18,
              padding: "22px 24px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.thisMonth}</div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                marginTop: 16,
                color: "var(--muted)",
              }}
            >
              <span>{t.modelSpend}</span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  color: "var(--text)",
                  fontWeight: 600,
                }}
              >
                {vm.mcTotal}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                marginTop: 11,
                color: "var(--muted)",
              }}
            >
              <span>{t.feeSpend}</span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  color: "var(--text)",
                  fontWeight: 600,
                }}
              >
                {vm.feeTotal}
              </span>
            </div>
            <div
              style={{ height: 1, background: "var(--border)", margin: "14px 0" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {t.monthTotal}
              </span>
              <span
                style={{
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 700,
                  fontSize: 22,
                  color: "var(--accent)",
                }}
              >
                {vm.monthTotal}
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <button
              style={{
                marginTop: 16,
                padding: 10,
                borderRadius: 11,
                border: "1px solid var(--border-2)",
                background: "var(--surface-2)",
                color: "var(--text)",
                font: "inherit",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t.topup}
            </button>
          </div>
        </div>

        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 30 }}>
          {t.plansTitle}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 13,
            marginTop: 14,
          }}
        >
          {vm.plans.map((p, i) => (
            <div
              key={i}
              style={{
                background: "var(--surface)",
                border: `1.5px solid ${p.border}`,
                borderRadius: 16,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              {p.current && (
                <span
                  style={{
                    position: "absolute",
                    top: -9,
                    left: 18,
                    padding: "3px 10px",
                    borderRadius: 8,
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {t.currentBadge}
                </span>
              )}
              <div
                style={{
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                {p.name}
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 700,
                    fontSize: 24,
                  }}
                >
                  {p.price}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {p.period}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--accent)",
                  fontWeight: 700,
                  marginTop: 4,
                  minHeight: 16,
                }}
              >
                {p.creditNote}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 14,
                  flex: 1,
                }}
              >
                {p.features.map((f, j) => (
                  <div
                    key={j}
                    style={{
                      display: "flex",
                      gap: 7,
                      alignItems: "flex-start",
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    <span
                      style={{
                        color: "var(--success)",
                        flex: "none",
                        marginTop: 1,
                      }}
                    >
                      <Icon name="check" />
                    </span>
                    {f}
                  </div>
                ))}
              </div>
              <button
                style={{
                  marginTop: 16,
                  padding: 9,
                  borderRadius: 10,
                  border: `1px solid ${p.btnBorder}`,
                  background: p.btnBg,
                  color: p.btnFg,
                  font: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {p.btnLabel}
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginTop: 24,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "18px 20px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>
              {t.invoices}
            </div>
            {vm.invoices.map((iv, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{iv.date}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)" }}>
                    {iv.plan}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {iv.amount}
                </span>
                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 7,
                    background: "rgba(58,209,155,.14)",
                    color: "var(--success)",
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {iv.status}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "18px 20px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>
              {t.paymentMethod}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: 14,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 30,
                  borderRadius: 7,
                  background: "linear-gradient(135deg,#1a1f36,#3a3f66)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "'Space Grotesk'",
                }}
              >
                VISA
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono',monospace",
                  }}
                >
                  •••• 4242
                </div>
                <div style={{ fontSize: 11, color: "var(--faint)" }}>
                  {t.expires} 08/28
                </div>
              </div>
              <button
                style={{
                  padding: "7px 12px",
                  borderRadius: 9,
                  border: "1px solid var(--border-2)",
                  background: "transparent",
                  color: "var(--muted)",
                  font: "inherit",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t.manage}
              </button>
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--faint)",
                lineHeight: 1.6,
                marginTop: 14,
              }}
            >
              {t.creditNote}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
