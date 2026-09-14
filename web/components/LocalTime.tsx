"use client";
import { useEffect, useState } from "react";
import { Tip } from "@/components/Tip";
import { formatStamp } from "@/lib/format";

/** A timestamp in the viewer's own zone. The server (and the first client render) show UTC so
 * hydration matches; the browser's zone is applied right after mount. The ISO stamp is the tooltip. */
export function LocalTime({ iso, locale, className }: { iso: string; locale: string; className?: string }) {
  const [text, setText] = useState(() => formatStamp(iso, locale, "UTC"));
  useEffect(() => { setText(formatStamp(iso, locale)); }, [iso, locale]);
  return <Tip text={iso} mono><time dateTime={iso} className={className}>{text}</time></Tip>;
}
