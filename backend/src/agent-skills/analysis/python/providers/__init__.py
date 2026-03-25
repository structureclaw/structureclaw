def __getattr__(name: str):
    if name == "AnalysisEngineRegistry":
        from providers.registry import AnalysisEngineRegistry

        return AnalysisEngineRegistry
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["AnalysisEngineRegistry"]
