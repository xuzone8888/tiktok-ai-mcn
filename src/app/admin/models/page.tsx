"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Upload,
  User,
  UserCircle,
  Loader2,
  Key,
  Shield,
  Star,
  TrendingUp,
  Video,
  Image as ImageIcon,
  X,
  CheckCircle2,
  AlertCircle,
  FileVideo,
  Camera,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  validateFile,
  generateFileName,
  STORAGE_BUCKETS,
  type StorageBucket,
} from "@/lib/storage";

// ============================================================================
// 类型定义
// ============================================================================

interface AdminModel {
  id: string;
  name: string;
  description?: string;
  avatar_url: string | null;
  sample_images: string[];
  sample_videos?: string[];
  category: string;
  style_tags: string[];
  gender: "male" | "female" | "neutral" | null;
  age_range?: string;
  price_daily: number;
  price_weekly: number;
  price_monthly: number;
  price_yearly: number;
  rating: number;
  total_rentals: number;
  total_generations: number;
  is_active: boolean;
  is_featured: boolean;
  is_trending: boolean;
  trigger_word?: string;
  created_at: string;
}

interface FormData {
  name: string;
  description: string;
  category: string;
  gender: "male" | "female" | "neutral";
  age_range: string;
  style_tags: string[];
  price_daily: number;
  price_weekly: number;
  price_monthly: number;
  price_yearly: number;
  is_active: boolean;
  is_featured: boolean;
  is_trending: boolean;
  trigger_word: string;
  // File uploads
  avatar_file: File | null;
  avatar_url: string;
  avatar_preview: string;
  demo_file: File | null;
  demo_url: string;
  demo_preview: string;
}

const CATEGORIES = [
  "Fashion",
  "Beauty",
  "Fitness",
  "Tech",
  "Lifestyle",
  "Food",
  "Travel",
  "Entertainment",
];

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "neutral", label: "Neutral" },
];

const INITIAL_FORM_DATA: FormData = {
  name: "",
  description: "",
  category: "Fashion",
  gender: "female",
  age_range: "20-25",
  style_tags: [],
  price_daily: 100,
  price_weekly: 500,
  price_monthly: 1500,
  price_yearly: 12000,
  is_active: true,
  is_featured: false,
  is_trending: false,
  trigger_word: "",
  avatar_file: null,
  avatar_url: "",
  avatar_preview: "",
  demo_file: null,
  demo_url: "",
  demo_preview: "",
};

// ============================================================================
// File Upload Component
// ============================================================================

interface FileUploadProps {
  label: string;
  accept: string;
  bucket: StorageBucket;
  currentUrl: string;
  preview: string;
  onFileSelect: (file: File | null, preview: string) => void;
  onUrlChange: (url: string) => void;
  icon: React.ReactNode;
  description?: string;
}

function FileUpload({
  label,
  accept,
  bucket,
  currentUrl,
  preview,
  onFileSelect,
  onUrlChange,
  icon,
  description,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadMode, setUploadMode] = useState<"file" | "url">("file");
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (file: File | null) => {
    if (!file) {
      onFileSelect(null, "");
      setError(null);
      return;
    }

    const validation = validateFile(file, bucket);
    if (!validation.valid) {
      setError(validation.error || "Invalid file");
      return;
    }

    setError(null);
    const objectUrl = URL.createObjectURL(file);
    onFileSelect(file, objectUrl);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file);
  };

  const isVideo = accept.includes("video");
  const hasPreview = preview || currentUrl;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          {icon}
          {label}
        </Label>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setUploadMode("file")}
            className={cn(
              "px-2 py-1 rounded",
              uploadMode === "file"
                ? "bg-tiktok-cyan/20 text-tiktok-cyan"
                : "text-muted-foreground hover:text-white"
            )}
          >
            Upload
          </button>
          <button
            type="button"
            onClick={() => setUploadMode("url")}
            className={cn(
              "px-2 py-1 rounded",
              uploadMode === "url"
                ? "bg-tiktok-cyan/20 text-tiktok-cyan"
                : "text-muted-foreground hover:text-white"
            )}
          >
            URL
          </button>
        </div>
      </div>

      {uploadMode === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-xl transition-all cursor-pointer",
            dragOver
              ? "border-tiktok-cyan bg-tiktok-cyan/10"
              : "border-white/20 hover:border-white/40",
            hasPreview ? "p-2" : "p-6"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            className="hidden"
          />

          {hasPreview ? (
            <div className="relative group">
              {isVideo ? (
                <video
                  src={preview || currentUrl}
                  className="w-full h-32 object-cover rounded-lg"
                  muted
                />
              ) : (
                <img
                  src={preview || currentUrl}
                  alt="Preview"
                  className="w-full h-32 object-cover rounded-lg"
                />
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                <span className="text-white text-sm">Click to change</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFileSelect(null, "");
                  onUrlChange("");
                }}
                className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full text-white hover:bg-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center text-muted-foreground">
              <Upload className="h-8 w-8 mb-2" />
              <p className="text-sm font-medium">Drop file here or click to upload</p>
              {description && <p className="text-xs mt-1">{description}</p>}
            </div>
          )}
        </div>
      ) : (
        <Input
          value={currentUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://..."
          className="bg-black/30 border-white/10"
        />
      )}

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Admin Models Page
// ============================================================================

export default function AdminModelsPage() {
  const { toast } = useToast();

  // 列表状态
  const [models, setModels] = useState<AdminModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Dialog 状态
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<AdminModel | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // 表单状态
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_DATA);
  const [newTag, setNewTag] = useState("");

  // ================================================================
  // 数据获取
  // ================================================================

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/models?include_trigger_word=true");
      const data = await res.json();

      if (data.success) {
        setModels(data.data.models || []);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
      toast({
        variant: "destructive",
        title: "获取模特列表失败",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // ================================================================
  // 过滤逻辑
  // ================================================================

  const filteredModels = models.filter((model) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !model.name.toLowerCase().includes(query) &&
        !model.category.toLowerCase().includes(query) &&
        !model.trigger_word?.toLowerCase().includes(query)
      ) {
        return false;
      }
    }
    if (filterCategory !== "all" && model.category !== filterCategory) return false;
    if (filterStatus === "active" && !model.is_active) return false;
    if (filterStatus === "inactive" && model.is_active) return false;
    return true;
  });

  // ================================================================
  // 表单处理
  // ================================================================

  const handleOpenCreate = () => {
    setEditingModel(null);
    setFormData(INITIAL_FORM_DATA);
    setShowEditDialog(true);
  };

  const handleOpenEdit = (model: AdminModel) => {
    setEditingModel(model);
    setFormData({
      name: model.name,
      description: model.description || "",
      category: model.category,
      gender: model.gender || "female",
      age_range: model.age_range || "20-25",
      style_tags: model.style_tags || [],
      price_daily: model.price_daily,
      price_weekly: model.price_weekly,
      price_monthly: model.price_monthly,
      price_yearly: model.price_yearly,
      is_active: model.is_active,
      is_featured: model.is_featured,
      is_trending: model.is_trending,
      trigger_word: model.trigger_word || "",
      avatar_file: null,
      avatar_url: model.avatar_url || "",
      avatar_preview: "",
      demo_file: null,
      demo_url: model.sample_videos?.[0] || "",
      demo_preview: "",
    });
    setShowEditDialog(true);
  };

  const handleAddTag = () => {
    const tag = newTag.trim();
    if (tag && !formData.style_tags.includes(tag)) {
      setFormData((prev) => ({
        ...prev,
        style_tags: [...prev.style_tags, tag],
      }));
      setNewTag("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      style_tags: prev.style_tags.filter((t) => t !== tag),
    }));
  };

  // ================================================================
  // 文件上传 (使用真实的 Supabase Storage)
  // ================================================================

  const uploadFileToStorage = async (
    file: File,
    bucket: string,
    path: string
  ): Promise<string> => {
    const formDataUpload = new FormData();
    formDataUpload.append("file", file);
    formDataUpload.append("bucket", bucket);
    formDataUpload.append("path", path);

    const response = await fetch("/api/admin/upload", {
      method: "POST",
      body: formDataUpload,
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Upload failed");
    }

    return result.data.publicUrl;
  };

  const uploadFiles = async (modelId: string): Promise<{ avatarUrl: string; demoUrl: string }> => {
    let avatarUrl = formData.avatar_url;
    let demoUrl = formData.demo_url;

    // 上传头像
    if (formData.avatar_file) {
      setUploadProgress("Uploading avatar...");
      const fileName = generateFileName(formData.avatar_file.name, "avatar");
      const path = `${modelId}/${fileName}`;
      
      // 验证文件
      const validation = validateFile(formData.avatar_file, STORAGE_BUCKETS.MODEL_AVATARS);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid avatar file");
      }

      avatarUrl = await uploadFileToStorage(
        formData.avatar_file,
        STORAGE_BUCKETS.MODEL_AVATARS,
        path
      );
    }

    // 上传视频
    if (formData.demo_file) {
      setUploadProgress("Uploading demo video...");
      const fileName = generateFileName(formData.demo_file.name, "demo");
      const path = `${modelId}/${fileName}`;
      
      // 验证文件
      const validation = validateFile(formData.demo_file, STORAGE_BUCKETS.MODEL_DEMOS);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid video file");
      }

      demoUrl = await uploadFileToStorage(
        formData.demo_file,
        STORAGE_BUCKETS.MODEL_DEMOS,
        path
      );
    }

    return { avatarUrl, demoUrl };
  };

  // ================================================================
  // 提交表单
  // ================================================================

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ variant: "destructive", title: "请输入模特名称" });
      return;
    }

    setIsSaving(true);
    setUploadProgress(null);

    try {
      // 生成临时 ID (新建模特时)
      const modelId = editingModel?.id || `model-${Date.now()}`;

      // 上传文件
      const { avatarUrl, demoUrl } = await uploadFiles(modelId);

      setUploadProgress("Saving model data...");

      // 准备提交数据
      const payload = {
        id: editingModel?.id,
        name: formData.name.trim(),
        description: formData.description.trim(),
        category: formData.category,
        gender: formData.gender,
        age_range: formData.age_range,
        style_tags: formData.style_tags,
        price_daily: formData.price_daily,
        price_weekly: formData.price_weekly,
        price_monthly: formData.price_monthly,
        price_yearly: formData.price_yearly,
        is_active: formData.is_active,
        is_featured: formData.is_featured,
        is_trending: formData.is_trending,
        trigger_word: formData.trigger_word.trim(),
        avatar_url: avatarUrl,
        sample_video_url: demoUrl,
      };

      const res = await fetch("/api/admin/models", {
        method: editingModel ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: editingModel ? "模特信息已更新" : "模特创建成功",
          description: `${formData.name} 已保存`,
        });
        setShowEditDialog(false);
        fetchModels();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast({
        variant: "destructive",
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setIsSaving(false);
      setUploadProgress(null);
    }
  };

  // ================================================================
  // 快捷操作
  // ================================================================

  const handleToggleActive = async (model: AdminModel) => {
    try {
      const res = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: model.id,
          is_active: !model.is_active,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: model.is_active ? "模特已下架" : "模特已上架",
        });
        fetchModels();
      }
    } catch (error) {
      console.error("Toggle error:", error);
      toast({ variant: "destructive", title: "操作失败" });
    }
  };

  const handleDelete = async (model: AdminModel) => {
    if (!confirm(`确定要删除模特 "${model.name}" 吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/models?id=${model.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast({ title: "模特已删除" });
        fetchModels();
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast({ variant: "destructive", title: "删除失败" });
    }
  };

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Models Management</h1>
          <p className="text-muted-foreground">
            管理 AI 模特库，包含 Trigger Word 等敏感配置
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          className="bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add New Model
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search models, trigger words..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-black/30 border-white/10"
                />
              </div>
            </div>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[150px] bg-black/30 border-white/10">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-black/95 border-white/10">
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px] bg-black/30 border-white/10">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-black/95 border-white/10">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <User className="h-12 w-12 mb-4 opacity-50" />
              <p>No models found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-[300px]">Model</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Key className="h-3.5 w-3.5 text-red-400" />
                      Trigger Word
                    </div>
                  </TableHead>
                  <TableHead>Price (Monthly)</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModels.map((model) => (
                  <TableRow
                    key={model.id}
                    className="border-border/50 hover:bg-white/5"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-black/30 overflow-hidden flex-shrink-0">
                          {model.avatar_url ? (
                            <img
                              src={model.avatar_url}
                              alt={model.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <User className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{model.name}</p>
                            {model.is_featured && (
                              <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                            )}
                            {model.is_trending && (
                              <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {model.gender} · {model.age_range}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="px-2 py-1 rounded-full text-xs bg-white/10">
                        {model.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      {model.trigger_word ? (
                        <code className="px-2 py-1 rounded bg-red-500/10 text-red-400 text-xs font-mono border border-red-500/20">
                          {model.trigger_word}
                        </code>
                      ) : (
                        <span className="text-muted-foreground text-xs">Not set</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-amber-400">
                        {model.price_monthly} pts
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        <div>{model.total_rentals} rentals</div>
                        <div>{model.total_generations} generations</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={model.is_active}
                          onCheckedChange={() => handleToggleActive(model)}
                          className="data-[state=checked]:bg-green-500 scale-90"
                        />
                        <span
                          className={cn(
                            "text-xs",
                            model.is_active ? "text-green-400" : "text-muted-foreground"
                          )}
                        >
                          {model.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-black/95 border-white/10"
                        >
                          <DropdownMenuItem onClick={() => handleOpenEdit(model)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(model)}>
                            {model.is_active ? (
                              <>
                                <EyeOff className="h-4 w-4 mr-2" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <Eye className="h-4 w-4 mr-2" />
                                Activate
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem
                            onClick={() => handleDelete(model)}
                            className="text-red-400 focus:text-red-400"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-3xl bg-black/95 border-white/10 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCircle className="h-5 w-5 text-red-400" />
              {editingModel ? "Edit Model" : "Create New Model"}
            </DialogTitle>
            <DialogDescription>
              {editingModel
                ? "修改模特信息，包括敏感的 Trigger Word 配置"
                : "添加新的 AI 模特到模特库"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Media Upload Row */}
            <div className="grid grid-cols-2 gap-6">
              {/* Avatar Upload */}
              <FileUpload
                label="Avatar Image"
                accept="image/jpeg,image/png,image/webp,image/gif"
                bucket={STORAGE_BUCKETS.MODEL_AVATARS}
                currentUrl={formData.avatar_url}
                preview={formData.avatar_preview}
                onFileSelect={(file, preview) =>
                  setFormData((prev) => ({
                    ...prev,
                    avatar_file: file,
                    avatar_preview: preview,
                  }))
                }
                onUrlChange={(url) =>
                  setFormData((prev) => ({ ...prev, avatar_url: url }))
                }
                icon={<Camera className="h-3.5 w-3.5" />}
                description="JPG, PNG, WebP (Max 5MB)"
              />

              {/* Demo Video Upload */}
              <FileUpload
                label="Demo Video"
                accept="video/mp4,video/webm,video/quicktime"
                bucket={STORAGE_BUCKETS.MODEL_DEMOS}
                currentUrl={formData.demo_url}
                preview={formData.demo_preview}
                onFileSelect={(file, preview) =>
                  setFormData((prev) => ({
                    ...prev,
                    demo_file: file,
                    demo_preview: preview,
                  }))
                }
                onUrlChange={(url) =>
                  setFormData((prev) => ({ ...prev, demo_url: url }))
                }
                icon={<FileVideo className="h-3.5 w-3.5" />}
                description="MP4, WebM (Max 100MB)"
              />
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Model Name *
                </Label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g., Sophia"
                  className="bg-black/30 border-white/10"
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Category
                </Label>
                <Select
                  value={formData.category}
                  onValueChange={(v) =>
                    setFormData((prev) => ({ ...prev, category: v }))
                  }
                >
                  <SelectTrigger className="bg-black/30 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black/95 border-white/10">
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Gender
                </Label>
                <Select
                  value={formData.gender}
                  onValueChange={(v: "male" | "female" | "neutral") =>
                    setFormData((prev) => ({ ...prev, gender: v }))
                  }
                >
                  <SelectTrigger className="bg-black/30 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black/95 border-white/10">
                    {GENDERS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Description
              </Label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Model description..."
                rows={3}
                className="bg-black/30 border-white/10 resize-none"
              />
            </div>

            {/* Trigger Word - 敏感字段 */}
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
              <Label className="text-xs text-red-400 mb-2 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Trigger Word (Confidential) *
              </Label>
              <Input
                value={formData.trigger_word}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, trigger_word: e.target.value }))
                }
                placeholder="e.g., @sophia_v1"
                className="bg-black/30 border-red-500/30 font-mono"
              />
              <p className="text-xs text-red-400/70 mt-2">
                ⚠️ 此字段仅在 Admin 后台可见，不会暴露给前端用户。用于 Sora API 的 Prompt 注入。
              </p>
            </div>

            {/* Style Tags */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Style Tags (逗号分隔)
              </Label>
              <div className="flex gap-2 mb-2 flex-wrap min-h-[32px]">
                {formData.style_tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 rounded-full bg-tiktok-cyan/20 text-tiktok-cyan text-xs flex items-center gap-1"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                    if (e.key === ",") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="e.g., Cyberpunk, Fashion, Street"
                  className="bg-black/30 border-white/10"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddTag}
                  className="border-white/20"
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Pricing */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Pricing (Credits)
              </Label>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Daily</span>
                  <Input
                    type="number"
                    value={formData.price_daily}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        price_daily: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="bg-black/30 border-white/10"
                  />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Weekly</span>
                  <Input
                    type="number"
                    value={formData.price_weekly}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        price_weekly: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="bg-black/30 border-white/10"
                  />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Monthly</span>
                  <Input
                    type="number"
                    value={formData.price_monthly}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        price_monthly: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="bg-black/30 border-white/10"
                  />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Yearly</span>
                  <Input
                    type="number"
                    value={formData.price_yearly}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        price_yearly: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="bg-black/30 border-white/10"
                  />
                </div>
              </div>
            </div>

            {/* Flags */}
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) =>
                    setFormData((prev) => ({ ...prev, is_active: v }))
                  }
                  className="data-[state=checked]:bg-green-500"
                />
                <Label className="text-sm">Active (上架)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_featured}
                  onCheckedChange={(v) =>
                    setFormData((prev) => ({ ...prev, is_featured: v }))
                  }
                  className="data-[state=checked]:bg-amber-500"
                />
                <Label className="text-sm flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-amber-400" />
                  Featured
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_trending}
                  onCheckedChange={(v) =>
                    setFormData((prev) => ({ ...prev, is_trending: v }))
                  }
                  className="data-[state=checked]:bg-green-500"
                />
                <Label className="text-sm flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                  Trending
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              disabled={isSaving}
              className="border-white/20"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold min-w-[140px]"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {uploadProgress || "Saving..."}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {editingModel ? "Update Model" : "Create Model"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
