#!/bin/bash
# Deploys the latest commit to the Hugging Face Space. A Space is a git repo
# that HF builds (from the Dockerfile) and runs whenever something is pushed.
#
#   bash deploy/push-to-hf.sh
#
# Needs deploy/.env (git-ignored) with:
#   HF_SPACE=your-username/meet-translate
#   HF_WRITE_TOKEN=hf_...   (huggingface.co/settings/tokens, "Write" access)
#
# Only committed files are sent (git archive), so .env files and local
# models can never be uploaded. The Space gets its own README (the one HF
# reads its settings from), not the project README.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/.env

commit=$(git rev-parse --short HEAD)
work=$(mktemp -d)
git archive HEAD | tar -x -C "$work"
cp deploy/space-README.md "$work/README.md"

cd "$work"
git init -q -b main
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" \
    -c user.email="$(git -C "$OLDPWD" config user.email)" \
    commit -q -m "Deploy $commit"
git push -q -f "https://user:${HF_WRITE_TOKEN}@huggingface.co/spaces/${HF_SPACE}" main
echo "Pushed $commit to https://huggingface.co/spaces/${HF_SPACE} -- HF is building it now."
rm -rf "$work"
