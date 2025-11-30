"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Package,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Grid3X3,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";

interface ProductSelectorProps {
  selectedProduct: Product | null;
  onSelect: (product: Product | null) => void;
  onGoToAssets: () => void;
}

export function ProductSelector({ selectedProduct, onSelect, onGoToAssets }: ProductSelectorProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/products?status=ready");
      if (response.ok) {
        const data = await response.json();
        // 只显示已处理完成的产品
        setProducts(data.filter((p: Product) => p.status === "ready"));
      }
    } catch (error) {
      console.error("Failed to fetch products:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          选择要展示的产品（可选）
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelect(null)}
          className={cn(
            "text-xs",
            !selectedProduct && "text-tiktok-cyan"
          )}
        >
          不使用产品
        </Button>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-border/50 rounded-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 mb-3">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">暂无可用产品</p>
          <Button
            variant="link"
            size="sm"
            onClick={onGoToAssets}
            className="mt-2 text-tiktok-cyan"
          >
            上传产品
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {products.map((product) => {
            const isSelected = selectedProduct?.id === product.id;
            const hasGrid = product.processed_images?.grid_images?.length ?? 0 > 0;

            return (
              <button
                key={product.id}
                onClick={() => onSelect(product)}
                className={cn(
                  "relative group rounded-xl border overflow-hidden transition-all duration-200",
                  isSelected
                    ? "border-tiktok-cyan ring-2 ring-tiktok-cyan/30"
                    : "border-border/50 hover:border-tiktok-cyan/30"
                )}
              >
                {/* Image */}
                <div className="aspect-square bg-black/20">
                  <img
                    src={product.original_image_url}
                    alt={product.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>

                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-2 right-2 bg-tiktok-cyan rounded-full p-1">
                    <CheckCircle2 className="h-4 w-4 text-black" />
                  </div>
                )}

                {/* Grid indicator */}
                {hasGrid && (
                  <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/50 text-xs text-white">
                    <Grid3X3 className="h-3 w-3" />
                    {product.processed_images?.grid_images?.length}
                  </div>
                )}

                {/* Name */}
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-xs font-medium text-white truncate">
                    {product.name}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}



