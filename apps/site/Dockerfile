# The site for playground.tini.works. Built on the Dokploy box by scripts/deploy-playground.sh,
# after `vp run -r build` made dist/server: the one binary that holds the page and the server.
FROM debian:bookworm-slim
WORKDIR /app
# wget: the health check, the same one the nginx image ran. setcap: port 80 without root.
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends wget libcap2-bin \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin site
COPY dist/server /app/server
RUN setcap cap_net_bind_service=+ep /app/server
# PORT 80: the Dokploy domain already points there. No telemetry store yet: the two URLs go
# nowhere, and LOG_LEVEL 40 keeps the console to warnings and errors.
ENV NODE_ENV=production \
  PORT=80 \
  PUBLIC_ORIGIN=https://playground.tini.works \
  OTEL_SERVICE_NAME=tinker-site \
  VICTORIA_TRACES_URL=http://127.0.0.1:1/traces \
  VICTORIA_LOGS_URL=http://127.0.0.1:1/logs \
  LOG_LEVEL=40
USER site
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/api/health || exit 1
# The binary is PID 1: a stop signal reaches the server at once.
CMD ["/app/server"]
