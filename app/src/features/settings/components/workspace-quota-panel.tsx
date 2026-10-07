import useSWR from "swr";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { fetchQuota } from "@/api/kalaidoscope/cloud/quota.ts";
import { Label, Mono, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function WorkspaceQuotaPanel({
  kalaidoscope,
}: {
  kalaidoscope: KalaidoscopeMeta;
}) {
  if (kalaidoscope.type !== "cloud") return null;
  return <CloudQuotaPanel kalaidoscopeId={kalaidoscope.id} />;
}

function CloudQuotaPanel({ kalaidoscopeId }: { kalaidoscopeId: string }) {
  const { data, error } = useSWR(
    ["workspace-quota", kalaidoscopeId],
    async () => {
      const result = await fetchQuota();
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-2.5">
      <div className="flex items-center gap-2.5">
        <Label>AI allowance</Label>
        <div className="flex-1" />
        <Button variant="outline">Request more</Button>
      </div>
      {error ? (
        <span className="text-body text-critical-ink">
          Couldn't load this kalaidoscope's allowance: {error.message}
        </span>
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="flex flex-wrap items-center gap-2.5 text-body">
          <Mono>{data.balance.toLocaleString()}</Mono>
          <span>tokens remaining</span>
          {data.balance <= 0 ? (
            <StatusPill kind="critical">exhausted</StatusPill>
          ) : (
            <StatusPill kind="stable">active</StatusPill>
          )}
          <div className="flex-1" />
          <span className="text-muted-foreground">
            {data.used.toLocaleString()} used this month
            {data.expires &&
              ` · expires ${new Date(data.expires).toLocaleDateString()}`}
          </span>
        </div>
      )}
    </div>
  );
}
