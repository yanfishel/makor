"use client";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LineTab, LineTabs, LineTabsContent, LineTabsList } from "@/components/LineTabs";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Cpu, Database, HardDrive, KeyRound, RotateCcw, Server, ShieldCheck } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import { RegistriesPanel } from "@/components/RegistriesPanel";
import { settingsErrorKey } from "@/lib/ui-errors";
import type { AuthMode } from "@/lib/config";
import type { PublicSettings } from "@/lib/settings";
import type { EngineModels } from "@/lib/engine";

interface EngineHealth { backend: string; model: string; anthropic_key?: boolean }
type Verdict = "valid" | "invalid" | "unreachable";

/** Ollama's load time for the larger local model, measured on an Apple M5. */
const LOCAL_MODEL_RELOAD_S = 24;

class ApiError extends Error {
  constructor(readonly code: string | undefined) { super(code ?? "REQUEST_FAILED"); }
}

/** One fetch + res.ok + JSON; every non-2xx becomes an ApiError carrying the body's error code. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error);
  return body as T;
}
const putJson = (body: unknown): RequestInit => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function Section({ icon: Icon, title, description, children }: { icon: typeof KeyRound; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-1">
      <div><h2 className="flex items-center gap-2 text-base font-medium"><Icon className="size-4 text-highlight" aria-hidden />{title}</h2>{description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}</div>
      {children}
    </section>
  );
}

export type SettingsTab = "key" | "engine" | "storage" | "registries";

/**
 * Every user gets every tab (the admin-only part lives inside the registries tab itself); this
 * only decides which one a `?tab=` request lands on, falling back to `key` when the request
 * names a tab that doesn't exist. Exported (pure, no fetch) because `SettingsPanel`'s own render
 * is gated behind an async `/api/settings` load — under `renderToStaticMarkup` (no DOM, no
 * effects, no microtask flush) that gate never opens, so a test cannot reach the tab bar by
 * rendering the full panel; it renders this logic through the real `SettingsTabsList` instead.
 */
export function resolveSettingsTabs(requestedTab: string | null): { tabs: readonly SettingsTab[]; initialTab: SettingsTab } {
  const tabs: readonly SettingsTab[] = ["key", "engine", "storage", "registries"];
  const initialTab = (tabs as readonly string[]).includes(requestedTab ?? "") ? (requestedTab as SettingsTab) : "key";
  return { tabs, initialTab };
}

/** The tab strip itself, split out so a test can render the real triggers without the fetch-gated panel around them. */
export function SettingsTabsList({ tabs }: { tabs: readonly SettingsTab[] }) {
  const t = useTranslations("settings");
  return <LineTabsList>{tabs.map((tab) => <LineTab key={tab} value={tab}>{t(`tabs.${tab}`)}</LineTab>)}</LineTabsList>;
}

export function SettingsPanel({ authMode, isAdmin, locale }: { authMode: AuthMode; isAdmin: boolean; locale: string }) {
  const t = useTranslations("settings");
  const ta = useTranslations("app");
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [models, setModels] = useState<EngineModels | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [deleted, setDeleted] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingOff, setPendingOff] = useState(false);
  const local = authMode === "none";
  const requestedTab = useSearchParams().get("tab");
  const { tabs: TABS, initialTab } = resolveSettingsTabs(requestedTab);

  /** Remembers the API error CODE, not a translated string, so no effect depends on `t`. */
  function fail(err: unknown) {
    setErrorCode(err instanceof ApiError ? err.code ?? null : null);
    setFailed(true);
  }

  useEffect(() => {
    void (async () => {
      try { setSettings(await api<PublicSettings>("/api/settings")); }
      catch (err) { fail(err); }
    })();
    if (!local) return;
    void (async () => {
      try { setHealth(await api<EngineHealth>("/api/settings/engine-health")); }
      catch { setHealth(null); }
    })();
    void (async () => {
      try { setModels(await api<EngineModels>("/api/settings/engine-models")); }
      catch { setModels(null); }
    })();
  }, [local]);

  /** Runs one API action with the shared busy/error handling; local state changes only on success. */
  async function run(action: () => Promise<void>) {
    setErrorCode(null); setFailed(false); setDeleted(null); setVerdict(null); setBusy(true);
    try { await action(); }
    catch (err) { fail(err); }
    finally { setBusy(false); }
  }

  const patch = (body: Record<string, unknown>) => run(async () => {
    setSettings(await api<PublicSettings>("/api/settings", putJson(body)));
    toast.success(t("saved"));
  });

  const deleteStored = async () => {
    const body = await api<{ deleted: number }>("/api/v1/documents", { method: "DELETE" });
    setDeleted(body.deleted);
  };

  function toggleStore(checked: boolean) {
    if (!checked) { setPendingOff(true); return; }
    void patch({ store_results: true });
  }

  function turnOff(alsoDelete: boolean) {
    setPendingOff(false);
    void run(async () => {
      setSettings(await api<PublicSettings>("/api/settings", putJson({ store_results: false })));
      if (alsoDelete) await deleteStored();
      toast.success(t("saved"));
    });
  }

  function deleteAll() {
    void run(deleteStored);
  }

  function verifyKey() {
    void run(async () => {
      const body = await api<{ verdict: Verdict }>("/api/settings/anthropic-key/verify", postJson({ key: keyInput.trim() }));
      setVerdict(body.verdict);
    });
  }

  function saveKey() {
    void run(async () => {
      setSettings(await api<PublicSettings>("/api/settings/anthropic-key", putJson({ key: keyInput.trim() })));
      setKeyInput("");
      toast.success(t("saved"));
    });
  }

  function removeKey() {
    void run(async () => {
      setSettings(await api<PublicSettings>("/api/settings/anthropic-key", { method: "DELETE" }));
      toast.success(t("saved"));
    });
  }

  if (!settings) return <p className="text-sm text-muted-foreground">{failed ? t(settingsErrorKey(errorCode ?? undefined)) : t("loading")}</p>;
  const choices = settings.model_choices;
  const unknownModel = settings.model && !choices.some((c) => c.id === settings.model) ? settings.model : null;
  // Which backend a document would go to: the chosen one, else the engine's default.
  const effectiveBackend = local ? settings.backend ?? health?.backend ?? null : "anthropic";
  const showCloudModel = effectiveBackend !== "ollama";
  const showLocalModel = local && effectiveBackend === "ollama";
  const localChoices = models?.models ?? [];
  const unknownLocal = models && settings.local_model && !localChoices.some((m) => m.id === settings.local_model) ? settings.local_model : null;
  // The model a document would run on, per backend: the chosen one, else that backend's default.
  const cloudModel = settings.model ?? settings.default_model;
  const localModel = settings.local_model ?? models?.default_local ?? null;
  const effectiveModel = effectiveBackend === "ollama" ? localModel : effectiveBackend === "anthropic" ? cloudModel : null;
  const engineTouched = settings.backend != null || settings.model != null || settings.local_model != null;
  // Anthropic can run only on some key: the user's own (X-Anthropic-Key) or the engine's (/healthz reports it).
  // In clerk mode the trial runs on the server's key by design, so the gate is a local-mode one.
  const anthropicAvailable = !local || settings.has_anthropic_key || health?.anthropic_key === true;
  // "Your choice" only when the stored model differs from the default (a stored default reads as the default).
  const modelChosen = effectiveBackend === "ollama" ? Boolean(settings.local_model && settings.local_model !== models?.default_local) : Boolean(settings.model && settings.model !== settings.default_model);
  const backendLabel = (b: string | null) => (b === "ollama" ? t("backendOllama") : b === "anthropic" ? t("backendAnthropic") : "—");
  const selectedCloud = choices.find((c) => c.id === cloudModel);
  const selectedLocal = localChoices.find((m) => m.id === localModel);
  const missingLocal = localChoices.filter((m) => !m.installed);
  const confirmDialog = (trigger: ReactNode, title: string, text: string, action: () => void) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{text}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{ta("cancel")}</AlertDialogCancel><AlertDialogAction onClick={action}>{title}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="space-y-8">
      {failed && <Alert variant="destructive"><AlertTitle>{t(settingsErrorKey(errorCode ?? undefined))}</AlertTitle></Alert>}
      {deleted !== null && <Alert className="border-success/30 bg-success/5"><AlertTitle>{t("deleted", { n: deleted })}</AlertTitle></Alert>}

      <LineTabs defaultValue={initialTab} className="gap-6">
        <SettingsTabsList tabs={TABS} />
        <LineTabsContent value="key" className="space-y-8">
      <Section icon={KeyRound} title={t("keySection")} description={t("keyIntro")}>
        {settings.has_anthropic_key ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge value={t("keySaved", { last4: settings.anthropic_key_last4 ?? "" })} tone="success" className="font-sans" />
            {confirmDialog(<Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy}>{t("remove")}</Button>, t("remove"), t("confirmRemoveKey"), removeKey)}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="password" value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setVerdict(null); }} placeholder={t("keyPlaceholder")} dir="ltr" autoComplete="off" className="w-72 font-mono" />
            <Button type="button" variant="outline" onClick={verifyKey} disabled={busy || !keyInput.trim()}>{t("verify")}</Button>
            <Button type="button" onClick={saveKey} disabled={busy || !keyInput.trim()}>{t("save")}</Button>
            {verdict && <StatusBadge value={t(verdict === "valid" ? "verdictValid" : verdict === "invalid" ? "verdictInvalid" : "verdictUnreachable")} tone={verdict === "valid" ? "success" : verdict === "invalid" ? "destructive" : "warning"} className="font-sans" />}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("cacheNote")}</p>
      </Section>
        </LineTabsContent>
        <LineTabsContent value="engine" className="space-y-8">
      <div className="flex flex-wrap items-start gap-4 rounded-md border border-border bg-card p-4 text-sm">
        <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">{t("effBackend")}</dt>
          <dd className="flex flex-wrap items-center gap-2">{backendLabel(effectiveBackend)}<span className="text-xs text-muted-foreground">{settings.backend ? t("yourChoice") : t("byDefault")}</span></dd>
          <dt className="text-muted-foreground">{t("effModel")}</dt>
          <dd className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{effectiveModel ?? "—"}</span>{effectiveModel && <span className="text-xs text-muted-foreground">{modelChosen ? t("yourChoice") : t("byDefault")}</span>}</dd>
          {local && <>
            <dt className="text-muted-foreground">{t("effEngine")}</dt>
            <dd>{health ? <StatusBadge value={t("engineUp")} tone="success" className="font-sans" /> : <StatusBadge value={t("engineDown")} tone="destructive" className="font-sans" />}</dd>
          </>}
        </dl>
        <Button type="button" variant="outline" size="sm" disabled={busy || !engineTouched} onClick={() => void patch({ backend: null, model: null, local_model: null })}><RotateCcw />{t("resetEngine")}</Button>
      </div>

      {local && (
        <Section icon={Server} title={t("backendSection")}>
          <RadioGroup value={effectiveBackend ?? ""} disabled={busy} onValueChange={(v) => void patch({ backend: v })}>
            {[{ value: "ollama", label: t("backendOllama"), ok: true }, { value: "anthropic", label: t("backendAnthropic"), ok: anthropicAvailable }].map((o) => (
              <div key={o.value} className="flex items-center gap-2"><RadioGroupItem value={o.value} id={`backend-${o.value}`} disabled={!o.ok} /><Label htmlFor={`backend-${o.value}`} className={cn("font-normal", !o.ok && "text-muted-foreground")}>{o.label}</Label></div>
            ))}
          </RadioGroup>
          {!anthropicAvailable && <p className="text-xs text-muted-foreground">{t("anthropicNeedsKey")}</p>}
        </Section>
      )}

      {showCloudModel && anthropicAvailable && (
        <Section icon={Cpu} title={t("modelSection")}>
          <Select value={unknownModel ?? cloudModel} disabled={busy} onValueChange={(v) => void patch({ model: v === settings.default_model ? null : v, ...(settings.backend ? {} : { backend: "anthropic" }) })}>
            <SelectTrigger className="w-full sm:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              {choices.map((c) => <SelectItem key={c.id} value={c.id}>{c.id === settings.default_model ? t("withDefault", { label: c.label }) : c.label}</SelectItem>)}
              {unknownModel && <SelectItem value={unknownModel} disabled>{t("unknownModel", { model: unknownModel })}</SelectItem>}
            </SelectContent>
          </Select>
          {selectedCloud?.recommended && <p className="text-xs text-muted-foreground">{t("recommended")}</p>}
        </Section>
      )}

      {showLocalModel && (
        <Section icon={HardDrive} title={t("localModelSection")}>
          <Select value={unknownLocal ?? localModel ?? ""} disabled={busy || !models?.ollama_reachable} onValueChange={(v) => void patch({ local_model: v === models?.default_local ? null : v, ...(settings.backend ? {} : { backend: "ollama" }) })}>
            <SelectTrigger className="w-full sm:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              {localChoices.map((m) => (
                <SelectItem key={m.id} value={m.id} disabled={!m.installed}>
                  {!m.installed ? t("notInstalledShort", { label: m.label }) : m.id === models?.default_local ? t("withDefault", { label: m.label }) : m.label}
                </SelectItem>
              ))}
              {unknownLocal && <SelectItem value={unknownLocal} disabled>{t("localModelUnavailable", { model: unknownLocal })}</SelectItem>}
            </SelectContent>
          </Select>
          {selectedLocal && <p className="text-xs text-muted-foreground">{selectedLocal.note}</p>}
          {missingLocal.map((m) => <p key={m.id} className="font-mono text-xs text-muted-foreground">{t("notInstalled", { label: m.label, tag: m.id })}</p>)}
          {models && !models.ollama_reachable && <StatusBadge value={t("ollamaDown")} tone="destructive" className="font-sans" />}
          <p className="text-xs text-muted-foreground">{t("localModelNote", { seconds: LOCAL_MODEL_RELOAD_S })}</p>
        </Section>
      )}
        </LineTabsContent>
        <LineTabsContent value="storage" className="space-y-8">
      <Section icon={Database} title={t("storeSection")}>
        <div className="flex items-center gap-3 text-sm">
          <Switch id="store-results" checked={settings.store_results} disabled={busy} onCheckedChange={toggleStore} />
          <Label htmlFor="store-results" className="font-normal">{t("storeLabel")}</Label>
        </div>
        <AlertDialog open={pendingOff} onOpenChange={setPendingOff}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>{t("storeSection")}</AlertDialogTitle><AlertDialogDescription>{t("confirmDeleteStored")}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel onClick={() => turnOff(false)}>{t("keepResults")}</AlertDialogCancel><AlertDialogAction onClick={() => turnOff(true)}>{t("deleteResults")}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {confirmDialog(<Button type="button" variant="destructive" size="sm" disabled={busy}>{t("deleteAll")}</Button>, t("deleteAll"), t("confirmDeleteAll"), deleteAll)}
      </Section>
        </LineTabsContent>
        <LineTabsContent value="registries" className="space-y-8">
          <Section icon={ShieldCheck} title={t("registries.checkSection")} description={t("registries.checkIntro")}>
            <div className="flex items-center gap-3 text-sm">
              <Switch id="check-registries" checked={settings.check_registries} disabled={busy} onCheckedChange={(checked) => void patch({ check_registries: checked })} />
              <Label htmlFor="check-registries" className="font-normal">{t("registries.checkLabel")}</Label>
            </div>
          </Section>
          <RegistriesPanel locale={locale} isAdmin={isAdmin} checkEnabled={settings.check_registries} />
        </LineTabsContent>
      </LineTabs>
    </div>
  );
}
