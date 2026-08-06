"use client";

import { useEffect } from "react";

import { useToast } from "@/hooks/use-toast";
import { canvasSaveAdapter } from "@/lib/canvas/canvas-save-adapter";
import {
  connectCanvasRepairPreparer,
  connectCanvasSavePreparer,
} from "@/stores/canvas-store";

export function CanvasSaveFeedbackBridge() {
  const { toast } = useToast();

  useEffect(() => {
    const disconnectStore = connectCanvasSavePreparer((state, input) =>
      canvasSaveAdapter.preparePatch(state, input)
    );
    const disconnectRepair = connectCanvasRepairPreparer((state, input) =>
      canvasSaveAdapter.prepareRepair(state, input)
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
      disconnectRepair();
      disconnectStore();
    };
  }, [toast]);

  return null;
}
