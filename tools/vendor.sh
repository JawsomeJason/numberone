#!/usr/bin/env bash
# Refetches the pinned `yaml` release from the npm registry, verifies its sha512
# integrity, and replaces vendor/yaml/ with the ESM build plus LICENSE.
#
#   tools/vendor.sh           show what would change, then apply it (no-op when current)
#   tools/vendor.sh --check   verify vendor/yaml/ matches the pinned tarball; write nothing
#
# To bump: edit VERSION and INTEGRITY below (integrity from `npm view yaml@<v> dist.integrity`).
set -euo pipefail

VERSION=2.9.1
INTEGRITY='sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw=='

mode=${1:-apply}
case "$mode" in apply | --check) ;; *) echo "usage: tools/vendor.sh [--check]" >&2; exit 2 ;; esac

root=$(cd "$(dirname "$0")/.." && pwd)
dest="$root/vendor/yaml"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL "https://registry.npmjs.org/yaml/-/yaml-$VERSION.tgz" -o "$work/yaml.tgz"
actual="sha512-$(openssl dgst -sha512 -binary "$work/yaml.tgz" | openssl base64 -A)"
if [ "$actual" != "$INTEGRITY" ]; then
  echo "integrity mismatch for yaml@$VERSION" >&2
  echo "  pinned: $INTEGRITY" >&2
  echo "  actual: $actual" >&2
  exit 1
fi
echo "integrity ok: yaml@$VERSION $INTEGRITY"

mkdir "$work/src" "$work/stage"
tar -xzf "$work/yaml.tgz" -C "$work/src"
pkg="$work/src/package"

# The browser build is plain ESM with explicit .js extensions, so Node loads it directly.
cp -R "$pkg/browser/dist" "$work/stage/dist"
cp "$pkg/browser/index.js" "$pkg/browser/package.json" "$pkg/LICENSE" "$work/stage/"
# The shipped .d.ts files use extensionless imports that NodeNext cannot resolve,
# so the surface engine/yaml.ts needs is declared here instead.
cat > "$work/stage/index.d.ts" <<'EOF'
// Hand-written by tools/vendor.sh. Covers the part of yaml's API that numberone uses.
export type YAMLOptions = { prettyErrors?: boolean; strict?: boolean; uniqueKeys?: boolean; maxAliasCount?: number };
export declare class YAMLError extends Error {
  code: string;
  pos: [number, number];
  linePos?: [{ line: number; col: number }] | [{ line: number; col: number }, { line: number; col: number }];
}
export declare class YAMLParseError extends YAMLError {}
export declare class YAMLWarning extends YAMLError {}
export declare function parse(src: string, options?: YAMLOptions): unknown;
export declare function stringify(value: unknown): string;
export declare function parseDocument(src: string, options?: YAMLOptions): {
  errors: YAMLParseError[];
  warnings: YAMLWarning[];
  toJS(): unknown;
};
EOF

if diff -r "$work/stage" "$dest" > "$work/diff.txt" 2>&1; then
  echo "vendor/yaml matches yaml@$VERSION"
  exit 0
fi

if [ "$mode" = "--check" ]; then
  echo "vendor/yaml differs from yaml@$VERSION:" >&2
  head -40 "$work/diff.txt" >&2
  exit 1
fi

echo "plan: replace vendor/yaml with yaml@$VERSION"
grep -E '^(Only in|diff )' "$work/diff.txt" | head -40 || true
mkdir -p "$dest"
rsync -a --delete "$work/stage/" "$dest/"
diff -r "$work/stage" "$dest" > /dev/null && echo "applied: vendor/yaml now matches yaml@$VERSION"
