"use client";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function DeleteButton({ url, method = "DELETE", confirmText, label, redirectTo, errorText }: { url: string; method?: string; confirmText: string; label: string; redirectTo?: string; errorText: string }) {
  const t = useTranslations("app");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method });
      if (!res.ok) { setError(errorText); return; }
      if (redirectTo) router.push(redirectTo); else router.refresh();
    } catch {
      setError(errorText);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-sm text-destructive">{error}</span>}
      <AlertDialog>
        <AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={busy}><Trash2 />{label}</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{label}</AlertDialogTitle><AlertDialogDescription>{confirmText}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void run()}>{label}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
