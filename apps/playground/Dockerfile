# The playground is fully static: build with `vp build` (or `vp run build`), then bake dist/ into
# nginx. No build step here — the workspace toolchain (pnpm/vp) produces dist/ before the image.
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
