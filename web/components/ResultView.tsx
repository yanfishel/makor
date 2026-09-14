"use client";
import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LineTab, LineTabs, LineTabsContent, LineTabsList } from "@/components/LineTabs";
import { CodeBlock } from "@/components/CodeBlock";
import { DocTypeChip } from "@/components/DocTypeChip";
import { DownloadResultButton } from "@/components/DownloadResultButton";
import { Tip } from "@/components/Tip";
import { StatusBadge } from "@/components/StatusBadge";
import { fieldLabel } from "@/lib/field-labels";
import { formatFieldDate } from "@/lib/format";
import { fieldRows, type ExtractResponse } from "@/lib/result-types";
import { registriesRows, type Translate } from "@/lib/registries/section";
import { sefachSections } from "@/lib/sefach";
import { cn } from "@/lib/utils";

/** The response as a page reads it: the document's type and the response to take away over
 * the table, the verdict on the tab rule (a verdict is about the readings under it), the
 * readings themselves, and the engine's warnings under the lot as footnotes to them. */
export function ResultView({ result }: { result: ExtractResponse }) {
  const t = useTranslations("extract");
  const ta = useTranslations("app");
  const tl = useTranslations("labels");
  const locale = useLocale();
  const tc = useTranslations("registries.check") as unknown as Translate;
  const ts = useTranslations("registries.sources") as unknown as Translate;
  const json = JSON.stringify(result, null, 2);
  // One row of the table: the printed label with the API's own name as its tooltip (dropped
  // when the label IS that name — a tooltip repeating the line under it says nothing), the
  // value centred and the confidence at the line's end.
  const row = (r: { name: string; value: string; confidence: string }) => {
    const label = fieldLabel(r.name, tl);
    return (
      <tr key={r.name} data-field={r.name} className="border-t border-border">
        <td className="px-3 py-1.5"><Tip text={label.translated ? label.raw : null} mono><span className={cn(!label.translated && "font-mono text-xs")}>{label.text}</span></Tip></td>
        <td className="px-3 py-1.5 text-center"><span dir="auto">{formatFieldDate(r.value) ?? r.value}</span></td>
        <td className="px-3 py-1.5 text-end"><StatusBadge value={r.confidence} /></td>
      </tr>
    );
  };
  return (
    <section className="space-y-4">
      {/* First, under the stages that produced them: what the engine could not see well, and
          why a reading below may be off. A caveat is read before the values it qualifies. */}
      {result.warnings.length > 0 && (
        <Alert className="border-warning/30 bg-warning/5"><AlertTitle>{t("warnings")}</AlertTitle><AlertDescription><ul className="list-disc ps-4">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></AlertDescription></Alert>
      )}
      {/* One row over the table it describes, spread to its edges: what the page turned out to
          be, how well it was read, and the response to take away — whichever tab is open, the
          download takes the whole of it. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <DocTypeChip type={result.document_type} />
        <div className="flex items-center gap-2">
          <StatusBadge value={tl.has(`verdicts.${result.validation.overall}`) ? tl(`verdicts.${result.validation.overall}`) : result.validation.overall} tone={result.validation.overall}
            className="font-sans" />
          {result.meta.trial_remaining != null && <span className="text-xs text-muted-foreground">{t("trialLeft", { n: result.meta.trial_remaining })}</span>}
        </div>
        <DownloadResultButton result={result} />
      </div>
      <LineTabs defaultValue="fields" className="gap-4">
        <LineTabsList><LineTab value="fields">{t("fields")}</LineTab><LineTab value="json">{t("json")}</LineTab></LineTabsList>
        <LineTabsContent value="fields">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start font-medium">{t("field")}</th><th className="px-3 py-2 text-center font-medium">{t("value")}</th><th className="px-3 py-2 text-end font-medium">{t("confidence")}</th></tr></thead>
              <tbody>
                {fieldRows(result.fields).map(row)}
                {/* The appendix sheet continues the same table: one full-width rule names the
                    section, its readings are rows like any other field. */}
                {result.sefach && sefachSections(result.sefach).map((section) => (
                  <Fragment key={section.title}>
                    <tr data-slot={`section-${section.title}`} className="border-t border-border bg-muted/40">
                      <th colSpan={3} scope="colgroup" className="px-3 py-1.5 text-start font-mono text-xs font-medium text-muted-foreground">{t(`sefach.${section.title}`)}</th>
                    </tr>
                    {section.rows.map(row)}
                  </Fragment>
                ))}
                {/* The registries check continues the table the same way: a rule, then one row per
                    match — what was looked up, where and how it matched, the record, its level. */}
                {result.registries && (
                  <Fragment>
                    <tr data-slot="section-registries" className="border-t border-border bg-muted/40">
                      <th colSpan={3} scope="colgroup" className="px-3 py-1.5 text-start font-mono text-xs font-medium text-muted-foreground">{tc("section")}</th>
                    </tr>
                    {registriesRows(result.registries, tc, locale).map((r, i) => r.kind === "note" ? (
                      <tr key={`registries-${i}`} className="border-t border-border"><td colSpan={3} className="px-3 py-1.5 text-muted-foreground">{r.text}</td></tr>
                    ) : (
                      <tr key={`registries-${i}`} data-registry={r.source} className="border-t border-border">
                        <td className="px-3 py-1.5">{tc(`fields.${r.field}`)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className="block text-xs text-muted-foreground">{[ts(r.source), tc(`by.${r.by}`), r.by === "name" ? tc("verify") : null].filter(Boolean).join(" · ")}</span>
                          <span dir="auto">{r.summary}</span>
                        </td>
                        <td className="px-3 py-1.5 text-end"><StatusBadge value={tc(`levels.${r.level}`)} tone={r.level === "alert" ? "destructive" : "neutral"} className="font-sans" /></td>
                      </tr>
                    ))}
                  </Fragment>
                )}
              </tbody>
            </table>
          </div>
        </LineTabsContent>
        {/* A full response is hundreds of lines; left to grow it stretched the page — and with
            it the scene beside it — far past the window. The listing scrolls inside its own
            box instead, and the download button is what takes the whole of it away. */}
        <LineTabsContent value="json"><CodeBlock code={json} labels={{ copy: ta("copy"), copied: ta("copied") }} className="max-h-[40vh]" /></LineTabsContent>
      </LineTabs>
    </section>
  );
}
