import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../lib/api-client";
import AdminRiskPage from "./AdminRiskPage";

const TITLES: Record<string, string> = { overview: "Platform overview", merchants: "Merchant onboarding", readiness: "Merchant readiness", payments: "Platform payments", risk: "Payment exceptions", audit: "Platform audit ledger", users: "Account roles" };
type Row = Record<string, unknown>;
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" && item !== null && "overallScore" in item ? `Score ${String(item.overallScore)}` : String(item)).join(", ") : "Not assessed";
    return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join(", ");
  }
  return String(value);
}

export default function AdminPlatformPage() {
  const section = useLocation().pathname.split("/")[2] ?? "overview";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const data = useQuery({ queryKey: ["admin", section], queryFn: () => apiGet<Row & { items?: Row[] }>(`/admin/${section}`) });
  const onboard = useMutation({ mutationFn: () => apiPost("/admin/merchants", { name, slug, businessCategory: category }), onSuccess: () => { setName(""); setSlug(""); setCategory(""); void data.refetch(); } });
  const govern = useMutation({ mutationFn: ({ id, action }: { id: string; action: "ACTIVE" | "SUSPENDED" | "ASSESS" }) => action === "ASSESS" ? apiPost(`/admin/merchants/${id}/readiness`, {}) : apiPut(`/admin/merchants/${id}/status`, { status: action }), onSuccess: () => { void data.refetch(); } });
  const rows = data.data?.items ?? [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return <div className="space-y-5">
    {section === "risk" ? <AdminRiskPage /> : null}
    {section !== "risk" ? <h1 className="text-2xl font-bold">{TITLES[section] ?? "Platform administration"}</h1> : null}
    <p className="text-sm text-ink-muted">Platform-wide records. Server-verified administrator access is required. Lists show the latest 100 records.</p>
    <button onClick={() => void data.refetch()} className="rounded-lg border px-4 py-2">Refresh</button>
    {govern.isError ? <p role="alert">{govern.error.message}</p> : null}
    {section === "merchants" || section === "readiness" ? <section className="grid gap-3 md:grid-cols-3">{rows.map((row) => <article key={String(row.id)} className="space-y-2 rounded-card border p-3"><h2 className="font-semibold">{String(row.name)}</h2><div className="flex flex-wrap gap-2"><button disabled={govern.isPending} className="rounded border px-3 py-2 text-xs" onClick={() => govern.mutate({ id: String(row.id), action: "ASSESS" })}>Assess readiness</button><button disabled={govern.isPending} className="rounded border px-3 py-2 text-xs" onClick={() => govern.mutate({ id: String(row.id), action: row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>{row.status === "ACTIVE" ? "Suspend merchant" : "Reactivate merchant"}</button></div></article>)}</section> : null}
    {section === "merchants" ? <form className="grid gap-3 rounded-card border border-border p-4 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); onboard.mutate(); }}>
      <input aria-label="Merchant name" placeholder="Merchant name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className="rounded-lg border p-2" />
      <input aria-label="Merchant slug" placeholder="merchant-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(event) => setSlug(event.target.value)} className="rounded-lg border p-2" />
      <input aria-label="Business category" placeholder="Business category" required minLength={2} value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border p-2" />
      <button disabled={onboard.isPending} className="rounded-lg bg-brand-600 px-4 py-2 text-white disabled:opacity-50">Onboard merchant</button>
      {onboard.isError ? <p role="alert">{onboard.error.message}</p> : null}
      {onboard.isSuccess ? <p role="status">Merchant created. Catalog and readiness setup are still required.</p> : null}
    </form> : null}
    {data.isPending ? <p role="status">Loading platform records…</p> : data.isError ? <p role="alert">{data.error.message}</p> : section === "overview" ? <div className="grid gap-4 md:grid-cols-4">{Object.entries(data.data ?? {}).map(([key, value]) => <article key={key} className="rounded-card border p-5"><h2 className="capitalize">{key}</h2><p className="mt-2 text-3xl font-bold">{display(value)}</p></article>)}</div> : rows.length ? <div className="overflow-x-auto rounded-card border border-border"><table className="w-full text-left text-xs"><thead><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap bg-surface-subtle p-3">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)} className="border-t">{columns.map((column) => <td key={column} className="max-w-80 break-words p-3">{display(row[column])}</td>)}</tr>)}</tbody></table></div> : <p>No records yet.</p>}
  </div>;
}
