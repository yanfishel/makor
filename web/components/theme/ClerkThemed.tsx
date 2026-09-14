"use client";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

export function ClerkThemed({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/"
      signInFallbackRedirectUrl="/app" signUpFallbackRedirectUrl="/app" telemetry={{ disabled: true }}
      appearance={{
        baseTheme: resolvedTheme === "dark" ? dark : undefined,
        variables: { colorPrimary: resolvedTheme === "dark" ? "#dfe6f5" : "#0f1b36", borderRadius: "0.375rem", fontFamily: "var(--font-sans)" },
        elements: { card: "shadow-none ring-1 ring-foreground/10", formButtonPrimary: "text-sm" },
      }}>
      {children}
    </ClerkProvider>
  );
}
