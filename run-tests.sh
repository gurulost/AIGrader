#!/bin/bash

# Set environment variables for tests
export NODE_ENV=test
export SESSION_SECRET="test_session_secret_with_at_least_32_characters"
export CSRF_SECRET="test_csrf_secret_with_at_least_32_characters"

# Run all tests
echo "Running all tests..."
npx vitest run --config ./test/vitest.config.ts

# Run specific test categories if needed
echo "Running auth and session management tests..."
npx vitest run test/unit/session-management.test.ts --config ./vitest.config.ts

echo "Running submission error handling tests..."
npx vitest run test/unit/submission-error-handling.test.ts --config ./vitest.config.ts

echo "Running CSRF token tests..."
npx vitest run test/unit/esm-csrf-token.test.ts --config ./vitest.config.ts

echo "Running TypeScript error handling tests..."
npx vitest run test/unit/typescript-error-handling.test.ts test/unit/async-handler.test.ts --config ./vitest.config.ts

echo "Running Gemini Adapter error handling tests..."
npx vitest run test/unit/gemini-adapter-error-handling.test.ts --config ./vitest.config.ts

echo "Running BatchOperations TypeScript tests..."
npx vitest run test/unit/batch-operations-typing.test.ts --config ./vitest.config.ts

echo "Running integration tests..."
npx vitest run test/integration/submission-resilience.test.ts test/integration/enhanced-auth-flow.test.ts --config ./vitest.config.ts

# echo "Running client tests..."
# npx vitest run test/client --config ./test/vitest.config.ts
