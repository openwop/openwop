/** Daemon lifecycle — pid/log files under ~/.openwop/ + cross-platform service-install plan. */
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openwopHomeDir } from './config.js';

export function daemonPidPath(env = process.env) {
  return join(openwopHomeDir(env), 'demo-backend.pid.json');
}

export function daemonLogPath(env = process.env) {
  return join(openwopHomeDir(env), 'demo-backend.log');
}

export function readDaemonRecord(env = process.env) {
  try {
    const path = daemonPidPath(env);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeDaemonRecord(env: any, record: any) {
  const path = daemonPidPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  try { chmodSync(path, 0o600); } catch { /* best-effort on Windows */ }
}

export function clearDaemonRecord(env: any) {
  try {
    const path = daemonPidPath(env);
    if (existsSync(path)) rmSync(path);
  } catch { /* best-effort */ }
}

export function processAlive(pid: any) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. EPERM: exists but not ours → still alive.
    return !!(err && (err as NodeJS.ErrnoException).code === 'EPERM');
  }
}

export function openLogStream(path: any) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    return openSync(path, 'a');
  } catch {
    return null;
  }
}

export function writeLog(fd: any, chunk: any) {
  try {
    writeFileSync(fd, chunk);
  } catch { /* best-effort; never crash the dev loop over a log write */ }
}

// Build a per-platform service-install plan. Pure (no fs side effects) so it
// can be unit-tested and dry-run printed. Returns either an `unsupported`
// plan with guidance text, or a writable plan with path/contents/activate.
export function buildServiceInstallPlan(input: any) {
  const { platform, root, backendPort, label, apiKey, env, uninstall } = input;
  const nodeBin = process.execPath;
  const backendDir = join(root, 'apps/workflow-engine/backend/typescript');
  const home = env.HOME ?? homedir();
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';

  if (platform === 'darwin') {
    const path = join(home, 'Library/LaunchAgents', `${label}.plist`);
    const contents = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${label}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      `    <string>${npm}</string>`,
      '    <string>run</string>',
      '    <string>dev</string>',
      '  </array>',
      '  <key>WorkingDirectory</key>',
      `  <string>${backendDir}</string>`,
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      '    <key>PORT</key>',
      `    <string>${backendPort}</string>`,
      '    <key>OPENWOP_API_KEY</key>',
      `    <string>${apiKey}</string>`,
      '  </dict>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <true/>',
      '  <key>StandardOutPath</key>',
      `  <string>${daemonLogPath(env)}</string>`,
      '  <key>StandardErrorPath</key>',
      `  <string>${daemonLogPath(env)}</string>`,
      '</dict>',
      '</plist>',
    ].join('\n');
    return {
      manager: 'launchd LaunchAgent',
      path,
      contents,
      uninstall: Boolean(uninstall),
      activate: `launchctl load -w ${path}`,
      deactivate: `launchctl unload -w ${path}`,
    };
  }

  if (platform === 'linux') {
    const path = join(home, '.config/systemd/user', `${label}.service`);
    const contents = [
      '[Unit]',
      'Description=OpenWOP workflow-engine demo backend',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      `WorkingDirectory=${backendDir}`,
      `Environment=PORT=${backendPort}`,
      `Environment=OPENWOP_API_KEY=${apiKey}`,
      `ExecStart=${npm} run dev`,
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=default.target',
    ].join('\n');
    return {
      manager: 'systemd user unit',
      path,
      contents,
      uninstall: Boolean(uninstall),
      activate: `systemctl --user daemon-reload && systemctl --user enable --now ${label}.service`,
      deactivate: `systemctl --user disable --now ${label}.service`,
    };
  }

  // Windows + anything else: no file is written. Give a concrete recipe.
  const guidance = platform === 'win32'
    ? [
        'Automatic service install is not wired for Windows yet.',
        'Create a Scheduled Task that runs the demo backend at logon:',
        '',
        `  schtasks /Create /TN "${label}" /SC ONLOGON /TR ^`,
        `    "cmd /c cd /d ${backendDir} && set PORT=${backendPort}&& set OPENWOP_API_KEY=${apiKey}&& ${npm} run dev"`,
        '',
        'Remove it later with:',
        `  schtasks /Delete /TN "${label}" /F`,
        '',
        `(Node runtime: ${nodeBin})`,
      ].join('\n')
    : [
        `Automatic service install is not supported on platform "${platform}".`,
        'Run the backend under your platform process manager with:',
        `  cd ${backendDir} && PORT=${backendPort} OPENWOP_API_KEY=${apiKey} ${npm} run dev`,
      ].join('\n');
  return { unsupported: true, guidance };
}

