"use client";

import { OmniProvider, useViewModel } from "@/lib/OmniContext";
import type { OmniConfig } from "@/lib/store";
import Sidebar from "./Sidebar";
import ChatView from "./chat/ChatView";
import UsageView from "./UsageView";
import ModelsView from "./ModelsView";
import BillingView from "./BillingView";
import ProfileView from "./ProfileView";
import UsersView from "./UsersView";

function BootSpinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "3px solid var(--border)",
          borderTopColor: "var(--accent)",
          animation: "spin .7s linear infinite",
        }}
      />
    </div>
  );
}

function Shell({ live }: { live: boolean }) {
  const vm = useViewModel();
  if (live && !vm.bootstrapped) return <BootSpinner />;
  return (
    <div
      data-theme={vm.theme}
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "'Manrope','Noto Sans SC',sans-serif",
        fontSize: 14,
      }}
    >
      {vm.menuOpen && (
        <div onClick={vm.closeMenu} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
      )}

      <Sidebar vm={vm} />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {vm.isChat && <ChatView vm={vm} />}
        {vm.isUsage && <UsageView vm={vm} />}
        {vm.isModels && <ModelsView vm={vm} />}
        {vm.isBilling && <BillingView vm={vm} />}
        {vm.isProfile && <ProfileView vm={vm} />}
        {vm.isUsers && <UsersView vm={vm} />}
      </main>
    </div>
  );
}

export default function OmniApp({ config }: { config?: OmniConfig }) {
  return (
    <OmniProvider config={config}>
      <Shell live={!!config?.live} />
    </OmniProvider>
  );
}
