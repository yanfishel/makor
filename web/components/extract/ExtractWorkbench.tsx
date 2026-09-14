"use client";
import { RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DocSilhouette } from "@/components/DocSilhouette";
import { EngineLine } from "./EngineLine";
import { PageHeader } from "@/components/PageHeader";
import { ResultView } from "@/components/ResultView";
import { DocumentScene } from "./DocumentScene";
import { FieldLedger } from "./FieldLedger";
import { RunSummary } from "./RunSummary";
import { parseEngineModel, type EngineChoice } from "@/lib/engine-label";
import { applyEvent, initialState, type StreamEvent } from "@/lib/extract-stream";
import { readNdjson } from "@/lib/ndjson";
import { errorMessageKey } from "@/lib/ui-errors";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/** A floor so the bed cannot collapse to nothing on a very short window; below it the page
 * scrolls instead. */
const MIN_GRID = 240;
const paddingBottom = (el: Element | null | undefined): number =>
  el ? parseFloat(getComputedStyle(el).paddingBottom) || 0 : 0;

const MAX_BYTES = 30 * 1024 * 1024;  // mirrors lib/extract-handler MAX_UPLOAD_BYTES (a client component cannot import the server module)
const ACCEPTED_TYPES = /^(image\/|application\/pdf$)/;

/** The extract page: dropzone → scene + stages + ledger fed by POST /api/extract/stream →
 * ResultView. State is the pure reducer in lib/extract-stream.ts; this component owns the
 * file, the fetch and the layout. */
export function ExtractWorkbench({ choice }: { choice: EngineChoice }) {
  const t = useTranslations("extract");
  const reduced = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [state, dispatch] = useReducer(applyEvent, undefined, () => initialState(Date.now(), "idle"));
  const busy = !["idle", "done", "error"].includes(state.stage);
  const grid = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | null>(null);

  // The two columns are sized together, not apart. The grid asks for exactly the window height
  // left under it, so when the results are short the bed fills the screen and nothing scrolls;
  // when the results are tall the grid grows past that minimum and the bed — stretched by the
  // grid row and flexed inside its column — follows them down, so the bed is never left shorter
  // than the results beside it. Measuring the BED instead would size the two columns
  // independently and produce exactly that mismatch.
  //
  // The chrome above (topbar, heading) and below (the content's bottom padding, the footer) is
  // measured rather than assumed: it changes with the viewport's WIDTH as things wrap, and a
  // fixed `Nvh` therefore overflows one window and wastes space on another. Neither quantity
  // depends on the grid's own height, so reading them back cannot feed the grid its own size.
  const measure = useCallback(() => {
    const el = grid.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const section = el.closest("main > *");
    const footer = section?.parentElement?.lastElementChild;
    const below = (footer && footer !== section ? footer.getBoundingClientRect().height : 0) + paddingBottom(section);
    setMinHeight(Math.max(MIN_GRID, Math.round(window.innerHeight - top - below)));
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    // The chrome reflows without a window resize too: the sidebar collapses, the file line wraps,
    // an alert appears above the grid. Watching the body catches those.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, [measure, file]);

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  function reset() {
    setFile(null);
    setObjectUrl(null);
    setHoverIndex(null);
    dispatch({ type: "reset", now: Date.now(), stage: "idle" });
  }
  async function submit(f: File) {
    if (!ACCEPTED_TYPES.test(f.type)) return dispatch({ type: "error", error: "NOT_IMAGE", detail: "" });
    if (f.size > MAX_BYTES) return dispatch({ type: "error", error: "TOO_LARGE", detail: "" });
    setFile(f);
    setObjectUrl(f.type === "application/pdf" ? null : URL.createObjectURL(f));  // a PDF's preview comes from the engine (`page.preview`)
    setHoverIndex(null);
    dispatch({ type: "start", now: Date.now() });
    const form = new FormData();
    form.append("file", f);
    try {
      const res = await fetch("/api/extract/stream", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        return dispatch({ type: "error", error: body.error ?? null, detail: String(body.detail ?? body.error ?? res.status) });
      }
      for await (const event of readNdjson(res.body)) dispatch(event as unknown as StreamEvent);
    } catch (err) {
      dispatch({ type: "error", error: "ENGINE_UNAVAILABLE", detail: (err as Error).message });
    }
  }

  const error = state.stage === "error" && state.error ? t(errorMessageKey(state.error.code ?? undefined), { detail: state.error.detail }) : null;
  // A pre-stream rejection (trial exhaustion, 413, a full queue) fails before any "page"
  // event arrives: there is nothing to show in the scene (a PDF has no preview yet, an
  // image's object URL is a poor substitute for the workbench), so the dropzone stays
  // instead of the scene — the user can simply drop another file.
  const preStreamError = state.stage === "error" && !state.page;
  const src = state.page?.preview ?? objectUrl;
  const dropzone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void submit(f); }}
      onClick={() => input.current?.click()}
      className={cn("flex cursor-pointer flex-col items-center gap-4 rounded-lg border border-dashed border-foreground/25 p-10 text-center transition-colors hover:bg-muted/40", over && "border-highlight bg-highlight/5")}>
      <div className="flex flex-wrap justify-center gap-4 text-foreground/35" aria-hidden>
        {(["teudat_zehut", "israeli_passport", "israeli_drivers_license", "cheque"] as const).map((k) => <DocSilhouette key={k} type={k} className="h-9" />)}
      </div>
      <p className="font-medium">{t("drop")}</p>
      <p className="max-w-md text-[13px] text-muted-foreground">{t("intro")}</p>
      <Button type="button" variant="outline">{t("choose")}</Button>
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void submit(f); }} />
    </div>
  );
  // The resolution guidance sits under the frame, not in it: inside, it pushed "Choose file" below the fold on a phone.
  const hint = <p className="mx-auto max-w-md text-center text-[13px] text-muted-foreground">{t("hint")}</p>;

  const another = file && !preStreamError
    ? <Button type="button" variant="outline" onClick={reset} disabled={busy}><RotateCcw />{t("reset")}</Button>
    : undefined;
  return (
    <div className="space-y-6">
      {/* Under the heading, not in the result: the engine is known before the first upload,
          and a document already read names the one that actually ran. */}
      <PageHeader title={t("heading")} actions={another}
        description={<EngineLine choice={state.result ? parseEngineModel(state.result.model) : choice} />} />
      {(!file || preStreamError) && <div className="space-y-3">{dropzone}{hint}</div>}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
          {state.error?.code === "TRIAL_EXHAUSTED" && <AlertDescription><Link href="/app/settings" className="underline">{t("goToSettings")}</Link></AlertDescription>}
        </Alert>
      )}
      {file && !preStreamError && (
        <div ref={grid} className="grid gap-6 lg:grid-cols-[3fr_2fr]" style={minHeight !== null ? { minHeight } : undefined}>
          {/* A grid item stretches to the row's height, which is the taller of the two columns — so
              the unit ends level with the results instead of stopping short of them. Its own
              min-height is the floor for the one-column layout, where nothing stretches it.
              The ceiling is a sheet of A4 at the column's own width (`cqw` against this
              container): a long results table used to stretch the bed into a corridor. */}
          <div className="min-w-0 [container-type:inline-size]">
            <DocumentScene src={src} file={file} state={state} hoverIndex={hoverIndex} onHover={setHoverIndex}
              className="h-full max-h-[calc(297/210*100cqw)]" />
          </div>
          <div className="min-w-0 space-y-4">
            <RunSummary state={state} />
            {state.stage === "done" && state.result
              ? <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}><ResultView result={state.result} /></motion.div>
              : <FieldLedger state={state} hoverIndex={hoverIndex} onHover={setHoverIndex} />}
          </div>
        </div>
      )}
    </div>
  );
}
