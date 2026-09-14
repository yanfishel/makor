import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { LineTabs } from "@/components/LineTabs";
import { resolveSettingsTabs, SettingsTabsList } from "@/components/SettingsPanel";
import { TooltipProvider } from "@/components/ui/tooltip";

// `SettingsPanel`'s render is gated behind an async `/api/settings` fetch that resolves in a
// `useEffect`; `renderToStaticMarkup` runs no effects and flushes no microtasks, so that gate
// never opens and the full panel can never be observed past its "Loading settings…" state here
// (verified: it renders that text regardless of `isAdmin`). `resolveSettingsTabs` and
// `SettingsTabsList` are the exact tab-list logic and markup `SettingsPanel` uses, extracted so
// this test can render the real tab bar — including the real `LineTabs`/Radix active-state
// attributes — without the fetch gate around it. Neither is ever imported here, so this test
// never needs `next/navigation`'s `useSearchParams` (only `SettingsPanel` itself calls it).

const render = (requestedTab: string | null) => {
  const { tabs, initialTab } = resolveSettingsTabs(requestedTab);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TooltipProvider>
        <LineTabs defaultValue={initialTab}><SettingsTabsList tabs={tabs} /></LineTabs>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
};

describe("resolveSettingsTabs", () => {
  it("offers every tab to every user and honours the requested one", () => {
    expect(resolveSettingsTabs("registries")).toEqual({ tabs: ["key", "engine", "storage", "registries"], initialTab: "registries" });
    expect(resolveSettingsTabs("nope").initialTab).toBe("key");
    expect(render("registries")).toContain("Registries");
  });
});
