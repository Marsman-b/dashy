/**
 * Cloudflare Worker for Dashy Configuration Storage
 *
 * 功能说明：
 * - 将 Dashy 的配置修改保存到 Cloudflare KV 存储
 * - 提供 API 端点用于保存、读取和重置配置
 * - 支持 CORS，可从 Cloudflare Pages 域名访问
 *
 * 部署步骤：
 * 1. 在 Cloudflare Dashboard 创建 KV 命名空间
 * 2. 将此代码粘贴到 Workers 编辑器
 * 3. 在 Worker 设置中绑定 KV 命名空间（变量名：DASHY_CONFIG）
 * 4. 在环境变量中设置 API_TOKEN（用于保护写入操作）
 * 5. 部署 Worker
 */

// CORS 配置 - 允许的域名
const ALLOWED_ORIGINS = [
  'https://dashy-8ke.pages.dev',
  'http://localhost:8080', // 本地开发
  'http://localhost:4000'
];

// 配置键名
const CONFIG_KEY = 'dashy-config-yml';

/**
 * 处理 CORS 预检请求
 */
function handleCORS(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Token',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * 添加 CORS 头到响应
 */
function addCORSHeaders(response, request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', allowedOrigin);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Token');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * 验证 API Token
 */
function validateToken(request, env) {
  const token = request.headers.get('X-API-Token') || request.headers.get('Authorization')?.replace('Bearer ', '');

  // 如果没有设置 API_TOKEN 环境变量，则不需要验证（不推荐生产环境）
  if (!env.API_TOKEN) {
    return true;
  }

  return token === env.API_TOKEN;
}

/**
 * 主处理函数
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    try {
      let response;

      // 路由处理
      switch (true) {
        // 获取配置
        case path === '/api/config' && request.method === 'GET':
          response = await handleGetConfig(env);
          break;

        // 保存配置
        case path === '/api/config' && request.method === 'POST':
          if (!validateToken(request, env)) {
            response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          } else {
            response = await handleSaveConfig(request, env);
          }
          break;

        // 重置配置（恢复到默认）
        case path === '/api/config/reset' && request.method === 'POST':
          if (!validateToken(request, env)) {
            response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          } else {
            response = await handleResetConfig(env);
          }
          break;

        // 健康检查
        case path === '/api/health' && request.method === 'GET':
          response = new Response(JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            kvAvailable: !!env.DASHY_CONFIG
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
          break;

        // 获取配置元信息
        case path === '/api/config/meta' && request.method === 'GET':
          response = await handleGetConfigMeta(env);
          break;

        // 未找到路由
        default:
          response = new Response(JSON.stringify({
            error: 'Not Found',
            availableEndpoints: [
              'GET  /api/config - 获取配置',
              'POST /api/config - 保存配置（需要 API Token）',
              'POST /api/config/reset - 重置配置（需要 API Token）',
              'GET  /api/config/meta - 获取配置元信息',
              'GET  /api/health - 健康检查'
            ]
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
      }

      // 添加 CORS 头
      return addCORSHeaders(response, request);

    } catch (error) {
      const errorResponse = new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

      return addCORSHeaders(errorResponse, request);
    }
  },
};

/**
 * 获取配置
 */
async function handleGetConfig(env) {
  try {
    const config = await env.DASHY_CONFIG.get(CONFIG_KEY);

    if (!config) {
      return new Response(JSON.stringify({
        error: 'Config not found',
        message: '配置未找到，请先保存配置或使用默认配置'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(config, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': 'inline; filename="conf.yml"'
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to get config',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * 保存配置
 */
async function handleSaveConfig(request, env) {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    let configData;

    if (contentType.includes('application/json')) {
      const json = await request.json();
      configData = json.config || json.data || JSON.stringify(json);
    } else {
      configData = await request.text();
    }

    if (!configData || configData.trim().length === 0) {
      return new Response(JSON.stringify({
        error: 'Invalid config data',
        message: '配置数据不能为空'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 保存配置到 KV，带元数据
    const metadata = {
      lastModified: new Date().toISOString(),
      size: configData.length,
    };

    await env.DASHY_CONFIG.put(CONFIG_KEY, configData, { metadata });

    return new Response(JSON.stringify({
      success: true,
      message: '配置保存成功',
      metadata
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to save config',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * 重置配置
 */
async function handleResetConfig(env) {
  try {
    await env.DASHY_CONFIG.delete(CONFIG_KEY);

    return new Response(JSON.stringify({
      success: true,
      message: '配置已重置，下次访问将使用默认配置'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to reset config',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * 获取配置元信息
 */
async function handleGetConfigMeta(env) {
  try {
    const { metadata } = await env.DASHY_CONFIG.getWithMetadata(CONFIG_KEY);

    if (!metadata) {
      return new Response(JSON.stringify({
        exists: false,
        message: '配置不存在'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      exists: true,
      metadata
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to get config metadata',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
