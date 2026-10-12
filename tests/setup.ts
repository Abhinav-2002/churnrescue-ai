import { beforeEach } from 'vitest';
import { resetRateLimitsForTests } from '@/lib/rate-limit';

beforeEach(() => {
  // Centrally reset in-memory rate-limit buckets and daily LLM budget counter before every test
  resetRateLimitsForTests();
});
