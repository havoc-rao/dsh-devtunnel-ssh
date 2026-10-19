#!/bin/sh
# Download first, inspect, then run. Never disables Gatekeeper or installs services.
set -eu
VERSION=0.1.0
FORCE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || exit 2; VERSION=$2; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo 'Usage: sh install-macos.sh [--version X.Y.Z] [--force]' >&2; exit 2 ;;
  esac
done
printf '%s\n' "$VERSION" | /usr/bin/grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo 'Invalid version' >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo 'macOS required' >&2; exit 1; }
ARCH=$(uname -m)
# Rosetta shells must still select the native Apple Silicon executable.
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
case "$ARCH" in arm64) TARGET=macos-arm64 ;; x86_64) TARGET=macos-x64 ;; *) echo 'Unsupported architecture' >&2; exit 1 ;; esac
: "${HOME:?HOME is required}"
case "$HOME" in /*) ;; *) echo 'HOME must be absolute' >&2; exit 1 ;; esac
DEST="$HOME/.local/bin"
check_path() {
  path=$1
  while [ "$path" != / ]; do
    [ ! -L "$path" ] || { echo "Refusing symlink: $path" >&2; exit 1; }
    path=$(dirname "$path")
  done
}
check_path "$DEST/dsh-rdl"
[ ! -e "$DEST/dsh-rdl" ] || [ "$FORCE" = 1 ] || { echo 'Already installed; use --force to replace after review' >&2; exit 1; }
[ ! -e "$DEST/dsh-rdl" ] || [ -f "$DEST/dsh-rdl" ] || exit 1
ASSET="dsh-remote-devtunnel-link-${VERSION}-${TARGET}.tar.gz"
BASE="https://github.com/havoc-rao/dsh-devtunnel-ssh/releases/download/dsh-remote-devtunnel-link-v${VERSION}"
WORK=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/dsh-rdl-install.XXXXXXXX")
cleanup() {
  case "$WORK" in */dsh-rdl-install.????????) [ -d "$WORK" ] && [ ! -L "$WORK" ] && /bin/rm -rf "$WORK" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 "$BASE/$ASSET" -o "$WORK/$ASSET"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 "$BASE/$ASSET.sha256" -o "$WORK/checksum"
EXPECTED=$(/usr/bin/awk 'NR==1 {print $1}' "$WORK/checksum")
printf '%s\n' "$EXPECTED" | /usr/bin/grep -Eq '^[0-9a-fA-F]{64}$' || { echo 'Invalid checksum' >&2; exit 1; }
ACTUAL=$(/usr/bin/shasum -a 256 "$WORK/$ASSET" | /usr/bin/awk '{print $1}')
[ "$(printf '%s' "$EXPECTED" | tr A-F a-f)" = "$ACTUAL" ] || { echo 'Checksum mismatch' >&2; exit 1; }
[ "$(/usr/bin/tar -tzf "$WORK/$ASSET")" = dsh-rdl ] || { echo 'Unexpected archive contents' >&2; exit 1; }
# Stream the single member instead of trusting archive link/permission metadata.
/usr/bin/tar -xOzf "$WORK/$ASSET" dsh-rdl > "$WORK/dsh-rdl"
[ -f "$WORK/dsh-rdl" ] && [ ! -L "$WORK/dsh-rdl" ] || exit 1
/bin/chmod 755 "$WORK/dsh-rdl"
/usr/bin/codesign --verify "$WORK/dsh-rdl"
[ "$("$WORK/dsh-rdl" --version)" = "$VERSION" ] || { echo 'Executable version mismatch' >&2; exit 1; }
check_path "$DEST/dsh-rdl"
/bin/mkdir -p "$DEST"
/usr/bin/install -m 755 "$WORK/dsh-rdl" "$DEST/dsh-rdl"
printf 'Installed: %s\n' "$DEST/dsh-rdl"
case ":$PATH:" in *":$DEST:"*) ;; *) printf 'Add this once to your shell configuration, then open a new terminal:\nexport PATH="$HOME/.local/bin:$PATH"\n' ;; esac
printf 'No services, SSH authorization, login or shell configuration were changed.\n'
