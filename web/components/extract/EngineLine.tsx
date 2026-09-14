"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Skeleton } from "@/components/ui/skeleton";
import { engineLabel, type EngineCatalogue, type EngineChoice } from "@/lib/engine-label";

/** What is going to read the document, under the page's heading — and, once a page has been
 * read, what did read it (the engine's own answer, which is the one that counts if the
 * settings changed in another tab meanwhile).
 *
 * The user's choice comes from the server with the page, so the line is right on the first
 * paint whenever a choice was made. What it cannot know is the ENGINE's own default (which
 * backend runs when nothing was picked) and a local model's printed name — both live in the
 * engine's config — so the catalogue is fetched once and fills them in; until it answers, a
 * chosen model shows as its raw tag rather than as nothing.
 *
 * Where nothing was chosen there is no line to write at all until that answer comes back, and
 * a line appearing under the heading pushed the whole page down. The wait is held open by a
 * skeleton of exactly one line's height instead.
 */
export function EngineLine({ choice }: { choice: EngineChoice }) {
  const t = useTranslations("extract");
  const tl = useTranslations("labels");
  const [catalogue, setCatalogue] = useState<EngineCatalogue | null>(null);
  // Only the engine holds the local labels and its own defaults; an anthropic run with a
  // model already chosen needs neither, so it costs no request.
  const complete = choice.backend === "anthropic" && choice.model !== null;
  const [pending, setPending] = useState(!complete);
  useEffect(() => {
    if (complete) { setPending(false); return; }
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/settings/engine-models");
        if (res.ok && live) setCatalogue((await res.json()) as EngineCatalogue);
      } catch { /* the engine is down: the line says what the settings say, or nothing */ }
      // Answered or not, the wait is over: an engine that never answers must not leave a
      // skeleton pulsing under the heading for the rest of the session.
      if (live) setPending(false);
    })();
    return () => { live = false; };
  }, [complete]);

  const { backend, model } = engineLabel(choice, catalogue);
  if (pending && !backend) {
    return (
      <span data-slot="engine-line-skeleton" aria-hidden className="flex h-[1lh] items-center">
        <Skeleton className="h-3.5 w-40" />
      </span>
    );
  }
  if (!backend) return null;
  const name = tl.has(`engines.${backend}`) ? tl(`engines.${backend}`) : backend;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {t("engine")}:{" "}
      <Link href="/app/settings?tab=engine" className="text-foreground hover:text-highlight hover:underline">
        {/* Each part isolated: a Hebrew line around "Qwen3-VL 8B" reorders a joined string. */}
        <bdi>{name}</bdi>{model && <> · <bdi>{model}</bdi></>}
      </Link>
    </span>
  );
}
