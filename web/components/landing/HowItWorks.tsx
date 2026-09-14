import { StepPicture } from "./pictures";
import type { LandingMessages } from "./Landing";

export function HowItWorks({ m }: { m: LandingMessages["how"] }) {
  return (
    <section id="how" className="scroll-mt-14 space-y-8">
      <h2 className="text-3xl font-semibold tracking-tight">{m.title}</h2>
      <ol className="grid border-t border-foreground md:grid-cols-4">
        {m.steps.map((s, i) => (
          <li key={s.title} className="space-y-3 border-b border-border py-6 md:border-b-0 md:border-e md:pe-5 md:me-5 md:last:border-e-0 md:last:me-0 md:last:pe-0">
            <div className="flex justify-center pb-1"><StepPicture step={i as 0 | 1 | 2 | 3} /></div>
            <div className="text-center font-medium"><span className="me-2 font-mono text-xs text-muted-foreground">0{i + 1}</span>{s.title}</div>
            <p className="text-[13px] text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
