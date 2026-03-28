#!/usr/bin/env bash
# 在项目根目录安装依赖并打包为 .vsix，供 Cursor「从 VSIX 安装」使用。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v npm >/dev/null 2>&1; then
  echo "错误: 未找到 npm，请先安装 Node.js。" >&2
  exit 1
fi

echo "==> 安装依赖: npm install"
npm install

echo "==> 打包: npm run vsix"
npm run vsix

echo "==> 完成。VSIX 文件："
find "$ROOT" -maxdepth 1 -name "*.vsix" -print
