"use client";
import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { enUS, he } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Range = { from?: string; to?: string };
export const PRESETS = ["today", "7d", "30d", "all"] as const;
export type Preset = (typeof PRESETS)[number];

const pad = (n: number) => String(n).padStart(2, "0");
/** Calendar days as the URL carries them (YYYY-MM-DD), in the viewer's own zone. */
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s?: string) => (s ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : undefined);
const daysAgo = (now: Date, n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);

export function presetRange(preset: Preset, now: Date = new Date()): Range {
  switch (preset) {
    case "today": return { from: day(now), to: day(now) };
    case "7d": return { from: day(daysAgo(now, 6)), to: day(now) };
    case "30d": return { from: day(daysAgo(now, 29)), to: day(now) };
    default: return {};
  }
}

const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const tidy = (s: string) => s.replace(/[  ]/g, " ");
export function dateLabel(locale: string, iso: string): string {
  return tidy(new Intl.DateTimeFormat(locale, opts).format(parse(iso)!));
}
/** "Sep 7 – 11, 2026" — the locale's own way of collapsing a range. */
export function rangeLabel(locale: string, from: string, to: string): string {
  return tidy(new Intl.DateTimeFormat(locale, opts).formatRange(parse(from)!, parse(to)!));
}

/**
 * The list's date range: a button opening a two-month range calendar with presets. The range
 * travels as hidden `from`/`to` inputs of the surrounding GET form — a preset submits at once,
 * a calendar pick when the popover closes.
 */
export function DateRangeField({ from, to, locale }: { from?: string; to?: string; locale: string }) {
  const t = useTranslations("documents.range");
  const [range, setRange] = useState<Range>({ from, to });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (pending) { setPending(false); fromRef.current?.form?.requestSubmit(); } }, [pending, range]);
  const changed = range.from !== from || range.to !== to;
  const apply = (r: Range) => { setRange(r); setOpen(false); setPending(true); };
  const onOpenChange = (o: boolean) => { setOpen(o); if (!o && changed) setPending(true); };
  const label = range.from && range.to ? rangeLabel(locale, range.from, range.to)
    : range.from ? t("from", { date: dateLabel(locale, range.from) })
    : range.to ? t("until", { date: dateLabel(locale, range.to) })
    : t("all");
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  /* Two months end on the range's last day (or today), so the recent past is what opens. */
  const anchor = parse(range.to) ?? new Date();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <input ref={fromRef} type="hidden" name="from" value={range.from ?? ""} readOnly />
      <input type="hidden" name="to" value={range.to ?? ""} readOnly />
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn("h-8 justify-start gap-2 rounded-lg font-normal", !range.from && !range.to && "text-muted-foreground")}>
          <CalendarDays className="text-muted-foreground" />{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto flex-row gap-0 p-0">
        <ul className="flex flex-col gap-0.5 border-e border-border p-2">
          {PRESETS.map((p) => <li key={p}><Button type="button" variant="ghost" size="sm" className="w-full justify-start font-normal" onClick={() => apply(presetRange(p))}>{t(`presets.${p}`)}</Button></li>)}
        </ul>
        <Calendar mode="range" numberOfMonths={narrow ? 1 : 2} locale={locale === "he" ? he : enUS} dir={locale === "he" ? "rtl" : "ltr"}
          defaultMonth={narrow ? anchor : new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)}
          selected={{ from: parse(range.from), to: parse(range.to) }}
          onSelect={(r) => setRange({ from: r?.from && day(r.from), to: r?.to && day(r.to) })} />
      </PopoverContent>
    </Popover>
  );
}
