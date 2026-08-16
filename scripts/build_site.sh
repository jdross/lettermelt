#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="$project_dir/dist"
client_dir="$dist_dir/client"
server_dir="$dist_dir/server"

rm -rf "$dist_dir"
mkdir -p "$client_dir" "$server_dir"

cp "$project_dir/index.html" "$project_dir/styles.css" "$client_dir/"
cp -R "$project_dir/assets" "$project_dir/data" "$project_dir/js" "$client_dir/"

cat > "$server_dir/index.js" <<'EOF'
const worker = {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};

export default worker;
EOF

printf 'Built static LetterMelt site in %s\n' "$dist_dir"
