"use client";
import { KeyRound, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyReveal } from "@/components/KeyReveal";
import { EmptyState } from "@/components/EmptyState";
import type { ApiKeyMeta } from "@/lib/api-keys";
import { cn } from "@/lib/utils";

export function KeysPanel() {
  const t = useTranslations("keys");
  const ta = useTranslations("app");
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setKeys((await (await fetch("/api/keys")).json()).keys ?? []);
    } catch {
      setError(t("loadFailed"));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on mount; `load` only closes over the stable setters plus `t`
  useEffect(() => { void load(); }, []);
  async function create() {
    setError(null);
    try {
      const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await res.json();
      if (!res.ok) {
        const code = body.error;
        return setError(code === "KEY_LIMIT" || code === "INVALID_NAME" ? t(`errors.${code}`) : t("createFailed"));
      }
      setFresh(body.token); setName(""); void load();
    } catch {
      setError(t("createFailed"));
    }
  }
  async function revoke(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok) { setError(t("revokeFailed")); return; }
      void load();
    } catch {
      setError(t("revokeFailed"));
    }
  }
  const copy = { copy: ta("copy"), copied: ta("copied") };
  return (
    <div className="space-y-6">
      <Card size="sm"><CardContent>
        <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} maxLength={64} className="max-w-xs" />
          <Button type="submit" disabled={!name.trim()}><Plus />{t("create")}</Button>
        </form>
      </CardContent></Card>
      {error && <Alert variant="destructive"><AlertTitle>{error}</AlertTitle></Alert>}
      {fresh && (
        <Alert className="border-success/30 bg-success/5">
          <KeyRound />
          <AlertTitle>{t("shownOnce")}</AlertTitle>
          <AlertDescription className="w-full space-y-3">
            <KeyReveal value={fresh} labels={copy} />
          </AlertDescription>
        </Alert>
      )}
      {keys === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : keys.length === 0 ? <EmptyState title={t("empty")} silhouette="other" /> : (
        <div className="overflow-x-auto border-t border-foreground">
          <Table>
            <TableHeader><TableRow><TableHead>{t("colName")}</TableHead><TableHead>{t("colPrefix")}</TableHead><TableHead>{t("colCreated")}</TableHead><TableHead>{t("colLastUsed")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{keys.map((k) => (
              <TableRow key={k.id} className={cn(k.revokedAt && "text-muted-foreground line-through")}>
                <TableCell>{k.name}</TableCell>
                <TableCell className="font-mono text-xs" dir="ltr">{k.prefix}…</TableCell>
                <TableCell><span dir="ltr">{k.createdAt.slice(0, 10)}</span></TableCell>
                <TableCell><span dir="ltr">{k.lastUsedAt?.slice(0, 16).replace("T", " ") ?? "—"}</span></TableCell>
                <TableCell className="text-end">
                  {!k.revokedAt && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive">{t("revoke")}</Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>{t("revoke")}</AlertDialogTitle><AlertDialogDescription>{t("confirmRevoke")}</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>{ta("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void revoke(k.id)}>{t("revoke")}</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
