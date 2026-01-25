/**
 * Aliyun Phone Authentication Service (号码认证服务) for SMS Verification
 * 
 * 使用 HTTP API 直接调用，避免 SDK 模块兼容性问题
 * 签名: 速通互联验证码
 * 模板CODE: 100001
 */

import crypto from 'crypto';

// 阿里云配置
const SMS_CONFIG = {
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    signName: process.env.ALIYUN_SMS_SIGN_NAME || '速通互联验证码',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '100001',
    endpoint: 'https://dypnsapi.aliyuncs.com',
};

/**
 * 生成阿里云 API 签名
 */
function generateSignature(params: Record<string, string>, accessKeySecret: string): string {
    // 1. 按参数名排序
    const sortedKeys = Object.keys(params).sort();

    // 2. 构造规范化请求字符串
    const canonicalizedQueryString = sortedKeys
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&');

    // 3. 构造待签名字符串
    const stringToSign = `POST&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQueryString)}`;

    // 4. 计算签名
    const hmac = crypto.createHmac('sha1', accessKeySecret + '&');
    hmac.update(stringToSign);
    return hmac.digest('base64');
}

/**
 * 生成随机字符串
 */
function generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * 生成6位数字验证码
 */
export function generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送短信验证码（使用 HTTP API）
 */
export async function sendSmsVerificationCode(
    phone: string,
    code: string
): Promise<{ success: boolean; message: string; requestId?: string }> {
    try {
        // 格式化手机号
        const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');

        // 验证手机号格式
        if (!/^1[3-9]\d{9}$/.test(formattedPhone)) {
            return { success: false, message: '手机号格式不正确' };
        }

        // 公共参数
        const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const params: Record<string, string> = {
            AccessKeyId: SMS_CONFIG.accessKeyId,
            Action: 'SendSmsVerifyCode',
            Format: 'JSON',
            PhoneNumber: formattedPhone,
            SignName: SMS_CONFIG.signName,
            SignatureMethod: 'HMAC-SHA1',
            SignatureNonce: generateNonce(),
            SignatureVersion: '1.0',
            TemplateCode: SMS_CONFIG.templateCode,
            TemplateParam: JSON.stringify({ code, min: '5' }),
            Timestamp: timestamp,
            Version: '2017-05-25',
            CodeLength: '6',
            ValidTime: '300',
        };

        // 生成签名
        const signature = generateSignature(params, SMS_CONFIG.accessKeySecret);
        params.Signature = signature;

        // 发送请求
        const response = await fetch(SMS_CONFIG.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(params).toString(),
        });

        const result = await response.json();

        console.log('[SMS API] Response:', JSON.stringify(result));

        if (result.Code === 'OK') {
            return {
                success: true,
                message: '验证码发送成功',
                requestId: result.RequestId,
            };
        } else {
            return {
                success: false,
                message: result.Message || result.Code || '发送失败',
            };
        }
    } catch (error: any) {
        console.error('[SMS] 发送异常:', error);
        return {
            success: false,
            message: error.message || '短信服务异常',
        };
    }
}

/**
 * 验证手机号格式
 */
export function isValidPhoneNumber(phone: string): boolean {
    const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');
    return /^1[3-9]\d{9}$/.test(formattedPhone);
}
