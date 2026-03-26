def run_opensees_runtime_smoke_test():
    from adapters.opensees.runtime import run_opensees_runtime_smoke_test as _impl

    return _impl()


def get_opensees_runtime_issue():
    from adapters.opensees.runtime import get_opensees_runtime_issue as _impl

    return _impl()


__all__ = ['get_opensees_runtime_issue', 'run_opensees_runtime_smoke_test']
