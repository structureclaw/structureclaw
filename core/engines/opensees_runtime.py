from __future__ import annotations

import argparse
import json
from typing import Optional


def run_opensees_runtime_smoke_test() -> None:
    try:
        import openseespy.opensees as ops
    except ModuleNotFoundError as error:
        raise RuntimeError(f"OpenSeesPy package is not installed: {error}") from error
    except Exception as error:
        raise RuntimeError(f"OpenSeesPy import failed: {error}") from error

    try:
        ops.wipe()
        ops.model('basic', '-ndm', 2, '-ndf', 3)
        ops.node(1, 0.0, 0.0)
        ops.node(2, 1.0, 0.0)
        ops.fix(1, 1, 1, 1)
        ops.geomTransf('Linear', 1)
        ops.element('elasticBeamColumn', 1, 1, 2, 0.01, 2.05e8, 1.0e-4, 1)
        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)
        ops.load(2, 0.0, -1.0, 0.0)
        ops.system('BandGeneral')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('LoadControl', 1.0)
        ops.algorithm('Newton')
        ops.analysis('Static')
        status = ops.analyze(1)
        if status != 0:
            raise RuntimeError(f"OpenSees smoke test failed with analysis code {status}")
    except Exception as error:
        raise RuntimeError(f"OpenSees runtime initialization failed: {error}") from error
    finally:
        try:
            ops.wipe()
        except Exception:
            pass


def get_opensees_runtime_issue() -> Optional[str]:
    try:
        run_opensees_runtime_smoke_test()
        return None
    except Exception as error:
        return str(error)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description='Run an OpenSeesPy runtime smoke test.')
    parser.add_argument('--json', action='store_true', help='Print probe result as JSON')
    args = parser.parse_args(argv)

    issue = get_opensees_runtime_issue()
    payload = {
        'available': issue is None,
        'reason': issue,
    }

    if args.json:
        print(json.dumps(payload))
    elif issue is None:
        print('OpenSees runtime is available.')
    else:
        print(f'OpenSees runtime is unavailable: {issue}')

    return 0 if issue is None else 1


if __name__ == '__main__':
    raise SystemExit(main())
