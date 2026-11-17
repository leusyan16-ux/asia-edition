import { runOneJob } from "./runner";
import { newWorkerOwner } from "./projection";
import type { Database } from "./postgres-worker";
import type { AdminTaxonomy } from "../admin/model";
export function startSupervisor(
  db: Database,
  taxonomy: () => Promise<AdminTaxonomy>,
  options: {
    pollMs?: number;
    onError?: (error: unknown) => void;
    allowSynthetic?: boolean;
  } = {},
) {
  const controller = new AbortController(),
    owner = newWorkerOwner();
  const finished = (async () => {
    while (!controller.signal.aborted) {
      let worked = false;
      try {
        worked = await runOneJob(
          db,
          owner,
          await taxonomy(),
          controller.signal,
          options.allowSynthetic ?? false,
        );
      } catch (error) {
        if (!controller.signal.aborted) options.onError?.(error);
      }
      if (!worked && !controller.signal.aborted)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(
            done,
            Math.max(50, Math.min(30000, options.pollMs ?? 1000)),
          );
          controller.signal.addEventListener("abort", done, { once: true });
        });
    }
  })();
  return {
    owner,
    finished,
    async stop() {
      controller.abort();
      await finished;
    },
  };
}
export function attachShutdown(
  supervisor: ReturnType<typeof startSupervisor>,
  close: () => Promise<void>,
) {
  const stop = () => {
    void supervisor
      .stop()
      .then(close)
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return () => {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  };
}
