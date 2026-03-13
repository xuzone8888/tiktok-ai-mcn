/**
 * 测试角色转面图 v2 - 写实摄影风格
 */

const prompt = `Photorealistic photography, studio lighting, white background. A real photograph of the same young Asian woman (age 25, shoulder-length black hair, warm natural smile, slim figure, wearing a simple white t-shirt and blue jeans) shown from multiple camera angles in one composite image.

Top row: four full-body photos side by side - front facing camera, left side profile, right side profile, back view. She stands in a relaxed natural pose.

Bottom row: three headshot close-up photos - front face, left profile face, right profile face.

Shot with a Canon EOS R5 camera, 85mm lens, soft studio lighting, high resolution. The same real person in every panel, maintaining perfect consistency in face, hair, clothing, and body proportions across all views. Clean white seamless studio backdrop. No illustration, no cartoon, no drawing - only photorealistic photography.`;

async function test() {
  console.log("=== 角色转面图 v2（写实摄影风）===");
  console.log("提示词长度:", prompt.length, "字符");
  console.log("调用 API...\n");

  try {
    const response = await fetch("http://localhost:3000/api/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "generate",
        prompt: prompt,
        model: "nano-banana",
        aspectRatio: "16:9",
      }),
    });

    const result = await response.json();
    console.log("响应状态:", response.status);
    console.log("响应结果:", JSON.stringify(result, null, 2));

    if (result.success && result.data?.imageUrl) {
      console.log("\n✅ 生成成功！");
      console.log("🖼️  图片 URL:", result.data.imageUrl);
    } else if (result.success && result.data?.status === "processing") {
      console.log("\n⏳ 任务处理中，taskId:", result.data.taskId);
    } else {
      console.log("\n❌ 生成失败:", result.error);
    }
  } catch (error) {
    console.error("请求错误:", error.message);
  }
}

test();
