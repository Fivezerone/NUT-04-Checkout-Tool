import { useEffect, useState } from "react";
import { ShoppingCart, Search } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { NutriBadge } from "./NutriBadge";
import { NutriFlyout } from "./NutriFlyout";
import { PRODUCTS } from "../lib/products";
import { recordView } from "../lib/db";
import type { LedgerEntry, Product } from "../lib/nutriscore";

interface StorefrontProps {
  diabetesModule: boolean;
  hypertensionModule: boolean;
  cardiovascularModule: boolean;
  onScored: (count: number) => void;
  onViewRecorded: () => void;
}

// Simulated Naivas.co.ke storefront. In the real extension a MutationObserver
// (300ms debounce) would detect product cards and inject each badge into a
// Shadow DOM root attached to the card, giving CLS 0.00.
export function Storefront({
  diabetesModule,
  hypertensionModule,
  cardiovascularModule,
  onScored,
  onViewRecorded,
}: StorefrontProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  // "Inject" badges shortly after mount to mimic async card detection.
  const [injected, setInjected] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setInjected(true);
      onScored(PRODUCTS.length);
    }, 350);
    return () => clearTimeout(t);
  }, [onScored]);

  async function handleOpen(product: Product) {
    const next = openId === product.id ? null : product.id;
    setOpenId(next);
    if (next) {
      const entry: LedgerEntry = {
        id: `${product.id}-${Date.now()}`,
        productId: product.id,
        name: product.name,
        category: product.category,
        grade: product.grade,
        sodiumMg: product.nutrients.sodiumMg,
        sugarsG: product.nutrients.sugarsG,
        satFatG: product.nutrients.satFatG,
        viewedAt: Date.now(),
      };
      await recordView(entry);
      onViewRecorded();
    }
  }

  return (
    <div className="min-h-full bg-[#f6f7f9]">
      {/* Fake host-site chrome */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-[#e4002b] px-4 py-3 text-white">
        <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>naivas</span>
        <div className="flex flex-1 items-center gap-2 rounded-md bg-white px-3 py-1.5 text-black">
          <Search size={16} className="opacity-50" aria-hidden />
          <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
            Search groceries…
          </span>
        </div>
        <ShoppingCart size={20} aria-hidden />
      </header>

      <div className="px-4 py-3">
        <p style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
          Home / Groceries / Popular this week
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-8 sm:grid-cols-3 lg:grid-cols-4">
        {PRODUCTS.map((product) => (
          <div
            key={product.id}
            className="relative flex flex-col rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5"
          >
            <div className="mb-2 aspect-square overflow-hidden rounded-lg bg-[#f2f2f2]">
              <ImageWithFallback
                src={product.imageUrl}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            </div>
            <p
              className="line-clamp-2"
              style={{ fontSize: "0.85rem", minHeight: "2.4em" }}
            >
              {product.name}
            </p>
            <p style={{ fontWeight: 700, fontSize: "0.95rem", marginTop: 4 }}>
              {product.price}
            </p>

            {/* Injected badge (Shadow-DOM equivalent) */}
            <div className="relative mt-2">
              {injected && (
                <NutriBadge
                  grade={product.grade}
                  active={openId === product.id}
                  onClick={() => handleOpen(product)}
                />
              )}
              {openId === product.id && (
                <NutriFlyout
                  product={product}
                  diabetesModule={diabetesModule}
                  hypertensionModule={hypertensionModule}
                  cardiovascularModule={cardiovascularModule}
                  onClose={() => setOpenId(null)}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
