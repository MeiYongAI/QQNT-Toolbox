'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const HELPER_LABEL = 'com.qqnt-toolbox.closed-lid';
const HELPER_PATH = `/Library/PrivilegedHelperTools/${HELPER_LABEL}`;
const PLIST_PATH = `/Library/LaunchDaemons/${HELPER_LABEL}.plist`;
const STATE_DIR = '/Library/Application Support/QQNT-Toolbox';

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function appleScriptString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function createHelperScript(uid, requestPath = path.join(STATE_DIR, `request-${uid}`)) {
    return `#!/bin/sh
set -u
STATE_DIR=${shellQuote(STATE_DIR)}
REQUEST=${shellQuote(requestPath)}
PREVIOUS="$STATE_DIR/previous-${uid}"
APPLIED="$STATE_DIR/applied-${uid}"

read_sleep_disabled() {
  value="$(/usr/bin/pmset -g 2>/dev/null | /usr/bin/awk '$1 == "SleepDisabled" { print $2; exit }')"
  case "$value" in 0|1) /bin/echo "$value" ;; *) /bin/echo 0 ;; esac
}

restore_setting() {
  if [ -f "$APPLIED" ]; then
    previous="$(/bin/cat "$PREVIOUS" 2>/dev/null || /bin/echo 0)"
    case "$previous" in 0|1) ;; *) previous=0 ;; esac
    /usr/bin/pmset -a disablesleep "$previous" >/dev/null 2>&1 || true
    /bin/rm -f "$APPLIED" "$PREVIOUS"
  fi
}

trap 'restore_setting; exit 0' TERM INT HUP EXIT
while :; do
  if [ ! -f "$REQUEST" ]; then
    restore_setting
    exit 0
  fi
  active=0
  pid=0
  active="$(/usr/bin/awk -F= '$1 == "active" { print $2; exit }' "$REQUEST" 2>/dev/null || /bin/echo 0)"
  pid="$(/usr/bin/awk -F= '$1 == "pid" { print $2; exit }' "$REQUEST" 2>/dev/null || /bin/echo 0)"
  power_source="$(/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/head -n 1)"
  if [ "$active" = 1 ] && [ "$pid" -gt 1 ] 2>/dev/null && /bin/kill -0 "$pid" 2>/dev/null &&
     /usr/bin/printf '%s' "$power_source" | /usr/bin/grep -q "AC Power"; then
    if [ ! -f "$APPLIED" ]; then
      read_sleep_disabled > "$PREVIOUS"
      if /usr/bin/pmset -a disablesleep 1 >/dev/null 2>&1; then
        /usr/bin/touch "$APPLIED"
      fi
    fi
  else
    restore_setting
    if [ "$active" != 1 ] || ! [ "$pid" -gt 1 ] 2>/dev/null || ! /bin/kill -0 "$pid" 2>/dev/null; then
      /bin/rm -f "$REQUEST"
      exit 0
    fi
  fi
  /bin/sleep 3
done
`;
}

function createLaunchDaemonPlist(uid, requestPath = path.join(STATE_DIR, `request-${uid}`)) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${HELPER_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${HELPER_PATH}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
    <key>PathState</key>
    <dict><key>${escapeXml(requestPath)}</key><true/></dict>
  </dict>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/var/log/${HELPER_LABEL}.log</string>
  <key>StandardErrorPath</key><string>/var/log/${HELPER_LABEL}.log</string>
</dict>
</plist>
`;
}

class MacClosedLidHelper {
    constructor(options = {}) {
        this.platform = options.platform || process.platform;
        this.uid = Number.isInteger(options.uid) ? options.uid : process.getuid?.();
        this.pid = Number.isInteger(options.pid) ? options.pid : process.pid;
        this.dataDir = path.resolve(options.dataDir || path.join(os.tmpdir(), 'qqnt-toolbox-power'));
        this.execFile = options.execFile || promisify(childProcess.execFile);
        this.pathExists = options.pathExists || fs.existsSync;
        this.requestPath = path.join(this.dataDir, `request-${this.uid}`);
        this.requested = false;
        this.installed = this.pathExists(HELPER_PATH) && this.pathExists(PLIST_PATH);
        this.lastError = '';
    }

    getStatus() {
        return {
            supported: this.platform === 'darwin' && Number.isInteger(this.uid),
            installed: this.installed,
            requested: this.requested,
            helperLabel: HELPER_LABEL,
            lastError: this.lastError
        };
    }

    async writeRequest(active) {
        if (!this.installed) {
            throw new Error('closed-lid-helper-not-installed');
        }
        if (active !== true) {
            await fsp.rm(this.requestPath, { force: true });
            this.requested = false;
            return;
        }
        const temporaryPath = `${this.requestPath}.tmp-${this.pid}`;
        const content = `active=1\npid=${this.pid}\nupdatedAt=${Date.now()}\n`;
        await fsp.writeFile(temporaryPath, content, { mode: 0o600 });
        await fsp.rename(temporaryPath, this.requestPath);
        this.requested = active === true;
    }

    writeRequestSync(active) {
        if (!this.installed) {
            return false;
        }
        if (active !== true) {
            fs.rmSync(this.requestPath, { force: true });
            this.requested = false;
            return true;
        }
        const temporaryPath = `${this.requestPath}.tmp-${this.pid}`;
        fs.writeFileSync(temporaryPath, `active=1\npid=${this.pid}\nupdatedAt=${Date.now()}\n`, {
            mode: 0o600
        });
        fs.renameSync(temporaryPath, this.requestPath);
        this.requested = active === true;
        return true;
    }

    async install() {
        if (this.platform !== 'darwin' || !Number.isInteger(this.uid)) {
            throw new Error('closed-lid-helper-unsupported');
        }
        await fsp.mkdir(this.dataDir, { recursive: true });
        const helperContent = createHelperScript(this.uid, this.requestPath);
        const plistContent = createLaunchDaemonPlist(this.uid, this.requestPath);
        const helperTemporaryPath = `${HELPER_PATH}.new`;
        const plistTemporaryPath = `${PLIST_PATH}.new`;
        const command = [
            `/bin/mkdir -p ${shellQuote(STATE_DIR)}`,
            `/usr/sbin/chown root:wheel ${shellQuote(STATE_DIR)}`,
            `/bin/chmod 700 ${shellQuote(STATE_DIR)}`,
            `/usr/bin/printf '%s' ${shellQuote(helperContent)} > ${shellQuote(helperTemporaryPath)}`,
            `/usr/sbin/chown root:wheel ${shellQuote(helperTemporaryPath)}`,
            `/bin/chmod 755 ${shellQuote(helperTemporaryPath)}`,
            `/bin/mv -f ${shellQuote(helperTemporaryPath)} ${shellQuote(HELPER_PATH)}`,
            `/usr/bin/printf '%s' ${shellQuote(plistContent)} > ${shellQuote(plistTemporaryPath)}`,
            `/usr/sbin/chown root:wheel ${shellQuote(plistTemporaryPath)}`,
            `/bin/chmod 644 ${shellQuote(plistTemporaryPath)}`,
            `/bin/mv -f ${shellQuote(plistTemporaryPath)} ${shellQuote(PLIST_PATH)}`,
            `(/bin/launchctl bootout system/${HELPER_LABEL} >/dev/null 2>&1 || true)`,
            `/bin/launchctl bootstrap system ${shellQuote(PLIST_PATH)}`,
            `/bin/launchctl enable system/${HELPER_LABEL}`,
            `/bin/launchctl kickstart -k system/${HELPER_LABEL}`
        ].join(' && ');
        await this.execFile('/usr/bin/osascript', [
            '-e',
            `do shell script "${appleScriptString(command)}" with administrator privileges`
        ]);
        this.installed = this.pathExists(HELPER_PATH) && this.pathExists(PLIST_PATH);
        if (!this.installed) {
            throw new Error('closed-lid-helper-install-not-observed');
        }
        this.lastError = '';
        return this.getStatus();
    }

    async setEnabled(enabled) {
        try {
            if (enabled && (this.platform !== 'darwin' || !Number.isInteger(this.uid))) {
                throw new Error('closed-lid-helper-unsupported');
            }
            if (enabled && !this.installed) {
                await this.install();
            }
            if (this.installed) {
                await this.writeRequest(enabled === true);
            }
            this.lastError = '';
            return this.getStatus();
        } catch (error) {
            this.lastError = String(error?.message || error);
            this.requested = false;
            throw error;
        }
    }

    async uninstall() {
        if (this.platform !== 'darwin') {
            return this.getStatus();
        }
        if (this.installed) {
            await this.writeRequest(false).catch(() => {});
        }
        const command = [
            `/bin/launchctl bootout system/${HELPER_LABEL} >/dev/null 2>&1 || true`,
            `if [ -f ${shellQuote(path.join(STATE_DIR, `applied-${this.uid}`))} ]; then ` +
                `previous=$(/bin/cat ${shellQuote(path.join(STATE_DIR, `previous-${this.uid}`))} 2>/dev/null || /bin/echo 0); ` +
                `case "$previous" in 0|1) ;; *) previous=0 ;; esac; ` +
                `/usr/bin/pmset -a disablesleep "$previous" >/dev/null 2>&1 || true; ` +
                `fi`,
            `/bin/rm -f ${shellQuote(HELPER_PATH)} ${shellQuote(PLIST_PATH)}`,
            `/bin/rm -f ${shellQuote(this.requestPath)} ` +
                `${shellQuote(path.join(STATE_DIR, `previous-${this.uid}`))} ` +
                `${shellQuote(path.join(STATE_DIR, `applied-${this.uid}`))}`
        ].join(' && ');
        try {
            await this.execFile('/usr/bin/osascript', [
                '-e',
                `do shell script "${appleScriptString(command)}" with administrator privileges`
            ]);
            this.installed = false;
            this.requested = false;
            this.lastError = '';
            return this.getStatus();
        } catch (error) {
            this.lastError = String(error?.message || error);
            throw error;
        }
    }
}

module.exports = {
    HELPER_LABEL,
    HELPER_PATH,
    PLIST_PATH,
    STATE_DIR,
    shellQuote,
    appleScriptString,
    escapeXml,
    createHelperScript,
    createLaunchDaemonPlist,
    MacClosedLidHelper
};
