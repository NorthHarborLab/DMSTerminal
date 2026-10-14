#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VERSION="${DSM_TERMINAL_VERSION:-0.2.3-0015}"
VARIANT="${DSM_TERMINAL_VARIANT:-}"
if [[ ! "${VARIANT}" =~ ^[a-z0-9-]*$ ]]; then
  printf 'Invalid package variant.\n' >&2
  exit 1
fi
OUTPUT_DIR="${PROJECT_ROOT}/release"
OUTPUT_FILE="${OUTPUT_DIR}/DSM-Terminal-${VERSION}${VARIANT:+-${VARIANT}}-apollolake.spk"
STAGE_DIR="$(mktemp -d /tmp/dsm-terminal-spk.XXXXXX)"
PAYLOAD_DIR="${STAGE_DIR}/payload"
DEPLOY_DIR="${STAGE_DIR}/deploy"
SPK_DIR="${STAGE_DIR}/spk"

cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

mkdir -p "${PAYLOAD_DIR}/server" "${SPK_DIR}" "${OUTPUT_DIR}"

cd "${PROJECT_ROOT}"
MSYS2_ENV_CONV_EXCL="DSM_TERMINAL_BASE" DSM_TERMINAL_BASE="/3rdparty/DSMTerminal/" pnpm build
pnpm --filter @dsm-terminal/server --prod deploy --node-linker=hoisted --ignore-scripts --no-optional "${DEPLOY_DIR}/server"

cp -a "${DEPLOY_DIR}/server/dist" "${PAYLOAD_DIR}/server/dist"
cp -a "${DEPLOY_DIR}/server/node_modules" "${PAYLOAD_DIR}/server/node_modules"
# pnpm installation state contains host paths and is not needed by the deployed Node runtime
rm -f "${PAYLOAD_DIR}/server/node_modules/.modules.yaml" \
  "${PAYLOAD_DIR}/server/node_modules/.pnpm-workspace-state-v1.json"
cp "${DEPLOY_DIR}/server/package.json" "${PAYLOAD_DIR}/server/package.json"
cp -a "${PROJECT_ROOT}/apps/web/dist" "${PAYLOAD_DIR}/web"
if [ -d "${SCRIPT_DIR}/compat-assets" ]; then
  cp -a "${SCRIPT_DIR}/compat-assets/." "${PAYLOAD_DIR}/web/assets/"
fi
cp -a "${SCRIPT_DIR}/package/." "${PAYLOAD_DIR}/"
if [ -n "${DSM_TERMINAL_ACCESS_CONFIG_SOURCE:-}" ]; then
  cp "${DSM_TERMINAL_ACCESS_CONFIG_SOURCE}" "${PAYLOAD_DIR}/config/access.json"
fi
cp "${PROJECT_ROOT}/LICENSE" "${PROJECT_ROOT}/THIRD_PARTY_NOTICES.md" "${PAYLOAD_DIR}/"
node "${SCRIPT_DIR}/generate-frontend-licenses.mjs" "${PAYLOAD_DIR}/FRONTEND_LICENSES.txt"

mkdir -p "${PAYLOAD_DIR}/ui/images"
for icon_size in 16 24 32 48 64 72 256; do
  node "${SCRIPT_DIR}/generate-icon.mjs" "${icon_size}" \
    "${PAYLOAD_DIR}/ui/images/dsm-terminal_${icon_size}.png"
done

tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='UTC 2020-01-01' \
  -czf "${SPK_DIR}/package.tgz" -C "${PAYLOAD_DIR}" .

extract_size="$(du -sk "${PAYLOAD_DIR}" | awk '{print $1}')"
sed \
  -e "s/@VERSION@/${VERSION}/g" \
  -e "s/@EXTRACT_SIZE@/${extract_size}/g" \
  "${SCRIPT_DIR}/INFO.in" > "${SPK_DIR}/INFO"

cp -a "${SCRIPT_DIR}/conf" "${SPK_DIR}/conf"
cp -a "${SCRIPT_DIR}/scripts" "${SPK_DIR}/scripts"
sed -i 's/\r$//' "${SPK_DIR}/scripts/"*
node "${SCRIPT_DIR}/generate-icon.mjs" 64 "${SPK_DIR}/PACKAGE_ICON.PNG"
node "${SCRIPT_DIR}/generate-icon.mjs" 256 "${SPK_DIR}/PACKAGE_ICON_256.PNG"
chmod 755 "${SPK_DIR}/scripts/"*

for script in "${SPK_DIR}/scripts/"*; do
  sh -n "${script}"
done

node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${SPK_DIR}/conf/privilege"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${SPK_DIR}/conf/resource"
if find "${PAYLOAD_DIR}" -type l -lname '/*' | grep -q .; then
  printf 'Payload contains an absolute symlink.\n' >&2
  exit 1
fi

temporary_output="${OUTPUT_FILE}.tmp"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='UTC 2020-01-01' \
  -cf "${temporary_output}" -C "${SPK_DIR}" \
  INFO PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG package.tgz scripts conf
node "${SCRIPT_DIR}/verify-spk.mjs" "${temporary_output}"
mv -f "${temporary_output}" "${OUTPUT_FILE}"

printf 'Created %s\n' "${OUTPUT_FILE}"
(
  cd "${OUTPUT_DIR}"
  sha256sum "$(basename "${OUTPUT_FILE}")" | tee "$(basename "${OUTPUT_FILE}").sha256"
)
