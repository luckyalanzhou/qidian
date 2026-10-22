#!/bin/sh
set -eu

INSTALL_DIR=/opt/qidian
ENV_FILE=$INSTALL_DIR/.env
COMPOSE_FILE=$INSTALL_DIR/compose.yaml
IMAGE_REPOSITORY=docker.io/luckyalanzhou/qidian
RELEASE_REPOSITORY=luckyalanzhou/qidian
LOCK_DIR=/tmp/qidian-operation.lock
WEB_UPDATE_LOCK=/tmp/qidian-web-update.lock
DEPLOY_FAILED=/tmp/qidian-deployment.failed
UPDATE_WORK_DIR=
UPDATE_WORKER_PATH=
QIDIAN_PACKAGE_UPDATED=false

fail() { printf '栖点操作失败：%s\n' "$*" >&2; exit 1; }

detect_root() {
	command -v docker >/dev/null 2>&1 || return 1
	docker info --format '{{.DockerRootDir}}' 2>/dev/null
}

status() {
	if ! command -v docker >/dev/null 2>&1; then
		printf 'error\n'
		return
	fi
	if ! docker info >/dev/null 2>&1; then
		printf 'error\n'
		return
	fi
	if ! docker inspect qidian >/dev/null 2>&1; then
		printf 'not_installed\n'
		return
	fi
	state=$(docker inspect --format '{{.State.Status}}' qidian 2>/dev/null || true)
	if [ "$state" = running ]; then
		printf 'running\n'
	else
		printf 'stopped\n'
	fi
}

account_status() {
	[ "$(status)" = running ] || { printf 'unavailable\n'; return; }
	url=http://127.0.0.1:9908/api/auth/config
	if command -v uclient-fetch >/dev/null 2>&1; then
		body=$(uclient-fetch -qO- "$url" 2>/dev/null || true)
	elif command -v wget >/dev/null 2>&1; then
		body=$(wget -qO- "$url" 2>/dev/null || true)
	elif command -v curl >/dev/null 2>&1; then
		body=$(curl -fsS "$url" 2>/dev/null || true)
	else
		printf 'unknown\n'
		return
	fi
	if command -v jsonfilter >/dev/null 2>&1; then
		setup_required=$(printf '%s' "$body" | jsonfilter -e '@.setupRequired' 2>/dev/null || true)
	else
		case "$body" in *'"setupRequired":true'*) setup_required=true ;; *'"setupRequired":false'*) setup_required=false ;; *) setup_required= ;; esac
	fi
	case "$setup_required" in true) printf 'setup_required\n' ;; false) printf 'ready\n' ;; *) printf 'unknown\n' ;; esac
}

compose_setup() {
	if docker compose version >/dev/null 2>&1; then
		compose() { docker compose "$@"; }
	elif command -v docker-compose >/dev/null 2>&1; then
		compose() { docker-compose "$@"; }
	else
		fail '未检测到 Docker Compose，请先在 OpenWrt 安装 Docker Compose。'
	fi
}

# Capture ownership before pulling a mutable tag; afterwards the old image can
# be dangling. Never prune global Docker resources or force-remove an image.
image_is_qidian_owned() (
	image_refs=$(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null) || return 1
	[ -n "$image_refs" ] || [ "${2:-}" = allow-empty ] || return 1
	for image_ref in $image_refs; do
		case "$image_ref" in
			docker.io/luckyalanzhou/qidian:*|luckyalanzhou/qidian:*|docker.io/luckyalanzhou/qidian@sha256:*|luckyalanzhou/qidian@sha256:*) ;;
			*) return 1 ;;
		esac
	done
)

owned_image_id() (
	image_id=$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null) || return 1
	printf '%s\n' "$image_id" | grep -Eq '^sha256:[a-f0-9]{64}$' || return 1
	image_is_qidian_owned "$image_id" || return 1
	printf '%s\n' "$image_id"
)

remember_replaced_images() {
	previous_container_image=$(docker inspect --type container --format '{{.Image}}' qidian 2>/dev/null || true)
	previous_container_image=$(owned_image_id "$previous_container_image" || true)
	previous_target_image=$(owned_image_id "$1" || true)
}

wait_for_ready_image() (
	expected_image=$1
	attempt=0
	while [ "$attempt" -lt 60 ]; do
		container_health=$(docker inspect --type container --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.Image}}' qidian 2>/dev/null || true)
		[ "$container_health" = "running healthy $expected_image" ] && return 0
		attempt=$((attempt + 1))
		sleep 2
	done
	printf '新容器未通过健康检查，保留旧镜像。\n' >&2
	return 1
)

recreate_container() {
	previous_state=$1
	expected_image=$2
	if [ -n "$previous_state" ] && [ "$previous_state" != running ]; then
		compose create --force-recreate qidian || return 1
		actual_image=$(docker inspect --type container --format '{{.Image}}' qidian 2>/dev/null) || return 1
		[ "$actual_image" = "$expected_image" ] || { printf '容器镜像不匹配，保留旧镜像。\n'; return 1; }
		printf '容器已更新，服务保持停止；旧镜像保留。\n'
	else
		compose up -d --no-build --force-recreate qidian || return 1
		wait_for_ready_image "$expected_image" || return 1
	fi
}

cleanup_replaced_images() (
	# Cleanup is best effort: a Docker inspection/removal failure must not turn
	# a successful deployment into an update failure.
	current_image=$1
	printf '%s\n' "$current_image" | grep -Eq '^sha256:[a-f0-9]{64}$' || return 0
	for old_image in "${previous_container_image:-}" "${previous_target_image:-}"; do
		[ -n "$old_image" ] && [ "$old_image" != "$current_image" ] || continue
		[ "$old_image" != "${cleaned_image:-}" ] || continue
		cleaned_image=$old_image
		image_is_qidian_owned "$old_image" allow-empty || continue
		image_users=$(docker container ls -aq --filter "ancestor=$old_image" 2>/dev/null) || continue
		[ -z "$image_users" ] || { printf '旧镜像仍被其他容器引用，已保留。\n'; continue; }
		old_tags=$(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$old_image" 2>/dev/null) || continue
		# Refuse a newly added foreign tag, too.
		image_is_qidian_owned "$old_image" allow-empty || continue
		printf '正在清理栖点旧镜像 %s…\n' "$old_image"
		for old_tag in $old_tags; do
			case "$old_tag" in docker.io/luckyalanzhou/qidian:*|luckyalanzhou/qidian:*) ;; *) continue ;; esac
			tag_image=$(docker image inspect --format '{{.Id}}' "$old_tag" 2>/dev/null) || continue
			[ "$tag_image" = "$old_image" ] || continue
			docker image rm --no-prune "$old_tag" || printf '旧镜像标签未能清理，已保留：%s\n' "$old_tag"
		done
		if docker image inspect "$old_image" >/dev/null 2>&1; then
			docker image rm --no-prune "$old_image" || printf '旧镜像未能清理，已保留：%s\n' "$old_image"
		fi
	done
	return 0
)

is_version() {
	printf '%s\n' "$1" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
}

verify_image_version() (
	required_version=$2
	image_version=$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null | sed -n 's/^QIDIAN_VERSION=//p' | sed -n '1p')
	if ! is_version "$required_version" || [ "$image_version" != "$required_version" ]; then
		printf '镜像版本与目标版本 %s 不一致（镜像：%s），保留现有容器，请稍后重试。\n' "$required_version" "${image_version:-未知}" >&2
		return 1
	fi
)

numeric_component_is_newer() {
	new_component=$1
	current_component=$2
	[ "$new_component" != "$current_component" ] || return 1
	new_length=${#new_component}
	current_length=${#current_component}
	[ "$new_length" -gt "$current_length" ] && return 0
	[ "$new_length" -lt "$current_length" ] && return 1
	first_component=$(printf '%s\n%s\n' "$new_component" "$current_component" | LC_ALL=C sort | sed -n '1p')
	[ "$first_component" = "$current_component" ]
}

version_is_newer() {
	new_version=$1
	current_version=$2
	old_ifs=$IFS
	IFS=.
	set -- $new_version
	new_major=$1; new_minor=$2; new_patch=$3
	set -- $current_version
	current_major=$1; current_minor=$2; current_patch=$3
	IFS=$old_ifs

	if [ "$new_major" != "$current_major" ]; then numeric_component_is_newer "$new_major" "$current_major"; return $?; fi
	if [ "$new_minor" != "$current_minor" ]; then numeric_component_is_newer "$new_minor" "$current_minor"; return $?; fi
	if [ "$new_patch" != "$current_patch" ]; then numeric_component_is_newer "$new_patch" "$current_patch"; return $?; fi
	return 1
}

download_update_file() {
	url=$1
	destination=$2
	rm -f "$destination"
	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -q -U 'qidian-luci-updater' -O "$destination" "$url"
	elif command -v wget >/dev/null 2>&1; then
		wget -q --user-agent='qidian-luci-updater' -O "$destination" "$url"
	else
		printf '缺少 uclient-fetch 或 wget，无法下载更新文件。\n' >&2
		return 127
	fi
}

release_asset_url() {
	asset_name=$1
	asset_label=$2
	asset_url=$(jsonfilter -i "$UPDATE_WORK_DIR/release.json" -e "@.assets[@.name='$asset_name'].browser_download_url" 2>/dev/null || true)
	[ -n "$asset_url" ] || asset_url=$(jsonfilter -i "$UPDATE_WORK_DIR/release.json" -e "@.assets[@.label='$asset_label'].browser_download_url" 2>/dev/null || true)
	case "$asset_url" in "$UPDATE_ASSET_PREFIX"*) printf '%s' "$asset_url" ;; *) return 1 ;; esac
}

check_and_apply_updates() {
	update_failed=0
	if ! command -v jsonfilter >/dev/null 2>&1; then
		printf '缺少 jsonfilter，无法读取 Release 信息。\n'
		return 1
	fi
	if ! command -v sha256sum >/dev/null 2>&1; then
		printf '缺少 sha256sum，无法安全验证管理插件安装包。\n'
		return 1
	fi
	UPDATE_WORK_DIR=$(mktemp -d /tmp/qidian-check-update.XXXXXX) || { printf '无法创建临时更新目录。\n'; return 1; }
	printf '正在检查栖点管理插件和 Docker 镜像版本…\n'
	if ! download_update_file "https://api.github.com/repos/$RELEASE_REPOSITORY/releases/latest" "$UPDATE_WORK_DIR/release.json"; then
		printf '无法读取最新 Release，请检查设备网络、DNS 和 HTTPS 证书。\n'
		return 1
	fi
	latest_tag=$(jsonfilter -i "$UPDATE_WORK_DIR/release.json" -e '@.tag_name' 2>/dev/null || true)
	case "$latest_tag" in v*) latest_version=${latest_tag#v} ;; *) latest_version= ;; esac
	if ! is_version "$latest_version"; then
		printf '最新 Release 版本号无效，已停止更新。\n'
		return 1
	fi
	UPDATE_ASSET_PREFIX="https://github.com/$RELEASE_REPOSITORY/releases/download/$latest_tag/"
	installed_plugin_version=$(cat /etc/qidian-version 2>/dev/null || true)
	if ! is_version "$installed_plugin_version"; then
		printf '无法读取有效的管理插件版本，已停止更新以避免错误覆盖。\n'
		return 1
	fi
	plugin_needs_update=false
	plugin_is_ahead=false
	if version_is_newer "$latest_version" "$installed_plugin_version"; then
		plugin_needs_update=true
	elif version_is_newer "$installed_plugin_version" "$latest_version"; then
		plugin_is_ahead=true
	fi

	container_state=$(docker inspect --format '{{.State.Status}}' qidian 2>/dev/null || true)
	image_needs_update=false
	image_is_ahead=false
	container_version=
	if [ -n "$container_state" ]; then
		container_version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' qidian 2>/dev/null | sed -n 's/^QIDIAN_VERSION=//p' | sed -n '1p')
		if ! is_version "$container_version"; then
			printf '容器版本信息不可用，将按需要更新到最新镜像判断。\n'
			container_version=0.0.0
		fi
		if version_is_newer "$latest_version" "$container_version"; then image_needs_update=true; fi
		if version_is_newer "$container_version" "$latest_version"; then image_is_ahead=true; fi
		printf 'Docker 镜像：当前 %s，最新 %s。\n' "$container_version" "$latest_version"
	else
		printf '未检测到栖点容器，跳过镜像更新。\n'
	fi
	printf '管理插件：当前 %s，最新 %s。\n' "$installed_plugin_version" "$latest_version"

	if [ "$plugin_needs_update" = true ]; then
		archive="栖点-$latest_version.run"
		checksum="$archive.sha256"
		installer_name="qidian-$latest_version.run"
		checksum_name="qidian-$latest_version.run.release.sha256"
		installer_url=$(release_asset_url "$installer_name" "$archive" || true)
		checksum_url=$(release_asset_url "$checksum_name" "$checksum" || true)
		if [ -z "$installer_url" ] || [ -z "$checksum_url" ]; then
			printf 'Release 缺少管理插件安装包或 SHA-256 文件，跳过插件更新。\n'
			update_failed=1
		elif ! download_update_file "$installer_url" "$UPDATE_WORK_DIR/$archive" || ! download_update_file "$checksum_url" "$UPDATE_WORK_DIR/$checksum"; then
			printf '管理插件安装包下载失败，跳过插件更新。\n'
			update_failed=1
		elif ! (cd "$UPDATE_WORK_DIR" && sha256sum -c "$checksum"); then
			printf '管理插件安装包 SHA-256 校验失败，未执行安装包。\n'
			update_failed=1
		else
			printf '校验通过，正在更新 LuCI 管理插件…\n'
			chmod 755 "$UPDATE_WORK_DIR/$archive"
			if (cd "$UPDATE_WORK_DIR" && QIDIAN_UPDATE_WORKER=1 "./$archive") && [ "$(cat /etc/qidian-version 2>/dev/null || true)" = "$latest_version" ]; then
				QIDIAN_PACKAGE_UPDATED=true
				printf 'LuCI 管理插件已更新到 %s。\n' "$latest_version"
			else
				printf 'LuCI 管理插件更新失败，继续检查 Docker 镜像。\n'
				update_failed=1
			fi
		fi
	elif [ "$plugin_is_ahead" = true ]; then
		printf 'LuCI 管理插件版本高于最新 Release，保留当前版本。\n'
	else
		printf 'LuCI 管理插件已是最新版本。\n'
	fi

	if [ "$image_needs_update" = true ]; then
		printf '正在准备 Docker 数据目录和 Compose 配置…\n'
		if prepare; then
			image_name=$IMAGE_REPOSITORY:latest
			printf '正在拉取 Docker 镜像 %s…\n' "$image_name"
			remember_replaced_images "$image_name"
			if docker pull "$image_name" && verify_image_version "$image_name" "$latest_version"; then
				set_env QIDIAN_IMAGE "$image_name"
				deployed_image=$(docker image inspect --format '{{.Id}}' "$image_name") || return 1
				cd "$INSTALL_DIR"
				if [ "$container_state" = running ]; then
					if compose up -d --no-build --force-recreate qidian; then
						updated_version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' qidian 2>/dev/null | sed -n 's/^QIDIAN_VERSION=//p' | sed -n '1p')
						if wait_for_ready_image "$deployed_image" && [ "$updated_version" = "$latest_version" ]; then
							cleanup_replaced_images "$deployed_image"
							rm -f "$DEPLOY_FAILED"
							printf 'Docker 镜像已更新到 %s，栖点服务运行正常。\n' "$latest_version"
						else
							printf '镜像已拉取，但新容器未能在等待时间内确认运行。\n'
							touch "$DEPLOY_FAILED"
							update_failed=1
						fi
					else
						printf '镜像已拉取，但容器重建失败。\n'
						touch "$DEPLOY_FAILED"
						update_failed=1
					fi
				else
					if compose create --force-recreate qidian; then
						updated_version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' qidian 2>/dev/null | sed -n 's/^QIDIAN_VERSION=//p' | sed -n '1p')
						if [ "$updated_version" = "$latest_version" ]; then
							rm -f "$DEPLOY_FAILED"
							printf 'Docker 镜像和容器已更新到 %s；服务保持停止状态。\n' "$latest_version"
							printf '服务未启动验证，保留旧镜像。\n'
						else
							printf '镜像已拉取，但停止状态的容器未能确认更新。\n'
							touch "$DEPLOY_FAILED"
							update_failed=1
						fi
					else
						printf '镜像已拉取，但停止状态的容器重建失败。\n'
						touch "$DEPLOY_FAILED"
						update_failed=1
					fi
				fi
			else
				printf 'Docker 镜像拉取或版本校验失败，现有容器未替换。\n'
				update_failed=1
			fi
		else
			printf 'Docker 环境或数据目录检查失败，未更新镜像。\n'
			update_failed=1
		fi
	elif [ -n "$container_state" ] && [ "$image_is_ahead" = true ]; then
		printf 'Docker 镜像版本高于最新 Release，保留当前版本。\n'
	elif [ -n "$container_state" ]; then
		printf 'Docker 镜像已是最新版本。\n'
	fi

	if [ "$update_failed" -eq 0 ]; then printf '检查并更新完成。\n'; fi
	rm -rf "$UPDATE_WORK_DIR"
	UPDATE_WORK_DIR=
	return "$update_failed"
}

validate_path() {
	case "$1" in /*) ;; *) fail "数据目录必须是绝对路径：$1" ;; esac
	case "$1" in *:*) fail "数据目录不能包含冒号：$1" ;; esac
	case "/$1/" in *"/../"*) fail "数据目录不能包含上级目录：$1" ;; esac
	[ "$1" != / ] || fail '数据目录不能是根目录。'
}

set_config() {
	uci set "qidian.main.$1=$2"
	uci commit qidian
}

prepare_update_control() {
	data_dir=$1
	validate_path "$data_dir"
	# This directory is not mounted from the container's writable data volume.
	control_dir=$INSTALL_DIR/update-control
	[ ! -L "$INSTALL_DIR" ] || fail '设备更新目录不能是符号链接。'
	# Older releases pointed this path into /data. Remove only the link itself;
	# never follow or migrate files supplied by the container.
	if [ -L "$control_dir" ]; then rm -f "$control_dir" || fail '无法移除旧的更新控制目录链接。'; fi
	[ ! -e "$control_dir" ] || [ -d "$control_dir" ] || fail '更新控制目录路径类型无效。'
	mkdir -p "$control_dir"
	for part in inbox outbox; do
		part_dir=$control_dir/$part
		if [ -L "$part_dir" ]; then rm -f "$part_dir" || fail "无法移除不安全的更新目录链接：$part"; fi
		[ ! -e "$part_dir" ] || [ -d "$part_dir" ] || fail "更新目录路径类型无效：$part"
		mkdir -p "$part_dir"
	done
	chown root:1000 "$control_dir/inbox"
	chmod 1730 "$control_dir/inbox"
	chown root:root "$control_dir/outbox"
	chmod 755 "$control_dir/outbox"
	set_config update_control_path "$control_dir"
}

prepare_update_control_if_ready() {
	docker_root=$(detect_root 2>/dev/null || true)
	data_dir=$(uci -q get qidian.main.data_path 2>/dev/null || true)
	if [ -z "$data_dir" ]; then
		[ -n "$docker_root" ] || return 0
		data_dir=${docker_root%/}/volumes/qidian/data
	fi
	validate_path "$data_dir"
	[ -d "$data_dir" ] && [ -f "$data_dir/.qidian-storage" ] || return 0
	if [ -n "$docker_root" ]; then
		docker_root=${docker_root%/}
		case "$data_dir" in "$docker_root"/*) ;; *) return 1 ;; esac
	fi
	prepare_update_control "$data_dir"
}

set_env() {
	key=$1
	value=$2
	if grep -q "^$key=" "$ENV_FILE"; then
		tmp_file=$ENV_FILE.tmp
		awk -v key="$key" -v value="$value" 'BEGIN { done = 0 } index($0, key "=") == 1 { if (!done) print key "=" value; done = 1; next } { print } END { if (!done) print key "=" value }' "$ENV_FILE" > "$tmp_file"
		chmod 600 "$tmp_file"
		mv "$tmp_file" "$ENV_FILE"
	else
		printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
		chmod 600 "$ENV_FILE"
	fi
}

configured_image() (
	saved_image=$(sed -n 's/^QIDIAN_IMAGE=//p' "$ENV_FILE" 2>/dev/null | tail -n 1)
	[ -n "$saved_image" ] || saved_image=$IMAGE_REPOSITORY:latest
	case "$saved_image" in
		"$IMAGE_REPOSITORY":*|luckyalanzhou/qidian:*)
			saved_tag=${saved_image##*:}
			[ "$saved_tag" = latest ] || is_version "$saved_tag" || return 1
			;;
		sha256:*) printf '%s\n' "$saved_image" | grep -Eq '^sha256:[a-f0-9]{64}$' || return 1 ;;
		*) return 1 ;;
	esac
	printf '%s\n' "$saved_image"
)

prepare() {
	[ "$(id -u)" -eq 0 ] || fail '请使用 OpenWrt 管理员身份操作。'
	[ -f "$COMPOSE_FILE" ] || fail '缺少 Compose 配置；请重新安装栖点管理包。'
	command -v docker >/dev/null 2>&1 || fail '未检测到 Docker。'
	docker info >/dev/null 2>&1 || fail 'Docker 服务尚未启动。'

	docker_root=$(detect_root) || fail '无法读取 Docker 挂载目录。'
	case "$docker_root" in /*) ;; *) fail "Docker 挂载目录无效：$docker_root" ;; esac
	docker_root=${docker_root%/}
	[ -n "$docker_root" ] && [ "$docker_root" != / ] || fail 'Docker 数据根目录不能是系统根目录。'
	case "$docker_root" in *:*) fail "Docker 挂载目录不能包含冒号：$docker_root" ;; esac
	case "/$docker_root/" in *"/../"*) fail 'Docker 挂载目录不能包含上级目录。' ;; esac

	registration_enabled=$(uci -q get qidian.main.registration_enabled 2>/dev/null || true)
	case "$registration_enabled" in 1|true) registration_enabled=true ;; *) registration_enabled=false ;; esac
	trust_proxy_enabled=$(uci -q get qidian.main.trust_proxy_enabled 2>/dev/null || true)
	case "$trust_proxy_enabled" in 1|true) trust_proxy_enabled=true ;; *) trust_proxy_enabled=false ;; esac
	trusted_proxy_ip=$(uci -q get qidian.main.trusted_proxy_ip 2>/dev/null || true)
	if [ "$trust_proxy_enabled" = true ]; then
		[ -n "$trusted_proxy_ip" ] || fail '启用反向代理信任前，请填写直接连接栖点容器的代理 IP。'
		case "$trusted_proxy_ip" in *[!a-fA-F0-9:.]*) fail '反向代理 IP 格式无效。' ;; esac
	fi

	data_dir=$(uci -q get qidian.main.data_path 2>/dev/null || true)
	legacy_data=$(sed -n 's/^QIDIAN_DATA_PATH=//p' "$ENV_FILE" 2>/dev/null | tail -n 1)
	if [ -n "$legacy_data" ] && [ -f "$legacy_data/.qidian-storage" ]; then
		if [ -n "$data_dir" ] && [ "$data_dir" != "$legacy_data" ]; then
			fail "配置目录与现有知识库目录不一致：现有 $legacy_data；配置 $data_dir。已停止以保护原数据。"
		fi
		data_dir=$legacy_data
	fi
	# Older installers could copy the example /var/lib path into a fresh
	# device before detecting its real Docker root.  Discard only that
	# uninitialized placeholder; a marked existing knowledge base is never moved.
	if [ "$data_dir" = /var/lib/docker/volumes/qidian/data ] && [ "$docker_root" != /var/lib/docker ] && [ ! -f "$data_dir/.qidian-storage" ]; then
		data_dir=
	fi
	[ -n "$data_dir" ] || data_dir=$docker_root/volumes/qidian/data
	validate_path "$data_dir"
	case "$data_dir" in "$docker_root"/*) ;; *) fail "知识库数据必须位于 Docker 挂载目录 $docker_root 下。" ;; esac
	if [ -f "$data_dir/.qidian-storage" ]; then
		:
	else
		mkdir -p "$data_dir"
		if [ -n "$(find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
			fail "数据目录已有文件但没有栖点标记，停止安装以避免覆盖：$data_dir"
		fi
		printf 'qidian data directory created by the Qidian device manager\n' > "$data_dir/.qidian-storage"
	fi

	chown 1000:1000 "$data_dir"
	prepare_update_control "$data_dir"
	request_dir=$control_dir/inbox
	status_dir=$control_dir/outbox

	if [ ! -f "$ENV_FILE" ]; then
		cp /opt/qidian/.env.example "$ENV_FILE"
	fi
	chmod 600 "$ENV_FILE"
	set_env QIDIAN_DATA_PATH "$data_dir"
	set_env APP_BIND_ADDRESS 0.0.0.0
	set_env REGISTRATION_ENABLED "$registration_enabled"
	set_env TRUST_PROXY "$trust_proxy_enabled"
	set_env TRUSTED_PROXY_IPS "$trusted_proxy_ip"
	app_version=$(cat /etc/qidian-version 2>/dev/null || printf '0.0.0')
	printf '%s\n' "$app_version" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || fail '安装包版本号无效。'
	set_env QIDIAN_VERSION "$app_version"
	image_name=$(configured_image) || fail '镜像配置无效，未修改现有容器。'
	set_env QIDIAN_IMAGE "$image_name"
	set_env QIDIAN_UPDATE_REQUEST_PATH "$request_dir"
	set_env QIDIAN_UPDATE_STATUS_PATH "$status_dir"
	set_config data_path "$data_dir"
	compose_setup
}

run_operation() {
	action=$1
	[ "$(id -u)" -eq 0 ] || fail '请使用 OpenWrt 管理员身份操作。'
	lock_owned=0
	if [ "${QIDIAN_UPDATE_WORKER:-0}" = 1 ]; then
		[ -d "$WEB_UPDATE_LOCK" ] && [ -d "$LOCK_DIR" ] || fail '网页更新锁已失效，已停止设备操作。'
	elif [ "${QIDIAN_INSTALL_LOCK_HELD:-0}" = 1 ]; then
		[ -d "$LOCK_DIR" ] && [ ! -d "$WEB_UPDATE_LOCK" ] || fail '安装锁已失效，已停止部署。'
	else
		if [ -d "$WEB_UPDATE_LOCK" ]; then
			fail '网页在线更新正在执行，请稍后再试。'
		fi
		if ! mkdir "$LOCK_DIR" 2>/dev/null; then
			rm -f /tmp/qidian-operation.queued
			fail '另一项操作正在执行，请稍后刷新页面。'
		fi
		lock_owned=1
	fi
	unset QIDIAN_INSTALL_LOCK_HELD
	rm -f /tmp/qidian-operation.queued
	printf 'running\n' > /tmp/qidian-operation.result
	finish_operation() {
		result=$?
		trap - EXIT HUP INT TERM
		if [ -n "$UPDATE_WORK_DIR" ]; then
			case "$UPDATE_WORK_DIR" in /tmp/qidian-check-update.*) rm -rf "$UPDATE_WORK_DIR" ;; esac
		fi
		if [ "$QIDIAN_PACKAGE_UPDATED" = true ]; then
			printf '正在重启 LuCI 更新管理服务…\n' >> /tmp/qidian-operation.log
			if ! /etc/init.d/qidian-updater restart >/dev/null 2>&1 && ! /etc/init.d/qidian-updater start >/dev/null 2>&1; then
				printf '管理插件已更新，但更新管理服务未能重启。\n' >> /tmp/qidian-operation.log
				result=1
			else
				printf 'LuCI 更新管理服务已重启。\n' >> /tmp/qidian-operation.log
			fi
		fi
		if [ "$result" -eq 0 ]; then
			printf 'success\n' > /tmp/qidian-operation.result
		else
			printf 'failed\n' > /tmp/qidian-operation.result
		fi
		case "$action" in
			install|upgrade|install-package)
				if [ "$result" -eq 0 ]; then rm -f "$DEPLOY_FAILED"; else touch "$DEPLOY_FAILED"; fi
				;;
		esac
		rm -f /tmp/qidian-operation.queued
		[ -z "$UPDATE_WORKER_PATH" ] || rm -f "$UPDATE_WORKER_PATH"
		[ "$lock_owned" = 1 ] && rmdir "$LOCK_DIR" 2>/dev/null || true
		exit "$result"
	}
	trap finish_operation EXIT
	trap 'exit 1' HUP INT TERM

	case "$action" in
		apply-config)
			if ! docker info >/dev/null 2>&1; then
				fail 'Docker 服务尚未启动，配置已保存；启动 Docker 后请重新保存并应用。'
			fi
			if ! docker inspect --type container qidian >/dev/null 2>&1; then
				printf '配置已保存；栖点尚未部署，设置将在部署时应用。\n'
				return 0
			fi
			deployment_state=$(docker inspect --type container --format '{{.State.Status}}' qidian) || fail '无法读取容器状态。'
			deployed_image=$(docker inspect --type container --format '{{.Image}}' qidian) || fail '无法读取容器镜像。'
			docker image inspect "$deployed_image" >/dev/null 2>&1 || fail '当前容器镜像不可用，请先检查更新。'
			printf '正在应用栖点容器配置…\n'
			prepare
			set_env QIDIAN_IMAGE "$deployed_image"
			cd "$INSTALL_DIR"
			recreate_container "$deployment_state" "$deployed_image" || fail '容器配置应用失败，请查看日志。'
			printf '配置已应用，栖点容器已重建。\n'
			;;
		install|upgrade|install-package)
			printf '正在检查 Docker 与数据目录…\n'
			deployment_state=$(docker inspect --type container --format '{{.State.Status}}' qidian 2>/dev/null || true)
			prepare
			if [ "${QIDIAN_UPDATE_WORKER:-0}" = 1 ]; then
				exec >> "$status_dir/update.log" 2>&1
			fi
			printf '正在拉取适合当前设备架构的栖点成品镜像（端口 9908）…\n'
			image_name=$IMAGE_REPOSITORY:latest
			if [ "$action" = install-package ]; then
				deployment_version=$(cat /etc/qidian-version 2>/dev/null || true)
				is_version "$deployment_version" || fail '安装包版本无效，已停止部署。'
				image_name=$IMAGE_REPOSITORY:$deployment_version
			fi
			remember_replaced_images "$image_name"
			docker pull "$image_name"
			if [ "$action" = install-package ]; then
				verify_image_version "$image_name" "$deployment_version" || fail '安装包对应的镜像版本校验失败。'
			elif [ "${QIDIAN_UPDATE_WORKER:-0}" = 1 ]; then
				target_version=${QIDIAN_TARGET_VERSION:-$(cat /etc/qidian-version 2>/dev/null || true)}
				verify_image_version "$image_name" "$target_version" || fail 'latest 镜像尚未同步到目标版本。'
			fi
			set_env QIDIAN_IMAGE "$image_name"
			deployed_image=$(docker image inspect --format '{{.Id}}' "$image_name")
			cd "$INSTALL_DIR"
			recreate_container "$deployment_state" "$deployed_image" || fail '容器部署失败，旧镜像已保留。'
			if [ -z "$deployment_state" ] || [ "$deployment_state" = running ]; then
				cleanup_replaced_images "$deployed_image"
			fi
			if [ "${QIDIAN_UPDATE_WORKER:-0}" != 1 ] && [ -x /etc/init.d/qidian-updater ]; then
				/etc/init.d/qidian-updater enable
				/etc/init.d/qidian-updater restart || /etc/init.d/qidian-updater start
			fi
			printf '\n栖点部署完成。\n'
			printf '访问端口：9908（HTTP）\n'
			printf '数据目录：%s\n' "$(uci -q get qidian.main.data_path)"
			printf '请允许 OpenWrt 网关 TCP 9908 入站，并按需配置路由器端口转发。\n'
			;;
		check-update)
			check_and_apply_updates
			;;
		start)
			prepare
			cd "$INSTALL_DIR"
			compose up -d --no-build qidian
			printf '栖点已启动。\n'
			;;
		stop|remove)
			compose_setup
			if [ -f "$COMPOSE_FILE" ]; then
				cd "$INSTALL_DIR"
				if [ "$action" = remove ]; then
					compose down
					printf '栖点容器已卸载；知识库、附件和配置仍保留在 Docker 挂载目录及 /opt/qidian。\n'
				else
					compose stop qidian
					printf '栖点已停止。\n'
				fi
			fi
			;;
		*) fail "未知操作：$action" ;;
	esac
}

case "${1:-status}" in
	status) status ;;
	account-status) account_status ;;
	prepare-control) prepare_update_control_if_ready ;;
	check-update)
		worker=/tmp/qidian-check-update-worker.$$.sh
		cp "$0" "$worker" || { rm -f /tmp/qidian-operation.queued; fail '无法启动安全的更新任务。'; }
		chmod 700 "$worker" || { rm -f "$worker" /tmp/qidian-operation.queued; fail '无法启动安全的更新任务。'; }
		exec /bin/sh "$worker" check-update-worker
		;;
	check-update-worker)
		UPDATE_WORKER_PATH=$0
		trap 'rm -f "$UPDATE_WORKER_PATH" /tmp/qidian-operation.queued' EXIT
		run_operation check-update
		;;
	apply-config|install|upgrade|install-package|start|stop|remove) run_operation "$1" ;;
	*) fail "未知操作：$1" ;;
esac
