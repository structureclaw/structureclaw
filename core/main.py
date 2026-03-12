"""
StructureClaw Core - 结构分析引擎
基于 OpenSees 和 Pynite 的有限元分析引擎
"""

from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, ValidationError
from typing import List, Dict, Any, Optional
import uvicorn
import logging

from fem.static_analysis import StaticAnalyzer
from fem.dynamic_analysis import DynamicAnalyzer
from fem.seismic_analysis import SeismicAnalyzer
from design.concrete import ConcreteDesigner
from design.steel import SteelDesigner
from design.code_check import CodeChecker
from converters import get_converter, supported_formats
from schemas.structure_model_v1 import StructureModelV1
from schemas.migrations import (
    is_supported_target_schema_version,
    migrate_structure_model_v1,
)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="StructureClaw Analysis Engine",
    description="建筑结构有限元分析引擎",
    version="0.1.0"
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ 数据模型 ============

class LoadCase(BaseModel):
    name: str
    type: str  # dead, live, wind, seismic
    loads: List[Dict[str, Any]]


class AnalysisRequest(BaseModel):
    type: str  # static, dynamic, seismic, nonlinear
    model: StructureModelV1
    parameters: Dict[str, Any]


class ValidateRequest(BaseModel):
    model: Dict[str, Any]


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
    return {
        "supportedFormats": supported_formats(),
        "defaultSourceFormat": "structuremodel-v1",
        "defaultTargetFormat": "structuremodel-v1",
    }


@app.post("/validate")
async def validate_structure_model(request: ValidateRequest):
    """校验结构模型并返回标准化摘要"""
    try:
        model = StructureModelV1.model_validate(request.model)
    except ValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "valid": False,
                "errors": e.errors(),
            },
        )

    return {
        "valid": True,
        "schemaVersion": model.schema_version,
        "stats": {
            "nodes": len(model.nodes),
            "elements": len(model.elements),
            "materials": len(model.materials),
            "sections": len(model.sections),
            "loadCases": len(model.load_cases),
            "loadCombinations": len(model.load_combinations),
        },
    }


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

    source_converter = get_converter(request.source_format)
    if source_converter is None:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_SOURCE_FORMAT",
                "message": f"source_format '{request.source_format}' is not supported",
                "supportedFormats": supported_formats(),
            },
        )

    target_converter = get_converter(request.target_format)
    if target_converter is None:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "UNSUPPORTED_TARGET_FORMAT",
                "message": f"target_format '{request.target_format}' is not supported",
                "supportedFormats": supported_formats(),
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

        if request.type == "static":
            analyzer = StaticAnalyzer(request.model)
            result = analyzer.run(request.parameters)

        elif request.type == "dynamic":
            analyzer = DynamicAnalyzer(request.model)
            result = analyzer.run(request.parameters)

        elif request.type == "seismic":
            analyzer = SeismicAnalyzer(request.model)
            result = analyzer.run(request.parameters)

        elif request.type == "nonlinear":
            analyzer = StaticAnalyzer(request.model)
            result = analyzer.run_nonlinear(request.parameters)

        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "errorCode": "INVALID_ANALYSIS_TYPE",
                    "message": f"Unknown analysis type: {request.type}",
                },
            )

        logger.info(f"Analysis completed successfully")
        now = datetime.now(timezone.utc).isoformat()
        return AnalysisResponse(
            schema_version=request.model.schema_version,
            analysis_type=request.type,
            success=True,
            error_code=None,
            message="Analysis completed",
            data=result,
            meta={
                "engineName": app.title,
                "engineVersion": app.version,
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
                "engineName": app.title,
                "engineVersion": app.version,
                "timestamp": now,
            },
        )


@app.post("/code-check")
async def code_check(request: CodeCheckRequest):
    """
    规范校核
    """
    try:
        checker = CodeChecker(request.code)
        result = checker.check(request.model_id, request.elements, request.context)
        return result

    except Exception as e:
        logger.error(f"Code check failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/design/beam")
async def design_beam(params: Dict[str, Any]):
    """
    梁截面设计
    """
    try:
        designer = ConcreteDesigner()
        result = designer.design_beam(params)
        return result

    except Exception as e:
        logger.error(f"Beam design failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/design/column")
async def design_column(params: Dict[str, Any]):
    """
    柱截面设计
    """
    try:
        designer = ConcreteDesigner()
        result = designer.design_column(params)
        return result

    except Exception as e:
        logger.error(f"Column design failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ 启动服务 ============

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        log_level="info"
    )
