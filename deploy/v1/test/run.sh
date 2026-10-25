#!/bin/sh
set -eu
export TEST_DATABASE_URL="$DATABASE_URL"
node --test /app/v1-contract-test/test/contract.test.mjs
