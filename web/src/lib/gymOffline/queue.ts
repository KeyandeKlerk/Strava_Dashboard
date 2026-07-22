// Replays queued mutations in strict createdAt (FIFO) order against the
// dedicated REST routes under web/src/app/api/gym/* — see that directory's
// route.ts header comments for why REST rather than server actions. FIFO
// order is required for two reasons: (1) a session must sync before its
// sets, since addGymSet resolves session_id server-side by
// session_client_uuid; (2) a custom exercise created offline must sync
// before a set referencing it (via exercise_client_uuid, resolved locally
// against exercisesCache) can be sent with a real exercise_id.
import {
  deleteExerciseCache,
  findExerciseByClientUuid,
  getGymOfflineDb,
  listPendingMutations,
  patchSessionCache,
  putExerciseCache,
  reassignSetsExerciseId,
  type GymOfflineDb,
  type PendingMutation,
} from "./db";

export type FetchLike = typeof fetch;

type SendResult =
  | { outcome: "sent" }
  | { outcome: "blocked"; reason: string }
  | { outcome: "failed"; reason: "network" | "auth" | "http" };

export interface FlushResult {
  sentCount: number;
  stoppedReason: "network" | "auth" | "http" | "blocked" | null;
}

async function safeFetch(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  acceptStatuses: number[] = [],
): Promise<{ ok: true; body: unknown } | { ok: false; reason: "network" | "auth" | "http" }> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch {
    return { ok: false, reason: "network" };
  }

  if (res.status === 401 || res.status === 403 || res.redirected) {
    return { ok: false, reason: "auth" };
  }
  // A status the caller explicitly expects to parse (e.g. addGymSet's 409
  // "session not synced yet") is treated as a successful fetch — the caller
  // inspects the body itself to decide what happened.
  if (!res.ok && !acceptStatuses.includes(res.status)) {
    return { ok: false, reason: "http" };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // A login-page redirect resolves as a 200 HTML document, not JSON/401 —
    // this is the fallback catch for that case.
    return { ok: false, reason: "auth" };
  }

  return { ok: true, body: await res.json() };
}

// A negative id marks a not-yet-synced custom exercise (see
// gymOffline/context.tsx's addCustomExercise) — resolving to one here would
// send a dangling exercise_id to the server (no FK constraint enforces it,
// so it would silently insert a corrupt reference instead of failing loudly).
// Only a real (positive) id counts as resolved; otherwise stay blocked.
async function resolveSetExerciseId(db: GymOfflineDb, payload: Record<string, unknown>): Promise<number | null> {
  if (typeof payload.exercise_id === "number") {
    return payload.exercise_id >= 0 ? payload.exercise_id : null;
  }
  if (typeof payload.exercise_client_uuid === "string") {
    const cached = await findExerciseByClientUuid(db, payload.exercise_client_uuid);
    return cached && cached.id >= 0 ? cached.id : null;
  }
  return null;
}

async function sendMutation(db: GymOfflineDb, mutation: PendingMutation, fetchImpl: FetchLike): Promise<SendResult> {
  switch (mutation.type) {
    case "create_exercise": {
      const result = await safeFetch(fetchImpl, "/api/gym/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation.payload),
      });
      if (!result.ok) return { outcome: "failed", reason: result.reason };
      const body = result.body as { id: number; client_uuid: string | null };

      const placeholder = await findExerciseByClientUuid(db, mutation.clientUuid);
      await putExerciseCache(db, {
        id: body.id,
        client_uuid: body.client_uuid,
        name: String(mutation.payload.name),
        muscle_group: String(mutation.payload.muscle_group),
        equipment: (mutation.payload.equipment as string | null) ?? null,
        is_custom: true,
      });
      if (placeholder && placeholder.id !== body.id) {
        await deleteExerciseCache(db, placeholder.id);
        await reassignSetsExerciseId(db, placeholder.id, body.id);
      }
      return { outcome: "sent" };
    }

    case "create_session": {
      const result = await safeFetch(fetchImpl, "/api/gym/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation.payload),
      });
      if (!result.ok) return { outcome: "failed", reason: result.reason };
      const body = result.body as { id: number; client_uuid: string };
      await patchSessionCache(db, body.client_uuid, { id: body.id });
      return { outcome: "sent" };
    }

    case "create_set": {
      const exerciseId = await resolveSetExerciseId(db, mutation.payload);
      if (exerciseId == null) {
        return { outcome: "blocked", reason: "exercise not synced yet" };
      }
      const result = await safeFetch(
        fetchImpl,
        "/api/gym/sets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...mutation.payload, exercise_id: exerciseId }),
        },
        [409],
      );
      if (!result.ok) return { outcome: "failed", reason: result.reason };
      const body = result.body as { error?: string };
      if (body.error) {
        // Session not synced yet (409) — same FIFO-blocking treatment as an
        // unresolved exercise; the session-create mutation precedes this one.
        return { outcome: "blocked", reason: body.error };
      }
      return { outcome: "sent" };
    }

    case "delete_set": {
      const clientUuid = String(mutation.payload.client_uuid);
      const result = await safeFetch(fetchImpl, `/api/gym/sets/${encodeURIComponent(clientUuid)}`, {
        method: "DELETE",
      });
      if (!result.ok) return { outcome: "failed", reason: result.reason };
      return { outcome: "sent" };
    }
  }
}

// Stops on the first item that can't be sent (network/auth/http failure, or
// a dependency — session/exercise — not synced yet), leaving it and
// everything after it queued for the next flush trigger. Never reorders.
export async function flushQueue(fetchImpl: FetchLike = fetch, db?: GymOfflineDb): Promise<FlushResult> {
  const database = db ?? (await getGymOfflineDb());
  const pending = await listPendingMutations(database);

  let sentCount = 0;
  for (const mutation of pending) {
    const result = await sendMutation(database, mutation, fetchImpl);
    if (result.outcome === "sent") {
      await database.delete("pendingMutations", mutation.clientUuid);
      sentCount++;
      continue;
    }
    const stoppedReason = result.outcome === "blocked" ? "blocked" : result.reason;
    return { sentCount, stoppedReason };
  }

  return { sentCount, stoppedReason: null };
}
