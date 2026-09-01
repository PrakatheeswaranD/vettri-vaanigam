/**
 * One money field, used wherever a person types an amount.
 *
 * WHY THIS EXISTS
 *
 * Every money input in the console took integer PAISE and said so in
 * small grey text underneath — "Integer paise", "stored in integer
 * paise". That is the storage unit, not the unit anyone thinks in, and it
 * put a factor of 100 between what a merchant meant and what the server
 * received. On a refund form that is the difference between returning
 * ₹4,699 and returning ₹46.99, and the only thing standing between the
 * two was whether the person read the hint.
 *
 * Two smaller defects came with it, both observed rather than theorised:
 *
 * - `type="number"` changes value on MOUSE WHEEL while focused, so
 *   scrolling the page after touching a field silently rewrote an amount.
 *   A daily spending limit went from ₹10,000 to ₹1,00,000 that way during
 *   this audit. `onWheel` blurs instead.
 * - Nothing marked these as currency, so nothing lined the digits up.
 *   `tabular-nums` and a ₹ adornment make a mistyped magnitude visible.
 *
 * The value handed upward is still integer minor units. Conversion
 * happens here, once, so no caller has to remember it — and the server
 * remains the only thing that decides what an amount actually is.
 */
import { clsx } from "clsx";

export function RupeeInput({
  label,
  valueMinor,
  onChangeMinor,
  help,
  max,
  disabled,
  id,
}: {
  label: string;
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
  help?: string;
  /** Optional ceiling, in minor units. */
  max?: number;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className={clsx("text-sm font-semibold", disabled ? "text-ink-faint" : "text-ink")}>{label}</span>
      <div className="relative mt-1.5">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-faint">
          ₹
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          disabled={disabled}
          {...(max !== undefined ? { max: max / 100 } : {})}
          value={valueMinor / 100}
          onChange={(event) => {
            const rupees = Number(event.target.value);
            onChangeMinor(Number.isFinite(rupees) ? Math.max(0, Math.round(rupees * 100)) : 0);
          }}
          onWheel={(event) => event.currentTarget.blur()}
          className="w-full rounded-md border border-border bg-surface py-2 pl-7 pr-3 text-sm tabular-nums text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-surface-subtle disabled:text-ink-faint"
        />
      </div>
      {help ? <span className="mt-1 block text-xs text-ink-faint">{help}</span> : null}
    </label>
  );
}
