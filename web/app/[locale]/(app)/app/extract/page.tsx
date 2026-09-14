import { ExtractWorkbench } from "@/components/extract/ExtractWorkbench";
import { getConfig } from "@/lib/config";
import { currentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { engineChoice } from "@/lib/engine-label";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// The heading lives inside the workbench: its action ("Another document") is the workbench's
// own state, and a server page cannot hold it. What the page does supply is the engine this
// user's next upload will ask for — the same resolution handleExtract sends, read straight
// from the settings row so the line under the heading is right on the first paint.
export default async function ExtractPage() {
  const { userId } = await currentUser();
  return <ExtractWorkbench choice={engineChoice(getSettings(getDb(), userId), getConfig().authMode)} />;
}
