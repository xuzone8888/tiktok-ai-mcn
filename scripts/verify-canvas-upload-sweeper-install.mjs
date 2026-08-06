#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const installer = readFileSync(
  new URL("../deploy/install-canvas-upload-sweeper.sh", import.meta.url),
  "utf8"
);
const worker = readFileSync(
  new URL("./sweep-canvas-upload-reservations.mjs", import.meta.url),
  "utf8"
);
let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

check(installer.startsWith("#!/usr/bin/env bash"), "installer is an explicit Bash program");
check(installer.includes("set -Eeuo pipefail"), "installer fails closed");
check(
  installer.includes('ACTION="${1:-validate}"') &&
    installer.includes('EXECUTE=0'),
  "validation is the default and mutation is separately armed"
);
check(
  installer.includes('[[ "${ACTION}" == "validate" || "${ACTION}" == "install" ]]'),
  "only validate and install actions are accepted"
);
check(
  installer.includes('[[ "${RELEASE_DIR}" == /* && "${RELEASE_DIR}" != "/" ]]') &&
    installer.includes('[[ "${ENV_FILE}" == /* && "${ENV_FILE}" != "/" ]]'),
  "broad or relative filesystem targets are rejected"
);
check(
  installer.includes('! -L "${RELEASE_DIR}"') &&
    installer.includes('! -L "${SWEEPER}"') &&
    installer.includes('! -L "${ENV_FILE}"'),
  "release, script, and secret file symlinks are rejected"
);
check(
  installer.includes("Environment file must be root-owned") &&
    installer.includes("(8#${ENV_MODE} & 077) == 0"),
  "secret file ownership and mode are enforced"
);
check(
  installer.includes("major !== 20 || minor < 12"),
  "the production Node contract is enforced"
);
check(
  installer.includes('"${SWEEPER}" --env-file "${ENV_FILE}" --dry-run'),
  "configuration is validated without database or OSS writes"
);
check(
  installer.includes('if [[ "${ACTION}" == "validate" || "${EXECUTE}" == "0" ]]'),
  "systemd changes require both install and --execute"
);
check(
  installer.includes("Type=oneshot") &&
    installer.includes("NoNewPrivileges=true") &&
    installer.includes("ProtectSystem=strict") &&
    installer.includes("ProtectHome=read-only"),
  "the service runs as a hardened one-shot"
);
check(
  installer.includes("OnUnitActiveSec=${INTERVAL_MINUTES}min") &&
    installer.includes("Persistent=true") &&
    installer.includes("RandomizedDelaySec=60"),
  "the timer is persistent, bounded, and jittered"
);
check(
  installer.includes('systemctl enable --now "${SERVICE_NAME}.timer"') &&
    installer.includes('systemctl start "${SERVICE_NAME}.service"') &&
    installer.includes("--property=Result"),
  "installation proves both timer activation and an initial successful cycle"
);
check(
  !installer.includes("CANVAS_RECONCILE_SECRET=") &&
    !installer.includes("SUPABASE_SERVICE_ROLE_KEY="),
  "the installer never accepts or embeds secret values"
);
check(
  worker.includes("claim_canvas_upload_purge_v1") &&
    worker.indexOf("await oss.delete(claim.object_key") <
      worker.indexOf('"complete_canvas_upload_purge_v1"'),
  "the installed worker deletes or proves absence before releasing quota"
);

console.log(`Canvas upload sweeper installer verifier: ${passed}/${passed} assertions passed`);
