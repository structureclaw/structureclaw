from __future__ import annotations

from typing import Any, Dict, List


class OpenSeesSeismicExecutor:
    def __init__(self, analyzer):
        self.analyzer = analyzer

    def get_modes(self, ops) -> List[Dict[str, Any]]:
        raise NotImplementedError(
            "OpenSees modal extraction is not yet implemented; "
            "use the simplified fallback via engine_mode='simplified'"
        )

    def pushover_analysis(self, target_disp: float, control_node: str | None, ops) -> Dict[str, Any]:
        ops.wipe()
        ops.model('basic', '-ndm', 3, '-ndf', 6)

        for node in self.analyzer.model.nodes:
            tag = self.analyzer._ops_node_tag(node.id)
            ops.node(tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(tag, *node.restraints)

        for mat in self.analyzer.model.materials:
            ops.uniaxialMaterial(
                'Concrete01',
                self.analyzer._ops_material_tag(mat.id),
                mat.fy * 0.002 if mat.fy else 30,
                0.002,
                mat.fy * 0.004 if mat.fy else 20,
                0.006,
            )

        for elem in self.analyzer.model.elements:
            if elem.type == 'beam':
                ops.element(
                    'elasticBeamColumn',
                    self.analyzer._ops_element_tag(elem.id),
                    self.analyzer._ops_node_tag(elem.nodes[0]),
                    self.analyzer._ops_node_tag(elem.nodes[1]),
                    0.01,
                    200000000,
                    0.0001,
                    0.0001,
                    79000000,
                    0.00001,
                )

        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)
        for node in self.analyzer.model.nodes:
            if not node.restraints or not all(node.restraints):
                ops.load(self.analyzer._ops_node_tag(node.id), 0, -100, 0, 0, 0, 0)

        ops.system('BandSPD')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('LoadControl', 0.1)
        ops.algorithm('Newton')
        ops.analysis('Static')
        ops.analyze(10)

        ops.loadConst('-time', 0.0)
        ops.timeSeries('Linear', 2)
        ops.pattern('Plain', 2, 2)

        heights = sorted(set(n.z for n in self.analyzer.model.nodes))
        max_height = max(heights) if heights else 1

        for node in self.analyzer.model.nodes:
            if not node.restraints or not all(node.restraints):
                coeff = node.z / max_height
                ops.load(self.analyzer._ops_node_tag(node.id), coeff * 10, 0, 0, 0, 0, 0)

        if not control_node:
            for node in self.analyzer.model.nodes:
                if not node.restraints or not all(node.restraints):
                    control_node = node.id
                    break

        ops.integrator('DisplacementControl', self.analyzer._ops_node_tag(control_node), 1, 0.001)
        ops.analysis('Static')

        results = []
        num_steps = int(target_disp / 0.001)

        for i in range(num_steps):
            ok = ops.analyze(1)
            if ok != 0:
                break

            reaction = ops.nodeReaction(1, 1)
            roof_disp = ops.nodeDisp(self.analyzer._ops_node_tag(control_node), 1)

            results.append({
                'step': i,
                'baseShear': reaction,
                'roofDisplacement': roof_disp,
            })

        ops.wipe()

        return {
            'status': 'success',
            'pushoverCurve': results,
            'targetDisplacement': target_disp,
        }
