import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/PageHeader";
import { ResultView } from "@/components/ResultView";
import { decrypt, getMasterKey } from "@/lib/crypto";
import { currentUserId } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { getDocumentResult } from "@/lib/documents";
import type { ExtractResponse } from "@/lib/result-types";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("document");
  const userId = await currentUserId();
  const { found, resultEnc } = getDocumentResult(getDb(), userId, id);
  if (!found) notFound();
  if (!resultEnc) return <p className="text-muted-foreground">{t("notStored")}</p>;
  let result: ExtractResponse;
  try {
    result = JSON.parse(decrypt(resultEnc, getMasterKey()));
  } catch {
    return <p className="text-destructive">{t("decryptFailed")}</p>;
  }
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} actions={<DeleteButton url={`/api/v1/documents/${id}`} method="DELETE" confirmText={t("confirmDelete")} label={t("delete")} redirectTo="/app" errorText={t("deleteFailed")} />} />
      <ResultView result={result} />
    </div>
  );
}
