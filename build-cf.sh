#!/bin/bash
# Cloudflare Pages 构建脚本

# 安装依赖
yarn install

# 构建项目（移除 NODE_OPTIONS 以兼容 Cloudflare）
vue-cli-service build
