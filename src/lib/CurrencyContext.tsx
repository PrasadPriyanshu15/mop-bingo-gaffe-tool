"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { compileFormula, formatCredits, formatCurrency } from "./currency";

export type CurrencyMode = "credit" | "currency";

interface CurrencyValue {
  /** Active display unit for every amount in the tool. */
  mode: CurrencyMode;
  setMode: (m: CurrencyMode) => void;
  /** The raw credit→currency formula text (e.g. "credit/100"). */
  formula: string;
  setFormula: (f: string) => void;
  /** True when `formula` compiles to a usable converter. */
  formulaValid: boolean;
  /**
   * Format a credit amount for display in the active mode: plain grouped
   * credits, or "$…" currency when in currency mode with a valid formula.
   */
  fmt: (credits: number) => string;
  /**
   * Always format as currency ("$…") regardless of the active mode, or return
   * null if the formula is invalid. Used for the live preview in the setup UI.
   */
  toCurrency: (credits: number) => string | null;
}

const DEFAULT_FORMULA = "credit/100";
const STORAGE_KEY = "mop-gaffe-currency";

const Ctx = createContext<CurrencyValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<CurrencyMode>("credit");
  const [formula, setFormula] = useState(DEFAULT_FORMULA);

  // Restore the last-used formula/mode (per browser) so the conversion set up
  // for a game survives a reload. Runs once on mount (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { mode?: CurrencyMode; formula?: string };
      if (saved.formula != null) setFormula(saved.formula);
      if (saved.mode === "credit" || saved.mode === "currency") setMode(saved.mode);
    } catch {
      /* ignore malformed / unavailable storage */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, formula }));
    } catch {
      /* ignore */
    }
  }, [mode, formula]);

  const convert = useMemo(() => compileFormula(formula), [formula]);
  const formulaValid = convert != null;

  // If the formula becomes invalid, fall back to showing credits so amounts are
  // never rendered wrong (the toggle back to currency is re-enabled on a fix).
  useEffect(() => {
    if (!formulaValid && mode === "currency") setMode("credit");
  }, [formulaValid, mode]);

  const fmt = useCallback(
    (credits: number) =>
      mode === "currency" && convert
        ? formatCurrency(credits, convert)
        : formatCredits(credits),
    [mode, convert]
  );

  const toCurrency = useCallback(
    (credits: number) => (convert ? formatCurrency(credits, convert) : null),
    [convert]
  );

  const value = useMemo<CurrencyValue>(
    () => ({ mode, setMode, formula, setFormula, formulaValid, fmt, toCurrency }),
    [mode, formula, formulaValid, fmt, toCurrency]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Access the credit/currency display state. Falls back to a credits-only
 * formatter if used outside a provider, so no component can crash.
 */
export function useCurrency(): CurrencyValue {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    mode: "credit",
    setMode: () => {},
    formula: DEFAULT_FORMULA,
    setFormula: () => {},
    formulaValid: true,
    fmt: formatCredits,
    toCurrency: () => null,
  };
}
