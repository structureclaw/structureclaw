"""
简支梁分析结果可视化脚本
用法: python visualize_case.py [case_json_path]
"""
import asyncio
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np

# 支持中文显示
for font_name in ["Microsoft YaHei", "SimHei", "STSong", "Arial Unicode MS"]:
    if any(font_name in f.name for f in fm.fontManager.ttflist):
        plt.rcParams["font.sans-serif"] = [font_name, "DejaVu Sans"]
        break
plt.rcParams["axes.unicode_minus"] = False

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from main import AnalysisRequest, analyze


def run_case(case_path: str):
    payload = json.loads(Path(case_path).read_text(encoding="utf-8"))
    req = AnalysisRequest.model_validate(payload["request"])
    result = asyncio.run(analyze(req))
    return payload, result.model_dump(mode="json")


def visualize(payload, result):
    model = payload["request"]["model"]
    data = result["data"]

    # 提取节点坐标
    nodes = {n["id"]: n["x"] for n in model["nodes"]}
    node_ids = sorted(nodes.keys(), key=lambda nid: nodes[nid])
    x_nodes = [nodes[nid] for nid in node_ids]

    # 提取位移
    uz_vals = [data["displacements"][nid]["uz"] for nid in node_ids]

    # 提取单元信息和内力
    elements = model["elements"]
    elem_ids = [e["id"] for e in elements]

    # 构建沿梁长度的剪力和弯矩分布
    x_shear = []
    v_shear = []
    x_moment = []
    v_moment = []

    for elem in elements:
        eid = elem["id"]
        n1_id, n2_id = elem["nodes"]
        x1, x2 = nodes[n1_id], nodes[n2_id]
        forces = data["forces"][eid]
        V1 = forces["n1"]["V"]
        M1 = forces["n1"]["M"]
        V2 = forces["n2"]["V"]
        M2 = forces["n2"]["M"]

        # 线性插值
        xs = np.linspace(x1, x2, 50)
        t = (xs - x1) / (x2 - x1) if x2 != x1 else np.zeros_like(xs)

        # 剪力 (常数，取左端值)
        vs = np.full_like(xs, V1)
        x_shear.extend(xs.tolist())
        v_shear.extend(vs.tolist())

        # 弯矩 (线性分布)
        ms = M1 + (M2 - M1) * t
        x_moment.extend(xs.tolist())
        v_moment.extend(ms.tolist())

    # 支座位置
    support_nodes = []
    for n in model["nodes"]:
        if n.get("restraints") and any(n["restraints"]):
            support_nodes.append(n)

    # ========= 绘图 =========
    fig, axes = plt.subplots(4, 1, figsize=(12, 14), sharex=True)
    fig.suptitle(
        "Simply Supported Beam - %s\n简支梁分析结果" % payload.get("name", ""),
        fontsize=14, fontweight="bold"
    )

    beam_color = "#2563EB"
    fill_color = "#93C5FD"
    support_color = "#DC2626"

    # --- (a) 结构示意图 ---
    ax = axes[0]
    ax.set_title("(a) Structure / 结构示意", fontsize=11)
    ax.plot(x_nodes, [0] * len(x_nodes), "-o", color=beam_color, linewidth=3, markersize=8, zorder=3)

    # 画支座
    for sn in support_nodes:
        sx = sn["x"]
        r = sn["restraints"]
        if r[0] and r[2]:  # 铰支座
            triangle = plt.Polygon(
                [[sx, 0], [sx - 0.15, -0.3], [sx + 0.15, -0.3]],
                closed=True, fill=False, edgecolor=support_color, linewidth=2
            )
            ax.add_patch(triangle)
            ax.annotate("Pin", (sx, -0.4), ha="center", fontsize=9, color=support_color)
        elif r[2]:  # 滚动支座
            triangle = plt.Polygon(
                [[sx, 0], [sx - 0.15, -0.3], [sx + 0.15, -0.3]],
                closed=True, fill=False, edgecolor=support_color, linewidth=2
            )
            ax.add_patch(triangle)
            circle = plt.Circle((sx, -0.38), 0.06, fill=False, edgecolor=support_color, linewidth=2)
            ax.add_patch(circle)
            ax.annotate("Roller", (sx, -0.55), ha="center", fontsize=9, color=support_color)

    # 画荷载
    for lc in model["load_cases"]:
        for load in lc["loads"]:
            if "node" in load:
                nid = load["node"]
                lx = nodes[nid]
                fz = load.get("fz", 0)
                if fz != 0:
                    ax.annotate(
                        "", xy=(lx, 0), xytext=(lx, 0.8),
                        arrowprops=dict(arrowstyle="->, head_width=0.3", color="#F59E0B", lw=2.5)
                    )
                    ax.text(lx + 0.1, 0.85, "P = %.1f kN" % abs(fz), fontsize=10, color="#F59E0B", fontweight="bold")

    # 节点标签
    for nid in node_ids:
        ax.text(nodes[nid], 0.15, nid, ha="center", fontsize=9, color="#6B7280")

    ax.set_ylim(-0.8, 1.2)
    ax.set_ylabel("")
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.3)

    # --- (b) 剪力图 ---
    ax = axes[1]
    ax.set_title("(b) Shear Force Diagram / 剪力图 (kN)", fontsize=11)
    ax.fill_between(x_shear, 0, v_shear, alpha=0.3, color="#10B981", step="mid")
    ax.step(x_shear, v_shear, where="mid", color="#059669", linewidth=2)
    ax.axhline(y=0, color="black", linewidth=0.8)
    ax.set_ylabel("V (kN)")
    ax.grid(True, alpha=0.3)

    # 标注关键值
    for elem in elements:
        eid = elem["id"]
        n1_id = elem["nodes"][0]
        x1 = nodes[n1_id]
        V1 = data["forces"][eid]["n1"]["V"]
        if abs(V1) > 0.01:
            ax.annotate("%.1f" % V1, (x1 + 0.1, V1), fontsize=9, fontweight="bold")

    # --- (c) 弯矩图 ---
    ax = axes[2]
    ax.set_title("(c) Bending Moment Diagram / 弯矩图 (kN*m)", fontsize=11)
    # 结构工程惯例: 弯矩图画在受拉侧 (翻转)
    v_moment_neg = [-m for m in v_moment]
    ax.fill_between(x_moment, 0, v_moment_neg, alpha=0.3, color="#F59E0B")
    ax.plot(x_moment, v_moment_neg, color="#D97706", linewidth=2)
    ax.axhline(y=0, color="black", linewidth=0.8)
    ax.set_ylabel("M (kN*m)")
    ax.grid(True, alpha=0.3)

    # 标注最大弯矩
    max_m_idx = np.argmax(np.abs(v_moment))
    ax.annotate(
        "Mmax = %.1f kN*m" % abs(v_moment[max_m_idx]),
        (x_moment[max_m_idx], v_moment_neg[max_m_idx]),
        textcoords="offset points", xytext=(10, -20),
        fontsize=10, fontweight="bold", color="#B45309",
        arrowprops=dict(arrowstyle="->", color="#B45309")
    )

    # --- (d) 变形图 ---
    ax = axes[3]
    ax.set_title("(d) Deflection / 变形图 (m)", fontsize=11)

    # 插值得到平滑曲线
    from scipy.interpolate import CubicSpline
    cs = CubicSpline(x_nodes, uz_vals)
    x_smooth = np.linspace(min(x_nodes), max(x_nodes), 200)
    uz_smooth = cs(x_smooth)

    ax.fill_between(x_smooth, 0, uz_smooth, alpha=0.3, color="#8B5CF6")
    ax.plot(x_smooth, uz_smooth, color="#7C3AED", linewidth=2)
    ax.plot(x_nodes, uz_vals, "o", color="#7C3AED", markersize=6, zorder=3)
    ax.axhline(y=0, color="black", linewidth=0.8)
    ax.set_ylabel("uz (m)")
    ax.set_xlabel("x (m)")
    ax.grid(True, alpha=0.3)

    # 标注最大位移
    min_uz_idx = np.argmin(uz_vals)
    ax.annotate(
        "max = %.6f m" % uz_vals[min_uz_idx],
        (x_nodes[min_uz_idx], uz_vals[min_uz_idx]),
        textcoords="offset points", xytext=(15, -15),
        fontsize=10, fontweight="bold", color="#6D28D9",
        arrowprops=dict(arrowstyle="->", color="#6D28D9")
    )

    plt.tight_layout()

    # 保存图片
    out_path = Path(case_path).with_suffix(".png")
    fig.savefig(str(out_path), dpi=150, bbox_inches="tight")
    print("Image saved: %s" % out_path)

    plt.show()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        case_path = str(Path(__file__).resolve().parent / "static_2d" / "case_13_simply_supported_off_center_point_load.json")
    else:
        case_path = sys.argv[1]

    print("Running case: %s" % case_path)
    payload, result = run_case(case_path)
    visualize(payload, result)
