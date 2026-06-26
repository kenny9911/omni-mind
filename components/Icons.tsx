import type { ReactNode } from "react";

export type IconName =
  | "chat"
  | "usage"
  | "models"
  | "billing"
  | "bolt"
  | "layers"
  | "sun"
  | "moon"
  | "send"
  | "plus"
  | "check"
  | "search"
  | "agent"
  | "globe"
  | "spark"
  | "sparkBig"
  | "code"
  | "pen"
  | "compare"
  | "map"
  | "chevron"
  | "copy"
  | "collapse"
  | "panel"
  | "refresh"
  | "mail"
  | "lock"
  | "user"
  | "eye"
  | "eyeOff"
  | "checkBig"
  | "route"
  | "coins"
  | "trash"
  | "close";

const P = (d: string, k: number) => <path d={d} key={k} />;
const C = (cx: number, cy: number, r: number, k: number) => (
  <circle cx={cx} cy={cy} r={r} key={k} />
);
const RC = (x: number, y: number, w: number, h: number, rx: number, k: number) => (
  <rect x={x} y={y} width={w} height={h} rx={rx} key={k} />
);

interface Def {
  size: number;
  sw: number;
  kids: ReactNode;
}

// Stroke icons, ported verbatim (viewBox 0 0 24 24).
const STROKE: Record<IconName, Def> = {
  chat: { size: 18, sw: 1.7, kids: [P("M21 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z", 1)] },
  usage: { size: 18, sw: 1.7, kids: [P("M4 20V9", 1), P("M10 20V4", 2), P("M16 20v-7", 3), P("M22 20H2", 4)] },
  models: { size: 18, sw: 1.7, kids: [P("M4 4h7v7H4z", 1), P("M13 4h7v7h-7z", 2), P("M13 13h7v7h-7z", 3), P("M4 13h7v7H4z", 4)] },
  billing: { size: 18, sw: 1.7, kids: [P("M3 6h18v12H3z", 1), P("M3 10h18", 2)] },
  bolt: { size: 18, sw: 1.7, kids: [P("M13 2 4 14h7l-1 8 9-12h-7z", 1)] },
  layers: { size: 18, sw: 1.7, kids: [P("M12 3 3 8l9 5 9-5z", 1), P("M3 13l9 5 9-5", 2), P("M3 8v5", 3), P("M21 8v5", 4)] },
  sun: { size: 18, sw: 1.7, kids: [C(12, 12, 4, 1), P("M12 2v2", 2), P("M12 20v2", 3), P("M2 12h2", 4), P("M20 12h2", 5), P("M4.9 4.9l1.4 1.4", 6), P("M17.7 17.7l1.4 1.4", 7), P("M19.1 4.9l-1.4 1.4", 8), P("M6.3 17.7l-1.4 1.4", 9)] },
  moon: { size: 18, sw: 1.7, kids: [P("M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z", 1)] },
  send: { size: 18, sw: 1.7, kids: [P("M22 2 11 13", 1), P("M22 2 15 22l-4-9-9-4z", 2)] },
  plus: { size: 18, sw: 1.7, kids: [P("M12 5v14", 1), P("M5 12h14", 2)] },
  check: { size: 14, sw: 2.4, kids: [P("M20 6 9 17l-5-5", 1)] },
  search: { size: 18, sw: 1.7, kids: [C(11, 11, 7, 1), P("M21 21l-3.6-3.6", 2)] },
  agent: { size: 18, sw: 1.7, kids: [RC(4, 7, 16, 13, 3, 1), P("M9 7V4", 2), P("M15 7V4", 3), C(9.5, 13, 1, 4), C(14.5, 13, 1, 5), P("M9 17h6", 6)] },
  globe: { size: 18, sw: 1.7, kids: [C(12, 12, 9, 1), P("M3 12h18", 2), P("M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z", 3)] },
  spark: { size: 18, sw: 1.9, kids: [P("M12 3v3", 1), P("M12 18v3", 2), P("M3 12h3", 3), P("M18 12h3", 4), P("M5.6 5.6l2 2", 5), P("M16.4 16.4l2 2", 6), P("M18.4 5.6l-2 2", 7), P("M7.6 16.4l-2 2", 8)] },
  sparkBig: { size: 30, sw: 1.9, kids: [P("M12 3v3", 1), P("M12 18v3", 2), P("M3 12h3", 3), P("M18 12h3", 4), P("M5.6 5.6l2 2", 5), P("M16.4 16.4l2 2", 6), P("M18.4 5.6l-2 2", 7), P("M7.6 16.4l-2 2", 8), C(12, 12, 3.2, 9)] },
  code: { size: 18, sw: 1.7, kids: [P("M9 8l-4 4 4 4", 1), P("M15 8l4 4-4 4", 2)] },
  pen: { size: 18, sw: 1.7, kids: [P("M12 20h9", 1), P("M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z", 2)] },
  compare: { size: 18, sw: 1.7, kids: [P("M3 6h7", 1), P("M3 12h7", 2), P("M3 18h7", 3), P("M14 6h7", 4), P("M14 12h7", 5), P("M14 18h7", 6)] },
  map: { size: 18, sw: 1.7, kids: [P("M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z", 1), P("M9 4v14", 2), P("M15 6v14", 3)] },
  chevron: { size: 15, sw: 2, kids: [P("M6 9l6 6 6-6", 1)] },
  copy: { size: 15, sw: 1.7, kids: [RC(9, 9, 11, 11, 2, 1), P("M5 15V5a2 2 0 0 1 2-2h8", 2)] },
  collapse: { size: 16, sw: 1.8, kids: [P("M15 18l-6-6 6-6", 1)] },
  panel: { size: 18, sw: 1.7, kids: [RC(3, 4, 18, 16, 2, 1), P("M9 4v16", 2)] },
  refresh: { size: 15, sw: 1.8, kids: [P("M21 12a9 9 0 1 1-2.6-6.4", 1), P("M21 3v5h-5", 2)] },
  mail: { size: 18, sw: 1.7, kids: [RC(3, 5, 18, 14, 2, 1), P("M3 7l9 6 9-6", 2)] },
  lock: { size: 18, sw: 1.7, kids: [RC(5, 11, 14, 10, 2, 1), P("M8 11V8a4 4 0 0 1 8 0v3", 2)] },
  user: { size: 18, sw: 1.7, kids: [C(12, 8, 4, 1), P("M4 21a8 8 0 0 1 16 0", 2)] },
  eye: { size: 18, sw: 1.7, kids: [P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", 1), C(12, 12, 3, 2)] },
  eyeOff: { size: 18, sw: 1.7, kids: [P("M2 12s3.5-7 10-7c1.7 0 3.2.5 4.6 1.2", 1), P("M22 12s-3.5 7-10 7c-1.7 0-3.2-.5-4.6-1.2", 2), P("M3 3l18 18", 3)] },
  checkBig: { size: 30, sw: 2.2, kids: [P("M20 6 9 17l-5-5", 1)] },
  route: { size: 20, sw: 1.7, kids: [C(6, 19, 3, 1), C(18, 5, 3, 2), P("M9 19h6a4 4 0 0 0 4-4V8", 3), P("M15 5H9a4 4 0 0 0-4 4v7", 4)] },
  coins: { size: 20, sw: 1.7, kids: [<ellipse cx={12} cy={6} rx={8} ry={3} key={1} />, P("M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", 2), P("M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6", 3)] },
  trash: { size: 15, sw: 1.7, kids: [P("M4 7h16", 1), P("M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2", 2), P("M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13", 3), P("M10 11v6", 4), P("M14 11v6", 5)] },
  close: { size: 14, sw: 2, kids: [P("M6 6l12 12", 1), P("M18 6 6 18", 2)] },
};

export function Icon({
  name,
  size,
  strokeWidth,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  const def = STROKE[name];
  return (
    <svg
      width={size ?? def.size}
      height={size ?? def.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? def.sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "none" }}
    >
      {def.kids}
    </svg>
  );
}

// Brand marks for SSO (multi-color / filled), ported verbatim.
export function GoogleIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" style={{ display: "block", flex: "none" }}>
      <path fill="#4285F4" d="M22 12.2c0-.7-.06-1.4-.18-2.05H12v3.9h5.6a4.8 4.8 0 0 1-2.07 3.15v2.6h3.35C20.84 18 22 15.4 22 12.2z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.63-2.43l-3.35-2.6c-.93.62-2.12.99-3.28.99-2.52 0-4.66-1.7-5.42-4H3.13v2.6A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.58 13.96A6 6 0 0 1 6.26 12c0-.68.12-1.34.32-1.96V7.44H3.13A10 10 0 0 0 2 12c0 1.6.38 3.12 1.13 4.56l3.45-2.6z" />
      <path fill="#EA4335" d="M12 5.96c1.42 0 2.7.49 3.7 1.45l2.77-2.77C16.97 2.99 14.7 2 12 2A10 10 0 0 0 3.13 7.44l3.45 2.6C7.34 7.66 9.48 5.96 12 5.96z" />
    </svg>
  );
}
export function GithubIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor" style={{ display: "block", flex: "none" }}>
      <path d="M12 2C6.5 2 2 6.6 2 12.25c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.36-3.37-1.36-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.56 2.34 1.11 2.91.85.1-.66.35-1.11.63-1.36-2.22-.26-4.55-1.13-4.55-5.04 0-1.11.39-2.02 1.03-2.73-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.04A9.4 9.4 0 0 1 12 6.84c.85 0 1.7.12 2.5.34 1.9-1.31 2.74-1.04 2.74-1.04.55 1.4.2 2.44.1 2.7.64.71 1.03 1.62 1.03 2.73 0 3.92-2.34 4.78-4.57 5.03.36.32.68.94.68 1.9v2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.6 17.5 2 12 2z" />
    </svg>
  );
}
export function AppleIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor" style={{ display: "block", flex: "none" }}>
      <path d="M16.4 12.8c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.14-2.6.8-3.3.8-.7 0-1.7-.78-2.8-.76-1.5.02-2.8.84-3.5 2.14-1.5 2.6-.4 6.5 1.07 8.6.72 1.04 1.57 2.2 2.7 2.16 1.08-.04 1.49-.7 2.8-.7 1.3 0 1.67.7 2.8.68 1.16-.02 1.9-1.06 2.6-2.1.82-1.2 1.16-2.36 1.18-2.42-.03-.01-2.26-.87-2.28-3.44zM14.2 6.1c.6-.72 1-1.72.9-2.72-.86.04-1.9.58-2.52 1.3-.55.63-1.04 1.65-.9 2.62.96.08 1.93-.49 2.52-1.2z" />
    </svg>
  );
}
export function WechatIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" style={{ display: "block", flex: "none" }}>
      <path d="M9 4C5.1 4 2 6.7 2 10c0 1.9 1 3.6 2.7 4.7L4 17l2.6-1.3c.5.1 1 .2 1.5.3-.1-.4-.1-.8-.1-1.2 0-3.1 3-5.6 6.8-5.6h.5C14.7 6 12.1 4 9 4zm-2.4 4.2c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9zm4.8 0c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9zM22 14.8c0-2.7-2.6-4.8-5.8-4.8s-5.8 2.2-5.8 4.8 2.6 4.8 5.8 4.8c.6 0 1.2-.1 1.8-.2l1.9 1-.5-1.7c1.5-.9 2.6-2.3 2.6-3.9zm-7.7-1.1c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7zm3.8 0c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7z" />
    </svg>
  );
}
