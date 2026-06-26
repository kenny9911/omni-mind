"use client";

import { useEffect, useRef } from "react";
import type {
  ViewModel,
  MessageVM,
  AssistantMsgVM,
  CallVM,
  FusionVM,
} from "@/lib/viewModel";
import { Icon } from "@/components/Icons";

const MONO = "'JetBrains Mono',monospace";
const DISPLAY = "'Space Grotesk',sans-serif";

function StreamingCursor() {
  return (
    <span style={{ color: "var(--accent)", animation: "blink 1s infinite", fontWeight: 700 }}>
      ▍
    </span>
  );
}
function ThinkingDots({ color = "var(--muted)", size = 6 }: { color?: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, verticalAlign: "middle" }}>
      {[0, 0.2, 0.4].map((d, i) => (
        <span
          key={i}
          style={{ width: size, height: size, borderRadius: "50%", background: color, animation: `dotpulse 1.2s infinite ${d}s` }}
        />
      ))}
    </span>
  );
}

function ModeBar({ vm }: { vm: ViewModel }) {
  const { t } = vm;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 22px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev)", flex: "none" }}>
      <div style={{ display: "flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: 3, gap: 2 }}>
        <button onClick={vm.onFast} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 9, border: "none", background: vm.fastBg, color: vm.fastFg, boxShadow: vm.fastSh, font: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <Icon name="bolt" />
          {t.fast}
        </button>
        <button onClick={vm.onExpert} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 9, border: "none", background: vm.expBg, color: vm.expFg, boxShadow: vm.expSh, font: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <Icon name="layers" />
          {t.expert}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{vm.modeDesc}</div>
      <div style={{ flex: 1 }} />

      {vm.isFast && (
        <>
          <button onClick={vm.onToggleAuto} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 11px", borderRadius: 10, border: `1px solid ${vm.autoBorder}`, background: vm.autoBg, color: vm.autoFg, font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            <Icon name="spark" />
            {t.auto}
          </button>
          <div style={{ position: "relative" }}>
            <button onClick={vm.onOpenModel} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px 6px 8px", borderRadius: 10, border: `1px solid ${vm.modelBtnBorder}`, background: "var(--surface)", cursor: "pointer", font: "inherit" }}>
              <div style={{ width: 22, height: 22, borderRadius: 7, background: vm.mainColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: DISPLAY }}>
                {vm.mainInitials}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{vm.mainName}</div>
              <span style={{ display: "flex", color: "var(--faint)" }}>
                <Icon name="chevron" />
              </span>
            </button>
            {vm.menuModel && (
              <div style={{ position: "absolute", top: "calc(100% + 7px)", right: 0, zIndex: 60, width: 248, maxHeight: 340, overflowY: "auto", background: "var(--bg-elev)", border: "1px solid var(--border-2)", borderRadius: 13, padding: 6, boxShadow: "var(--shadow)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--faint)", textTransform: "uppercase", padding: "6px 8px 8px" }}>
                  {vm.modelPickerTitle}
                </div>
                {vm.modelPicker.map((o, i) => (
                  <button key={i} onClick={o.onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 9px", borderRadius: 9, border: "none", background: o.bg, cursor: "pointer", font: "inherit", textAlign: "left", marginBottom: 1 }}>
                    {o.auto && (
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,var(--accent),var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flex: "none" }}>
                        <Icon name="spark" />
                      </span>
                    )}
                    {o.isModel && (
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: o.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: DISPLAY, flex: "none" }}>
                        {o.initials}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{o.sub}</div>
                    </div>
                    {o.active && (
                      <span style={{ color: "var(--accent)", display: "flex", flex: "none" }}>
                        <Icon name="check" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {vm.isExpert && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 7 }}>
          <button
            onClick={vm.onOpenTrio}
            title={vm.trioPickerTitle}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px 5px 12px", borderRadius: 10, border: `1px solid ${vm.trioBtnBorder}`, background: "var(--surface)", cursor: "pointer", font: "inherit" }}
          >
            <div style={{ display: "flex" }}>
              {vm.trioChips.map((c, i) => (
                <div key={i} title={c.name} style={{ width: 26, height: 26, borderRadius: 8, background: c.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: DISPLAY, marginLeft: -6, border: "2px solid var(--surface)" }}>
                  {c.initials}
                </div>
              ))}
            </div>
            <span style={{ display: "flex", color: "var(--faint)" }}>
              <Icon name="chevron" />
            </span>
          </button>
          <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 9, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11.5, fontWeight: 700 }}>
            <Icon name="spark" />
            {t.fusing}
          </span>

          {vm.menuTrio && (
            <div style={{ position: "absolute", top: "calc(100% + 7px)", right: 0, zIndex: 60, width: 264, maxHeight: 380, display: "flex", flexDirection: "column", background: "var(--bg-elev)", border: "1px solid var(--border-2)", borderRadius: 13, padding: 6, boxShadow: "var(--shadow)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "6px 8px 2px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--faint)", textTransform: "uppercase" }}>{vm.trioPickerTitle}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>{vm.trioCountLabel}</div>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--faint)", padding: "0 8px 6px" }}>{vm.trioPickerHint}</div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {vm.trioPicker.map((o) => (
                  <button key={o.id} onClick={o.onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 9px", borderRadius: 9, border: "none", background: o.selected ? "var(--accent-soft)" : "transparent", cursor: "pointer", font: "inherit", textAlign: "left", marginBottom: 1 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: o.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: DISPLAY, flex: "none" }}>
                      {o.initials}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{o.sub}</div>
                    </div>
                    <span style={{ width: 18, height: 18, borderRadius: 6, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", border: o.selected ? "none" : "1.5px solid var(--border-2)", background: o.selected ? "var(--accent)" : "transparent", color: "#fff" }}>
                      {o.selected && <Icon name="check" />}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={vm.onApplyTrio}
                disabled={vm.trioApplyDisabled}
                style={{ marginTop: 6, padding: "9px 12px", borderRadius: 9, border: "none", background: vm.trioApplyDisabled ? "var(--surface-2)" : "var(--accent)", color: vm.trioApplyDisabled ? "var(--faint)" : "#fff", font: "inherit", fontSize: 12.5, fontWeight: 700, cursor: vm.trioApplyDisabled ? "default" : "pointer" }}
              >
                {vm.trioApplyLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyRerun({ call, onRerun, t, accent }: { call: CallVM | FusionVM; onRerun: () => void; t: ViewModel["t"]; accent?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 7, marginTop: accent ? 14 : 13 }}>
      <button
        onClick={call.onCopy}
        title={t.copy}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 11px",
          borderRadius: 9,
          border: accent ? "1px solid var(--accent)" : "1px solid var(--border)",
          background: accent ? "var(--accent-soft)" : "var(--surface-2)",
          color: accent ? "var(--accent)" : "var(--muted)",
          font: "inherit",
          fontSize: 11.5,
          fontWeight: accent ? 700 : 600,
          cursor: "pointer",
        }}
      >
        {call.copied ? (
          <>
            <span style={{ color: "var(--success)", display: "flex" }}>
              <Icon name="check" />
            </span>
            {t.copied}
          </>
        ) : (
          <>
            <Icon name="copy" />
            {t.copy}
          </>
        )}
      </button>
      <button
        onClick={onRerun}
        title={t.rerun}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 9, border: accent ? "1px solid var(--border-2)" : "1px solid var(--border)", background: "var(--surface-2)", color: "var(--muted)", font: "inherit", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
      >
        <Icon name="refresh" />
        {t.rerun}
      </button>
    </div>
  );
}

function SingleCard({ m, vm }: { m: AssistantMsgVM; vm: ViewModel }) {
  const s = m.single!;
  const { t } = vm;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 17, padding: "16px 19px", boxShadow: "var(--shadow)" }}>
      {m.routeText && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13, paddingBottom: 13, borderBottom: "1px dashed var(--border)", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
          <Icon name="spark" />
          {m.routeText}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 11 }}>
        <div style={{ width: 28, height: 28, borderRadius: 9, background: s.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: DISPLAY }}>
          {s.initials}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
        <div style={{ fontSize: 11, color: "var(--faint)" }}>{s.vendor}</div>
        <div style={{ flex: 1 }} />
        {s.streaming && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", animation: "glow 1s infinite" }} />}
      </div>
      {s.thinking && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
          <ThinkingDots />
          {t.thinking}
        </div>
      )}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.72, fontSize: 14.5, color: "var(--text)" }}>
        {s.text}
        {s.streaming && <StreamingCursor />}
      </div>
      {s.done && <CopyRerun call={s} onRerun={m.onRerun} t={t} />}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, paddingTop: 11, borderTop: "1px dashed var(--border)", fontFamily: MONO, fontSize: 11, color: "var(--muted)" }}>
        <span style={{ color: "var(--faint)" }} title={s.modelId}>{s.modelId}</span>
        <span>
          {t.tokens} <b style={{ color: "var(--text)" }}>{s.tokStr}</b>
        </span>
        <span style={{ color: "var(--faint)" }}>↑{s.inTokStr} ↓{s.outTokStr}</span>
        <div style={{ flex: 1 }} />
        <span>
          {t.cost} <b style={{ color: "var(--accent)" }}>{s.costStr}</b>
        </span>
      </div>
    </div>
  );
}

function ExpertCard({ e, t }: { e: CallVM; t: ViewModel["t"] }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 13, boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, paddingBottom: 9, borderBottom: "1px solid var(--border)" }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: e.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: DISPLAY, flex: "none" }}>
          {e.initials}
        </div>
        <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
        <div style={{ flex: 1 }} />
        {e.streaming && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", animation: "glow 1s infinite", flex: "none" }} />}
        {e.done && (
          <span style={{ color: "var(--success)", display: "flex", flex: "none" }}>
            <Icon name="check" />
          </span>
        )}
      </div>
      {e.thinking && (
        <div style={{ display: "flex", gap: 3, padding: "4px 0" }}>
          {[0, 0.2, 0.4].map((d, i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--muted)", animation: `dotpulse 1.2s infinite ${d}s` }} />
          ))}
        </div>
      )}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 12, color: "var(--muted)", flex: 1 }}>
        {e.text}
        {e.streaming && <span style={{ color: "var(--accent)", animation: "blink 1s infinite" }}>▍</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border)", fontFamily: MONO, fontSize: 10, color: "var(--faint)" }}>
        <span title={e.modelId} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.modelId}</span>
        <span style={{ flex: "none" }}>· {e.tokStr} tok</span>
        <div style={{ flex: 1 }} />
        {e.done && (
          <button onClick={e.onCopy} title={t.copy} style={{ display: "flex", alignItems: "center", padding: 2, border: "none", background: "transparent", color: "var(--faint)", cursor: "pointer" }}>
            {e.copied ? (
              <span style={{ color: "var(--success)", display: "flex" }}>
                <Icon name="check" />
              </span>
            ) : (
              <Icon name="copy" />
            )}
          </button>
        )}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>{e.costStr}</span>
      </div>
    </div>
  );
}

function FusionCard({ m, vm }: { m: AssistantMsgVM; vm: ViewModel }) {
  const f = m.fusion!;
  const { t } = vm;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 7, margin: "12px 0 0", color: "var(--accent)", fontSize: 11.5, fontWeight: 700 }}>
        <span style={{ height: 1, width: 40, background: "linear-gradient(90deg,transparent,var(--accent))" }} />
        <Icon name="spark" />
        {t.fusing}
        <span style={{ height: 1, width: 40, background: "linear-gradient(90deg,var(--accent),transparent)" }} />
      </div>

      <div style={{ marginTop: 10, borderRadius: 18, padding: 1.5, background: "linear-gradient(120deg,var(--accent),var(--accent-2),var(--accent))", backgroundSize: "220% 100%", animation: "gradmove 5s linear infinite", boxShadow: "0 12px 34px var(--accent-soft)" }}>
        <div style={{ background: "var(--surface)", borderRadius: 16.5, padding: "17px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,var(--accent),var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <Icon name="spark" />
            </div>
            <div style={{ fontWeight: 700, fontSize: 14.5, fontFamily: DISPLAY }}>{t.fusedAnswer}</div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>· {t.compiledBy} {f.compilerName}</div>
            <div style={{ flex: 1 }} />
            {f.streaming && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "glow 1s infinite" }} />}
          </div>

          {f.waiting && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13, padding: "4px 0" }}>
              <span style={{ width: 14, height: 14, border: "2px solid var(--border-2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
              {t.waiting}
            </div>
          )}

          {f.showReason && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-3)", marginBottom: 14, overflow: "hidden" }}>
              <div onClick={f.onToggle} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 13px", cursor: "pointer", userSelect: "none" }}>
                {f.reasonActive && <span style={{ width: 13, height: 13, border: "2px solid var(--border-2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin .8s linear infinite", flex: "none" }} />}
                {f.reasonDone && !f.reasonFailed && (
                  <span style={{ color: "var(--success)", display: "flex", flex: "none" }}>
                    <Icon name="check" />
                  </span>
                )}
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>{t.thinkingProcess}</span>
                <div style={{ flex: 1 }} />
                <span style={{ display: "flex", color: "var(--faint)", transform: f.chevronRot, transition: "transform .2s" }}>
                  <Icon name="chevron" />
                </span>
              </div>
              {f.expanded && (
                <div style={{ padding: "2px 14px 13px 14px" }}>
                  <div style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 13, whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 12.5, color: "var(--muted)" }}>
                    {f.reasonFailed && !f.reasonText ? (
                      <span style={{ fontStyle: "italic", color: "var(--faint)" }}>{t.reasoningUnavailable}</span>
                    ) : (
                      f.reasonText
                    )}
                    {f.reasonStreaming && <span style={{ color: "var(--accent)", animation: "blink 1s infinite" }}>▍</span>}
                    {f.reasonThinking && <ThinkingDots color="var(--accent)" size={5} />}
                  </div>
                </div>
              )}
            </div>
          )}

          {f.showAnswer && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", color: "var(--accent)", textTransform: "uppercase" }}>
                <Icon name="spark" />
                {t.finalAnswer}
              </div>
              {f.answerThinking && (
                <div style={{ display: "flex", gap: 3, padding: "2px 0" }}>
                  {[0, 0.2, 0.4].map((d, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: `dotpulse 1.2s infinite ${d}s` }} />
                  ))}
                </div>
              )}
              {f.answerError ? (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 11, border: "1px solid var(--danger)", background: "rgba(255,106,106,.08)" }}>
                  <span style={{ color: "var(--danger)", display: "flex", flex: "none", marginTop: 1 }}>
                    <Icon name="bolt" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)" }}>{t.turnFailed}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginTop: 3, whiteSpace: "pre-wrap" }}>{f.answerError}</div>
                  </div>
                </div>
              ) : (
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.72, fontSize: 14.5, color: "var(--text)" }}>
                  {f.answerText}
                  {f.answerStreaming && <StreamingCursor />}
                </div>
              )}
              {f.done && !f.answerError && <CopyRerun call={f} onRerun={m.onRerun} t={t} accent />}
              {f.answerError && (
                <button onClick={m.onRerun} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, padding: "6px 11px", borderRadius: 9, border: "1px solid var(--border-2)", background: "var(--surface-2)", color: "var(--text)", font: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                  <Icon name="refresh" />
                  {t.rerun}
                </button>
              )}
              <div style={{ marginTop: 13, paddingTop: 10, borderTop: "1px dashed var(--border)", fontFamily: MONO, fontSize: 11, color: "var(--faint)" }} title={f.modelId}>
                {f.modelId}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function TurnLedger({ m, vm }: { m: AssistantMsgVM; vm: ViewModel }) {
  const { t } = vm;
  const chip = { display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", fontFamily: MONO, fontSize: 11, color: "var(--muted)" } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 13 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--faint)", letterSpacing: ".03em" }}>{t.thisTurn}</span>
      <span style={chip}>{t.tokens} <b style={{ color: "var(--text)" }}>{m.turnTokStr}</b></span>
      <span style={chip}>{t.cost} <b style={{ color: "var(--text)" }}>{m.turnCostStr}</b></span>
      <span style={chip}>{t.platformFee} <b style={{ color: "var(--text)" }}>{m.turnFeeStr}</b> · {m.callCount}{t.callsX}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, background: "var(--accent-soft)", border: "1px solid var(--accent)", fontFamily: MONO, fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>
        {t.total} {m.turnTotalStr}
      </span>
    </div>
  );
}

function AssistantBlock({ m, vm }: { m: AssistantMsgVM; vm: ViewModel }) {
  const { t } = vm;

  // A failed turn (e.g. the gateway isn't configured for a real account) surfaces a clear
  // inline error + a retry — never a permanent "waiting for experts" spinner.
  if (m.errorNote) {
    return (
      <div style={{ margin: "18px 0 6px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "14px 16px", borderRadius: 14, border: "1px solid var(--danger)", background: "rgba(255,106,106,.08)" }}>
          <span style={{ color: "var(--danger)", display: "flex", flex: "none", marginTop: 1 }}>
            <Icon name="bolt" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--danger)" }}>{t.turnFailed}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 4, whiteSpace: "pre-wrap" }}>{m.errorNote}</div>
            <button
              onClick={m.onRerun}
              style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, padding: "6px 11px", borderRadius: 9, border: "1px solid var(--border-2)", background: "var(--surface-2)", color: "var(--text)", font: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
            >
              <Icon name="refresh" />
              {t.rerun}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: "18px 0 6px" }}>
      {m.deepResearch && (
        <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface-3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)", fontSize: 12, fontWeight: 700 }}>
              <Icon name="search" />
              {t.deepResearch}
            </span>
            {m.researchSteps.map((rs, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" }}>
                <span style={{ color: "var(--success)" }}>
                  <Icon name="check" />
                </span>
                {rs}
              </span>
            ))}
          </div>
          {m.sources.length > 0 && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t.sourcesLabel}</span>
              {m.sources.map((s) => (
                <a
                  key={s.index}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.title}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, textDecoration: "none", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{s.index}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.domain}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {m.single && <SingleCard m={m} vm={vm} />}

      {m.isExpert && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--faint)", textTransform: "uppercase" }}>
            <Icon name="layers" />
            {t.experts}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {m.experts!.map((e, i) => (
              <ExpertCard key={i} e={e} t={t} />
            ))}
          </div>
          <FusionCard m={m} vm={vm} />
        </div>
      )}

      <TurnLedger m={m} vm={vm} />
    </div>
  );
}

function MessageItem({ m, vm }: { m: MessageVM; vm: ViewModel }) {
  const { t } = vm;
  if (m.isUser) {
    const iconBtn = {
      display: "flex" as const,
      alignItems: "center",
      gap: 5,
      padding: "4px 8px",
      borderRadius: 8,
      border: "1px solid var(--border)",
      background: "var(--surface-2)",
      color: "var(--muted)",
      font: "inherit",
      fontSize: 11,
      fontWeight: 600,
      cursor: "pointer",
    };
    return (
      <div className="user-msg" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", margin: "20px 0" }}>
        <div style={{ maxWidth: "78%", background: "linear-gradient(135deg,var(--accent),#8b7bff)", color: "#fff", padding: "11px 16px", borderRadius: "17px 17px 5px 17px", fontSize: 14.5, lineHeight: 1.55, boxShadow: "0 6px 18px var(--accent-soft)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {m.text}
        </div>
        <div className="user-msg-actions" style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={m.onCopy} title={t.copy} style={iconBtn}>
            {m.copied ? (
              <>
                <span style={{ color: "var(--success)", display: "flex" }}>
                  <Icon name="check" />
                </span>
                {t.copied}
              </>
            ) : (
              <>
                <Icon name="copy" />
                {t.copy}
              </>
            )}
          </button>
          <button onClick={m.onEdit} title={t.edit} style={iconBtn}>
            <Icon name="pen" />
            {t.edit}
          </button>
        </div>
      </div>
    );
  }
  return <AssistantBlock m={m} vm={vm} />;
}

export default function ChatView({ vm }: { vm: ViewModel }) {
  const { t } = vm;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  // Focus + caret-to-end when a user message is loaded into the composer for editing.
  useEffect(() => {
    if (!vm.composerFocusTick) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }, [vm.composerFocusTick]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ModeBar vm={vm} />

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "26px 24px 8px" }}>
          {vm.isEmpty && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "42px 10px 30px" }}>
              <div style={{ width: 62, height: 62, borderRadius: 18, background: "linear-gradient(135deg,var(--accent),var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 14px 40px var(--accent-soft)", fontSize: 30 }}>
                <Icon name="sparkBig" />
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 25, letterSpacing: "-.02em", marginTop: 20 }}>{t.emptyTitle}</div>
              <div style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 520, lineHeight: 1.65, marginTop: 10 }}>{t.emptySub}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 26, width: "100%", maxWidth: 580 }}>
                {vm.suggestions.map((s, i) => (
                  <button key={i} onClick={s.onClick} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "13px 14px", borderRadius: 13, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", font: "inherit", fontSize: 13, fontWeight: 600, lineHeight: 1.4, cursor: "pointer" }}>
                    <span style={{ color: s.color, flex: "none" }}>
                      <Icon name={s.icon} />
                    </span>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {vm.msgs.map((m) => (
            <MessageItem key={m.id} m={m} vm={vm} />
          ))}
        </div>
      </div>

      <div style={{ flex: "none", padding: "6px 24px 18px", background: "linear-gradient(0deg,var(--bg) 55%,transparent)" }}>
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <button onClick={vm.onToggleDR} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 9, border: `1px solid ${vm.drBorder}`, background: vm.drBg, color: vm.drFg, font: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
              <Icon name="search" />
              {t.deepResearch}
            </button>
            <button onClick={vm.onToggleDA} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 9, border: `1px solid ${vm.daBorder}`, background: vm.daBg, color: vm.daFg, font: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
              <Icon name="agent" />
              {t.deepAgents}
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: MONO }}>{vm.modeHint}</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: 16, padding: "10px 10px 10px 16px", boxShadow: "var(--shadow)" }}>
            <textarea
              ref={inputRef}
              value={vm.input}
              onChange={vm.onInput}
              onKeyDown={vm.onKeyDown}
              rows={1}
              placeholder={t.placeholder}
              style={{ flex: 1, border: "none", background: "transparent", color: "var(--text)", font: "inherit", fontSize: 14.5, lineHeight: 1.5, resize: "none", outline: "none", maxHeight: 150, padding: "6px 0" }}
            />
            <button onClick={vm.onSend} disabled={vm.sendDisabled} style={{ width: 40, height: 40, flex: "none", borderRadius: 12, border: "none", background: vm.sendBg, color: vm.sendColor, display: "flex", alignItems: "center", justifyContent: "center", cursor: vm.sendCursor }}>
              <Icon name="send" />
            </button>
          </div>
          <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--faint)", marginTop: 9 }}>{t.disclaimer}</div>
        </div>
      </div>
    </div>
  );
}
