"use client";
import { MailPlus, MoreHorizontal, RotateCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api, jsonBody } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import type { InvitationView } from "@/lib/invitations";
import { invitationTone } from "@/lib/status-tone";

const ERROR_CODES = ["EMAIL_INVALID", "ALREADY_REGISTERED", "ALREADY_INVITED", "INVITE_SEND_FAILED", "INVITATION_CLOSED", "INVITE_REVOKE_FAILED"];

/** The `users.*` message key for an invitation route's error code. */
export function inviteErrorKey(code: string | undefined): string {
  return code && ERROR_CODES.includes(code) ? `inviteErrors.${code}` : "inviteErrors.generic";
}

export function InvitationsPanel({ locale }: { locale: string }) {
  const t = useTranslations("users");
  const ta = useTranslations("app");
  const [rows, setRows] = useState<InvitationView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<InvitationView | null>(null);

  const load = useCallback(async () => {
    setRows((await api<{ invitations: InvitationView[] }>("/api/admin/invitations")).invitations);
  }, []);
  useEffect(() => { load().catch(() => setFailed(true)); }, [load]);

  /** One action: success toast + reload, or the error code's message as a toast. */
  async function act(action: () => Promise<void>, success: string) {
    setBusy(true);
    try { await action(); toast.success(success); await load(); }
    catch (err) { toast.error(t(inviteErrorKey(err instanceof ApiError ? err.code : undefined))); }
    finally { setBusy(false); }
  }
  function send(e: FormEvent) {
    e.preventDefault();
    const to = email.trim();
    void act(async () => { await api("/api/admin/invitations", jsonBody("POST", { email: to })); setEmail(""); }, t("inviteSent", { email: to }));
  }
  const resend = (r: InvitationView) => void act(async () => { await api(`/api/admin/invitations/${r.id}/resend`, { method: "POST" }); }, t("inviteResent", { email: r.email }));
  const revoke = (r: InvitationView) => void act(async () => { await api(`/api/admin/invitations/${r.id}`, { method: "DELETE" }); }, t("inviteRevoked", { email: r.email }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("invitationsIntro")}</p>
      <form onSubmit={send} className="flex max-w-xl flex-wrap gap-2">
        <Input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("inviteEmail")} aria-label={t("inviteEmail")} className="min-w-0 flex-1 basis-60" />
        <Button type="submit" disabled={busy || !email.trim()}><MailPlus />{t("inviteSend")}</Button>
      </form>
      {!rows ? <p className="text-sm text-muted-foreground">{failed ? t("invitationsLoadFailed") : t("loading")}</p>
        : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("invitationsEmpty")}</p>
        : (
          <div className="overflow-x-auto border-t border-foreground">
            <Table>
              <TableHeader><TableRow>{[t("colInvEmail"), t("colInvBy"), t("colInvSent"), t("colInvStatus")].map((h) => <TableHead key={h}>{h}</TableHead>)}<TableHead className="text-end">{t("actions")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell dir="ltr">{r.email}</TableCell>
                    <TableCell>
                      {r.invitedBy === "system" ? <span className="text-muted-foreground">{t("invitedBySystem")}</span>
                        : r.invitedByEmail ? <span dir="ltr">{r.invitedByEmail}</span>
                        : <span className="text-muted-foreground">{t("invitedByDeleted")}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(r.createdAt, locale)}</TableCell>
                    <TableCell><StatusBadge value={t(`invStatus.${r.status}`)} tone={invitationTone(r.status)} className="font-sans" /></TableCell>
                    <TableCell className="text-end">
                      {(r.status === "pending" || r.status === "expired") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("actions")}><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => resend(r)}><RotateCw />{t("resend")}</DropdownMenuItem>
                            {r.status === "pending" && <DropdownMenuItem variant="destructive" onClick={() => setRevoking(r)}><Undo2 />{t("revoke")}</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      <AlertDialog open={revoking !== null} onOpenChange={(o) => { if (!o) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revoke")}</AlertDialogTitle>
            <AlertDialogDescription>{revoking && t("confirmRevoke", { email: revoking.email })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ta("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (revoking) revoke(revoking); setRevoking(null); }}>{t("revoke")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
