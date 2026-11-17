import { redirect } from "next/navigation";
import { CatalogJobPanel } from "@/features/admin/catalog-job-panel";
import { currentAdmin } from "@/features/admin/server";
import { ImportPanel, Logout } from "@/features/admin/components";
import { UniversalImportPanel } from "@/features/admin/import-panel";
import { localDirectory, readLocalState } from "@/features/admin/local-store";
import { isTestProfile } from "@/features/admin/import-engine";
import { postgresSelected } from "@/features/ingestion/config";
import { PostgresJobs } from "@/features/ingestion/jobs-view";
import { adminPostgresJobs } from "@/features/admin/server";
import { PostgresUploadPanel } from "@/features/ingestion/upload-panel";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const p = await currentAdmin();
  if (!p) redirect("/admin/login");
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <h1>Импорт каталога</h1>
          <p>Подготовьте большой каталог с проверкой каждой строки.</p>
        </div>
        <Logout />
      </div>
      {postgresSelected() ? (
        <>
          <PostgresUploadPanel />
          <PostgresJobs
            data={await adminPostgresJobs(
              p,
              Number((await searchParams).page) || 1,
            )}
          />
        </>
      ) : p.mode === "local" ? (
        <>
          <CatalogJobPanel />
          <UniversalImportPanel
            initialLogs={(await readLocalState()).imports.slice(-50).reverse()}
            testProfile={isTestProfile(localDirectory())}
          />
          <details>
            <summary>Прежний CSV-импорт собственных экскурсий</summary>
            <ImportPanel />
          </details>
        </>
      ) : (
        <ImportPanel />
      )}
    </>
  );
}
