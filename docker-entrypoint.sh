#!/bin/sh
set -e

if [ "${RUN_DB_SETUP:-true}" = "true" ]; then
  npm run db:setup
fi

exec "$@"
