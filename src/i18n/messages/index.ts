import commonEn from "./en/common.json";
import characterEn from "./en/character.json";
import characterCreateEn from "./en/character-create.json";
import templatesEn from "./en/templates.json";
import commonZh from "./zh/common.json";
import characterZh from "./zh/character.json";
import characterCreateZh from "./zh/character-create.json";
import templatesZh from "./zh/templates.json";

export const appMessages = {
  zh: { common: commonZh, character: characterZh, characterCreate: characterCreateZh, templates: templatesZh },
  en: { common: commonEn, character: characterEn, characterCreate: characterCreateEn, templates: templatesEn },
} as const;

export type AppMessages = typeof appMessages.zh;
