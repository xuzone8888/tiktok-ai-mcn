"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Package,
  Upload,
  Search,
  Grid3X3,
  List,
  Plus,
  Image as ImageIcon,
  Video,
  FileText,
  MoreVertical,
  Download,
  Trash2,
  Edit,
  Eye,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// 模拟素材数据
const mockAssets = [
  {
    id: "1",
    name: "夏季新品展示图",
    type: "image",
    thumbnail: "/api/placeholder/300/200",
    size: "2.4 MB",
    uploadedAt: "2024-01-15",
    category: "产品图",
  },
  {
    id: "2",
    name: "品牌介绍视频",
    type: "video",
    thumbnail: "/api/placeholder/300/200",
    size: "45.2 MB",
    uploadedAt: "2024-01-14",
    category: "视频素材",
  },
  {
    id: "3",
    name: "产品文案模板",
    type: "document",
    thumbnail: "/api/placeholder/300/200",
    size: "128 KB",
    uploadedAt: "2024-01-13",
    category: "文案",
  },
  {
    id: "4",
    name: "秋季穿搭素材",
    type: "image",
    thumbnail: "/api/placeholder/300/200",
    size: "3.1 MB",
    uploadedAt: "2024-01-12",
    category: "产品图",
  },
  {
    id: "5",
    name: "美妆产品展示",
    type: "image",
    thumbnail: "/api/placeholder/300/200",
    size: "1.8 MB",
    uploadedAt: "2024-01-11",
    category: "产品图",
  },
  {
    id: "6",
    name: "运动装备介绍",
    type: "video",
    thumbnail: "/api/placeholder/300/200",
    size: "32.5 MB",
    uploadedAt: "2024-01-10",
    category: "视频素材",
  },
];

const categories = ["全部", "产品图", "视频素材", "文案", "背景音乐"];

export default function AssetsPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("全部");

  const filteredAssets = mockAssets.filter((asset) => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "全部" || asset.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image":
        return <ImageIcon className="h-4 w-4" />;
      case "video":
        return <Video className="h-4 w-4" />;
      case "document":
        return <FileText className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "image":
        return "text-tiktok-cyan bg-tiktok-cyan/10";
      case "video":
        return "text-tiktok-pink bg-tiktok-pink/10";
      case "document":
        return "text-amber-400 bg-amber-400/10";
      default:
        return "text-gray-400 bg-gray-400/10";
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-tiktok-text">选品中心</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            管理您的产品素材、视频和文案资源
          </p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90">
          <Upload className="h-4 w-4" />
          上传素材
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "总素材数", value: "1,234", icon: Package, color: "cyan" },
          { label: "图片素材", value: "856", icon: ImageIcon, color: "pink" },
          { label: "视频素材", value: "234", icon: Video, color: "cyan" },
          { label: "文案模板", value: "144", icon: FileText, color: "pink" },
        ].map((stat, index) => (
          <Card key={index} className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex items-center gap-4 p-6">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-tiktok-${stat.color}/10`}>
                <stat.icon className={`h-6 w-6 text-tiktok-${stat.color}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters and Search */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索素材..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-background/50 border-border/50"
              />
            </div>

            {/* Categories */}
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(category)}
                  className={selectedCategory === category 
                    ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink" 
                    : "border-border/50 hover:border-tiktok-cyan/50"
                  }
                >
                  {category}
                </Button>
              ))}
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 border border-border/50 rounded-lg p-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Assets Grid/List */}
      {viewMode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* Upload Card */}
          <Card className="group cursor-pointer border-2 border-dashed border-border/50 bg-card/30 hover:border-tiktok-cyan/50 hover:bg-card/50 transition-all">
            <CardContent className="flex flex-col items-center justify-center h-[200px] gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tiktok-cyan/10 group-hover:bg-tiktok-cyan/20 transition-colors">
                <Plus className="h-8 w-8 text-tiktok-cyan" />
              </div>
              <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                上传新素材
              </p>
            </CardContent>
          </Card>

          {/* Asset Cards */}
          {filteredAssets.map((asset) => (
            <Card key={asset.id} className="group overflow-hidden border-border/50 bg-card/50 hover:border-tiktok-cyan/30 transition-all">
              <div className="relative aspect-[4/3] bg-gradient-to-br from-background to-background/50">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`flex h-16 w-16 items-center justify-center rounded-xl ${getTypeColor(asset.type)}`}>
                    {getTypeIcon(asset.type)}
                  </div>
                </div>
                {/* Hover Actions */}
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="secondary" className="h-9 w-9">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="secondary" className="h-9 w-9">
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="secondary" className="h-9 w-9">
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {asset.size} · {asset.uploadedAt}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Eye className="h-4 w-4 mr-2" />
                        预览
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Download className="h-4 w-4 mr-2" />
                        下载
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Edit className="h-4 w-4 mr-2" />
                        编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-400">
                        <Trash2 className="h-4 w-4 mr-2" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-xs">
                    {getTypeIcon(asset.type)}
                    {asset.category}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {filteredAssets.map((asset) => (
                <div key={asset.id} className="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${getTypeColor(asset.type)}`}>
                    {getTypeIcon(asset.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{asset.name}</p>
                    <p className="text-sm text-muted-foreground">{asset.category}</p>
                  </div>
                  <div className="text-sm text-muted-foreground hidden md:block">
                    {asset.size}
                  </div>
                  <div className="text-sm text-muted-foreground hidden lg:block">
                    {asset.uploadedAt}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Download className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Edit className="h-4 w-4 mr-2" />
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-400">
                          <Trash2 className="h-4 w-4 mr-2" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}





