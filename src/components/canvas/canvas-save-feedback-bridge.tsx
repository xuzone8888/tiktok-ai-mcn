"use client";

import { useEffect } from "react";

import { useToast } from "@/hooks/use-toast";
import { canvasSaveAdapter } from "@/lib/canvas/canvas-save-adapter";
import { connectCanvasSavePreparer } from "@/stores/canvas-store";

export function CanvasSaveFeedbackBridge() {
  const { toast } = useToast();

  useEffect(() => {
    const disconnectStore = connectCanvasSavePreparer((state, input) =>
      canvasSaveAdapter.preparePatch(state, input)
    );
    const unsubscribe = canvasSaveAdapter.subscribe((feedback) => {
        toast({
          variant: "destructive",
          title: feedback.title,
          description: feedback.description,
        });
    });
    return () => {
      unsubscribe();
      disconnectStore();
    };
  }, [toast]);

  return null;
}
