"""StructureClaw backend-hosted Python analysis runtime."""

from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from typing import List, Dict, Any, Optional
import logging
import os
import traceback

from registry import AnalysisEngineRegistry
from structure_protocol.structure_model_v2 import StructureModelV2

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _include_error_traceback() -> bool:
    return os.getenv("ANALYSIS_INCLUDE_TRACEBACK", "").strip().lower() in {"1", "true", "yes", "on"}


def _exception_dict_attr(exc: Exception, name: str) -> Dict[str, Any]:
    value = getattr(exc, name, None)
    return value if isinstance(value, dict) else {}


app = FastAPI(
    title="StructureClaw Analysis Runtime",
    description="Backend-hosted structural analysis runtime",
    version="0.1.0"
)

engine_registry = AnalysisEngineRegistry(app.title, app.version)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ 数据模型 ============

class AnalysisRequest(BaseModel):
    type: str  # static, dynamic, seismic, nonlinear
    model: StructureModelV2
    parameters: Dict[str, Any]
    engine_id: Optional[str] = Field(default=None, alias="engineId")


class AnalysisResponse(BaseModel):
    schema_version: str
    analysis_type: str
    success: bool
    error_code: Optional[str] = None
    message: str
    data: Dict[str, Any]
    meta: Dict[str, Any]


# ============ API 端点 ============

@app.get("/")
async def root():
    """服务状态"""
    return {
        "name": "StructureClaw Analysis Engine",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "healthy"}


@app.get("/engines")
async def list_analysis_engines():
    """返回可用分析引擎目录"""
    return {
        "engines": engine_registry.list_engines(),
        "defaultSelectionMode": "auto",
    }


@app.get("/engines/{engine_id}")
async def get_analysis_engine(engine_id: str):
    """返回单个分析引擎详情"""
    engine = engine_registry.get_engine(engine_id)
    if engine is None:
        raise HTTPException(
            status_code=404,
            detail={
                "errorCode": "ENGINE_NOT_FOUND",
                "message": f"Analysis engine '{engine_id}' was not found",
            },
        )
    return engine


@app.post("/engines/{engine_id}/check")
async def check_analysis_engine(engine_id: str):
    """检查分析引擎可用性"""
    return engine_registry.check_engine(engine_id)


@app.post("/engines/{engine_id}/probe")
async def probe_analysis_engine(engine_id: str):
    """运行小型算例验证分析引擎能否正常工作"""
    return engine_registry.probe_engine(engine_id)


@app.post("/analyze")
async def analyze(request: AnalysisRequest) -> AnalysisResponse:
    """
    执行结构分析
    """
    try:
        logger.info(f"Starting {request.type} analysis")
        result = engine_registry.run_analysis(request.type, request.model, request.parameters, request.engine_id)

        logger.info(f"Analysis completed successfully")
        now = datetime.now(timezone.utc).isoformat()
        meta = result.get("meta") if isinstance(result, dict) else {}
        return AnalysisResponse(
            schema_version=request.model.schema_version,
            analysis_type=request.type,
            success=True,
            error_code=None,
            message="Analysis completed",
            data=result,
            meta={
                **(meta if isinstance(meta, dict) else {}),
                "timestamp": now,
            },
        )

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Analysis failed")
        now = datetime.now(timezone.utc).isoformat()
        error_meta = {
            "engineId": request.engine_id or "auto",
            "engineName": app.title,
            "engineVersion": app.version,
            "engineKind": "python",
            "selectionMode": "manual" if request.engine_id else "auto",
            "fallbackFrom": None,
            "timestamp": now,
            "exceptionType": type(e).__name__,
        }
        error_meta.update(_exception_dict_attr(e, "meta"))
        error_detail = _exception_dict_attr(e, "detail")
        if error_detail:
            error_meta["detail"] = error_detail
        if _include_error_traceback():
            traceback_summary = "".join(
                traceback.format_exception(type(e), e, e.__traceback__, limit=8)
            )
            error_meta["traceback"] = traceback_summary[-4000:]
        return AnalysisResponse(
            schema_version=request.model.schema_version,
            analysis_type=request.type,
            success=False,
            error_code="ANALYSIS_EXECUTION_FAILED",
            message=str(e),
            data={},
            meta=error_meta,
        )
