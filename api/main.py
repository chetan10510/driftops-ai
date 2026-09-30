from __future__ import annotations

from dataclasses import asdict
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path
from pydantic import BaseModel

from driftops.engine import SAMPLES, SCENARIOS, PipelineRun, create_run


app = FastAPI(title="DriftOps API", version="1.0.0")
runs: dict[str, PipelineRun] = {}


class RunRequest(BaseModel):
    scenario: str
    sample: str = "commerce_orders"


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "service": "driftops-api", "scenarios": len(SCENARIOS)}


@app.get("/api/scenarios")
def scenarios() -> dict[str, object]:
    return {"scenarios": [asdict(value) for value in SCENARIOS.values()]}


@app.get("/api/samples")
def samples() -> dict[str, object]:
    return {"samples": [asdict(value) for value in SAMPLES.values()]}


@app.post("/api/runs", status_code=201)
def start_run(request: RunRequest) -> dict[str, object]:
    try:
        run = create_run(request.scenario, request.sample)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    runs[run.id] = run
    return run.snapshot()


@app.get("/api/runs/{run_id}")
def get_run(run_id: Annotated[str, Path(pattern=r"^[a-f0-9]{12}$")]) -> dict[str, object]:
    return require_run(run_id).snapshot()


@app.post("/api/runs/{run_id}/{action}")
def transition_run(
    run_id: Annotated[str, Path(pattern=r"^[a-f0-9]{12}$")],
    action: Annotated[str, Path(pattern=r"^(tick|repair|replay)$")],
) -> dict[str, object]:
    run = require_run(run_id)
    try:
        getattr(run, action)()
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return run.snapshot()


def require_run(run_id: str) -> PipelineRun:
    if run_id not in runs:
        raise HTTPException(status_code=404, detail="Run not found")
    return runs[run_id]
