## Testing

### Unit and Integration Tests
We use Vitest. Run `npm test`.

### E2E Scripts
End-to-end evaluation scripts are located in `scripts/e2e/`:
- `scripts/e2e/eval_real_model.ts`: Evaluates the model against real test cases.
- `scripts/e2e/eval_d1.ts`: Evaluates the model specifically for the Defect 1 trace.
