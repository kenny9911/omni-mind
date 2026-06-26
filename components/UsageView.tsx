import type { ViewModel } from "@/lib/viewModel";

const MONO = "'JetBrains Mono',monospace";
const DISPLAY = "'Space Grotesk',sans-serif";
const GRID = "88px 1fr 92px 120px 90px 80px 82px 90px";

export default function UsageView({ vm }: { vm: ViewModel }) {
  const { t } = vm;
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "30px 30px 60px" }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, letterSpacing: "-.02em" }}>{t.usageTitle}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{t.usageSub}</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginTop: 24 }}>
          {vm.usageStats.map((s, i) => (
            <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "15px 16px" }}>
              <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 21, marginTop: 8, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16, marginTop: 18 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.uTrend}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, marginTop: 20 }}>
              {vm.trendDays.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, height: "100%", justifyContent: "flex-end" }}>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--muted)" }}>{d.valStr}</div>
                  <div style={{ width: "100%", borderRadius: "7px 7px 3px 3px", background: "linear-gradient(180deg,var(--accent),var(--accent-2))", height: d.h }} />
                  <div style={{ fontSize: 10, color: "var(--faint)" }}>{d.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.uByModel}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 16 }}>
              {vm.perModel.map((p, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: "none" }} />
                    <span style={{ fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ fontFamily: MONO, color: "var(--muted)", flex: "none" }}>{p.costStr}</span>
                    <span style={{ fontFamily: MONO, color: "var(--faint)", fontSize: 11, width: 40, textAlign: "right", flex: "none" }}>{p.shareStr}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 4, background: p.color, width: p.w }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, marginTop: 18, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.uLedger}</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{t.creditNote}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "11px 20px", fontSize: 11, fontWeight: 700, color: "var(--faint)", letterSpacing: ".03em", borderBottom: "1px solid var(--border)", textTransform: "uppercase" }}>
            <div>{t.colTime}</div>
            <div>{t.colPrompt}</div>
            <div>{t.colMode}</div>
            <div>{t.colModels}</div>
            <div style={{ textAlign: "right" }}>{t.colTokens}</div>
            <div style={{ textAlign: "right" }}>{t.colMc}</div>
            <div style={{ textAlign: "right" }}>{t.colFee}</div>
            <div style={{ textAlign: "right" }}>{t.colTotal}</div>
          </div>
          {vm.ledgerRows.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "12px 20px", fontSize: 12, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: MONO, color: "var(--muted)", fontSize: 11 }}>{r.time}</div>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)" }}>{r.prompt}</div>
              <div>
                <span style={{ padding: "3px 8px", borderRadius: 7, fontSize: 10.5, fontWeight: 700, background: r.modeBg, color: r.modeFg }}>{r.modeLabel}</span>
              </div>
              <div style={{ display: "flex" }}>
                {r.dots.map((d, i) => (
                  <span key={i} title={d.name} style={{ width: 18, height: 18, borderRadius: 6, background: d.color, marginLeft: -4, border: "2px solid var(--surface)" }} />
                ))}
              </div>
              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--muted)" }}>{r.tokStr}</div>
              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--muted)" }}>{r.mcStr}</div>
              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--faint)" }}>{r.feeStr}</div>
              <div style={{ textAlign: "right", fontFamily: MONO, color: "var(--accent)", fontWeight: 700 }}>{r.totalStr}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
