#!/bin/sh

REPOSITORY=luckyalanzhou/qidian
INSTALL_DIR=/opt/qidian
CONTROL_ROOT=$INSTALL_DIR/update-control
LOCK_DIR=/tmp/qidian-web-update.lock
OPERATION_LOCK=/tmp/qidian-operation.lock

write_state() {
	state=$1
	version=$2
	stamp=$(date +%s)
	tmp=$STATE_FILE.tmp
	printf '%s\t%s\t%s\n' "$state" "$version" "$stamp" > "$tmp"
	mv "$tmp" "$STATE_FILE"
}

append_log() { printf '%s\n' "$*" >> "$LOG_FILE"; }

release_asset_url() {
	asset_name=$1
	asset_label=${2:-$asset_name}
	asset_url=$(jsonfilter -i "$work_dir/release.json" -e "@.assets[@.name='$asset_name'].browser_download_url" 2>/dev/null || true)
	[ -n "$asset_url" ] || asset_url=$(jsonfilter -i "$work_dir/release.json" -e "@.assets[@.label='$asset_label'].browser_download_url" 2>/dev/null || true)
	case "$asset_url" in "$asset_prefix"*) printf '%s' "$asset_url" ;; *) return 1 ;; esac
}

download() {
	url=$1
	destination=$2
	download_name=${url##*/}
	result_file=$destination.result.$$
	rm -f "$result_file"
	append_log "开始下载 $download_name…"
	if command -v uclient-fetch >/dev/null 2>&1; then
		(
			if uclient-fetch -q -U 'qidian-istoreos-updater' -O "$destination" "$url"; then result=0; else result=$?; fi
			printf '%s\n' "$result" > "$result_file.tmp"
			mv "$result_file.tmp" "$result_file"
		) &
	elif command -v wget >/dev/null 2>&1; then
		(
			if wget -q --user-agent='qidian-istoreos-updater' -O "$destination" "$url"; then result=0; else result=$?; fi
			printf '%s\n' "$result" > "$result_file.tmp"
			mv "$result_file.tmp" "$result_file"
		) &
	else
		return 127
	fi
	download_pid=$!
	last_size=-1
	while [ ! -f "$result_file" ]; do
		if [ -f "$destination" ]; then
			download_size=$(wc -c < "$destination" 2>/dev/null | tr -d ' ')
			case "$download_size" in *[!0-9]*|'') download_size=0 ;; esac
			if [ "$download_size" != "$last_size" ]; then
				append_log "正在下载：已接收 $((download_size / 1024)) KB。"
				last_size=$download_size
			fi
		fi
		sleep 1
	done
	wait "$download_pid" 2>/dev/null || true
	download_result=$(cat "$result_file" 2>/dev/null || printf '1')
	rm -f "$result_file" "$result_file.tmp"
	[ "$download_result" = 0 ]
}

run_update() {
	job_file=$1
	lock_dir=$2
	status_dir=$3
	[ "$status_dir" = "$CONTROL_ROOT/outbox" ] && [ ! -L "$status_dir" ] && [ -d "$status_dir" ] || { printf '更新状态目录无效。\n' >&2; return 1; }
	STATE_FILE=$status_dir/update-status
	LOG_FILE=$status_dir/update.log
	work_dir=
	version=

	finish_update() {
		result=$?
		trap - EXIT HUP INT TERM
		if [ "$result" -eq 0 ]; then
			write_state success "$version"
			append_log "更新完成：栖点 $version 已启动。"
		else
			write_state failed "$version"
			append_log "更新未完成；请查看上方日志并稍后重试。"
		fi
		[ -z "$work_dir" ] || rm -rf "$work_dir"
		rm -f "$job_file"
		rmdir "$lock_dir" 2>/dev/null || true
		rmdir "$OPERATION_LOCK" 2>/dev/null || true
		exit "$result"
	}
	trap finish_update EXIT
	trap 'exit 1' HUP INT TERM

	[ "$(cat "$job_file" 2>/dev/null)" = update ] || { append_log '更新请求格式无效，已拒绝执行。'; exit 1; }
	if [ ! -d "$OPERATION_LOCK" ] || [ ! -d "$lock_dir" ]; then
		append_log '网页更新锁已失效，已停止设备操作。'
		exit 1
	fi
	: > "$LOG_FILE"
	write_state running ''
	append_log '正在连接公开版本源…'
	work_dir=$(mktemp -d /tmp/qidian-web-update.XXXXXX) || { append_log '无法创建临时更新目录。'; exit 1; }
	if ! download "https://api.github.com/repos/$REPOSITORY/releases/latest" "$work_dir/release.json"; then
		append_log '无法读取最新 Release；请检查设备的 DNS、网络和 HTTPS 证书。'
		exit 1
	fi
	if ! command -v jsonfilter >/dev/null 2>&1; then
		append_log '缺少 jsonfilter，请先通过设备软件包管理器安装该依赖。'
		exit 1
	fi
	tag=$(jsonfilter -i "$work_dir/release.json" -e '@.tag_name' 2>/dev/null || true)
	case "$tag" in v[0-9]*) version=${tag#v} ;; *) append_log 'Release 版本号无效。'; exit 1 ;; esac
	printf '%s\n' "$version" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || { append_log 'Release 版本号格式无效，已停止更新。'; exit 1; }
	write_state running "$version"
	asset_prefix="https://github.com/$REPOSITORY/releases/download/$tag/"
	archive="栖点-$version.run"
	checksum="$archive.sha256"
	asset_name="qidian-$version.run"
	checksum_asset_name="qidian-$version.run.release.sha256"
	asset_label=$archive
	checksum_label=$checksum
	installer_url=$(release_asset_url "$asset_name" "$asset_label") || { append_log 'Release 安装包链接无效。'; exit 1; }
	checksum_url=$(release_asset_url "$checksum_asset_name" "$checksum_label") || { append_log 'Release 校验文件链接无效。'; exit 1; }
	append_log "发现栖点 $version，正在下载安装包和校验文件…"
	if ! download "$installer_url" "$work_dir/$archive" || ! download "$checksum_url" "$work_dir/$checksum"; then
		append_log '安装包下载失败；请检查设备是否能访问 GitHub Release。'
		exit 1
	fi
	append_log '正在校验 SHA-256…'
	if ! (cd "$work_dir" && sha256sum -c "$checksum"); then
		append_log 'SHA-256 校验失败，安装包未执行。'
		exit 1
	fi
	append_log '校验通过，正在更新设备管理文件…'
	chmod 755 "$work_dir/$archive"
	if ! (cd "$work_dir" && QIDIAN_UPDATE_WORKER=1 "./$archive"); then
		append_log '管理包安装失败，已停止更新。'
		exit 1
	fi
	installed=$(cat /etc/qidian-version 2>/dev/null || true)
	[ "$installed" = "$version" ] || { append_log "安装包版本不匹配：预期 $version，设备记录为 $installed。"; exit 1; }
	append_log '管理文件已更新；等待 10 秒后拉取成品镜像并重启栖点服务以应用新版本…'
	sleep 10
	append_log '正在拉取适合当前设备架构的成品镜像并重启 Docker 容器…'
	if ! QIDIAN_UPDATE_WORKER=1 QIDIAN_TARGET_VERSION="$version" /usr/libexec/istorec/qidian.sh install; then
		append_log 'Docker 镜像拉取或启动失败，已停止更新。'
		exit 1
	fi
	append_log '正在确认容器已启动…'
	attempt=0
	while [ "$attempt" -lt 60 ]; do
		state=$(docker inspect --format '{{.State.Status}}' qidian 2>/dev/null || true)
		[ "$state" = running ] && return 0
		attempt=$((attempt + 1))
		sleep 2
	done
	append_log 'Docker 容器在等待时间内没有进入运行状态。'
	return 1
}

serve() {
	CONTROL_DIR=${1:-$(uci -q get qidian.main.update_control_path 2>/dev/null || true)}
	[ "$CONTROL_DIR" = "$CONTROL_ROOT" ] || return 1
	REQUEST_DIR=$CONTROL_DIR/inbox
	STATUS_DIR=$CONTROL_DIR/outbox
	[ ! -L "$CONTROL_DIR" ] && [ ! -L "$REQUEST_DIR" ] && [ ! -L "$STATUS_DIR" ] || return 1
	[ -d "$REQUEST_DIR" ] && [ -d "$STATUS_DIR" ] || return 1
	STATE_FILE=$STATUS_DIR/update-status
	LOG_FILE=$STATUS_DIR/update.log
	REQUEST_FILE=$REQUEST_DIR/update-request
	if [ "${QIDIAN_UPDATER_TEMP:-0}" != 1 ]; then
		worker=/tmp/qidian-update-service.$$.sh
		cp "$0" "$worker"
		chmod 700 "$worker"
		export QIDIAN_UPDATER_TEMP=1
		exec /bin/sh "$worker" serve "$CONTROL_DIR"
	fi
	mkdir -p "$REQUEST_DIR" "$STATUS_DIR"
	touch "$STATUS_DIR/update-agent-ready"
	trap 'rm -f "$STATUS_DIR/update-agent-ready"; exit 0' HUP INT TERM
	[ -f "$STATE_FILE" ] || write_state idle ''
	while :; do
		if [ -f "$REQUEST_FILE" ] && mkdir "$OPERATION_LOCK" 2>/dev/null; then
			if ! mkdir "$LOCK_DIR" 2>/dev/null; then
				rmdir "$OPERATION_LOCK" 2>/dev/null || true
				sleep 2
				continue
			fi
			write_state queued ''
			job_file=/tmp/qidian-web-update-request.$$
			worker=/tmp/qidian-web-update-worker.$$.sh
			if [ -f "$REQUEST_FILE" ] && [ ! -L "$REQUEST_FILE" ] && mv "$REQUEST_FILE" "$job_file" && cp /usr/libexec/istorec/qidian-updater.sh "$worker"; then
				chmod 700 "$worker"
				nohup /bin/sh "$worker" execute "$job_file" "$LOCK_DIR" "$STATUS_DIR" >> "$LOG_FILE" 2>&1 </dev/null &
			else
				rm -f "$job_file" "$worker"
				append_log '无法启动设备更新任务，请刷新后重试。'
				write_state failed ''
				rmdir "$LOCK_DIR" 2>/dev/null || true
				rmdir "$OPERATION_LOCK" 2>/dev/null || true
			fi
		fi
		sleep 2
	done
}

case "${1:-serve}" in
	serve) serve "${2:-}" ;;
	control-dir) uci -q get qidian.main.update_control_path 2>/dev/null ;;
	execute) run_update "${2:-}" "${3:-}" "${4:-$STATUS_DIR}" ;;
	*) printf '未知的更新操作。\n' >&2; exit 2 ;;
esac
