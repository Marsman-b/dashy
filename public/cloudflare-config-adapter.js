/**
 * Cloudflare Worker 配置适配器
 *
 * 使用说明：
 * 1. 在 public/index.html 中引入此脚本（在加载 Dashy 主应用之前）
 * 2. 配置 WORKER_URL 为您的 Worker 地址
 * 3. 配置 API_TOKEN（如果您在 Worker 中设置了）
 *
 * 此脚本会拦截 Dashy 的配置加载和保存操作，
 * 将配置从 Cloudflare KV 读取，并在修改时保存回 KV
 */

(function() {
  'use strict';

  // ====== 配置区域 ======
  const CONFIG = {
    // Cloudflare Worker 地址（必填）
    WORKER_URL: 'https://dashy-worker.zhongweizi1108.workers.dev',

    // API Token（如果 Worker 中设置了 API_TOKEN 环境变量，这里必须提供）
    API_TOKEN: '', // 暂未设置 API Token

    // 默认配置文件路径（作为后备）
    DEFAULT_CONFIG_PATH: '/conf.yml',

    // 是否启用调试日志
    DEBUG: true,

    // 缓存配置（避免频繁请求）
    CACHE_ENABLED: true,
    CACHE_DURATION: 60000, // 缓存时间（毫秒），60秒
  };
  // =====================

  // 日志工具
  const log = {
    info: (...args) => CONFIG.DEBUG && console.log('[Cloudflare Adapter]', ...args),
    error: (...args) => console.error('[Cloudflare Adapter]', ...args),
    warn: (...args) => console.warn('[Cloudflare Adapter]', ...args),
  };

  // 配置缓存
  let configCache = {
    data: null,
    timestamp: 0,
  };

  /**
   * 从 Cloudflare Worker 获取配置
   */
  async function getConfigFromWorker() {
    log.info('正在从 Worker 获取配置...');

    // 检查缓存
    if (CONFIG.CACHE_ENABLED && configCache.data) {
      const age = Date.now() - configCache.timestamp;
      if (age < CONFIG.CACHE_DURATION) {
        log.info('使用缓存的配置（缓存年龄：' + Math.round(age / 1000) + '秒）');
        return configCache.data;
      }
    }

    try {
      const response = await fetch(`${CONFIG.WORKER_URL}/api/config`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/x-yaml',
        },
      });

      if (response.ok) {
        const configText = await response.text();
        log.info('成功从 Worker 获取配置（大小：' + configText.length + ' 字节）');

        // 更新缓存
        configCache.data = configText;
        configCache.timestamp = Date.now();

        return configText;
      } else if (response.status === 404) {
        log.warn('Worker 中未找到配置，将使用默认配置');
        return await getDefaultConfig();
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      log.error('从 Worker 获取配置失败:', error);
      log.info('回退到默认配置');
      return await getDefaultConfig();
    }
  }

  /**
   * 获取默认配置（从原始路径）
   */
  async function getDefaultConfig() {
    log.info('正在加载默认配置文件:', CONFIG.DEFAULT_CONFIG_PATH);

    try {
      // 使用原始 fetch，添加特殊标记避免被拦截
      const response = await originalFetch(CONFIG.DEFAULT_CONFIG_PATH, {
        headers: {
          'X-Bypass-Adapter': 'true'
        }
      });
      if (response.ok) {
        const configText = await response.text();
        log.info('成功加载默认配置');
        return configText;
      } else {
        throw new Error(`无法加载默认配置: HTTP ${response.status}`);
      }
    } catch (error) {
      log.error('加载默认配置失败:', error);
      throw error;
    }
  }

  /**
   * 保存配置到 Cloudflare Worker
   */
  async function saveConfigToWorker(configData) {
    log.info('正在保存配置到 Worker...（大小：' + configData.length + ' 字节）');

    try {
      const headers = {
        'Content-Type': 'application/x-yaml',
      };

      // 添加 API Token
      if (CONFIG.API_TOKEN) {
        headers['X-API-Token'] = CONFIG.API_TOKEN;
      }

      const response = await fetch(`${CONFIG.WORKER_URL}/api/config`, {
        method: 'POST',
        headers,
        body: configData,
      });

      if (response.ok) {
        const result = await response.json();
        log.info('配置保存成功:', result);

        // 清除缓存，强制下次重新获取
        configCache.data = configData;
        configCache.timestamp = Date.now();

        return { success: true, ...result };
      } else if (response.status === 401) {
        throw new Error('认证失败：请检查 API Token 是否正确');
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      log.error('保存配置到 Worker 失败:', error);
      throw error;
    }
  }

  /**
   * 获取配置元信息
   */
  async function getConfigMeta() {
    try {
      const response = await fetch(`${CONFIG.WORKER_URL}/api/config/meta`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      log.error('获取配置元信息失败:', error);
    }
    return null;
  }

  /**
   * 拦截 fetch 请求，重定向配置文件请求到 Worker
   */
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [resource, options] = args;

    // 检查是否有绕过标记
    const bypassAdapter = options && options.headers &&
      (options.headers['X-Bypass-Adapter'] || options.headers['x-bypass-adapter']);

    // 检查是否是配置文件请求
    const isConfigRequest = typeof resource === 'string' &&
      (resource.endsWith('/conf.yml') ||
       resource.endsWith('user-data/conf.yml') ||
       resource.includes('/conf.yml?'));

    if (isConfigRequest && !bypassAdapter) {
      log.info('拦截配置文件请求:', resource);

      // GET 请求 - 从 Worker 获取配置
      if (!options || options.method === 'GET' || !options.method) {
        return getConfigFromWorker().then(configText => {
          return new Response(configText, {
            status: 200,
            headers: { 'Content-Type': 'application/x-yaml' },
          });
        });
      }

      // POST/PUT 请求 - 保存配置到 Worker
      if (options && (options.method === 'POST' || options.method === 'PUT')) {
        return Promise.resolve(options.body).then(configData => {
          return saveConfigToWorker(configData).then(result => {
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          });
        }).catch(error => {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        });
      }
    }

    // 其他请求正常处理
    return originalFetch.apply(this, args);
  };

  /**
   * 拦截 XMLHttpRequest，处理旧版本的配置请求
   */
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._method = method;
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(data) {
    const isConfigRequest = this._url &&
      (this._url.endsWith('/conf.yml') ||
       this._url.endsWith('user-data/conf.yml') ||
       this._url.includes('/conf.yml?'));

    if (isConfigRequest) {
      log.info('拦截 XHR 配置请求:', this._url, this._method);

      // GET 请求
      if (this._method === 'GET') {
        getConfigFromWorker().then(configText => {
          Object.defineProperty(this, 'responseText', { writable: true });
          Object.defineProperty(this, 'response', { writable: true });
          Object.defineProperty(this, 'status', { writable: true });
          Object.defineProperty(this, 'readyState', { writable: true });

          this.responseText = configText;
          this.response = configText;
          this.status = 200;
          this.readyState = 4;

          if (this.onreadystatechange) {
            this.onreadystatechange();
          }
          if (this.onload) {
            this.onload();
          }
        }).catch(error => {
          log.error('XHR 获取配置失败:', error);
          if (this.onerror) {
            this.onerror(error);
          }
        });
        return;
      }

      // POST/PUT 请求
      if (this._method === 'POST' || this._method === 'PUT') {
        saveConfigToWorker(data).then(result => {
          Object.defineProperty(this, 'responseText', { writable: true });
          Object.defineProperty(this, 'response', { writable: true });
          Object.defineProperty(this, 'status', { writable: true });
          Object.defineProperty(this, 'readyState', { writable: true });

          this.responseText = JSON.stringify(result);
          this.response = JSON.stringify(result);
          this.status = 200;
          this.readyState = 4;

          if (this.onreadystatechange) {
            this.onreadystatechange();
          }
          if (this.onload) {
            this.onload();
          }
        }).catch(error => {
          log.error('XHR 保存配置失败:', error);
          if (this.onerror) {
            this.onerror(error);
          }
        });
        return;
      }
    }

    // 其他请求正常处理
    return originalXHRSend.apply(this, [data]);
  };

  // 在全局对象上暴露工具函数（可选，用于调试）
  window.CloudflareConfigAdapter = {
    getConfig: getConfigFromWorker,
    saveConfig: saveConfigToWorker,
    getMeta: getConfigMeta,
    clearCache: () => {
      configCache.data = null;
      configCache.timestamp = 0;
      log.info('缓存已清除');
    },
    setDebug: (enabled) => {
      CONFIG.DEBUG = enabled;
    },
  };

  log.info('Cloudflare 配置适配器已加载');
  log.info('Worker URL:', CONFIG.WORKER_URL);
  log.info('API Token 已配置:', CONFIG.API_TOKEN ? '是' : '否');

  // 预加载配置（可选）
  if (CONFIG.CACHE_ENABLED) {
    getConfigFromWorker().catch(() => {
      log.warn('预加载配置失败，将在需要时重试');
    });
  }

})();
