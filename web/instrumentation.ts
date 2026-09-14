/**
 * Next calls this once per server start. Clerk mode: invite MAKOR_ADMIN_EMAIL while the
 * instance has no admin. Fired and forgotten — a slow or unreachable Clerk must never delay
 * the server coming up; `startupAdminInvitation` itself never throws. Either mode: arm the
 * daily registries refresh when MAKOR_REGISTRIES_REFRESH_AT is set.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTH_MODE === "clerk") {
    const { startupAdminInvitation } = await import("./lib/bootstrap-admin");
    void startupAdminInvitation();
  }
  try {
    const { startRegistriesSchedule } = await import("./lib/registries/schedule");
    startRegistriesSchedule();
  } catch (err) {
    // A malformed time is also refused by every request's getConfig(); here it must not stop the boot.
    console.error(`registries: daily refresh not scheduled: ${err instanceof Error ? err.message : String(err)}`);
  }
}
