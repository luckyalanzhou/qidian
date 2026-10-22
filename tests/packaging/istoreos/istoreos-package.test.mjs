import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('LuCI version action retains its native form submission and follows operation state', async () => {
  const base = '../../../packaging/istoreos/luci-app-qidian/root/usr/lib/lua/luci/view/qidian/';
  const service = await read(`${base}status.htm`);
  const logs = await read(`${base}logs.htm`);
  const render = (template) => template
    .replaceAll('<%=util.pcdata(initial_status)%>', '操作进行中')
    .replaceAll('<%=util.pcdata(port)%>', '9908')
    .replaceAll('<%=busy and "true" or "false"%>', 'true')
    .replaceAll('<%=log_endpoint%>', '/log-data')
    .replace(/<%:([^%]+)%>/g, '$1')
    .replace(/<%[\s\S]*?%>/g, '');
  const script = (template) => render(template.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const controls = ['_start', '_stop', '_remove', '_install', '_check_update', '_clear_logs'].map(name =>
    `<div class="cbi-value" id="row${name}"><div class="cbi-value-title">Label</div><div class="cbi-value-field"><input type="submit" name="cbid.qidian.main.${name}" value="${name}"></div></div>`
  ).join('');
  const dom = new JSDOM(`<form>${render(service)}<div class="basic-tab">${controls}</div>${render(logs)}</form>`, {
    url: 'http://router.example/cgi-bin/luci/admin/services/qidian', runScripts: 'outside-only'
  });
  try {
    const { window } = dom, { document } = window;
    const update = document.querySelector('[name$="._check_update"]');
    const deploy = document.querySelector('[name$="._install"]');
    window.eval(script(service));
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert.equal(document.querySelector('#qidian-version-actions input'), update);
    assert.equal(update.form, document.querySelector('form'));
    assert.equal(update.name, 'cbid.qidian.main._check_update');
    assert.equal(document.getElementById('row_check_update'), null, 'remove the empty basic-settings row');
    assert.ok(deploy.closest('.basic-tab'), 'deployment remains with the settings');
    assert.equal(update.disabled, true);
    assert.equal(deploy.disabled, true);
    const scheduled = [];
    window.setTimeout = callback => scheduled.push(callback);
    window.fetch = async () => ({ ok: true, json: async () => ({
      busy: false, state: 'running', result: 'success', log: '更新完成'
    }) });
    window.eval(script(logs));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(update.disabled, false, 're-enable update after the operation finishes');
    assert.equal(deploy.disabled, false);
    assert.equal(deploy.closest('.cbi-value').hidden, true, 'hide retry after deployment succeeds');
    assert.equal(document.querySelector('[name$="._start"]').disabled, true);
    assert.equal(document.querySelector('[name$="._stop"]').disabled, false);
    assert.equal(document.getElementById('qidian-panel-log').value, '更新完成');
  } finally {
    dom.window.close();
  }
});

test('LuCI uninstall asks in a LuCI modal and submits only after confirmation', async () => {
  const service = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/lib/lua/luci/view/qidian/status.htm');
  const rendered = service
    .replaceAll('<%=util.pcdata(initial_status)%>', '栖点服务运行中')
    .replaceAll('<%=util.pcdata(port)%>', '9908')
    .replaceAll('<%=busy and "true" or "false"%>', 'false')
    .replace(/<%:([^%]+)%>/g, '$1')
    .replace(/<%[\s\S]*?%>/g, '');
  const script = rendered.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM(`<form>${rendered}<div class="basic-tab"><div class="cbi-value"><div class="cbi-value-field"><input type="submit" name="cbid.qidian.main._remove"></div></div></div></form>`, { runScripts:'outside-only' });
  try {
    const { window } = dom, { document } = window;
    let modalTitle = '', modal = null, submits = 0;
    window._ = text => text;
    window.E = (tag, attributes = {}, children = []) => {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) {
        if (name === 'click') element.addEventListener('click', value);
        else element.setAttribute(name, value);
      }
      for (const child of Array.isArray(children) ? children : [children]) {
        if (child) element.append(child.nodeType ? child : document.createTextNode(child));
      }
      return element;
    };
    window.ui = {
      showModal(title, children) { modalTitle = title; modal = document.createElement('section'); modal.setAttribute('role','dialog'); modal.append(...children); document.body.append(modal); },
      hideModal() { modal?.remove(); modal = null; }
    };
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submits++; });
    window.eval(script);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const remove = document.querySelector('[name$="._remove"]');
    remove.click();
    assert.equal(modalTitle, '确认卸载服务');
    assert.equal(modal.getAttribute('role'), 'dialog');
    assert.match(modal.textContent, /保留知识库数据、附件、证书和配置/);
    assert.equal(submits, 0, 'opening the modal must not submit the uninstall form');
    modal.querySelector('.btn:not(.cbi-button-negative)').click();
    assert.equal(modal, null, 'cancel closes the modal');
    assert.equal(submits, 0, 'cancel leaves the service installed');
    remove.click();
    modal.querySelector('.cbi-button-negative').click();
    assert.equal(submits, 1, 'confirm submits the existing LuCI action exactly once');
    assert.equal(modal, null);
  } finally { dom.window.close(); }
});

test('iStoreOS run payload stays lightweight and contains persistent manager UI and Compose files', async () => {
  const builder = await read('../../../packaging/istoreos/build-run.sh');
  assert.match(builder, /PAYLOAD\/root/);
  assert.match(builder, /"\$ROOT_DIR\/packaging\/istoreos\/compose\.yaml" "\$PAYLOAD\/compose\.yaml"/);
  assert.match(builder, /luci-app-qidian\/root/);
  assert.doesNotMatch(builder, /Dockerfile|pnpm-lock|PAYLOAD\/app|sqlite-adapter/);
  assert.match(builder, /OUTPUT_DIR=\$\{1:-"\$ROOT_DIR\/artifacts\/istoreos"\}/);
  assert.match(builder, /OUTPUT="\$OUTPUT_DIR\/qidian-\$\{VERSION\}\.run"/);
  assert.ok(builder.includes('=~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'), 'package versions use unbounded canonical SemVer integers');
  assert.match(builder, /sha256sum "\$\(basename -- "\$OUTPUT"\)"/);
});

test('iStoreOS release is manual and uses package.json as its single version source', async () => {
  const workflow = await read('../../../.github/workflows/istoreos-release.yml');
  const releaseVersionScript = await read('../../../scripts/release-version.mjs');
  const releaseWorkflow = workflow.slice(workflow.indexOf('  package:'));
  const pullRequestWorkflow = workflow.slice(workflow.indexOf('  verify:'), workflow.indexOf('  package:'));
  const workflowPreamble = workflow.slice(0, workflow.indexOf('jobs:'));
  const packageJobHeader = releaseWorkflow.slice(0, releaseWorkflow.indexOf('      - uses: actions/checkout'));

  assert.match(workflow, /pull_request:[\s\S]*?branches:[\s\S]*?- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflowPreamble, /secrets\./, 'publishing secrets must not be exposed at workflow scope');
  assert.doesNotMatch(packageJobHeader, /secrets\./, 'publishing secrets must be scoped to individual release steps');
  assert.match(workflow, /verify:\r?\n    if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /package:\r?\n    if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
    'publishing secrets must never be available to a manually dispatched non-main workflow revision');
  assert.match(workflow, /group: qidian-manual-release[\s\S]*?cancel-in-progress: false/);
  assert.match(workflow, /group: qidian-pr-\$\{\{ github\.event\.pull_request\.number \}\}[\s\S]*?cancel-in-progress: true/);
  assert.match(workflow, /name: Verify PR source[\s\S]*?pnpm check[\s\S]*?pnpm test[\s\S]*?pnpm build/);
  assert.match(workflow, /name: Smoke-test PR container/);
  assert.match(pullRequestWorkflow, /persist-credentials: false/);
  assert.doesNotMatch(pullRequestWorkflow, /secrets\.|push: true|gh release/);
  assert.doesNotMatch(pullRequestWorkflow, /setup-qemu-action/);
  assert.match(workflow, /release_notes:\r?\n\s+description: "中文发布说明：每行写一项用户可感知的改进或修复，不要填写提交标题或构建步骤"\r?\n\s+required: true/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /permissions:\r?\n  contents: read/);
  assert.match(releaseWorkflow, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1[\s\S]*?ref: main[\s\S]*?fetch-depth: 0[\s\S]*?token: \$\{\{ github\.token \}\}[\s\S]*?persist-credentials: false/);
  assert.doesNotMatch(releaseWorkflow.slice(releaseWorkflow.indexOf('name: Verify publishing secrets'), releaseWorkflow.indexOf('name: Select or resume release version')), /token: \$\{\{ secrets\.RELEASE_PUBLISH_TOKEN \}\}/);
  assert.match(releaseWorkflow, /name: Push release version bump to main[\s\S]*?RELEASE_PUBLISH_TOKEN: \$\{\{ secrets\.RELEASE_PUBLISH_TOKEN \}\}[\s\S]*?GIT_ASKPASS=\"\$askpass\" GIT_TERMINAL_PROMPT=0 git push origin HEAD:main/);
  assert.match(releaseWorkflow, /name: Push release version bump to main[\s\S]*?umask 077[\s\S]*?askpass=\$\(mktemp "\$RUNNER_TEMP\/qidian-release-askpass\.XXXXXX"\)[\s\S]*?trap 'rm -f "\$askpass"' EXIT[\s\S]*?chmod 700 "\$askpass"/);
  for (const [, actionRef] of workflow.matchAll(/^\s+uses: [^\s@]+@([^\s#]+)(?:\s+#.*)?$/gm)) {
    assert.match(actionRef, /^[0-9a-f]{40}$/, `external action reference must be pinned to a full commit SHA, got ${actionRef}`);
  }
  assert.match(workflow, /## 本版优化与新增/);
  assert.match(releaseWorkflow, /name: Validate release notes[\s\S]*?请填写面向使用者的中文发布说明/);
  assert.doesNotMatch(releaseWorkflow, /git log --reverse --format='%s'/);
  assert.match(releaseWorkflow, /## 获取与安装/);
  assert.doesNotMatch(releaseWorkflow, /源码版本已自动递增并提交到 `main`/);
  assert.match(workflow, /while \[\[ "\$detail" =~/);
  assert.match(workflow, /prefix=\$\{BASH_REMATCH\[0\]\}/);
  assert.match(workflow, /--notes-file "\$notes_file"/);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /release_mode|verification-only|Remote verification only|仅运行远程验收/);
  assert.match(workflow, /Verify publishing secrets/);
  assert.doesNotMatch(workflow, /- name: Verify publishing secrets\r?\n        if:/);
  assert.match(workflow, /test -n "\$DOCKERHUB_TOKEN"/);
  assert.match(workflow, /test -n "\$RELEASE_PUBLISH_TOKEN"/);
  assert.match(workflow, /Select or resume release version/);
  assert.match(workflow, /version=\$\(node scripts\/release-version\.mjs "\$RELEASE_BUMP"\)/);
  assert.match(workflow, /WORKFLOW_RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(workflow, /openwrt\/gh-action-sdk|artifacts\/openwrt|\.ipk|\.apk/);
  assert.match(workflow, /release_bump:[\s\S]*?options:[\s\S]*?- patch[\s\S]*?- minor[\s\S]*?- major[\s\S]*?default: patch/);
  assert.match(workflow, /node scripts\/release-version\.mjs/);
  assert.match(workflow, /RELEASE_PUBLISH_TOKEN/);
  assert.match(workflow, /Commit version bump to main/);
  assert.match(workflow, /sha256sum --check/);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(workflow, /pnpm\/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6\.1\.0/);
  assert.match(workflow, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\.1\.0/);
  assert.match(workflow, /docker\/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4\.4\.1/);
  assert.match(workflow, /docker\/login-action@dbcb813823bdd20940b903addbd779551569679f # v4\.6\.0/);
  assert.doesNotMatch(workflow, /- name: Sign in to Docker Hub\r?\n        if:/);
  assert.match(workflow, /username: luckyalanzhou/);
  assert.match(workflow, /password: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/);
  assert.match(workflow, /docker\/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7\.4\.0/);
  assert.match(workflow, /push: true/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /cache: pnpm/);
  assert.match(workflow, /cache-dependency-path: pnpm-lock\.yaml/);
  assert.match(workflow, /timeout-minutes: 60/);
  assert.match(workflow, /DOCKER_BUILD_RECORD_UPLOAD: false/);
  assert.match(workflow, /setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4\.4\.0[\s\S]*?platforms: arm64/);
  assert.match(workflow, /pnpm install --frozen-lockfile --prefer-offline/);
  assert.ok(releaseWorkflow.indexOf('name: Verify source') < releaseWorkflow.indexOf('docker/setup-qemu-action@'), 'source verification fails before Docker emulation setup');
  assert.ok(workflow.indexOf('name: Smoke-test self-hosted container') < workflow.indexOf('name: Sign in to Docker Hub'), 'Docker Hub login happens only after the local smoke test');
  assert.match(workflow, /Build amd64 image for smoke test[\s\S]*?platforms: linux\/amd64[\s\S]*?load: true/);
  assert.match(releaseWorkflow, /Build arm64 image for smoke test[\s\S]*?platforms: linux\/arm64[\s\S]*?load: true[\s\S]*?Smoke-test arm64 self-hosted container[\s\S]*?docker run --platform linux\/arm64[\s\S]*?\/readyz[\s\S]*?ready=true[\s\S]*?ARM64 container did not become ready[\s\S]*?\/api\/vault/);
  assert.equal((workflow.match(/ready=false/g) || []).length, 3, 'PR, amd64 release, and arm64 release smokes all require a successful readiness probe');
  assert.equal((workflow.match(/if \[ "\$ready" != true \]/g) || []).length, 3, 'all smoke paths fail if readiness never succeeds');
  assert.match(workflow, /curl --fail --silent http:\/\/127\.0\.0\.1:9908\/readyz/);
  assert.doesNotMatch(workflow, /docker build --pull/);
  assert.match(workflow, /cache-from: type=gha,scope=qidian-image/);
  assert.match(workflow, /cache-to: type=gha,mode=max,scope=qidian-image/);
  assert.match(workflow, /docker\.io\/luckyalanzhou\/qidian:\$\{\{ steps\.version\.outputs\.version \}\}/);
  assert.match(workflow, /docker\.io\/luckyalanzhou\/qidian:latest/);
  assert.match(workflow, /gh release create "\$tag" --draft/);
  assert.match(workflow, /gh release upload "\$tag"/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /\.assets\[\] \| \(\.label \/\/ \.name\)/);
  assert.match(workflow, /git\/refs\/tags\/\$\{tag\}/);
  assert.match(workflow, /--method PATCH/);
  assert.match(workflow, /gh release edit "v\$\{VERSION\}" --draft=false --latest/);
  assert.match(workflow, /docker buildx imagetools create/);
  for (const step of [
    'Install dependencies',
    'Verify source',
    'Build amd64 image for smoke test',
    'Smoke-test self-hosted container',
    'Build arm64 image for smoke test',
    'Smoke-test arm64 self-hosted container',
    'Build multi-architecture Docker image',
    'Build self-extracting .run installer',
    'Commit version bump to main',
    'Push release version bump to main',
    'Prepare verified GitHub Release',
    'Publish verified GitHub Release',
  ]) {
    assert.match(workflow, new RegExp(`- name: ${step}`));
    assert.match(workflow, new RegExp(`- name: ${step}\\r?\\n        if: steps\\.version\\.outputs\\.promote_only != 'true'`));
  }
  assert.match(releaseVersionScript, /promote_only=\$\{selection\.promoteOnly === true\}/);
  assert.doesNotMatch(workflow, /- name: Promote released image to latest\r?\n        if:/);
  assert.ok(workflow.indexOf('name: Prepare verified GitHub Release') < workflow.indexOf('name: Publish verified GitHub Release'));
  assert.ok(workflow.indexOf('name: Publish verified GitHub Release') < workflow.indexOf('name: Promote released image to latest'));
  assert.match(workflow, /Prepare release checksum with the public asset name/);
  assert.match(workflow, /run\.release\.sha256#栖点-/);
  assert.match(workflow, /qidian-\$\{version\}\.run#栖点-\$\{version\}\.run/);
  assert.match(workflow, /run\.release\.sha256#栖点-/);
  assert.match(workflow, /qidian-\$\{version\}\.run#栖点-\$\{version\}\.run/);
  assert.match(workflow, /for expected in "栖点-\$\{version\}\.run" "栖点-\$\{version\}\.run\.sha256"/);
  assert.match(workflow, /git add package\.json/);
  assert.equal((workflow.match(/gh release upload/g) ?? []).length, 1);
  assert.match(workflow, /gh release upload "\$tag"[\s\S]*?qidian-\$\{version\}\.run[\s\S]*?qidian-\$\{version\}\.run\.release\.sha256/);
});

test('update status and log documentation points to the host control directory', async () => {
  const architecture = await read('../../../docs/architecture.md');
  const verification = await read('../../../docs/verification.md');
  const updater = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian-updater.sh');

  assert.match(updater, /CONTROL_ROOT=\$INSTALL_DIR\/update-control/);
  assert.match(updater, /LOG_FILE=\$status_dir\/update\.log/);
  assert.match(architecture, /请求、状态和日志由 iStoreOS 宿主代理保存在宿主安装目录的 `update-control` 下/);
  assert.match(architecture, /`\/opt\/qidian\/update-control\/outbox\/update\.log`/);
  assert.doesNotMatch(architecture, /更新状态与日志放在该设备的 Docker 数据目录下/);
  assert.match(verification, /更新请求、状态和日志由 iStoreOS 宿主代理保存在宿主安装目录的 `update-control` 下/);
  assert.match(verification, /`\/opt\/qidian\/update-control\/outbox\/update\.log`/);
  assert.doesNotMatch(verification, /更新状态写入配置的数据目录/);
});

test('the declared Node runtime supports the SQLite API used by the server', async () => {
  const manifest = JSON.parse(await read('../../../package.json'));
  const sqliteAdapter = await read('../../../server/adapters/sqlite-adapter.mjs');

  assert.equal(manifest.engines.node, '>=22.13');
  assert.match(sqliteAdapter, /from 'node:sqlite'/);
});

test('the iStoreOS self-extracting installer installs the LuCI manager and records its version', async () => {
  const installer = await read('../../../packaging/istoreos/install.sh');

  assert.match(installer, /cp -a "\$SCRIPT_DIR\/root\/usr\/\." \/usr\//);
  assert.match(installer, /cat "\$SCRIPT_DIR\/version"/);
  assert.match(installer, /qidian\.sh prepare-control/);
  assert.match(installer, /qidian-updater enable/);
  assert.match(installer, /command -v jsonfilter/);
  assert.doesNotMatch(installer, /qidian-package-manager|docker build|compose up|rm -rf/i);
});

test('reinstall preserves LuCI config and delegates deployment without removing note data', async () => {
  const installer = await read('../../../packaging/istoreos/install.sh');
  assert.match(installer, /HAD_CONFIG=false/);
  assert.match(installer, /HAD_ENV=false/);
  assert.match(installer, /if \[ "\$HAD_ENV" = true \]; then/);
  assert.match(installer, /registration_enabled=0/);
  assert.match(installer, /OLD_REGISTRATION/);
  assert.match(installer, /if \[ "\$HAD_CONFIG" = false \]; then/);
  assert.match(installer, /cp -a "\$SCRIPT_DIR\/root\/usr\/\." \/usr\//);
  assert.match(installer, /cp -a "\$SCRIPT_DIR\/root\/etc\/init\.d\/\." \/etc\/init\.d\//);
  assert.doesNotMatch(installer, /docker build|compose up|rm -rf/i);
  assert.match(installer, /qidian\.sh prepare-control/);
  assert.match(installer, /qidian-updater enable/);
  assert.doesNotMatch(installer, /SCRIPT_DIR\/app|cp -a "\$SCRIPT_DIR\/app/);
});

test('web updates use a limited host agent, verify the public release checksum, and never mount Docker socket', async () => {
  const compose = await read('../../../packaging/istoreos/compose.yaml');
  const updater = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian-updater.sh');
  const init = await read('../../../packaging/istoreos/luci-app-qidian/root/etc/init.d/qidian-updater');
  const dockerfile = await read('../../../Dockerfile');
  const dockerignore = await read('../../../.dockerignore');

  assert.match(updater, /api\.github\.com\/repos\/\$REPOSITORY\/releases\/latest/);
  assert.match(updater, /@\.assets\[@\.label='\$asset_label'\]/);
  assert.match(updater, /@\.assets\[@\.name='\$asset_name'\]/);
  assert.match(updater, /sha256sum -c/);
  assert.match(updater, /栖点-\$version\.run/);
  assert.match(updater, /browser_download_url/);
  assert.match(updater, /archive="栖点-\$version\.run"/);
  assert.match(updater, /asset_name="qidian-\$version\.run"/);
  assert.match(updater, /checksum_asset_name="qidian-\$version\.run\.release\.sha256"/);
  assert.match(updater, /QIDIAN_UPDATE_WORKER=1 "\.\/\$archive"/);
  assert.doesNotMatch(updater, /update_format=(?:ipk|apk)|opkg install|apk add --allow-untrusted/);
  assert.ok(updater.includes("grep -Eq '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'"), 'updater validates canonical SemVer integers without fixed limits');
  assert.match(updater, /mkdir "\$OPERATION_LOCK"/);
  assert.match(updater, /rmdir "\$OPERATION_LOCK"/);
  assert.match(updater, /网页更新锁已失效/);
  assert.match(await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian.sh'), /QIDIAN_UPDATE_WORKER:-0/);
  assert.match(updater, /qidian\.sh install/);
  assert.match(updater, /拉取成品镜像/);
  assert.match(init, /procd_set_param command \/usr\/libexec\/istorec\/qidian-updater\.sh serve/);
  assert.ok(init.includes('[ "$control_dir" = /opt/qidian/update-control ] || return 0'));
  assert.match(compose, /QIDIAN_UPDATE_REQUEST_PATH:\?[^\n]*:\/run\/qidian-update-inbox/);
  assert.match(compose, /QIDIAN_UPDATE_STATUS_PATH:\?[^\n]*:\/run\/qidian-update-status:ro/);
  assert.doesNotMatch(compose, /docker\.sock/);
  assert.match(dockerfile, /ARG QIDIAN_VERSION/);
  assert.match(dockerfile, /FROM --platform=\$BUILDPLATFORM node:24-bookworm-slim AS build/);
  assert.match(dockerfile, /FROM gcr\.io\/distroless\/nodejs24-debian13:nonroot AS runtime/);
  assert.ok(dockerfile.indexOf('RUN pnpm fetch --frozen-lockfile') < dockerfile.indexOf('COPY package.json ./'), 'fetch dependencies before copying the versioned package manifest');
  assert.match(dockerfile, /pnpm install --offline --frozen-lockfile/);
  assert.match(dockerfile, /COPY --chown=1000:1000 server \.\/server/);
  assert.match(dockerfile, /COPY --from=build --chown=1000:1000 \/qidian-runtime\/data \/data/);
  assert.match(dockerfile, /COPY --from=build --chown=0:0 \/qidian-runtime\/run\/qidian-update-status \/run\/qidian-update-status/);
  assert.match(dockerfile, /USER 1000:1000/);
  assert.match(dockerfile, /\/nodejs\/bin\/node/);
  assert.match(dockerignore, /^\*\*$/m);
  assert.match(dockerignore, /^!src\/\*\*$/m);
  assert.doesNotMatch(dockerignore, /^!tests(?:\/|$)/m);
});

test('generic Docker install uses a device-managed named volume and has no host updater privileges', async () => {
  const compose = await read('../../../packaging/docker/compose.yaml');
  const environment = await read('../../../packaging/docker/env.example');

  assert.match(compose, /docker\.io\/luckyalanzhou\/qidian:latest/);
  assert.match(compose, /- qidian-data:\/data/);
  assert.match(compose, /name: qidian-data/);
  assert.match(compose, /:9908:9908/);
  assert.doesNotMatch(compose, /APP_PORT|PORT:/);
  assert.match(compose, /TRUST_PROXY: \$\{TRUST_PROXY:-false\}/);
  assert.match(compose, /TRUSTED_PROXY_IPS: \$\{TRUSTED_PROXY_IPS:-\}/);
  assert.doesNotMatch(compose, /docker\.sock|QIDIAN_UPDATE_REQUEST|QIDIAN_UPDATE_STATUS/);
  assert.doesNotMatch(compose, /build:/);
  assert.doesNotMatch(environment, /\/mnt\/|\/var\/lib\/docker/);
});

test('LuCI service manager defaults to 9908 and guards Docker-mounted knowledge data', async () => {
  const model = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/lib/lua/luci/model/cbi/qidian.lua');
  const manager = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian.sh');
  const updater = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian-updater.sh');
  const installer = await read('../../../packaging/istoreos/install.sh');
  const controller = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/lib/lua/luci/controller/qidian.lua');
  const applyTrigger = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/share/ucitrack/luci-app-qidian.json');

  assert.match(controller, /admin", "services", "qidian/);
  assert.doesNotMatch(model, /http_port|访问端口/);
  assert.match(manager, /data_dir=\$docker_root\/volumes\/qidian\/data/);
  assert.match(manager, /data_dir" = \/var\/lib\/docker\/volumes\/qidian\/data/);
  assert.match(manager, /\.qidian-storage/);
  assert.match(manager, /compose down/);
  assert.doesNotMatch(manager, /docker volume rm|rm -rf "\$data_dir/);
  assert.match(manager, /control_dir=\$INSTALL_DIR\/update-control/);
  assert.doesNotMatch(manager, /control_dir=\$data_dir\/\.qidian-update-control/);
  assert.match(updater, /CONTROL_ROOT=\$INSTALL_DIR\/update-control/);
  assert.ok(updater.includes('[ "$CONTROL_DIR" = "$CONTROL_ROOT" ] || return 1'));
  assert.match(manager, /if \[ -L "\$control_dir" \]; then rm -f "\$control_dir"/);
  assert.doesNotMatch(manager, /legacy_source=|old_dir=\$legacy_source/);
  assert.doesNotMatch(model, /Docker 与 Compose 已就绪|translate\("运行依赖"\)/);
  assert.match(model, /if not docker_ready or not compose_ready then/);
  assert.match(model, /if needs_deployment then/);
  assert.match(model, /button\(install, translate\("重试部署"\), "apply", "install-package"\)/);
  assert.match(model, /Flag, "registration_enabled"/);
  assert.match(model, /Flag, "trust_proxy_enabled"/);
  assert.match(model, /Value, "trusted_proxy_ip"/);
  assert.match(model, /trusted_proxy_ip\.datatype = "ipaddr"/);
  assert.match(model, /trusted_proxy_ip:depends\("trust_proxy_enabled", "1"\)/);
  assert.doesNotMatch(model, /remove\.description\s*=/, 'keep the uninstall data-retention warning in one place before confirmation');
  assert.ok(model.indexOf('local registration = s:taboption("basic", Flag') < model.indexOf('local install = s:taboption("basic", Button'), 'show settings before the deployment retry');
  assert.doesNotMatch(model, /data_path_display/, 'show the detected Docker data directory once in the service overview');
  assert.match(manager, /account-status\) account_status/);
  assert.match(manager, /set_env REGISTRATION_ENABLED/);
  assert.match(manager, /set_env TRUST_PROXY "\$trust_proxy_enabled"/);
  assert.match(manager, /set_env TRUSTED_PROXY_IPS "\$trusted_proxy_ip"/);
  assert.match(manager, /apply-config\)\s*if ! docker info/);
  assert.match(manager, /docker image inspect "\$deployed_image"/);
  assert.match(manager, /compose up -d --no-build --force-recreate qidian/);
  assert.match(manager, /apply-config\|install\|upgrade\|install-package\|start\|stop\|remove\) run_operation/);
  assert.match(applyTrigger, /"config":\s*"qidian"/);
  assert.match(applyTrigger, /"exec":\s*"\/usr\/libexec\/istorec\/qidian\.sh apply-config"/);
  assert.match(installer, /\/etc\/init\.d\/ucitrack restart \|\| \/etc\/init\.d\/ucitrack start/);
  assert.match(manager, /启用反向代理信任前，请填写直接连接栖点容器的代理 IP/);
  assert.match(manager, /IMAGE_REPOSITORY=docker\.io\/luckyalanzhou\/qidian/);
  assert.match(manager, /set_env QIDIAN_IMAGE "\$image_name"/);
  assert.match(manager, /image_name=\$IMAGE_REPOSITORY:latest/);
  assert.match(manager, /verify_image_version "\$image_name" "\$latest_version"/);
  assert.match(manager, /docker pull "\$image_name"/);
  assert.match(manager, /check-update\)\s*check_and_apply_updates/);
  assert.match(manager, /version_is_newer "\$latest_version" "\$installed_plugin_version"/);
  assert.match(manager, /version_is_newer "\$latest_version" "\$container_version"/);
  assert.match(manager, /sha256sum -c "\$checksum"/);
  assert.ok(manager.indexOf('sha256sum -c "$checksum"') < manager.indexOf('QIDIAN_UPDATE_WORKER=1 "./$archive"'), 'verify the plugin installer before execution');
  assert.match(manager, /QIDIAN_UPDATE_WORKER=1 "\.\/\$archive"/);
  assert.match(manager, /compose up -d --no-build --force-recreate qidian/);
  assert.match(manager, /compose create --force-recreate qidian/);
  assert.match(manager, /check-update-worker/);
  assert.match(manager, /cp "\$0" "\$worker"/);
  assert.doesNotMatch(manager, /docker volume rm|rm -rf "\$data_dir/);
  assert.match(model, /s:taboption\("basic", Button, "_check_update", ""\)/);
  assert.match(model, /button\(updates, translate\("检查更新"\), "apply", "check-update"\)/);
  assert.match(model, /button\(start, translate\("启动服务"\), "apply", "start"\)/);
  assert.match(model, /button\(stop, translate\("停止服务"\), "reset", "stop"\)/);
  assert.match(model, /button\(remove, translate\("卸载服务"\), "remove", "remove"\)/);
  assert.doesNotMatch(model, /发现更新时自动安装。/);
  assert.doesNotMatch(manager, /docker build/);
});

test('Docker service and LuCI use HTTP 9908 without requiring certificates', async () => {
  const dockerfile = await read('../../../Dockerfile');
  const compose = await read('../../../packaging/istoreos/compose.yaml');
  const manager = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian.sh');
  const installer = await read('../../../packaging/istoreos/install.sh');
  const view = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/lib/lua/luci/view/qidian/status.htm');

  assert.match(dockerfile, /node:http.*http:\/\/127\.0\.0\.1:9908\/readyz/);
  assert.match(compose, /:9908:9908/);
  assert.doesNotMatch(compose, /APP_PORT|PORT:/);
  assert.doesNotMatch(manager, /qidian\.main\.http_port|APP_PORT/);
  assert.match(manager, /http:\/\/127\.0\.0\.1:9908\/api\/auth\/config/);
  assert.match(installer, /uci -q delete qidian\.main\.http_port/);
  assert.match(view, /http:\/\/localhost:9908/);
  assert.match(view, /var port = "9908"/);
  assert.match(compose, /QIDIAN_DATA_PATH:\?请先在LuCI执行安装或更新/);
  assert.match(compose, /QIDIAN_IMAGE:\?请先在LuCI执行安装或更新/);
  assert.doesNotMatch(compose, /TLS_CERT_PATH|TLS_KEY_PATH|certs\//);
  assert.doesNotMatch(manager, /openssl req|QIDIAN_CERT_PATH|QIDIAN_KEY_PATH/);
  assert.match(installer, /QIDIAN_INSTALL_LOCK_HELD=1 \/usr\/libexec\/istorec\/qidian\.sh install-package/);
  assert.ok(view.includes('href="http://localhost:'));
  assert.ok(view.includes('"http://" + window.location.hostname'));
});

test('LuCI uses native CBI sections, controls, tabs, and log output', async () => {
  const base = '../../../packaging/istoreos/luci-app-qidian/root/usr/lib/lua/luci/';
  const controller = await read(`${base}controller/qidian.lua`);
  const model = await read(`${base}model/cbi/qidian.lua`);
  const service = await read(`${base}view/qidian/status.htm`);
  const account = await read(`${base}view/qidian/account-tools.htm`);
  const logs = await read(`${base}view/qidian/logs.htm`);
  const styles = service.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const logStyles = logs.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

  assert.match(controller, /entry\(\{"admin", "services", "qidian"\}, cbi\("qidian"\)/);
  assert.doesNotMatch(controller, /"qidian", "logs"/);
  assert.match(controller, /"qidian", "log-data"}, call\("log_data"\)/);
  assert.match(model, /m:section\(NamedSection, "main", "qidian", translate\("部署设置"\)\)/);
  assert.doesNotMatch(model, /\bs\.description\s*=/, 'avoid repeating field guidance above the deployment form');
  assert.match(model, /s:tab\("basic", translate\("基本设置"\)\)/);
  assert.doesNotMatch(model, /s:tab\("advanced"/);
  assert.match(model, /s:tab\("logs", translate\("日志"\)\)/);
  assert.doesNotMatch(model, /s:tab\("maintenance"/);
  assert.match(model, /s:taboption\("basic", Button, "_install"/);
  assert.match(model, /s:taboption\("basic", Button, "_check_update"/);
  assert.match(model, /button\(install, translate\("重试部署"\), "apply", "install-package"\)/);
  assert.match(model, /s:taboption\("basic", DummyValue, "_account_tools"/);
  assert.match(model, /_account_tools", translate\("管理员密码重置"\)/);
  assert.match(model, /account\.template = "qidian\/account-tools"/);
  assert.match(model, /s:taboption\("logs", Button, "_clear_logs", translate\("日志"\)\)/);
  assert.match(model, /clear_logs\.inputtitle = translate\("清空日志"\)/);
  assert.match(model, /: > \/tmp\/qidian-operation\.log && rm -f \/tmp\/qidian-operation\.result/);
  assert.match(model, /s:taboption\("logs", DummyValue, "_operation_log"/);
  assert.match(model, /logs\.template = "qidian\/logs"/);
  assert.doesNotMatch(model, /install\.description|port\.description|registration\.description|image\.description|updates\.description/, 'remove routine helper descriptions from LuCI fields');
  assert.doesNotMatch(model, /栖点容器管理与更新|首次部署，或应用配置更改|默认端口：9908|首个管理员仍可创建|多架构镜像会自动匹配设备|发现更新时自动安装/);
  assert.match(service, /class="cbi-section qidian-overview"/);
  assert.match(service, /<h3><%:服务概览%><\/h3>/);
  assert.match(service, /class="cbi-value-title"/);
  assert.match(service, /<table class="table cbi-section-table">[\s\S]*?<%:服务状态%>[\s\S]*?<%:版本%>[\s\S]*?id="qidian-version-text"[\s\S]*?id="qidian-version-actions"[\s\S]*?<%:网页入口%>[\s\S]*?<\/table>/, 'show concise service details without storage or account internals');
  assert.doesNotMatch(service, /Docker 数据目录|qidian-data-path|账号状态|qidian-account-state|account-status/);
  assert.match(service, /local version_text = plugin_version == app_version and plugin_version or/);
  assert.match(service, /<span id="qidian-version-text"><%=util.pcdata\(version_text\)%><\/span>/);
  assert.doesNotMatch(service, /<strong id="qidian-(?:plugin|image)-version"/);
  assert.doesNotMatch(service, /<div class="cbi-value"><div class="cbi-value-title"><%:访问端口%>/, 'do not squeeze read-only service details into editable CBI rows');
  assert.match(service, /serviceActionFields\.appendChild\(button\)/);
  assert.match(service, /if \(startButton\) startButton\.disabled = busy \|\| running/);
  assert.match(service, /if \(stopButton\) stopButton\.disabled = busy \|\| !running/);
  assert.match(service, /if \(removeButton\) removeButton\.disabled = busy/);
  assert.match(service, /field\.remove\(\)/, 'remove empty CBI rows after grouping the native action buttons');
  assert.match(service, /if \(label\) label\.remove\(\)/, 'hide redundant CBI field titles for action buttons');
  assert.doesNotMatch(service, /cbi-section-descr"><%:卸载仅移除容器/);
  assert.doesNotMatch(service, /cbi-value-title"><%:运行状态%>|cbi-value-title"><%:网页入口%>/);
  assert.doesNotMatch(service, /<details|<summary|qidian-modal|仅在需要重置密码时展开/);
  assert.match(service, /@media screen and \(max-width: 600px\)/);
  assert.match(service, /#qidian-service-action-fields \{ display: inline-flex; flex-wrap: wrap;/);
  assert.match(service, /\.cbi-section-table td \{ border: 0; \}/);
  assert.match(service, /\.cbi-section-table th \{ width: 30%; text-align: start;/);
  assert.match(service, /name\$="\.' \+ suffix/);
  assert.match(service, /name\$="\._remove"/);
  assert.doesNotMatch(service, /refreshStatus|fetch\(endpoint/, 'poll service state through the same request as the live log');
  assert.match(service, /ui\.showModal\(_\("确认卸载服务"\)/);
  assert.match(service, /卸载会移除栖点容器，但会保留知识库数据、附件、证书和配置/);
  assert.doesNotMatch(service, /window\.confirm\s*\(/, 'service removal uses the LuCI modal instead of the browser dialog');
  assert.match(service, /<%:打开栖点%>/);
  assert.match(service, /<tr id="qidian-open-row"[\s\S]*?<th scope="row"><%:网页入口%><\/th><td><a id="qidian-open"/);
  assert.doesNotMatch(service, /打开栖点并创建管理员/);
  assert.match(service, /栖点服务运行中/);
  assert.match(service, /卸载会移除栖点容器，但会保留知识库数据、附件、证书和配置/);
  assert.doesNotMatch(styles, /\b(background|color|grid|border-radius|border-color|border-width|@media|@keyframes)\b/i, 'the page leaves colors to the active LuCI theme');
  assert.doesNotMatch(service, /syncArgonPalette|argon\/css\/dark|--qidian-(?:ink|surface|blue)|display:\s*grid/);
  assert.doesNotMatch(service, /qidian-copy-path|复制路径|function copyText/);
  assert.match(account, /id="qidian-account-tools"/);
  assert.match(account, /docker exec -it qidian node server\/reset-password\.mjs/);
  assert.match(account, /navigator\.clipboard/);
  assert.doesNotMatch(account, /在 OpenWrt 终端运行命令/);
  assert.match(model, /_operation_log", translate\("操作日志"\)/);
  assert.match(logs, /tail -c 65536/);
  assert.match(logs, /var operationBusy = <%=busy and "true" or "false"%>/);
  assert.match(logs, /cbi-tabmenu li\[data-tab="logs"\] a/);
  assert.match(logs, /if \(operationBusy\) \{\s*pollLog\(\);\s*activateLogTab\(\);/);
  assert.match(logs, /window\.setTimeout\(pollLog, 1800\)/);
  assert.match(logs, /function updateOverview\(data\)/);
  assert.match(logs, /updateOverview\(data\)/);
  assert.match(logs, /startButton\.disabled = data\.busy \|\| data\.state === "running"/);
  assert.match(logs, /stopButton\.disabled = data\.busy \|\| data\.state !== "running"/);
  assert.match(logs, /followLog/);
  assert.match(logs, /class="cbi-input-textarea" rows="18" readonly/);
  assert.match(logs, /class="cbi-value qidian-log-output"/);
  assert.doesNotMatch(logs, /操作输出/);
  assert.match(logs, /id="qidian-panel-log"[^>]*aria-label="<%:日志内容%>"/);
  assert.doesNotMatch(logs, /操作状态|qidian-log-state-text|qidian-log-updated/);
  assert.match(logs, /id="qidian-log-toolbar"/);
  assert.match(logs, /name\$="\._clear_logs"/);
  assert.match(logs, /\.qidian-log-toolbar \.cbi-value-title \{ display: none; \}/);
  assert.match(logStyles, /\.cbi-value\.qidian-log-output \{ display: block; \}/);
  assert.match(logStyles, /\.qidian-log-output \.cbi-value-field \{ display: block; float: none; width: 100%; max-width: none; margin: 0; \}/);
  assert.match(logStyles, /width: 100% !important; max-width: none !important; min-width: 0; min-height: 32em/);
  assert.match(logs, /class="cbi-button" type="button"><%:滚动到底部%>/);
  assert.doesNotMatch(logs, /最多显示最近 64 KB|日志操作|qidian-service-description|请查看日志了解操作进度|首次访问时创建管理员账号/);
  assert.match(logs, /if \(followLog\) panelLog\.scrollTop = panelLog\.scrollHeight/);
  assert.doesNotMatch(logs, /qidian-log-refresh|刷新日志/);
  assert.match(logs, /qidian-log-bottom/);
  assert.match(logStyles, /textarea#qidian-panel-log \{ display: block; box-sizing: border-box; width: 100% !important; max-width: none !important; min-width: 0; min-height: 32em;/);
  assert.doesNotMatch(logStyles, /\b(background|color|grid|border-radius|border-color|border-width|@media|@keyframes)\b|display:\s*flex/i);
  assert.doesNotMatch(logs, /操作已完成|等待操作|正在部署栖点|部署已完成|安装 \/ 更新过程|请保持页面打开|最近一次操作的实时输出/);
  const inlineScript = service.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(inlineScript, 'LuCI view includes its in-page interaction script');
  const renderedScript = inlineScript
    .replaceAll('<%=util.pcdata(port)%>', '9908')
    .replaceAll('<%=busy and "true" or "false"%>', 'false')
    .replaceAll('<%=log_endpoint%>', '/admin/services/qidian/log-data');
  assert.doesNotThrow(() => new Function(renderedScript), 'LuCI inline JavaScript parses after template interpolation');

  const logScript = logs.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(logScript, 'LuCI log tab includes its live-output behavior');
  const renderedLogScript = logScript
    .replaceAll('<%=log_endpoint%>', '/admin/services/qidian/log-data')
    .replaceAll('<%=busy and "true" or "false"%>', 'false');
  assert.doesNotThrow(() => new Function(renderedLogScript), 'LuCI log-tab script parses after template interpolation');

  const accountScript = account.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(accountScript, 'advanced settings include administrator password reset');
  assert.doesNotThrow(() => new Function(accountScript), 'LuCI account-tools script parses');

  const updater = await read('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian-updater.sh');
  assert.match(updater, /while \[ ! -f "\$result_file" \]/);
  assert.match(updater, /正在下载：已接收/);
});
