/**
 * 音色数据源 - 前后端共享
 * 注意：此文件不能有 'use client' 指令，用于 API 路由 (server) 和前端组件 (client) 共同引用
 */

export const PRESET_VOICES = [
    // === 中文音色（豆包 TTS 2.0）===
    // 注意：已移除 ICL_ 开头的音色（seed-icl-1.0 未开通，调用会报 55000 错误）
    { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', gender: 'female' as const, lang: 'zh' as const, style: '🎙️ 全能女声·自然', preview: '' },
    { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何', gender: 'female' as const, lang: 'zh' as const, style: '💫 温柔知性', preview: '' },
    { id: 'zh_female_qinqienvsheng_moon_bigtts', name: '亲切女声', gender: 'female' as const, lang: 'zh' as const, style: '🌸 亲切邻家', preview: '' },
    { id: 'zh_female_tianxinxiaomei_emo_v2_mars_bigtts', name: '甜心小美', gender: 'female' as const, lang: 'zh' as const, style: '🍬 甜美可爱', preview: '' },
    { id: 'zh_male_m191_uranus_bigtts', name: '云舟', gender: 'male' as const, lang: 'zh' as const, style: '🎯 沉稳磁性', preview: '' },
    { id: 'zh_male_taocheng_uranus_bigtts', name: '小天', gender: 'male' as const, lang: 'zh' as const, style: '😊 阳光温暖', preview: '' },
    { id: 'zh_male_jieshuoxiaoming_mars_bigtts', name: '解说小明', gender: 'male' as const, lang: 'zh' as const, style: '🎬 影视解说', preview: '' },
    { id: 'zh_male_lengkugege_emo_v2_mars_bigtts', name: '冷酷哥哥', gender: 'male' as const, lang: 'zh' as const, style: '🧊 冷酷深沉', preview: '' },
    { id: 'zh_male_qingyiyuxuan_mars_bigtts', name: '阳光阿辰', gender: 'male' as const, lang: 'zh' as const, style: '☀️ 朝气阳光', preview: '' },
    { id: 'zh_male_xudong_conversation_wvae_bigtts', name: '快乐小东', gender: 'male' as const, lang: 'zh' as const, style: '🎉 活力对话', preview: '' },
    { id: 'zh_male_jingqiangkanye_emo_mars_bigtts', name: '京腔侃爷', gender: 'male' as const, lang: 'zh' as const, style: '🏮 京腔特色', preview: '' },
    // === 英文音色（ElevenLabs）===
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'male' as const, lang: 'en' as const, style: '🔥 社媒达人·活力', preview: 'https://api.elevenlabs.io/v1/voices/TX3LPaxmHKxFdv7VOQHJ/preview' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male' as const, lang: 'en' as const, style: '💪 果断有力·霸气', preview: 'https://api.elevenlabs.io/v1/voices/pNInz6obpgDQGcFmaJgB/preview' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male' as const, lang: 'en' as const, style: '🎯 沉稳低音·社媒', preview: 'https://api.elevenlabs.io/v1/voices/nPczCjzI2devNBz1zQrb/preview' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female' as const, lang: 'en' as const, style: '⚡ 活力古灵精怪', preview: 'https://api.elevenlabs.io/v1/voices/FGY2WhTYpPnrIDTdsKH5/preview' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female' as const, lang: 'en' as const, style: '💫 甜美自信·成熟', preview: 'https://api.elevenlabs.io/v1/voices/EXAVITQu4vr4xnSDxMaL/preview' },
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female' as const, lang: 'en' as const, style: '🌸 俏皮明亮·温暖', preview: 'https://api.elevenlabs.io/v1/voices/cgSgspJ2msm6clMCkdW9/preview' },
    { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male' as const, lang: 'en' as const, style: '😊 亲切随和·邻家', preview: 'https://api.elevenlabs.io/v1/voices/iP95p4xoKVk53GoZ742B/preview' },
    { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', gender: 'male' as const, lang: 'en' as const, style: '🎵 慵懒随性·磁性', preview: 'https://api.elevenlabs.io/v1/voices/CwhRBWXzGAHq8TQ4Fs17/preview' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male' as const, lang: 'en' as const, style: '📖 英式故事大师', preview: 'https://api.elevenlabs.io/v1/voices/JBFqnCBsd6RMkjVDRZzb/preview' },
    { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'neutral' as const, lang: 'en' as const, style: '🌊 中性·淡定知性', preview: 'https://api.elevenlabs.io/v1/voices/SAz9YHcvj6GT2YYXdXww/preview' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male' as const, lang: 'en' as const, style: '🎬 澳洲·深沉有力', preview: 'https://api.elevenlabs.io/v1/voices/IKne3meq5aSn9XLyUdCD/preview' },
    { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female' as const, lang: 'en' as const, style: '📚 英式·清晰教育', preview: 'https://api.elevenlabs.io/v1/voices/Xb7hH8MSUJpSbSDYk0k2/preview' },
    { id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', gender: 'female' as const, lang: 'en' as const, style: '✨ 专业·明亮温暖', preview: 'https://api.elevenlabs.io/v1/voices/hpp4J3VqNfWAUOO0d1Us/preview' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male' as const, lang: 'en' as const, style: '🏆 沉稳专业·广告', preview: 'https://api.elevenlabs.io/v1/voices/pqHfZKP75CvOlQylNhV4/preview' },
];
