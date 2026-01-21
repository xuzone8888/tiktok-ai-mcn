"use client"

import { useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"

interface SaveTemplateDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (name: string, description: string) => Promise<void>
    defaultName?: string
}

export function SaveTemplateDialog({
    open,
    onOpenChange,
    onSave,
    defaultName = "",
}: SaveTemplateDialogProps) {
    const [name, setName] = useState(defaultName)
    const [description, setDescription] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const handleSave = async () => {
        if (!name.trim()) return

        setIsLoading(true)
        try {
            await onSave(name, description)
            onOpenChange(false)
        } catch (error) {
            console.error("Failed to save template:", error)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] glass-card border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle>保存创作灵感方案</DialogTitle>
                    <DialogDescription className="text-gray-400">
                        保存当前的所有配置设置，以便下次直接调用。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-gray-300">
                            方案名称
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例如：9:16风景视频混剪"
                            className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="description" className="text-gray-300">
                            描述备注 (选填)
                        </Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="记录这个方案的特殊设置..."
                            className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 resize-none"
                            rows={3}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-gray-400 hover:text-white hover:bg-white/10"
                    >
                        取消
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!name.trim() || isLoading}
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white border-none"
                    >
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        确认保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
