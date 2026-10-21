#!/bin/sh
set -eu

fail() { printf '栖点安装失败：%s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail '请在 iStoreOS 软件商店中以管理员身份安装，或使用 root 执行此安装包。'

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${QIDIAN_INSTALL_DIR:-/opt/qidian}
case "$INSTALL_DIR" in /opt/qidian) ;; *) fail "程序目录必须为 /opt/qidian，收到：$INSTALL_DIR" ;; esac
[ -f "$SCRIPT_DIR/compose.yaml" ] || fail '安装包缺少 Docker Compose 配置。'
[ -f "$SCRIPT_DIR/root/usr/libexec/istorec/qidian.sh" ] || fail '安装包缺少 iStoreOS 服务管理脚本。'
[ -f "$SCRIPT_DIR/root/usr/libexec/istorec/qidian-updater.sh" ] || fail '安装包缺少网页更新管理服务。'
[ -f "$SCRIPT_DIR/root/etc/init.d/qidian-updater" ] || fail '安装包缺少网页更新服务启动脚本。'
command -v uci >/dev/null 2>&1 || fail '未检测到设备 UCI 配置工具。'
command -v jsonfilter >/dev/null 2>&1 || fail '缺少 jsonfilter，请先通过设备软件包管理器安装后重试。'
[ -d /usr/lib/lua/luci/controller ] || fail '未检测到 LuCI 控制器目录，请先安装 LuCI。'
[ -d /usr/lib/lua/luci/model/cbi ] || fail '当前系统没有 LuCI CBI 管理界面，无法提供服务配置页。'

# Online updaters already own both operation locks and deploy once themselves.
# A manual installer owns the operation lock across file installation and deployment.
INSTALL_LOCK_OWNED=0
if [ "${QIDIAN_UPDATE_WORKER:-0}" != 1 ]; then
	[ ! -d /tmp/qidian-web-update.lock ] && [ ! -f /tmp/qidian-operation.queued ] || fail '另一项更新正在执行，请稍后重试。'
	mkdir /tmp/qidian-operation.lock 2>/dev/null || fail '另一项操作正在执行，请稍后重试。'
	INSTALL_LOCK_OWNED=1
	finish_install() {
		install_result=$?
		trap - EXIT HUP INT TERM
		if [ "$install_result" -ne 0 ]; then
			touch /tmp/qidian-deployment.failed
			printf 'failed\n' > /tmp/qidian-operation.result
			[ -s /tmp/qidian-operation.log ] || printf '安装未完成，请查看安装器输出后重试。\n' > /tmp/qidian-operation.log
		fi
		rmdir /tmp/qidian-operation.lock 2>/dev/null || true
		exit "$install_result"
	}
	trap finish_install EXIT
	trap 'exit 1' HUP INT TERM
	: > /tmp/qidian-operation.log
	printf 'running\n' > /tmp/qidian-operation.result
fi

HAD_CONFIG=false
[ ! -f /etc/config/qidian ] || HAD_CONFIG=true
HAD_ENV=false
[ ! -f "$INSTALL_DIR/.env" ] || HAD_ENV=true

mkdir -p "$INSTALL_DIR" /etc/config
cp "$SCRIPT_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env.example"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
fi

# Install LuCI's menu, configuration model, status page and root-owned manager.
# Keep /etc/config/qidian separate so a package upgrade never resets user settings.
cleanup_versioned_luci_pages() {
	source_view_dir=$1
	view_dir=/usr/lib/lua/luci/view/qidian
	[ -d "$view_dir" ] && [ ! -L "$view_dir" ] || return 0
	for page in "$view_dir"/*.htm; do
		[ -f "$page" ] || continue
		page_name=${page##*/}
		[ ! -f "$source_view_dir/$page_name" ] || continue
		if printf '%s\n' "$page_name" | grep -Eq '[-_.]v?[0-9]+\.[0-9]+\.[0-9]+\.htm$'; then
			rm -f "$page"
		fi
	done
}

cp -a "$SCRIPT_DIR/root/usr/." /usr/
cleanup_versioned_luci_pages "$SCRIPT_DIR/root/usr/lib/lua/luci/view/qidian"
mkdir -p /etc/init.d
cp -a "$SCRIPT_DIR/root/etc/init.d/." /etc/init.d/
if [ "$HAD_CONFIG" = false ]; then
	cp "$SCRIPT_DIR/root/etc/config/qidian" /etc/config/qidian
fi
chmod 755 /usr/libexec/istorec/qidian.sh
chmod 755 /usr/libexec/istorec/qidian-updater.sh
chmod 755 /etc/init.d/qidian-updater
printf '%s\n' "$(cat "$SCRIPT_DIR/version")" > /etc/qidian-version

if [ "$HAD_CONFIG" = false ]; then
	uci set qidian.main=qidian
  uci set qidian.main.registration_enabled=0
  uci set qidian.main.data_path=

  # Carry forward settings only when an environment file existed before this
  # package was installed.  A freshly copied example is not device state.
  if [ "$HAD_ENV" = true ]; then
    OLD_DATA=$(sed -n 's/^QIDIAN_DATA_PATH=//p' "$INSTALL_DIR/.env" | tail -n 1)
    OLD_REGISTRATION=$(sed -n 's/^REGISTRATION_ENABLED=//p' "$INSTALL_DIR/.env" | tail -n 1)
    case "$OLD_DATA" in /*) uci set "qidian.main.data_path=$OLD_DATA" ;; esac
    [ "$OLD_REGISTRATION" != true ] || uci set qidian.main.registration_enabled=1
  fi
  uci commit qidian
elif ! uci -q get qidian.main.registration_enabled >/dev/null 2>&1; then
  OLD_REGISTRATION=$(sed -n 's/^REGISTRATION_ENABLED=//p' "$INSTALL_DIR/.env" 2>/dev/null | tail -n 1)
  if [ "$OLD_REGISTRATION" = true ]; then
    uci set qidian.main.registration_enabled=1
  else
    uci set qidian.main.registration_enabled=0
  fi
  uci commit qidian
fi
if uci -q get qidian.main.http_port >/dev/null 2>&1; then
  uci -q delete qidian.main.http_port
  uci commit qidian
fi

# Register the LuCI Save & Apply hook immediately; it runs apply-config only
# after OpenWrt applies a committed qidian configuration change.
if [ -x /etc/init.d/ucitrack ]; then
	/etc/init.d/ucitrack restart || /etc/init.d/ucitrack start || fail '无法注册 LuCI 配置应用钩子。'
fi

# Move updater state into the configured Docker data directory before restarting its agent.
/usr/libexec/istorec/qidian.sh prepare-control

if [ -x /etc/init.d/qidian-updater ]; then
	/etc/init.d/qidian-updater enable
fi

if [ "$INSTALL_LOCK_OWNED" = 1 ]; then
	printf '管理界面已安装，正在部署栖点…\n'
	printf 'running\n' > /tmp/qidian-operation.result
	if QIDIAN_INSTALL_LOCK_HELD=1 /usr/libexec/istorec/qidian.sh install-package 2>&1 | tee /tmp/qidian-operation.log; then
		[ "$(cat /tmp/qidian-operation.result 2>/dev/null)" = success ] || fail '管理界面已保留；请在 LuCI 查看日志，解决问题后点击“重试部署”。'
		printf '安装完成，可在 LuCI 查看服务状态。\n'
	else
		fail '部署日志写入失败，请在 LuCI 查看状态后重试。'
	fi
else
	printf '管理插件已更新，容器由当前更新任务统一处理。\n'
fi
