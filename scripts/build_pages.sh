#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site_dir="$project_dir/site"

rm -rf "$site_dir"
mkdir -p "$site_dir"

cp "$project_dir/index.html" "$project_dir/styles.css" "$site_dir/"
cp -R "$project_dir/assets" "$project_dir/data" "$project_dir/js" "$site_dir/"
touch "$site_dir/.nojekyll"

printf 'Built GitHub Pages site in %s\n' "$site_dir"
