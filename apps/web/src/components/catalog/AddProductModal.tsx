import { useState } from "react";
import { Plus, X, PackagePlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, ApiError } from "../../lib/api-client";

export function AddProductModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Running Shoes");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("Standard");
  const [priceInr, setPriceInr] = useState("1299");
  const [costInr, setCostInr] = useState("650");
  const [stock, setStock] = useState("50");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const priceMinor = Math.round(parseFloat(priceInr) * 100);
      const costMinor = Math.round(parseFloat(costInr) * 100);
      const availableQuantity = parseInt(stock, 10);

      return apiPost("/catalog/products", {
        name,
        description,
        category,
        variants: [
          {
            sku: sku || `SKU-${Date.now()}`,
            title,
            priceMinor,
            costMinor,
            currency: "INR",
            inventory: {
              availableQuantity,
            },
          },
        ],
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["readiness"] });
      setOpen(false);
      setName("");
      setDescription("");
      setSku("");
      setErrorMsg(null);
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to create product.");
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
      >
        <Plus size={16} />
        Add Product
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                  <PackagePlus size={20} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Add New Product</h3>
                  <p className="text-xs text-ink-muted">Create a catalog item ready for agent-commerce</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-subtle hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            {errorMsg && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-ink-muted">Product Name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Velocity Carbon Running Shoes"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted">Category</label>
                <input
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Running Shoes, Apparel"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted">SKU</label>
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="Auto-generated if blank"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Variant Title</label>
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Size 10 / Midnight Black"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Price (₹)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="1"
                    value={priceInr}
                    onChange={(e) => setPriceInr(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Cost (₹)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={costInr}
                    onChange={(e) => setCostInr(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted">Initial Stock</label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted">Description (Optional)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Details and technical specifications for buyer agents..."
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-subtle"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {createMutation.isPending ? "Creating..." : "Save Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
