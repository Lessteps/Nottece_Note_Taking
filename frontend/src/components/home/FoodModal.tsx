import { Apple, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface FoodModalProps {
  open: boolean;
  mealName: string;
  onClose: () => void;
  onAddFood: (foodName: string, calories: number, macros?: string) => void;
}

const FOOD_PRESETS = [
  { name: "Pechuga de Pollo 150g", calories: 248, macros: "P 46g · C 0g · F 5g" },
  { name: "Huevos Revueltos (3 enteros)", calories: 215, macros: "P 18g · C 1g · F 15g" },
  { name: "Avena con Leche y Plátano", calories: 340, macros: "P 12g · C 60g · F 6g" },
  { name: "Arroz Blanco con Atún en Agua", calories: 390, macros: "P 35g · C 46g · F 4g" },
  { name: "Salmón a la Plancha 180g", calories: 360, macros: "P 36g · C 0g · F 22g" },
  { name: "Yogur Griego 0% con Frutos Rojos", calories: 160, macros: "P 18g · C 15g · F 0g" },
  { name: "Batido Whey Protein + Creatina", calories: 150, macros: "P 26g · C 3g · F 2g" },
  { name: "Tostada Integral con Aguacate y Pavo", calories: 280, macros: "P 16g · C 28g · F 12g" },
  { name: "Ensalada Mixta con Aceite de Oliva", calories: 140, macros: "P 2g · C 8g · F 12g" },
  { name: "Manzana verde / roja con Canela", calories: 95, macros: "P 0g · C 25g · F 0g" },
];

export function FoodModal({ open, mealName, onClose, onAddFood }: FoodModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const filtered = FOOD_PRESETS.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-[#2e2e34] bg-[#1a1a1e] p-5 shadow-2xl space-y-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#28282e] pb-3">
          <div className="flex items-center gap-2">
            <Apple size={17} className="text-accent" />
            <h4 className="text-sm font-semibold text-text">
              Añadir Alimento a <span className="text-accent font-bold">{mealName}</span>
            </h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-text transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-faint" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar alimento (ej. Manzana, Pollo, Avena...)"
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-xs text-text placeholder-faint focus:border-accent focus:outline-none transition"
          />
        </div>

        {/* Food list */}
        <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-faint">
              No se encontraron coincidencias. Presiona Enter para añadir «{query}» como personalizado.
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-lg border border-line bg-card p-2.5 transition hover:border-line-strong"
              >
                <div>
                  <div className="text-xs font-medium text-text">{item.name}</div>
                  <div className="font-mono text-[10px] text-faint">{item.macros}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onAddFood(item.name, item.calories, item.macros);
                    onClose();
                  }}
                  className="flex items-center gap-1 rounded bg-accent-soft border border-accent/40 px-2 py-1 font-mono text-[11px] font-semibold text-accent-text hover:bg-accent/20 transition"
                >
                  <Plus size={12} />
                  <span>{item.calories} kcal</span>
                </button>
              </div>
            ))
          )}
        </div>

        {query && !filtered.some((f) => f.name.toLowerCase() === query.toLowerCase()) && (
          <button
            type="button"
            onClick={() => {
              onAddFood(query, 200);
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft py-2 text-xs font-semibold text-accent hover:bg-accent/20 transition"
          >
            <Plus size={14} />
            <span>Añadir «{query}» con 200 kcal</span>
          </button>
        )}
      </div>
    </div>
  );
}

