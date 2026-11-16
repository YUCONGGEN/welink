#!/usr/bin/env node
// Builds the LinkMe server for every supported platform and packages the
// one-command installers. No npm dependencies: tar.gz and zip are written
// with node:zlib so file modes survive even when building on Windows.
//
//   node scripts/build-server.mjs                       # all targets
//   node scripts/build-server.mjs --targets linux/amd64 # subset
//   node scripts/build-server.mjs --skip-build          # repackage existing bin/
//
// Output (dist/server/):
//   bin/<os>-<arch>/linkme-server[.exe]
//   linkme-server-<os>-<arch>.tar.gz | .zip
//   install.sh  install.ps1  SHA256SUMS.txt
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'server');
const allTargets = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64', 'windows/amd64'];

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
if (flag('-h') || flag('--help')) {
	console.log('usage: node scripts/build-server.mjs [--targets os/arch,...] [--skip-build]');
	process.exit(0);
}
const targets = (option('--targets') ?? allTargets.join(',')).split(',').map(s => s.trim()).filter(Boolean);
for (const t of targets) if (!allTargets.includes(t)) throw new Error(`unknown target ${t}; supported: ${allTargets.join(', ')}`);

const serverSource = fs.readFileSync(path.join(root, 'internal', 'server', 'server.go'), 'utf8');
const version = (serverSource.match(/"version":\s*"([0-9][^"]*)"/) ?? [])[1] ?? 'unknown';

fs.mkdirSync(path.join(out, 'bin'), {recursive: true});

// ---------- build ----------
for (const target of targets) {
	const [goos, goarch] = target.split('/');
	const exe = goos === 'windows' ? 'linkme-server.exe' : 'linkme-server';
	const dir = path.join(out, 'bin', `${goos}-${goarch}`);
	const bin = path.join(dir, exe);
	if (flag('--skip-build')) {
		if (!fs.existsSync(bin)) throw new Error(`--skip-build: ${bin} is missing`);
		continue;
	}
	fs.mkdirSync(dir, {recursive: true});
	const started = Date.now();
	process.stdout.write(`building ${target} ... `);
	const r = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', bin, './cmd/welink-server'], {
		cwd: root,
		stdio: ['ignore', 'inherit', 'inherit'],
		env: {...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch},
	});
	if (r.status !== 0) {
		console.log('FAILED');
		process.exit(r.status ?? 1);
	}
	console.log(`${(fs.statSync(bin).size / 1048576).toFixed(1)} MiB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

// ---------- installers ----------
// Always ship LF line endings, even from a CRLF (autocrlf) checkout.
const installSh = Buffer.from(fs.readFileSync(path.join(root, 'deploy', 'install.sh'), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
// Two encodings of install.ps1 are needed:
//  - inside the zip (run with -File): Windows PowerShell 5.1 reads BOM-less
//    scripts in the ANSI code page and garbles the Chinese text, so it needs
//    a UTF-8 BOM;
//  - the top-level copy (irm ... | iex): Invoke-RestMethod keeps a BOM as a
//    U+FEFF character, which stops PowerShell from recognising the leading
//    param() block, so it must have no BOM (the server sniffs it as
//    text/plain; charset=utf-8).
const ps1Text = fs.readFileSync(path.join(root, 'deploy', 'install.ps1'), 'utf8').replace(/^﻿/, '').replace(/\r?\n/g, '\r\n');
const installPs1 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ps1Text, 'utf8')]);
const installPs1Web = Buffer.from(ps1Text, 'utf8');
fs.writeFileSync(path.join(out, 'install.sh'), installSh, {mode: 0o755});
fs.writeFileSync(path.join(out, 'install.ps1'), installPs1Web);

const readme = (goos, arch) => {
	const unix = goos !== 'windows';
	const lines = [
		`LinkMe 服务器 ${version}（${goos}-${arch}）`,
		'',
		unix ? '安装（Linux 需 root；macOS 以当前用户运行，开机即启动可用 sudo）：' : '安装（以管理员身份打开 PowerShell）：',
		unix ? '  sudo sh install.sh            # Linux' : '  powershell -ExecutionPolicy Bypass -File .\\install.ps1',
		...(unix ? ['  sh install.sh                 # macOS'] : []),
		'',
		'安装程序会：',
		'  1. 列出本机磁盘，由您亲自选择数据盘和数据目录（不会自动选择）；',
		'  2. 询问安装目录、公网地址、端口、是否启用媒体中继、控制台管理员账号；',
		'  3. 生成配置、创建控制台管理员、安装并启动系统服务，等待健康检查通过；',
		'  4. 打印 API、下载页、控制台地址以及管理员密码（只显示一次）。',
		'',
		'再次运行即为升级：自动备份程序与数据库，替换程序，健康检查失败会自动回滚。',
		'配置和数据在升级时不会被修改。',
		'',
		'常用参数：',
		unix ? '  --data-dir DIR   指定数据目录（无人值守安装时必填）' : '  -DataDir DIR     指定数据目录（无人值守安装时必填）',
		unix ? '  --yes            除数据目录外全部使用默认值' : '  -Yes             除数据目录外全部使用默认值',
		unix ? '  --uninstall      卸载服务与程序，保留配置和数据' : '  -Uninstall       卸载服务与程序，保留配置和数据',
		unix ? '  --no-service     仅生成配置，不安装服务（测试用）' : '  -NoService       仅生成配置，不安装服务（测试用）',
		'',
		'端口：8250 API，8251 下载页，8253 管理控制台，',
		'      8252 TCP/UDP 与 20000-20127 UDP（仅启用媒体中继时）。',
		'',
	];
	return Buffer.from(lines.join(unix ? '\n' : '\r\n'), 'utf8');
};

// ---------- archives ----------
function tarGz(entries) {
	const blocks = [];
	const pad = n => Buffer.alloc((512 - (n % 512)) % 512);
	for (const {name, data, mode} of entries) {
		const h = Buffer.alloc(512);
		const put = (str, off, len) => h.write(str, off, len, 'utf8');
		const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
		if (Buffer.byteLength(name) > 100) throw new Error(`tar name too long: ${name}`);
		put(name, 0, 100);
		put(oct(mode, 8), 100, 8);
		put(oct(0, 8), 108, 8);
		put(oct(0, 8), 116, 8);
		put(oct(data.length, 12), 124, 12);
		put(oct(Math.floor(Date.now() / 1000), 12), 136, 12);
		put('        ', 148, 8);
		put(name.endsWith('/') ? '5' : '0', 156, 1);
		put('ustar\0', 257, 6);
		put('00', 263, 2);
		put('root', 265, 32);
		put('root', 297, 32);
		let sum = 0;
		for (const b of h) sum += b;
		put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
		blocks.push(h, data, pad(data.length));
	}
	blocks.push(Buffer.alloc(1024));
	return zlib.gzipSync(Buffer.concat(blocks), {level: 9});
}

function zip(entries) {
	const local = [];
	const central = [];
	let offset = 0;
	const now = new Date();
	const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
	const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	for (const {name, data} of entries) {
		const nameBuf = Buffer.from(name, 'utf8');
		const crc = zlib.crc32(data);
		const comp = zlib.deflateRawSync(data, {level: 9});
		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(20, 4);
		lh.writeUInt16LE(0x0800, 6); // UTF-8 names
		lh.writeUInt16LE(8, 8);
		lh.writeUInt16LE(dosTime, 10);
		lh.writeUInt16LE(dosDate, 12);
		lh.writeUInt32LE(crc, 14);
		lh.writeUInt32LE(comp.length, 18);
		lh.writeUInt32LE(data.length, 22);
		lh.writeUInt16LE(nameBuf.length, 26);
		local.push(lh, nameBuf, comp);
		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE(20, 4);
		ch.writeUInt16LE(20, 6);
		ch.writeUInt16LE(0x0800, 8);
		ch.writeUInt16LE(8, 10);
		ch.writeUInt16LE(dosTime, 12);
		ch.writeUInt16LE(dosDate, 14);
		ch.writeUInt32LE(crc, 16);
		ch.writeUInt32LE(comp.length, 20);
		ch.writeUInt32LE(data.length, 24);
		ch.writeUInt16LE(nameBuf.length, 28);
		ch.writeUInt32LE(offset, 42);
		central.push(ch, nameBuf);
		offset += lh.length + nameBuf.length + comp.length;
	}
	const cd = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, cd, end]);
}

const produced = [];
for (const target of allTargets) {
	const [goos, goarch] = target.split('/');
	const exe = goos === 'windows' ? 'linkme-server.exe' : 'linkme-server';
	const bin = path.join(out, 'bin', `${goos}-${goarch}`, exe);
	if (!fs.existsSync(bin)) continue; // not built in this run or earlier
	const base = `linkme-server-${goos}-${goarch}`;
	const binary = fs.readFileSync(bin);
	let file;
	if (goos === 'windows') {
		file = `${base}.zip`;
		fs.writeFileSync(path.join(out, file), zip([
			{name: `${base}/${exe}`, data: binary},
			{name: `${base}/install.ps1`, data: installPs1},
			{name: `${base}/README.txt`, data: readme(goos, goarch)},
		]));
	} else {
		file = `${base}.tar.gz`;
		fs.writeFileSync(path.join(out, file), tarGz([
			{name: `${base}/`, data: Buffer.alloc(0), mode: 0o755},
			{name: `${base}/${exe}`, data: binary, mode: 0o755},
			{name: `${base}/install.sh`, data: installSh, mode: 0o755},
			{name: `${base}/README.txt`, data: readme(goos, goarch), mode: 0o644},
		]));
	}
	produced.push(file);
}

// ---------- Docker bundle ----------
// linkme-docker/: Dockerfile, compose.yaml, entrypoint.sh, install-docker.sh
// and the Linux binaries, so a server with only Docker installed can run
//   curl -fsSL .../linkme-server-docker.tar.gz | tar xz && sh linkme-docker/install-docker.sh
const dockerArchs = ['amd64', 'arm64'].filter(a => fs.existsSync(path.join(out, 'bin', `linux-${a}`, 'linkme-server')));
if (dockerArchs.length) {
	const text = name => Buffer.from(fs.readFileSync(path.join(root, 'deploy', 'docker', name), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
	const dir = name => ({name, data: Buffer.alloc(0), mode: 0o755});
	const dockerReadme = Buffer.from([
		`LinkMe 服务器 ${version}（Docker）`,
		'',
		'需要已安装 Docker 与 docker compose。在本目录运行：',
		'  sh install-docker.sh',
		'',
		'脚本会列出本机磁盘，由您亲自选择数据盘和数据目录（不会自动选择），',
		'然后询问公网地址、端口、是否启用媒体中继、管理后台账号，',
		'生成 .env、构建镜像并启动容器，最后打印各地址和后台密码。',
		'再次运行即为升级（沿用 .env，重建镜像与容器，数据不变）。',
		'',
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(out, 'linkme-server-docker.tar.gz'), tarGz([
		dir('linkme-docker/'), dir('linkme-docker/bin/'),
		...dockerArchs.flatMap(a => [dir(`linkme-docker/bin/linux-${a}/`), {name: `linkme-docker/bin/linux-${a}/linkme-server`, data: fs.readFileSync(path.join(out, 'bin', `linux-${a}`, 'linkme-server')), mode: 0o755}]),
		{name: 'linkme-docker/Dockerfile', data: text('Dockerfile'), mode: 0o644},
		{name: 'linkme-docker/compose.yaml', data: text('compose.yaml'), mode: 0o644},
		{name: 'linkme-docker/entrypoint.sh', data: text('entrypoint.sh'), mode: 0o755},
		{name: 'linkme-docker/install-docker.sh', data: text('install-docker.sh'), mode: 0o755},
		{name: 'linkme-docker/README.txt', data: dockerReadme, mode: 0o644},
	]));
	produced.push('linkme-server-docker.tar.gz');
}

// ---------- checksums ----------
const sumFiles = [...produced, 'install.sh', 'install.ps1'];
const sums = sumFiles.map(f => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex')}  ${f}`);
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`LinkMe server ${version} packaged in ${path.relative(root, out)}:`);
for (const line of sums) console.log('  ' + line);
