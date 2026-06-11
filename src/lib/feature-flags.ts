export const IMAGE_FACTORY_UPGRADING_MESSAGE = "商图精修正在升级中";

export function isImageFactoryEnabled(): boolean {
  return process.env.IMAGE_FACTORY_ENABLED === "true";
}

export function isImageFactoryUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IMAGE_FACTORY_ENABLED === "true";
}
