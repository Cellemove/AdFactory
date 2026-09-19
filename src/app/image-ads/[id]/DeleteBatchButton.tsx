"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteImageAdBatch } from "@/app/actions/image-ads";

// Two clicks, no modal: the first arms the button, the second deletes.
export function DeleteBatchButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteImageAdBatch(batchId);
      if (result.ok) {
        router.push("/image-ads");
        return;
      }
      setError(result.error);
    } catch {
      setError("Could not reach the server.");
    }
    setDeleting(false);
    setArmed(false);
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      {armed ? (
        <>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setArmed(false)} disabled={deleting}>
            Keep
          </button>
          <button type="button" className="btn btn-danger text-xs" onClick={remove} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete batch"}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost text-xs text-ink-500" onClick={() => setArmed(true)}>
          Delete
        </button>
      )}
    </div>
  );
}
