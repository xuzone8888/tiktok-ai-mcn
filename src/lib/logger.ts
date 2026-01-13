/**
 * 统一日志工具
 * 
 * 功能：
 * - 开发环境输出详细日志
 * - 生产环境仅输出错误和警告
 * - 支持命名空间分组
 * - 支持性能计时
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
  prefix: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 默认配置：生产环境只输出 warn 和 error
const defaultConfig: LoggerConfig = {
  enabled: true,
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  prefix: '',
};

class Logger {
  private config: LoggerConfig;
  private namespace: string;

  constructor(namespace: string, config: Partial<LoggerConfig> = {}) {
    this.namespace = namespace;
    this.config = { ...defaultConfig, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const prefix = this.config.prefix ? `${this.config.prefix} ` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${prefix}[${this.namespace}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  // 性能计时
  time(label: string): void {
    if (this.shouldLog('debug')) {
      console.time(`[${this.namespace}] ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldLog('debug')) {
      console.timeEnd(`[${this.namespace}] ${label}`);
    }
  }

  // 分组日志
  group(label: string): void {
    if (this.shouldLog('debug')) {
      console.group(`[${this.namespace}] ${label}`);
    }
  }

  groupEnd(): void {
    if (this.shouldLog('debug')) {
      console.groupEnd();
    }
  }

  // 表格输出
  table(data: unknown): void {
    if (this.shouldLog('debug')) {
      console.table(data);
    }
  }
}

// 创建命名空间日志器的工厂函数
export function createLogger(namespace: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger(namespace, config);
}

// 预定义的日志器实例
export const logger = {
  // 视频批量处理
  videoBatch: createLogger('VideoBatch'),
  // 图片批量处理
  imageBatch: createLogger('ImageBatch'),
  // 快速生成
  quickGen: createLogger('QuickGen'),
  // API 请求
  api: createLogger('API'),
  // 认证
  auth: createLogger('Auth'),
  // 存储
  storage: createLogger('Storage'),
  // 中间件
  middleware: createLogger('Middleware'),
  // 后台任务
  backgroundTask: createLogger('BackgroundTask'),
  // 合约管理
  contracts: createLogger('Contracts'),
  // 通用
  general: createLogger('App'),
};

// 导出默认日志器
export default logger;

// 简化的日志函数（用于快速替换 console.log）
export const log = {
  debug: (message: string, ...args: unknown[]) => logger.general.debug(message, ...args),
  info: (message: string, ...args: unknown[]) => logger.general.info(message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.general.warn(message, ...args),
  error: (message: string, ...args: unknown[]) => logger.general.error(message, ...args),
};
