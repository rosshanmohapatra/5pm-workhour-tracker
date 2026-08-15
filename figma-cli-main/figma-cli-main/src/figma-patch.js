/**
 * Figma Patch
 *
 * Patches Figma Desktop to enable remote debugging.
 * Newer Figma versions block --remote-debugging-port by default.
 */

import { readFileSync, writeFileSync, accessSync, constants } from 'fs';
import { execSync } from 'child_process';

// Matches the hostname exactly, not just any substring of the URL, so
// "notfigma.com" or "figma.com.evil.tld" can't spoof a match.
export function isFigmaUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'figma.com' || hostname.endsWith('.figma.com');
  } catch {
    return false;
  }
}

// CDP port used to connect to Figma's remote-debugging endpoint.
// Resolution order:
//   1. FIGMA_CDP_PORT environment variable  (manual override)
//   2. Auto-detected port cached by detectCdpPort()
//   3. 9222 default (original figma-use hardcoded value)
let _resolvedPort = null;

/**
 * Return the current CDP port synchronously.
 * Call detectCdpPort() once at startup for auto-detection; otherwise falls
 * back to FIGMA_CDP_PORT env var or the 9222 default.
 */
export function getCdpPort() {
  if (_resolvedPort !== null) return _resolvedPort;
  if (process.env.FIGMA_CDP_PORT) {
    _resolvedPort = parseInt(process.env.FIGMA_CDP_PORT, 10);
    return _resolvedPort;
  }
  return 9222; // default — overridden once detectCdpPort() resolves
}

/**
 * Probe localhost ports 9222-9229 for an active Figma CDP endpoint.
 * Caches the result so subsequent getCdpPort() calls return it synchronously.
 *
 * Set FIGMA_CDP_PORT=<port> to skip probing and use a fixed port instead.
 *
 * @returns {Promise<number>} The detected (or configured) port number.
 */
export async function detectCdpPort() {
  // Env var takes priority — skip probing entirely.
  if (process.env.FIGMA_CDP_PORT) {
    _resolvedPort = parseInt(process.env.FIGMA_CDP_PORT, 10);
    return _resolvedPort;
  }

  const candidates = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229];
  for (const port of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const resp = await fetch(`http://localhost:${port}/json`, { signal: controller.signal });
      clearTimeout(timeout);
      const pages = await resp.json();
      if (Array.isArray(pages) && pages.some(p => isFigmaUrl(p.url))) {
        _resolvedPort = port;
        return port;
      }
    } catch {
      // Port not open or no Figma — try next.
    }
  }

  // Nothing found — fall back to default.
  _resolvedPort = 9222;
  return _resolvedPort;
}

// Figma app.asar locations by platform
const ASAR_PATHS = {
  darwin: '/Applications/Figma.app/Contents/Resources/app.asar',
  win32: `${process.env.LOCALAPPDATA}\\Figma\\resources\\app.asar`,
  linux: '/opt/figma/resources/app.asar'
};

// The string that blocks remote debugging
const BLOCK_STRING = Buffer.from('removeSwitch("remote-debugging-port")');
// The patched string (changes "port" to "Xort" to disable the block)
const PATCH_STRING = Buffer.from('removeSwitch("remote-debugXing-port")');

/**
 * Get the path to Figma's app.asar file
 */
export function getAsarPath() {
  return ASAR_PATHS[process.platform] || null;
}

/**
 * Check if Figma is patched
 * @returns {boolean|null} true=patched, false=not patched, null=can't determine
 */
export function isPatched() {
  const asarPath = getAsarPath();
  if (!asarPath) return null;

  try {
    const content = readFileSync(asarPath);

    if (content.includes(PATCH_STRING)) {
      return true; // Already patched
    }

    if (content.includes(BLOCK_STRING)) {
      return false; // Needs patching
    }

    return null; // Can't determine (maybe old Figma version)
  } catch {
    return null;
  }
}

/**
 * Check if we have write access to the Figma app.asar file
 * @returns {boolean} true if we can write, false otherwise
 */
export function canPatchFigma() {
  const asarPath = getAsarPath();
  if (!asarPath) return false;

  try {
    accessSync(asarPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Patch Figma to enable remote debugging
 * @returns {boolean} true if patched successfully
 */
export function patchFigma() {
  const asarPath = getAsarPath();
  if (!asarPath) {
    throw new Error('Cannot detect Figma installation path for this platform');
  }

  // Check write access first
  if (!canPatchFigma()) {
    if (process.platform === 'darwin') {
      throw new Error('No write access to Figma. Grant Terminal "Full Disk Access" in System Settings → Privacy & Security');
    } else {
      throw new Error('No write access to Figma. Try running as administrator.');
    }
  }

  const content = readFileSync(asarPath);
  const blockIndex = content.indexOf(BLOCK_STRING);

  if (blockIndex < 0) {
    // Check if already patched
    if (content.includes(PATCH_STRING)) {
      return true; // Already patched
    }
    throw new Error('Could not find the string to patch. Figma version may be incompatible.');
  }

  // Apply patch
  PATCH_STRING.copy(content, blockIndex);
  writeFileSync(asarPath, content);

  // On macOS, re-sign the app
  if (process.platform === 'darwin') {
    try {
      execSync('codesign --force --deep --sign - /Applications/Figma.app', { stdio: 'ignore' });
    } catch {
      // Codesign might fail but patch might still work
    }
  }

  return true;
}

/**
 * Unpatch Figma to restore original state (re-enables remote debugging block)
 * @returns {boolean} true if unpatched successfully
 */
export function unpatchFigma() {
  const asarPath = getAsarPath();
  if (!asarPath) {
    throw new Error('Cannot detect Figma installation path for this platform');
  }

  const content = readFileSync(asarPath);
  const patchIndex = content.indexOf(PATCH_STRING);

  if (patchIndex < 0) {
    // Check if already unpatched (original state)
    if (content.includes(BLOCK_STRING)) {
      return true; // Already in original state
    }
    throw new Error('Could not find the patched string. Figma may not have been patched by this tool.');
  }

  // Restore original
  BLOCK_STRING.copy(content, patchIndex);
  writeFileSync(asarPath, content);

  // On macOS, re-sign the app
  if (process.platform === 'darwin') {
    try {
      execSync('codesign --force --deep --sign - /Applications/Figma.app', { stdio: 'ignore' });
    } catch {
      // Codesign might fail but unpatch might still work
    }
  }

  return true;
}

/**
 * Get the command to start Figma with remote debugging
 */
export function getFigmaCommand(port = 9222) {
  switch (process.platform) {
    case 'darwin':
      return `open -a Figma --args --remote-debugging-port=${port}`;
    case 'win32':
      return `"%LOCALAPPDATA%\\Figma\\Figma.exe" --remote-debugging-port=${port}`;
    case 'linux':
      return `figma --remote-debugging-port=${port}`;
    default:
      return null;
  }
}

/**
 * Get the path to Figma binary
 */
export function getFigmaBinaryPath() {
  switch (process.platform) {
    case 'darwin':
      return '/Applications/Figma.app/Contents/MacOS/Figma';
    case 'win32':
      return `${process.env.LOCALAPPDATA}\\Figma\\Figma.exe`;
    case 'linux':
      return '/usr/bin/figma';
    default:
      return null;
  }
}

export default {
  getAsarPath,
  isPatched,
  canPatchFigma,
  patchFigma,
  unpatchFigma,
  getFigmaCommand,
  getFigmaBinaryPath,
  getCdpPort,
  detectCdpPort,
};
