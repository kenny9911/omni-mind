import type { ViewModel } from "@/lib/viewModel";
import { Icon } from "@/components/Icons";

export default function ModelsView({ vm }: { vm: ViewModel }) {
  const { t } = vm;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "30px 30px 60px" }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "-.02em" }}>
          {t.modelsTitle}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{t.modelsSub}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 22 }}>
          <div style={{ background: "linear-gradient(135deg,var(--accent-soft),transparent)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 14 }}>
              <span style={{ color: "var(--accent)" }}>
                <Icon name="spark" />
              </span>
              {t.routeTitle}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginTop: 9 }}>{t.routeDesc}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ color: "var(--accent)" }}>
                <Icon name="layers" />
              </span>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t.trioTitle}</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>{t.trioDesc}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
              {vm.trioChips.map((c, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px 6px 7px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}
                >
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: c.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "'Space Grotesk'" }}>
                    {c.initials}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 13, marginTop: 16 }}>
          {vm.modelCards.map((m) => (
            <div
              key={m.id}
              style={{ background: "var(--surface)", border: `1px solid ${m.border}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 11, position: "relative" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: m.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk'", flex: "none" }}>
                  {m.initials}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)" }}>{m.vendor}</div>
                </div>
                <span style={{ padding: "3px 8px", borderRadius: 7, fontSize: 10, fontWeight: 700, background: m.tierBg, color: m.tierFg, flex: "none" }}>
                  {m.tierLabel}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {m.tags.map((tg, i) => (
                  <span key={i} style={{ padding: "3px 9px", borderRadius: 7, background: "var(--surface-2)", fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>
                    {tg}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono',monospace" }}>
                <span>
                  {t.context} <b style={{ color: "var(--text)" }}>{m.ctx}</b>
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 8, padding: "7px 9px" }}>
                  <div style={{ color: "var(--faint)", fontSize: 9.5 }}>
                    {t.inP}
                    {t.perM}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 2 }}>{m.inPrice}</div>
                </div>
                <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 8, padding: "7px 9px" }}>
                  <div style={{ color: "var(--faint)", fontSize: 9.5 }}>
                    {t.outP}
                    {t.perM}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 2 }}>{m.outPrice}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                <button
                  onClick={m.onMain}
                  style={{ flex: 1, padding: 8, borderRadius: 9, border: `1px solid ${m.mainBorder}`, background: m.mainBg, color: m.mainFg, font: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                >
                  {m.mainLabel}
                </button>
                <button
                  onClick={m.onToggle}
                  title={t.enable}
                  style={{ width: 46, flex: "none", padding: 8, borderRadius: 9, border: "1px solid var(--border)", background: m.toggleBg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <span style={{ width: 30, height: 16, borderRadius: 9, background: m.switchBg, position: "relative", display: "block" }}>
                    <span style={{ position: "absolute", top: 2, left: m.switchX, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "linear-gradient(120deg,var(--surface),var(--surface-2))", border: "1px dashed var(--border-2)", borderRadius: 16, padding: "18px 20px", marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "#8b8fa3", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontFamily: "'Space Grotesk'" }}>
            OR
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>
              OpenRouter <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>{t.gateway}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{t.gatewayDesc}</div>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", maxWidth: 280, justifyContent: "flex-end" }}>
            {vm.orModels.map((o, i) => (
              <span key={i} style={{ padding: "5px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                {o}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
