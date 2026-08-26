import { useMutation, useQuery } from "@tanstack/react-query";
import type { SandboxAttackId, SandboxAttackPresetDTO, SandboxRunResultDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";

export function useSandboxPresets() {
  return useQuery({
    queryKey: ["sandbox", "presets"],
    queryFn: () => apiGet<{ presets: SandboxAttackPresetDTO[] }>("/sandbox/break-the-agent/presets"),
  });
}

export function useRunSandboxAttack() {
  return useMutation({
    mutationFn: (attackId: SandboxAttackId) => apiPost<SandboxRunResultDTO>("/sandbox/break-the-agent/run", { attackId }),
  });
}
