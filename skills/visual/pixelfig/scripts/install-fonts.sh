#!/bin/sh
# 下载并安装像素中文字体到 $FONT_DIR（默认 ~/.fonts/pixel，其次 /usr/share/fonts/pixel）
#
# 用法：
#   sh install-fonts.sh            # 自动选可写目录
#   FONT_DIR=/path sh install-fonts.sh
#
# 只装 pixelfig 需要的这几款，不是全套（全套 59MB，这里约 12MB）。

set -e

FUSION_VER="2026.09.25"
ARK_VER="2026.09.25"
CUBIC_URL="https://raw.githubusercontent.com/ACh-K/Cubic-11/main/fonts/ttf/Cubic_11.ttf"

# --- 选目录 ---
if [ -z "$FONT_DIR" ]; then
  if [ -w /usr/share/fonts ] 2>/dev/null || [ "$(id -u)" = "0" ]; then
    FONT_DIR=/usr/share/fonts/pixel
  else
    FONT_DIR="$HOME/.fonts/pixel"
  fi
fi
mkdir -p "$FONT_DIR"
echo "字体安装到：$FONT_DIR"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

get_fusion() {
  for px in 12 10; do
    url="https://github.com/TakWolf/fusion-pixel-font/releases/download/$FUSION_VER/fusion-pixel-font-${px}px-proportional-ttf-v$FUSION_VER.zip"
    echo "  下载 Fusion Pixel ${px}px ..."
    curl -fsSL -o "$TMP/f$px.zip" "$url" || { echo "    失败：$url"; continue; }
    unzip -oq "$TMP/f$px.zip" -d "$TMP/f$px"
    cp "$TMP/f$px/fusion-pixel-${px}px-proportional-zh_hans.ttf" "$FONT_DIR/" 2>/dev/null \
      || echo "    包内没找到 zh_hans.ttf，跳过"
  done
}

get_ark() {
  for px in 12 10; do
    url="https://github.com/TakWolf/ark-pixel-font/releases/download/$ARK_VER/ark-pixel-font-${px}px-proportional-ttf-v$ARK_VER.zip"
    echo "  下载 Ark Pixel ${px}px ..."
    curl -fsSL -o "$TMP/a$px.zip" "$url" || { echo "    失败：$url"; continue; }
    unzip -oq "$TMP/a$px.zip" -d "$TMP/a$px"
    cp "$TMP/a$px/ark-pixel-${px}px-proportional-zh_hans.ttf" "$FONT_DIR/" 2>/dev/null \
      || echo "    包内没找到 zh_hans.ttf，跳过"
  done
}

echo "  下载 Cubic 11 ..."
curl -fsSL -o "$FONT_DIR/Cubic_11.ttf" "$CUBIC_URL" || echo "  失败：$CUBIC_URL"

get_fusion
get_ark

echo
echo "装好了，当前目录内容："
ls -1 "$FONT_DIR" | sed 's/^/  /'
echo
echo "如果 pixelfig 找不到它们，设置环境变量："
echo "  export PIXELFIG_FONT_DIR=\"$FONT_DIR\""
