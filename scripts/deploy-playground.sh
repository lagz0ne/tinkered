#!/usr/bin/env bash
# Continuous deployment of the playground on the box (the Dokploy docker host).
# The playground workflow runs this on the self-hosted runner, after ci passed on
# main and apps/playground/dist is built. It bakes the image for HEAD, rolls the
# Dokploy compose app to it, and checks that the new container is healthy and the
# live page is the one just built.
#
# Needs: docker (the host socket), curl, jq, and the Dokploy API key in a file.
set -euo pipefail

: "${DOKPLOY_URL:?the Dokploy API base, such as http://dokploy:3000}"
: "${DOKPLOY_TOKEN_FILE:?the file that holds the Dokploy API key}"
: "${COMPOSE_ID:?the playground compose id}"
LIVE_URL="${LIVE_URL:-https://playground.tini.works/}"
KEEP_IMAGES="${KEEP_IMAGES:-10}"
name=tinkered-playground

sha="$(git rev-parse --short=7 HEAD)"
key="$(cat "$DOKPLOY_TOKEN_FILE")"
api() { curl -fsS -H "x-api-key: $key" -H "content-type: application/json" "$@"; }

echo "build $name:$sha"
docker build -t "$name:$sha" apps/playground

# The compose file Dokploy holds, with only the image tag changed.
compose="$(api "$DOKPLOY_URL/api/compose.one?composeId=$COMPOSE_ID" | jq -r .composeFile)"
old="$(grep -oE "image: $name:[A-Za-z0-9._-]+" <<<"$compose" | head -1 | cut -d: -f3)"
if [ -z "$old" ]; then
  echo "the compose names no $name image; not changing it" >&2
  exit 1
fi
if [ "$old" = "$sha" ]; then
  echo "already live: $sha"
  exit 0
fi
next="$(sed -E "s#image: $name:[A-Za-z0-9._-]+#image: $name:$sha#" <<<"$compose")"

echo "roll $name: $old -> $sha"
api -X POST "$DOKPLOY_URL/api/compose.update" \
  -d "$(jq -n --arg id "$COMPOSE_ID" --arg file "$next" '{composeId: $id, composeFile: $file}')" >/dev/null
api -X POST "$DOKPLOY_URL/api/compose.deploy" \
  -d "$(jq -n --arg id "$COMPOSE_ID" '{composeId: $id}')" >/dev/null

# Live means: a healthy container on the new image, and the public page is the
# index.html this run built.
want="$(sha256sum apps/playground/dist/index.html | cut -d' ' -f1)"
for _ in $(seq 1 60); do
  healthy="$(docker ps --filter "ancestor=$name:$sha" --filter health=healthy --format '{{.ID}}' | head -1)"
  got="$(curl -fsS "$LIVE_URL" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)"
  if [ -n "$healthy" ] && [ "$got" = "$want" ]; then
    echo "live: $name:$sha"
    # Keep the newest few images, so a roll back stays one compose edit away.
    docker images "$name" --format '{{.Tag}} {{.CreatedAt}}' | sort -k2 -r |
      tail -n +"$((KEEP_IMAGES + 1))" | awk -v n="$name" '{print n":"$1}' |
      xargs -r docker rmi >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 5
done

echo "$name:$sha is not live after 5 minutes. Roll back: set image to $old" >&2
exit 1
