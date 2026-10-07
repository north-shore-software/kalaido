import useSWR from "swr";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import {
  fetchQuota,
  fetchUsage,
  type QuotaStatus,
  type UsageStatus,
} from "@/api/kalaidoscope/cloud/quota.ts";
import { Label, Mono, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function WorkspaceQuotaPanel({
  kalaidoscope,
}: {
  kalaidoscope: KalaidoscopeMeta;
}) {
  const cloud = kalaidoscope.type === "cloud";
  const usage = useSWR(["workspace-usage", kalaidoscope.id], async () => {
    const result = await fetchUsage();
    if (result.isErr()) throw result.error;
    return result.value;
  });
  const quota = useSWR(
    cloud ? ["workspace-quota", kalaidoscope.id] : null,
    async () => {
      const result = await fetchQuota();
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-2.5">
      <div className="flex items-center gap-2.5">
        <Label>{cloud ? "AI allowance" : "AI usage"}</Label>
        <div className="flex-1" />
        {cloud && <Button variant="outline">Request more</Button>}
      </div>
      {cloud && <Balance data={quota.data} error={quota.error} />}
      <UsageSplit data={usage.data} error={usage.error} />
    </div>
  );
}

function Balance({ data, error }: { data?: QuotaStatus; error?: Error }) {
  if (error) {
    return (
      <span className="text-body text-critical-ink">
        Couldn't load this kalaidoscope's allowance: {error.message}
      </span>
    );
  }
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-body">
      <Mono>{data.balance.toLocaleString()}</Mono>
      <span>tokens remaining</span>
      {data.balance <= 0 ? (
        <StatusPill kind="critical">exhausted</StatusPill>
      ) : (
        <StatusPill kind="stable">active</StatusPill>
      )}
      {data.expires && (
        <>
          <div className="flex-1" />
          <span className="text-muted-foreground">
            expires {new Date(data.expires).toLocaleDateString()}
          </span>
        </>
      )}
    </div>
  );
}

function UsageSplit({ data, error }: { data?: UsageStatus; error?: Error }) {
  if (error) {
    return (
      <span className="text-body text-critical-ink">
        Couldn't load this month's usage: {error.message}
      </span>
    );
  }
  if (!data) return <Spinner />;
  const rows: [string, number][] = [
    ["Tokens in", data.promptTokens],
    ["of which cached", data.cachedTokens],
    ["Tokens out", data.completionTokens],
    ["Total this month", data.totalTokens],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
      {rows.map(([label, n]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>
            <Mono>{n.toLocaleString()}</Mono>
          </dd>
        </div>
      ))}
    </dl>
  );
}
