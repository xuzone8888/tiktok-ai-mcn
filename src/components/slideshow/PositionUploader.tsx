/**
 * 位置上传器 - 场景编排模式
 * JCUI 2.0 Mermaid Glass
 */

'use client';

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Plus, X, Upload, Check, AlertCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface Position {
    id: string;
    name: string;
    images: File[];
}

interface PositionUploaderProps {
    positions: Position[];
    onChange: (positions: Position[]) => void;
    maxPositions?: number;
}

export function PositionUploader({
    positions,
    onChange,
    maxPositions = 15,
}: PositionUploaderProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // 添加位置
    const addPosition = () => {
        if (positions.length >= maxPositions) return;
        const newPos: Position = {
            id: crypto.randomUUID(),
            name: `位置 ${positions.length + 1}`,
            images: [],
        };
        onChange([...positions, newPos]);
    };

    // 删除位置
    const removePosition = (id: string) => {
        onChange(positions.filter(p => p.id !== id));
    };

    // 上传图片到位置
    const handleUpload = (id: string, files: FileList | null) => {
        if (!files) return;
        const newPositions = positions.map(p => {
            if (p.id === id) {
                return { ...p, images: [...p.images, ...Array.from(files)] };
            }
            return p;
        });
        onChange(newPositions);
    };

    // 清空位置图片
    const clearPosition = (id: string) => {
        const newPositions = positions.map(p => {
            if (p.id === id) {
                return { ...p, images: [] };
            }
            return p;
        });
        onChange(newPositions);
    };

    // 修改位置名称
    const startEdit = (pos: Position) => {
        setEditingId(pos.id);
        setEditName(pos.name);
    };

    const saveEdit = () => {
        if (!editingId) return;
        const newPositions = positions.map(p => {
            if (p.id === editingId) {
                return { ...p, name: editName || `位置 ${positions.indexOf(p) + 1}` };
            }
            return p;
        });
        onChange(newPositions);
        setEditingId(null);
        setEditName('');
    };

    // 检查是否均衡
    const imageCounts = positions.map(p => p.images.length);
    const isBalanced = imageCounts.length > 0 && imageCounts.every(c => c === imageCounts[0] && c > 0);
    const minCount = Math.min(...imageCounts);
    const maxCount = Math.max(...imageCounts);

    return (
        <div className="space-y-4">
            {/* 位置网格 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {positions.map((pos, index) => {
                    const isLow = pos.images.length < maxCount && pos.images.length < maxCount;
                    return (
                        <div
                            key={pos.id}
                            className={cn(
                                "relative p-3 rounded-xl border transition-all",
                                pos.images.length === 0
                                    ? "bg-white/5 border-white/10"
                                    : isLow && !isBalanced
                                        ? "bg-amber-500/5 border-amber-500/30"
                                        : "bg-emerald-500/5 border-emerald-500/30"
                            )}
                        >
                            {/* 删除按钮 */}
                            <button
                                onClick={() => removePosition(pos.id)}
                                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors z-10"
                            >
                                <X className="h-3 w-3" />
                            </button>

                            {/* 位置名称 */}
                            <div className="flex items-center gap-2 mb-2">
                                {editingId === pos.id ? (
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={saveEdit}
                                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                                        autoFocus
                                        className="flex-1 bg-white/10 border border-white/20 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-mermaid-cyan/50"
                                    />
                                ) : (
                                    <button
                                        onClick={() => startEdit(pos)}
                                        className="flex items-center gap-1 text-sm font-medium text-white/80 hover:text-white transition-colors"
                                    >
                                        {pos.name}
                                        <Pencil className="h-3 w-3 opacity-50" />
                                    </button>
                                )}
                            </div>

                            {/* 图片数量 */}
                            <div className="flex items-center gap-2 mb-2">
                                {pos.images.length > 0 ? (
                                    <>
                                        <Check className={cn(
                                            "h-4 w-4",
                                            isBalanced ? "text-emerald-400" : "text-amber-400"
                                        )} />
                                        <span className={cn(
                                            "text-sm font-medium",
                                            isBalanced ? "text-emerald-400" : "text-amber-400"
                                        )}>
                                            {pos.images.length} 张
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle className="h-4 w-4 text-white/30" />
                                        <span className="text-sm text-white/30">未上传</span>
                                    </>
                                )}
                            </div>

                            {/* 上传按钮 */}
                            <label className="block">
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => handleUpload(pos.id, e.target.files)}
                                />
                                <div className="flex items-center justify-center gap-1 py-1.5 px-3 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60 hover:bg-white/10 hover:text-white cursor-pointer transition-colors">
                                    <Upload className="h-3 w-3" />
                                    上传
                                </div>
                            </label>

                            {/* 清空按钮 */}
                            {pos.images.length > 0 && (
                                <button
                                    onClick={() => clearPosition(pos.id)}
                                    className="w-full mt-2 py-1 text-xs text-red-400/60 hover:text-red-400 transition-colors"
                                >
                                    清空
                                </button>
                            )}
                        </div>
                    );
                })}

                {/* 添加位置按钮 */}
                {positions.length < maxPositions && (
                    <button
                        onClick={addPosition}
                        className="p-3 rounded-xl border border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 transition-all flex flex-col items-center justify-center gap-2 min-h-[120px]"
                    >
                        <Plus className="h-6 w-6 text-white/40" />
                        <span className="text-xs text-white/40">添加位置</span>
                    </button>
                )}
            </div>

            {/* 均衡提示 */}
            {positions.length > 0 && !isBalanced && (
                <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="text-sm text-amber-400">
                        位置图片数量不均衡，需补充到 {maxCount} 张才能开始生成
                    </span>
                </div>
            )}

            {/* 统计信息 */}
            {positions.length > 0 && isBalanced && (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-sm text-emerald-400">
                        ✅ 可生成 {minCount} 个视频（每视频 {positions.length} 张图）
                    </span>
                </div>
            )}
        </div>
    );
}
