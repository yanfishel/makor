"use client";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ExtractResponse } from "@/lib/result-types";

/** The whole response as a file, built in the browser from what is already on the page —
 * the result never has to be fetched again, and nothing is written on the server. */
export function DownloadResultButton({ result, className }: { result: ExtractResponse; className?: string }) {
  const t = useTranslations("extract");
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    a.download = `makor-${result.meta.document_id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return <Button variant="outline" size="sm" onClick={download} className={className}><Download />{t("download")}</Button>;
}
