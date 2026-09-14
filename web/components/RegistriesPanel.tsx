"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Landmark, RefreshCw } from "lucide-react";
import { LocalTime } from "@/components/LocalTime";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatFieldDate, formatMs } from "@/lib/format";
import type { RegistriesStatusBody } from "@/lib/registries-handlers";
import { summarizeRun } from "@/lib/registries/summary";
import { sourceStateTone } from "@/lib/status-tone";

export const POLL_MS = 3000;

export function RegistriesTable({ status, locale }: { status: RegistriesStatusBody; locale: string }) {
  const t = useTranslations("settings.registries");
  const tr = useTranslations("registries");
  return (
    <div className="overflow-x-auto border-t border-foreground">
      <Table>
        <TableHeader>
          <TableRow>
            {(["source", "dataDate", "fetchedAt", "rows", "duration", "status"] as const).map((c) => <TableHead key={c}>{t(`cols.${c}`)}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {status.sources.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{tr(`sources.${s.id}`)}</TableCell>
              <TableCell className="font-mono">{s.dataDate ? formatFieldDate(s.dataDate) ?? s.dataDate : "—"}</TableCell>
              <TableCell>{s.fetchedAt ? <LocalTime iso={s.fetchedAt} locale={locale} /> : "—"}</TableCell>
              <TableCell className="font-mono">{s.rowCount === null ? "—" : s.rowCount.toLocaleString("en-US")}</TableCell>
              <TableCell className="font-mono">{s.durationMs === null ? "—" : formatMs(s.durationMs)}</TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <StatusBadge value={t(`states.${s.status}`)} tone={sourceStateTone(s.status)} />
                  {s.status === "error" && s.error && <span className="max-w-xs text-xs break-words text-muted-foreground">{s.error}</span>}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Heading, the not-downloaded warning, and the admin's refresh controls — split out so a test can render every combination without the fetch. */
export function RegistriesControls({ isAdmin, checkEnabled, status, onRefresh }: { isAdmin: boolean; checkEnabled: boolean; status: RegistriesStatusBody | null; onRefresh: () => void }) {
  const t = useTranslations("settings.registries");
  const nothingLoaded = status !== null && status.sources.every((s) => s.fetchedAt === null);
  return (
    <>
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium"><Landmark className="size-4 text-highlight" aria-hidden />{t("section")}</h2>
        {isAdmin && <p className="mt-1 text-[13px] text-muted-foreground">{t("intro")}</p>}
      </div>
      {checkEnabled && nothingLoaded && <p className="text-sm text-warning">{t("checkNotLoaded")}</p>}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="highlight" onClick={onRefresh} disabled={!status || status.running}>
            <RefreshCw className={status?.running ? "animate-spin" : undefined} />{status?.running ? t("refreshing") : t("refreshAll")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("guidance")}</span>
        </div>
      )}
    </>
  );
}

/** Every user sees the sources and the warning; only an admin sees the refresh controls (and only an admin's POST is accepted). The run state lives on the server, so a run started elsewhere shows here too. */
export function RegistriesPanel({ locale, isAdmin, checkEnabled }: { locale: string; isAdmin: boolean; checkEnabled: boolean }) {
  const t = useTranslations("settings.registries");
  const tr = useTranslations("registries");
  const [status, setStatus] = useState<RegistriesStatusBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState<ReturnType<typeof summarizeRun> | null>(null);
  const sawRunning = useRef(false);

  /** No dependency on `t`: a translator in the deps would re-create `load` and re-fire the effects that call it. */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/registries");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as RegistriesStatusBody;
      setStatus(body);
      setFailed(false);
      if (body.running) sawRunning.current = true;
      else if (sawRunning.current) {
        sawRunning.current = false;
        setFinished(summarizeRun(body.sources, body.runStartedAt));
      }
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!finished) return;
    if (finished.failed.length === 0) toast.success(t("doneAll"));
    else toast.warning(t("doneSome", { ok: finished.ok.length, total: finished.ok.length + finished.failed.length, failed: finished.failed.map((id) => tr(`sources.${id}`)).join(", ") }));
    setFinished(null);
  }, [finished, t, tr]);
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [status?.running, load]);

  const refresh = async () => {
    try {
      const res = await fetch("/api/admin/registries/refresh", { method: "POST" });
      if (res.status === 202 || res.status === 409) {
        sawRunning.current = true;
        setStatus((prev) => (prev ? { ...prev, running: true } : prev));
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
    await load();
  };

  return (
    <section className="space-y-3">
      <RegistriesControls isAdmin={isAdmin} checkEnabled={checkEnabled} status={status} onRefresh={() => void refresh()} />
      {failed && <p className="text-sm text-destructive">{t("loadFailed")}</p>}
      {status && <RegistriesTable status={status} locale={locale} />}
    </section>
  );
}
