"use client";

/**
 * ExcelUploader - Excel 批量提示词上传组件
 *
 * 功能：
 * - 下载标准 Excel 模板（2列：提示词、数量）
 * - 上传并解析 Excel 文件
 * - 显示解析结果摘要
 */

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Download,
    Upload,
    FileSpreadsheet,
    X,
    CheckCircle2,
    AlertCircle,
    Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

// 从 store 导入类型
import type { ExcelPromptRow } from "@/stores/image-batch-store";

interface ExcelUploaderProps {
    /** 解析后的数据回调 */
    onDataParsed: (data: ExcelPromptRow[]) => void;
    /** 当前已解析的数据 */
    data: ExcelPromptRow[];
    /** 清除数据回调 */
    onClear: () => void;
    /** 自定义类名 */
    className?: string;
}

/**
 * 生成并下载 Excel 模板
 */
function downloadTemplate() {
    // 创建工作簿和工作表
    const workbook = XLSX.utils.book_new();

    // 模板数据（无表头，仅含示例数据）
    const templateData = [
        ["一只可爱的橘猫在阳光下打盹", 2],
        ["未来城市夜景，霓虹灯闪烁", 3],
        ["水墨画风格的山水画", 1],
    ];

    // 创建工作表
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // 设置列宽
    worksheet["!cols"] = [
        { wch: 50 }, // 提示词列宽
        { wch: 10 }, // 数量列宽
    ];

    // 添加到工作簿
    XLSX.utils.book_append_sheet(workbook, worksheet, "批量提示词");

    // 导出文件
    XLSX.writeFile(workbook, "批量制图模板.xlsx");
}

/**
 * 解析上传的 Excel 文件
 */
async function parseExcelFile(file: File): Promise<ExcelPromptRow[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: "binary" });

                // 获取第一个工作表
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) {
                    reject(new Error("Excel 文件为空"));
                    return;
                }

                const worksheet = workbook.Sheets[sheetName];
                const jsonData: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: "",
                });

                // 解析数据（无表头）
                const results: ExcelPromptRow[] = [];
                const errors: string[] = [];

                jsonData.forEach((row, index) => {
                    // 跳过空行
                    if (!row || row.length === 0 || (!row[0] && !row[1])) {
                        return;
                    }

                    const prompt = String(row[0] || "").trim();
                    const countRaw = row[1];
                    const count = typeof countRaw === "number" ? countRaw : parseInt(String(countRaw), 10);

                    // 验证
                    if (!prompt) {
                        errors.push(`第 ${index + 1} 行：提示词不能为空`);
                        return;
                    }

                    if (isNaN(count) || count < 1) {
                        errors.push(`第 ${index + 1} 行：数量必须是正整数`);
                        return;
                    }

                    if (count > 20) {
                        errors.push(`第 ${index + 1} 行：单行数量不能超过 20`);
                        return;
                    }

                    results.push({ prompt, count });
                });

                if (errors.length > 0) {
                    reject(new Error(errors.slice(0, 3).join("\n") + (errors.length > 3 ? `\n...还有 ${errors.length - 3} 个错误` : "")));
                    return;
                }

                if (results.length === 0) {
                    reject(new Error("未找到有效的提示词数据"));
                    return;
                }

                resolve(results);
            } catch (err) {
                reject(new Error("文件解析失败，请确保是有效的 Excel 文件"));
            }
        };

        reader.onerror = () => {
            reject(new Error("文件读取失败"));
        };

        reader.readAsBinaryString(file);
    });
}

export function ExcelUploader({
    onDataParsed,
    data,
    onClear,
    className,
}: ExcelUploaderProps) {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);

    // 处理文件上传
    const handleFileChange = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            // 验证文件类型
            const validTypes = [
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                ".xlsx",
                ".xls",
            ];
            const isValidType =
                validTypes.some((t) => file.type.includes(t)) ||
                file.name.endsWith(".xlsx") ||
                file.name.endsWith(".xls");

            if (!isValidType) {
                toast({
                    variant: "destructive",
                    title: "文件格式错误",
                    description: "请上传 .xlsx 或 .xls 格式的 Excel 文件",
                });
                return;
            }

            setIsLoading(true);
            setFileName(file.name);

            try {
                const parsedData = await parseExcelFile(file);
                onDataParsed(parsedData);

                const totalTasks = parsedData.reduce((sum, row) => sum + row.count, 0);
                toast({
                    title: "✅ Excel 解析成功",
                    description: `共 ${parsedData.length} 条提示词，将创建 ${totalTasks} 个任务`,
                });
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : "解析失败";
                toast({
                    variant: "destructive",
                    title: "Excel 解析失败",
                    description: errorMsg,
                });
                setFileName(null);
            } finally {
                setIsLoading(false);
                // 重置 input，允许再次选择同一文件
                if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                }
            }
        },
        [onDataParsed, toast]
    );

    // 处理清除
    const handleClear = useCallback(() => {
        setFileName(null);
        onClear();
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, [onClear]);

    // 计算汇总
    const totalTasks = data.reduce((sum, row) => sum + row.count, 0);

    return (
        <div className={cn("space-y-3", className)}>
            {/* 操作按钮行 */}
            <div className="flex items-center gap-3">
                {/* 下载模板 */}
                <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 bg-black/20 hover:bg-black/40 transition-all"
                >
                    <Download className="h-3.5 w-3.5" />
                    下载模板
                </button>

                {/* 上传 Excel */}
                <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    className="hidden"
                    ref={fileInputRef}
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all",
                        data.length > 0
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "text-white/60 hover:text-white border border-white/10 hover:border-mermaid-cyan/40 bg-black/20 hover:bg-black/40"
                    )}
                >
                    {isLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : data.length > 0 ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                    )}
                    {isLoading ? "解析中..." : data.length > 0 ? "重新上传" : "上传Excel"}
                </button>

                {/* 显示已上传文件信息 */}
                {data.length > 0 && fileName && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-mermaid-cyan" />
                        <span className="text-xs text-white/60 max-w-[120px] truncate">
                            {fileName}
                        </span>
                        <Badge
                            variant="secondary"
                            className="text-[10px] bg-mermaid-cyan/10 text-mermaid-cyan border-mermaid-cyan/20"
                        >
                            {data.length} 条 · {totalTasks} 任务
                        </Badge>
                        <button
                            onClick={handleClear}
                            className="p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* 数据预览（当有数据时显示） */}
            {data.length > 0 && (
                <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">
                        预览（前3条）
                    </div>
                    <div className="space-y-1.5">
                        {data.slice(0, 3).map((row, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between text-xs"
                            >
                                <span className="text-white/60 truncate max-w-[300px]">
                                    {row.prompt}
                                </span>
                                <Badge
                                    variant="outline"
                                    className="text-[10px] bg-white/5 border-white/10 text-white/40"
                                >
                                    ×{row.count}
                                </Badge>
                            </div>
                        ))}
                        {data.length > 3 && (
                            <div className="text-[10px] text-white/30 text-center pt-1">
                                ...还有 {data.length - 3} 条
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
