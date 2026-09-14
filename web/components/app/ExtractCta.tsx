import { ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

/** The dashboard's and the documents list's call to action. Below `sm` it says only the verb:
 * the full label met the page title in the header row on a 320 px screen. */
export function ExtractCta({ label, short }: { label: string; short: string }) {
  return (
    <Button asChild variant="highlight">
      <Link href="/app/extract"><ScanText /><span className="sm:hidden">{short}</span><span className="max-sm:hidden">{label}</span></Link>
    </Button>
  );
}
