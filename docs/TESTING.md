## Testing

### Unit and Integration Tests
We use Vitest. Run `npm test`.

### E2E Scripts
End-to-end evaluation scripts are located in `scripts/e2e/`:
- `scripts/e2e/eval_real_model.ts`: Evaluates the model against real test cases using live Vertex/Gemini calls.
  - Guarded by `RUN_REAL_EVAL=1` to prevent accidental API credit spend.
  - To run in PowerShell:
    ```powershell
    $env:RUN_REAL_EVAL="1"; npx tsx scripts/e2e/eval_real_model.ts
    ```
