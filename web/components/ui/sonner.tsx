"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Status colours through the status tokens (lib/status-tone.ts' language), not sonner's own palette.
          // Opaque: the tint is mixed into the popover colour, so nothing shows through the toast.
          success: "!border-success/25 !bg-[color-mix(in_oklch,var(--success)_10%,var(--popover))] !text-success",
          warning: "!border-warning/30 !bg-[color-mix(in_oklch,var(--warning)_10%,var(--popover))] !text-warning",
          error: "!border-destructive/25 !bg-[color-mix(in_oklch,var(--destructive)_10%,var(--popover))] !text-destructive",
          info: "!border-highlight/25 !bg-[color-mix(in_oklch,var(--highlight)_10%,var(--popover))] !text-highlight",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
