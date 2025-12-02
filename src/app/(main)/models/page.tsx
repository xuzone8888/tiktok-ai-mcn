"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search,
  Filter,
  Users,
  Sparkles,
  TrendingUp,
  Coins,
  RefreshCw,
  PackageOpen,
  Star,
} from "lucide-react";
import { ModelPreviewCard, HireDialog } from "@/components/models";
import { getMarketplaceModels, type PublicModel } from "@/lib/actions/models";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AIModel } from "@/types/model";

// ============================================================================
// Types & Constants
// ============================================================================

type ModelWithContract = PublicModel & {
  has_active_contract?: boolean;
};

const categories = [
  { id: "all", label: "All", icon: Sparkles },
  { id: "fashion", label: "Fashion", icon: Star },
  { id: "beauty", label: "Beauty", icon: Star },
  { id: "fitness", label: "Fitness", icon: Star },
  { id: "lifestyle", label: "Lifestyle", icon: Star },
  { id: "tech", label: "Tech", icon: Star },
  { id: "food", label: "Food", icon: Star },
];

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ 
  hasFilters, 
  onClearFilters 
}: { 
  hasFilters: boolean; 
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-r from-tiktok-cyan/20 to-tiktok-pink/20 blur-3xl" />
        <PackageOpen className="relative h-24 w-24 text-muted-foreground/30" />
      </div>
      
      {hasFilters ? (
        <>
          <h3 className="text-xl font-semibold mb-2">No models match your criteria</h3>
          <p className="text-muted-foreground max-w-sm mb-6">
            Try adjusting your search terms or filters to find what you&apos;re looking for.
          </p>
          <Button 
            variant="outline" 
            onClick={onClearFilters}
            className="border-border/50 hover:border-tiktok-cyan/50"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Clear All Filters
          </Button>
        </>
      ) : (
        <>
          <h3 className="text-xl font-semibold mb-2">No models available yet</h3>
          <p className="text-muted-foreground max-w-sm">
            The model marketplace is empty. Please check back later or contact support.
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden animate-pulse"
        >
          <div className="aspect-[3/4] bg-gradient-to-br from-muted/50 to-muted/30" />
          <div className="p-4 space-y-3">
            <div className="h-4 bg-muted/50 rounded w-3/4" />
            <div className="h-10 bg-muted/50 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function ModelsPage() {
  const { toast } = useToast();
  
  // Data state
  const [models, setModels] = useState<ModelWithContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [userCredits, setUserCredits] = useState(0);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  
  // Filter state
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrending, setShowTrending] = useState(false);
  const [showFeatured, setShowFeatured] = useState(false);
  
  // Dialog state
  const [selectedModel, setSelectedModel] = useState<PublicModel | null>(null);
  const [hireDialogOpen, setHireDialogOpen] = useState(false);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMarketplaceModels({
        category: selectedCategory !== "all" ? selectedCategory : undefined,
        trending: showTrending || undefined,
        featured: showFeatured || undefined,
        search: searchQuery.trim().length >= 2 ? searchQuery : undefined,
        limit: 100,
      });

      if (result.success && result.data) {
        setModels(result.data.models);
        console.log(`[Models Page] Loaded ${result.data.models.length} models from Supabase`);
      } else {
        console.error("[Models Page] Failed to fetch:", result.error);
        toast({
          variant: "destructive",
          title: "加载失败",
          description: result.error || "无法获取模特列表",
        });
        setModels([]);
      }
    } catch (error) {
      console.error("[Models Page] Error:", error);
      toast({
        variant: "destructive",
        title: "加载失败",
        description: "网络错误，请重试",
      });
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, showTrending, showFeatured, searchQuery, toast]);

  const fetchUserInfo = async () => {
    try {
      const response = await fetch("/api/user/credits");
      if (response.ok) {
        const data = await response.json();
        setUserCredits(data.credits);
        if (data.userId) {
          setUserId(data.userId);
        }
      }
    } catch (error) {
      console.error("Failed to fetch user info:", error);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchUserInfo();
  }, [fetchModels]);

  // ============================================================================
  // Local Filtering (for instant feedback)
  // ============================================================================

  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      if (!searchQuery || searchQuery.trim().length < 2) return true;
      const query = searchQuery.toLowerCase();
      return (
        model.name.toLowerCase().includes(query) ||
        model.category.toLowerCase().includes(query) ||
        model.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [models, searchQuery]);

  const hasFilters = selectedCategory !== "all" || showTrending || showFeatured || searchQuery.length > 0;

  const clearFilters = () => {
    setSelectedCategory("all");
    setShowTrending(false);
    setShowFeatured(false);
    setSearchQuery("");
  };

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleHire = (model: PublicModel) => {
    setSelectedModel(model);
    setHireDialogOpen(true);
  };

  const handleHireSuccess = (modelId: string, newBalance: number) => {
    setUserCredits(newBalance);
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? { ...m, has_active_contract: true } : m
      )
    );
    toast({
      title: "🎉 签约成功！",
      description: "模特已加入您的团队",
    });
  };

  const handleManage = () => {
    window.location.href = "/team";
  };

  // Convert PublicModel to AIModel for HireDialog
  const selectedModelAsAIModel: AIModel | null = selectedModel
    ? {
        id: selectedModel.id,
        name: selectedModel.name,
        description: selectedModel.description || "",
        avatar_url: selectedModel.avatar_url,
        sample_images: selectedModel.avatar_url ? [selectedModel.avatar_url] : [],
        sample_videos: selectedModel.demo_video_url ? [selectedModel.demo_video_url] : [],
        style_tags: selectedModel.tags,
        category: selectedModel.category,
        gender: selectedModel.gender || "neutral",
        is_active: true,
        is_featured: selectedModel.is_featured,
        is_trending: selectedModel.is_trending,
        rating: selectedModel.rating,
        price_daily: Math.round(selectedModel.base_price / 30),
        price_weekly: Math.round(selectedModel.base_price / 4),
        price_monthly: selectedModel.base_price,
        price_yearly: selectedModel.base_price * 10,
        total_rentals: selectedModel.total_rentals,
        total_generations: selectedModel.total_generations,
        created_at: selectedModel.created_at,
        updated_at: selectedModel.created_at,
      }
    : null;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-tiktok-text">Model Market</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            Discover top AI talents and build your creative team
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={fetchModels}
            disabled={loading}
            className="border-border/50 hover:border-tiktok-cyan/50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-tiktok-cyan/10 to-tiktok-pink/10 border border-border/50">
            <Coins className="h-5 w-5 text-tiktok-cyan" />
            <span className="font-bold">{userCredits.toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">Credits</span>
          </div>
        </div>
      </div>

      {/* Search and Quick Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search by name, style, category..." 
            className="pl-10 bg-muted/50 border-border/50 focus:border-tiktok-cyan/50"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <Button 
          variant={showTrending ? "default" : "outline"} 
          className={cn(
            "transition-all",
            showTrending 
              ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold" 
              : "border-border/50 hover:border-tiktok-cyan/50 hover:bg-tiktok-cyan/5"
          )}
          onClick={() => setShowTrending(!showTrending)}
        >
          <TrendingUp className="mr-2 h-4 w-4" />
          Trending
        </Button>
        
        <Button 
          variant={showFeatured ? "default" : "outline"} 
          className={cn(
            "transition-all",
            showFeatured 
              ? "bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold" 
              : "border-border/50 hover:border-amber-500/50 hover:bg-amber-500/5"
          )}
          onClick={() => setShowFeatured(!showFeatured)}
        >
          <Star className="mr-2 h-4 w-4" />
          Featured
        </Button>
        
        <Button variant="outline" className="border-border/50 hover:bg-white/5">
          <Filter className="mr-2 h-4 w-4" />
          Advanced
        </Button>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <Button
            key={category.id}
            variant={selectedCategory === category.id ? "default" : "outline"}
            size="sm"
            className={cn(
              "transition-all",
              selectedCategory === category.id 
                ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold shadow-lg shadow-tiktok-cyan/20"
                : "border-border/50 hover:bg-white/5 hover:border-tiktok-cyan/30"
            )}
            onClick={() => setSelectedCategory(category.id)}
          >
            {category.label}
          </Button>
        ))}
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-6 py-3 px-5 rounded-xl bg-gradient-to-r from-white/5 to-white/[0.02] border border-border/50">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-tiktok-cyan" />
          <span className="text-sm">
            <span className="font-bold text-white">{filteredModels.length}</span>
            <span className="text-muted-foreground ml-1">models available</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-tiktok-pink" />
          <span className="text-sm">
            <span className="font-bold text-white">
              {filteredModels.filter((m) => m.has_active_contract).length}
            </span>
            <span className="text-muted-foreground ml-1">in your team</span>
          </span>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : filteredModels.length === 0 ? (
        <EmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredModels.map((model) => (
            <ModelPreviewCard
              key={model.id}
              model={model}
              hasActiveContract={model.has_active_contract}
              onHire={() => handleHire(model)}
              onManage={handleManage}
            />
          ))}
        </div>
      )}

      {/* Hire Dialog */}
      {selectedModelAsAIModel && (
        <HireDialog
          model={selectedModelAsAIModel}
          open={hireDialogOpen}
          onOpenChange={setHireDialogOpen}
          userCredits={userCredits}
          userId={userId}
          onHireSuccess={handleHireSuccess}
        />
      )}
    </div>
  );
}
