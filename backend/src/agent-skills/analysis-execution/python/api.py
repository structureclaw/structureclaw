"""StructureClaw backend-hosted Python analysis runtime."""

from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from typing import List, Dict, Any, Optional
import logging

from skill_loader import SkillNotLoadedError, build_missing_skill_detail, load_skill_symbol
from providers.registry import AnalysisEngineRegistry
from contracts.structure_model_v1 import StructureModelV1
from contracts.migrations import (
    is_supported_target_schema_version,
    migrate_structure_model_v1,
)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _supported_formats() -> List[str]:
    provider = load_skill_symbol("geometry-input/converters/registry.py", "supported_formats")
    return provider()


def _get_converter(format_name: str):
    resolver = load_skill_symbol("geometry-input/converters/registry.py", "get_converter")
    return resolver(format_name)


def _create_concrete_designer():
    cls = load_skill_symbol("material-constitutive/concrete.py", "ConcreteDesigner")
    return cls()

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
    model: StructureModelV1
    parameters: Dict[str, Any]
    engine_id: Optional[str] = Field(default=None, alias="engineId")


class ValidateRequest(BaseModel):
    model: Dict[str, Any]
    engine_id: Optional[str] = Field(default=None, alias="engineId")


class ConvertRequest(BaseModel):
    model: Dict[str, Any]
    target_schema_version: str = "1.0.0"
    source_format: str = "structuremodel-v1"
    target_format: str = "structuremodel-v1"


class AnalysisResponse(BaseModel):
    schema_version: str
    analysis_type: str
    success: bool
    error_code: Optional[str] = None
    message: str
    data: Dict[str, Any]
    meta: Dict[str, Any]


class CodeCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_id: str
    code: str  # GB50010, GB50017, etc.
    elements: List[str]
    context: Dict[str, Any] = {}
    engine_id: Optional[str] = Field(default=None, alias="engineId")


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


@app.get("/schema/structure-model-v1")
async def structure_model_schema():
    """返回 StructureModel v1 JSON Schema"""
    return StructureModelV1.model_json_schema()


@app.get("/schema/converters")
async def converter_schema():
    """返回已支持的格式转换器"""
    try:
        formats = _supported_formats()
        warning = None
    except SkillNotLoadedError as error:
        formats = []
        warning = build_missing_skill_detail(error, capability="converter schema")

    return {
        "supportedFormats": formats,
        "defaultSourceFormat": "structuremodel-v1",
        "defaultTargetFormat": "structuremodel-v1",
        "warning": warning,
    }


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


@app.post("/validate")
async def validate_structure_model(request: ValidateRequest):
    """校验结构模型并返回标准化摘要"""
    try:
        result = engine_registry.validate_model(request.model, request.engine_id)
    except ValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "valid": False,
                "errors": e.errors(),
            },
        )

    return result


@app.post("/convert")
async def convert_structure_model(request: ConvertRequest):
    """标准化并转换结构模型（支持 schema v1.0.x）"""
    if not is_supported_target_schema_version(request.target_schema_version):
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_TARGET_SCHEMA",
                "message": f"target_schema_version '{request.target_schema_version}' is not supported",
            },
        )

    try:
        source_converter = _get_converter(request.source_format)
    except SkillNotLoadedError as error:
        raise HTTPException(status_code=503, detail=build_missing_skill_detail(error, capability="model conversion"))

    if source_converter is None:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_SOURCE_FORMAT",
                "message": f"source_format '{request.source_format}' is not supported",
                "supportedFormats": _supported_formats(),
            },
        )

    target_converter = _get_converter(request.target_format)
    if target_converter is None:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_TARGET_FORMAT",
                "message": f"target_format '{request.target_format}' is not supported",
                "supportedFormats": _supported_formats(),
            },
        )

    try:
        normalized_source = source_converter.to_v1(request.model)
        model = StructureModelV1.model_validate(normalized_source)
    except ValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "errorCode": "INVALID_STRUCTURE_MODEL",
                "message": "Input model failed StructureModel v1 validation",
                "errors": e.errors(),
            },
        )
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "errorCode": "INVALID_STRUCTURE_MODEL",
                "message": str(e),
            },
        )

    migrated = migrate_structure_model_v1(model.model_dump(mode="json"), request.target_schema_version)
    if request.target_format == "structuremodel-v1":
        normalized = migrated
    else:
        normalized = target_converter.from_v1(StructureModelV1.model_validate(migrated))

    return {
        "sourceFormat": request.source_format,
        "targetFormat": request.target_format,
        "sourceSchemaVersion": model.schema_version,
        "targetSchemaVersion": request.target_schema_version,
        "model": normalized,
    }


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
        logger.error(f"Analysis failed: {str(e)}")
        now = datetime.now(timezone.utc).isoformat()
        return AnalysisResponse(
            schema_version=request.model.schema_version,
            analysis_type=request.type,
            success=False,
            error_code="ANALYSIS_EXECUTION_FAILED",
            message=str(e),
            data={},
            meta={
                "engineId": request.engine_id or "auto",
                "engineName": app.title,
                "engineVersion": app.version,
                "engineKind": "python",
                "selectionMode": "manual" if request.engine_id else "auto",
                "fallbackFrom": None,
                "timestamp": now,
            },
        )


@app.post("/code-check")
async def code_check(request: CodeCheckRequest):
    """
    规范校核
    """
    try:
        result = engine_registry.run_code_check(
            request.model_id,
            request.code,
            request.elements,
            request.context,
            request.engine_id,
        )
        return result

    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"Code check failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/design/beam")
async def design_beam(params: Dict[str, Any]):
    """
    梁截面设计
    """
    try:
        designer = _create_concrete_designer()
        result = designer.design_beam(params)
        return result

    except SkillNotLoadedError as error:
        raise HTTPException(status_code=503, detail=build_missing_skill_detail(error, capability="beam design"))

    except Exception as e:
        logger.error(f"Beam design failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/design/column")
async def design_column(params: Dict[str, Any]):
    """
    柱截面设计
    """
    try:
        designer = _create_concrete_designer()
        result = designer.design_column(params)
        return result

    except SkillNotLoadedError as error:
        raise HTTPException(status_code=503, detail=build_missing_skill_detail(error, capability="column design"))

    except Exception as e:
        logger.error(f"Column design failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
