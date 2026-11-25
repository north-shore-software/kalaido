import { checkCloudIdAvailability } from "@kalaido/client/cloud/user";
import { useCallback, useEffect, useState } from "react";
import {
  CLOUD_ID_CHECK_DELAY_MS,
  CLOUD_ID_RE,
  type CloudIdCheck,
} from "../cloud-id";

export function useCloudIdCheck(
  candidateId: string,
  cloudChecksApply: boolean,
) {
  const [idCheck, setIdCheck] = useState<CloudIdCheck | null>(null);
  const [idChecking, setIdChecking] = useState(false);

  useEffect(() => {
    if (!cloudChecksApply || !CLOUD_ID_RE.test(candidateId)) {
      setIdChecking(false);
      return;
    }
    let cancelled = false;
    setIdChecking(true);
    const handle = setTimeout(async () => {
      const result = await checkCloudIdAvailability(candidateId);
      if (cancelled) return;
      setIdChecking(false);
      if (result.isErr()) {
        console.error("Failed to check cloud id:", result.error);
        setIdCheck({ id: candidateId, available: null });
        return;
      }
      setIdCheck({ id: candidateId, ...result.value });
    }, CLOUD_ID_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [candidateId, cloudChecksApply]);

  const recheck = useCallback(async (id: string) => {
    const fresh = await checkCloudIdAvailability(id);
    if (fresh.isOk()) setIdCheck({ id, ...fresh.value });
  }, []);

  return { idCheck, idChecking, recheck };
}
