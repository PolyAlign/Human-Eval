# PolyAlign zh Human Evaluation

Local static website for scoring the zh human-eval samples.

## Run

From this directory:

```powershell
python -m http.server 8088
```

Then open:

```text
http://localhost:8088
```

## Use

- Toggle `5 / bin` or `10 / bin`.
- Pick a red/green bubble from the left sidebar. There is one bubble per model answer: `400` or `800`.
- The page shows `Human / Reference` plus five variants for the same prompt and model family.
- The highlighted variant is the only answer being scored.
- Click any answer card to open a larger centered reader; text can be selected/copied there.
- Select all five `1` to `5` scores, then press `Confirm score`.
- Green means confirmed with all scores. Red means not confirmed or incomplete.
- Use `Set up files` to choose JSON/CSV files for live updates where the browser supports it. Otherwise use `JSON` and `CSV` export buttons.
- Blind scoring is enabled by default; exports still include model and variant metadata.

The exported `scores` object contains:

```json
{
  "task_success": 1,
  "factual_grounding": 1,
  "instruction_following": 1,
  "reference_alignment": 1,
  "response_quality": 1
}
```
