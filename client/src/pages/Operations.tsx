import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canLoadOperations, operationsAccessNotice } from "@/lib/access";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowLeft, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const fields = [
  ["clientRequestsPerMinute", "Client requests / min"],
  ["globalSearchesPerMinute", "Global searches / min"],
  ["maxConcurrency", "Active searches"],
  ["maxWaitingRequests", "Queued searches"],
  ["maxQueueWaitMs", "Queue wait (ms)"],
  ["circuitFailureThreshold", "429 threshold"],
  ["circuitCooldownMaxSeconds", "Circuit cooldown (sec)"],
] as const;

function Surface({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[#f8fafc] p-4 text-[#3c3c43] sm:p-8 dark:bg-[#1a1a1a] dark:text-[#dfdfd6]">{children}</main>;
}

export default function Operations() {
  const [password, setPassword] = useState("");
  const status = trpc.adminAuth.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const canViewOperations = canLoadOperations(status.data?.authenticated === true);
  const overview = trpc.operations.overview.useQuery(undefined, { enabled: canViewOperations, retry: false });
  const updatePolicy = trpc.operations.updatePolicy.useMutation({ onSuccess: () => void overview.refetch() });
  const login = trpc.adminAuth.login.useMutation({
    onSuccess: () => {
      setPassword("");
      void status.refetch();
    },
  });
  const logout = trpc.adminAuth.logout.useMutation({ onSuccess: () => void status.refetch() });
  const data = overview.data;
  const policy = data?.policy;

  if (status.isLoading || (canViewOperations && overview.isLoading)) {
    return <Surface>Loading Operations…</Surface>;
  }

  if (!canViewOperations) {
    const notice = operationsAccessNotice(false)!;
    return (
      <Surface>
        <div className="mx-auto max-w-xl rounded-2xl border border-[#d6e5f3] bg-white p-6 shadow-[0_12px_28px_rgb(15_23_42_/_0.08)] dark:border-[#355697] dark:bg-[#222222]">
          <KeyRound className="mb-3 text-[#5d99da]" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{notice.heading}</h1>
          <p className="mt-2 text-sm leading-6 text-[#67676c] dark:text-[#b2b2aa]">{notice.detail}</p>
          <form className="mt-5 grid gap-3" onSubmit={event => { event.preventDefault(); login.mutate({ password }); }}>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="administrator-password">
              Administrator password
              <Input autoComplete="current-password" className="border-[#b7d6ef] bg-[#f8fbfe] focus-visible:ring-[#5d99da] dark:border-[#355697] dark:bg-[#1a1a1a]" id="administrator-password" onChange={event => setPassword(event.target.value)} required type="password" value={password} />
            </label>
            {login.error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{login.error.message}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button className="bg-[#5d99da] text-white hover:bg-[#4b85c6]" disabled={login.isPending} type="submit"><KeyRound size={15} /> {login.isPending ? "Unlocking…" : notice.actionLabel}</Button>
              <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#355697] underline-offset-4 hover:underline dark:text-[#a8d1ef]"><ArrowLeft size={15} /> Return to FMHYchat</Link>
            </div>
          </form>
        </div>
      </Surface>
    );
  }

  if (overview.error || !data || !policy) {
    return <Surface><div className="mx-auto max-w-xl rounded-2xl border border-[#d6e5f3] bg-white p-6 shadow-[0_12px_28px_rgb(15_23_42_/_0.08)] dark:border-[#355697] dark:bg-[#222222]"><AlertTriangle className="mb-3 text-[#5d99da]" aria-hidden="true" /><h1 className="text-xl font-semibold tracking-[-0.02em]">Operations is temporarily unavailable</h1><p className="mt-2 text-sm leading-6 text-[#67676c] dark:text-[#b2b2aa]">The aggregate Operations data could not be loaded. Refresh the page to try again.</p><div className="mt-5 flex flex-wrap items-center gap-3"><Button className="bg-[#5d99da] text-white hover:bg-[#4b85c6]" onClick={() => void overview.refetch()}>Try again</Button><Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#355697] underline-offset-4 hover:underline dark:text-[#a8d1ef]"><ArrowLeft size={15} /> Return to FMHYchat</Link></div></div></Surface>;
  }

  function save(formData: FormData) {
    updatePolicy.mutate(Object.fromEntries(fields.map(([key]) => [key, Number(formData.get(key))])) as Parameters<typeof updatePolicy.mutate>[0]);
  }

  const circuitOpen = data.circuit.openUntil && data.circuit.openUntil.getTime() > Date.now();
  return (
    <Surface>
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[#d6e5f3] pb-6 dark:border-[#355697]"><div><Link href="/" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-[#355697] underline-offset-4 hover:underline dark:text-[#a8d1ef]"><ArrowLeft size={15} /> FMHYchat</Link><h1 className="text-3xl font-semibold tracking-[-0.03em]">Operations</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-[#67676c] dark:text-[#b2b2aa]">Aggregate protection health. No prompts, user identities, or resource data are stored here.</p></div><div className="flex items-center gap-2"><Button className="border-[#b7d6ef] bg-[#edf6fd] text-[#355697] hover:bg-[#dfeffc] dark:border-[#355697] dark:bg-[#203a52] dark:text-[#a8d1ef]" variant="outline" onClick={() => void overview.refetch()} disabled={overview.isFetching}><RefreshCw size={15} className={overview.isFetching ? "animate-spin" : ""} /> Refresh</Button><Button className="border-[#b7d6ef] bg-[#edf6fd] text-[#355697] hover:bg-[#dfeffc] dark:border-[#355697] dark:bg-[#203a52] dark:text-[#a8d1ef]" variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={15} /> Lock</Button></div></header>
        <section className="grid gap-4 md:grid-cols-2" aria-label="Protection health"><div className="rounded-2xl border border-[#c6ebd5] bg-[#f5fcf7] p-5 dark:border-[#386752] dark:bg-[#1c3028]"><div className="flex items-center gap-2 text-sm font-semibold text-[#2d6a58] dark:text-[#a8f0cc]"><ShieldCheck size={16} /> Groq circuit</div><p className={circuitOpen ? "mt-3 text-2xl font-semibold text-[#9a5b14] dark:text-[#f5c47a]" : "mt-3 text-2xl font-semibold text-[#2d6a58] dark:text-[#a8f0cc]"}>{circuitOpen ? "Open" : "Closed"}</p><p className="mt-1 text-sm leading-6 text-[#426f60] dark:text-[#b8ddc8]">{circuitOpen ? `New searches resume after ${data.circuit.openUntil?.toLocaleTimeString()}.` : "New searches may be admitted within the configured policy."}</p></div><div className="rounded-2xl border border-[#d6e5f3] bg-white p-5 shadow-[0_12px_28px_rgb(15_23_42_/_0.06)] dark:border-[#355697] dark:bg-[#222222]"><div className="text-sm font-semibold text-[#355697] dark:text-[#a8d1ef]">Last 60 minutes</div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">{data.metrics.length ? data.metrics.map(metric => <><dt key={`${metric.kind}-label`} className="truncate text-[#67676c] dark:text-[#b2b2aa]">{metric.kind.replaceAll("_", " ")}</dt><dd key={metric.kind} className="text-right font-semibold">{metric.count}</dd></>) : <p className="col-span-2 text-[#67676c] dark:text-[#b2b2aa]">No aggregate events yet.</p>}</dl></div></section>
        <form className="mt-6 rounded-2xl border border-[#d6e5f3] bg-white p-5 shadow-[0_12px_28px_rgb(15_23_42_/_0.06)] dark:border-[#355697] dark:bg-[#222222]" onSubmit={event => { event.preventDefault(); save(new FormData(event.currentTarget)); }}><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 className="font-semibold tracking-[-0.01em]">Shared protection policy</h2><p className="mt-1 text-sm leading-6 text-[#67676c] dark:text-[#b2b2aa]">Revision {policy.revision}; changes apply to new shared admissions.</p></div><Button className="bg-[#5d99da] text-white hover:bg-[#4b85c6]" type="submit" disabled={updatePolicy.isPending}>{updatePolicy.isPending ? "Saving…" : "Save policy"}</Button></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label]) => <label key={key} className="grid gap-1.5 text-sm font-semibold text-[#3c3c43] dark:text-[#dfdfd6]"><span>{label}</span><Input className="border-[#b7d6ef] bg-[#f8fbfe] focus-visible:ring-[#5d99da] dark:border-[#355697] dark:bg-[#1a1a1a]" type="number" min="0" name={key} defaultValue={policy[key]} required /></label>)}</div>{updatePolicy.error ? <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{updatePolicy.error.message}</p> : null}</form>
      </div>
    </Surface>
  );
}
