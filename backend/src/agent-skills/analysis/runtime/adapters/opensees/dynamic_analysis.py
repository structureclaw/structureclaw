from __future__ import annotations

from typing import Any, Dict, List

import numpy as np


class OpenSeesDynamicExecutor:
    def __init__(self, analyzer):
        self.analyzer = analyzer

    def modal_analysis(self, num_modes: int, ops) -> Dict[str, Any]:
        ops.wipe()
        ops.model('basic', '-ndm', 3, '-ndf', 6)

        for node in self.analyzer.model.nodes:
            tag = self.analyzer._ops_node_tag(node.id)
            ops.node(tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(tag, *node.restraints)

        total_mass = 0
        for node in self.analyzer.model.nodes:
            mass = [100] * 6
            ops.mass(self.analyzer._ops_node_tag(node.id), *mass)
            total_mass += mass[0]

        for mat in self.analyzer.model.materials:
            ops.uniaxialMaterial('Elastic', self.analyzer._ops_material_tag(mat.id), mat.E * 1000)

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

        ops.system('BandSPD')
        ops.numberer('Plain')
        ops.constraints('Plain')

        eigen_values = ops.eigen(num_modes)
        modes = []
        for i, ev in enumerate(eigen_values):
            omega = np.sqrt(ev)
            period = 2 * np.pi / omega
            frequency = omega / (2 * np.pi)

            mode_shape = {}
            for node in self.analyzer.model.nodes:
                try:
                    shape = ops.nodeEigenvector(self.analyzer._ops_node_tag(node.id), i + 1)
                    mode_shape[node.id] = shape[:3].tolist()
                except Exception:
                    mode_shape[node.id] = [0, 0, 0]

            modes.append({
                'modeNumber': i + 1,
                'period': period,
                'frequency': frequency,
                'omega': omega,
                'modeShape': mode_shape,
            })

        ops.wipe()

        return {
            'status': 'success',
            'totalMass': total_mass,
            'modes': modes,
        }

    def time_history_analysis(
        self,
        time_step: float,
        duration: float,
        damping_ratio: float,
        ground_motion: List[float],
        ops,
    ) -> Dict[str, Any]:
        ops.wipe()
        ops.model('basic', '-ndm', 3, '-ndf', 6)

        for node in self.analyzer.model.nodes:
            tag = self.analyzer._ops_node_tag(node.id)
            ops.node(tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(tag, *node.restraints)

        for node in self.analyzer.model.nodes:
            ops.mass(self.analyzer._ops_node_tag(node.id), 100, 100, 100, 0, 0, 0)

        for mat in self.analyzer.model.materials:
            ops.uniaxialMaterial('Elastic', self.analyzer._ops_material_tag(mat.id), mat.E * 1000)

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

        ops.rayleigh(damping_ratio, 0, 0, damping_ratio)

        if ground_motion:
            ops.timeSeries('Path', 1, '-dt', time_step, '-values', *ground_motion[:min(len(ground_motion), 1000)])
        else:
            t = np.arange(0, duration, time_step)
            acc = 0.1 * np.sin(2 * np.pi * 1 * t)
            ops.timeSeries('Path', 1, '-dt', time_step, '-values', *acc.tolist())

        ops.pattern('UniformExcitation', 1, 1, '-accel', 1)
        ops.system('BandSPD')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('Newmark', 0.5, 0.25)
        ops.algorithm('Newton')
        ops.analysis('Transient')

        results = []
        current_time = 0
        num_steps = int(duration / time_step)

        monitor_node = None
        for node in self.analyzer.model.nodes:
            if not node.restraints or not all(node.restraints):
                monitor_node = node.id
                break

        for i in range(num_steps):
            ok = ops.analyze(1, time_step)
            if ok != 0:
                break

            current_time += time_step

            if monitor_node and i % 10 == 0:
                disp = ops.nodeDisp(self.analyzer._ops_node_tag(monitor_node))
                results.append({
                    'time': current_time,
                    'displacement': disp[1] if len(disp) > 1 else 0,
                })

        if results:
            max_disp = max(r['displacement'] for r in results)
            max_time = max(results, key=lambda x: x['displacement'])['time']
        else:
            max_disp = 0
            max_time = 0

        ops.wipe()

        return {
            'status': 'success',
            'maxDisplacement': max_disp,
            'timeOfMaxDisp': max_time,
            'timeHistory': results,
        }
