# 地震荷载技能 / Seismic Load Skill

## 概述 / Overview

专业的地震荷载计算与施加模块，遵循《建筑抗震设计规范》GB 50011-2010 标准，提供多种计算策略供用户选择。

Professional seismic load calculation and application module following GB 50011-2010 standard, with multiple calculation strategies.

## 功能特性 / Features

### 1. 底部剪力计算 / Base Shear Calculation

支持多种重量计算方法：

- **from_model_direct**: 从模型直接获取总重量
- **from_elements**: 从构件重量计算（基于材料密度和截面）
- **from_floors**: 从楼层信息计算（恒载 + 0.5×活载）
- **default_value**: 使用默认值（10000 kN）
- **auto**: 自动选择最优方法

### 2. 地震力分配 / Force Distribution

支持多种分配策略：

- **by_stiffness**: 按刚度比例分配（推荐，适用于框架结构）
  - 根据构件抗侧刚度比例分配地震力
  - F_i = (k_i / Σk_j) × F_total

- **by_distance**: 按距离刚度中心分配
  - 考虑扭转效应
  - F_i = (k_i × d_i / Σk_j × d_j) × F_total

- **evenly**: 平均分配（简化方法）
  - F_i = F_total / n

- **auto**: 自动选择最优策略

### 3. 规范符合性 / Code Compliance

- 遵循 GB 50011-2010 第 5.1.3 条：重力荷载代表值 = 1.0×恒载 + ψ_L×活载
- 遵循 GB 50011-2010 第 5.1.4 条：地震影响系数最大值 α_max
- 遵循 GB 50011-2010 第 5.1.5 条：阻尼调整系数 η_1
- 遵循 GB 50011-2010 第 5.2.1 条：倒三角形楼层力分布

## 模块结构 / Module Structure

```
seismic-load/
├── __init__.py                  # 模块初始化
├── skill.yaml                   # 技能清单（静态真源）
├── intent.md                    # 意图内容
├── runtime.py                   # 主运行时
├── base_shear_calculator.py     # 底部剪力计算器
├── force_distributor.py         # 地震力分配器
├── model_reader.py              # 模型数据读取器
├── utils.py                     # 工具函数
└── README.md                    # 本文档
```

`skill.yaml` is the canonical builtin skill definition for routing, stages, and compatibility.
`intent.md` is prompt/content only.

`skill.yaml` 是内置技能的唯一静态真源，用于定义路由、授权、阶段和兼容性。
`intent.md` 只承载提示与内容。

## 使用方法 / Usage

### 基本用法 / Basic Usage

```python
from structure_protocol.structure_model_v2 import StructureModelV2
from seismic_load import generate_seismic_loads

# 加载模型
model = StructureModelV2(**model_data)

# 生成地震荷载（使用默认参数）
result = generate_seismic_loads(model, {
    "intensity": 7.0,
    "site_category": "II",
    "design_group": "第二组",
    "seismic_direction": "x"
})

print(result["status"])  # "success"
```

### 高级用法 / Advanced Usage

```python
from seismic_load import (
    generate_seismic_loads,
    WeightCalculationMethod,
    ForceDistributeMethod
)

# 使用自定义参数
result = generate_seismic_loads(model, {
    "intensity": 7.5,
    "site_category": "II",
    "design_group": "第二组",
    "damping_ratio": 0.05,
    "seismic_direction": "x",
    "case_id": "LC_EX",
    "case_name": "X方向地震作用",
    "description": "根据GB50011-2010计算的X方向地震作用",

    # 重量计算方法
    "weight_calculation_method": "from_elements",

    # 地震力分配方法
    "force_distribute_method": "by_stiffness",

    # 活载组合值系数
    "live_load_factor": 0.5
})

# 获取详细信息
base_shear = result["calculation_details"]["base_shear"]
total_weight = result["calculation_details"]["total_weight"]
story_forces = result["calculation_details"]["story_forces"]

print(f"底部剪力: {base_shear:.2f} kN")
print(f"结构总重量: {total_weight:.2f} kN")
```

### 使用生成器类 / Using Generator Class

```python
from seismic_load import SeismicLoadGenerator, WeightCalculationMethod, ForceDistributeMethod

# 创建生成器
generator = SeismicLoadGenerator(
    model,
    weight_calculation_method=WeightCalculationMethod.FROM_ELEMENTS,
    force_distribute_method=ForceDistributeMethod.BY_STIFFNESS
)

# 生成地震荷载
result = generator.generate_seismic_loads(
    intensity=7.0,
    site_category='II',
    design_group='第二组',
    damping_ratio=0.05,
    seismic_direction='x',
    case_id='LC_E',
    description='地震荷载',
    live_load_factor=0.5
)

# 获取荷载工况
load_cases = generator.get_load_cases()
load_actions = generator.get_load_actions()
```

### 添加自定义地震荷载 / Custom Seismic Loads

```python
# 添加自定义地震荷载
generator.add_custom_seismic_load(
    element_id="C1",
    element_type="column",
    load_value=15.5,
    seismic_direction="x",
    case_id="LC_E"
)
```

## 参数说明 / Parameters

### 必需参数 / Required Parameters

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| intensity | float | 设防烈度 (6.0-9.0) | 7.0 |
| site_category | str | 场地类别 (I, II, III, IV) | "II" |
| design_group | str | 设计地震分组 | "第二组" |

### 可选参数 / Optional Parameters

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| damping_ratio | float | 阻尼比 (0.01-0.2) | 0.05 |
| seismic_direction | str | 地震方向 (x, y, z, -x, -y, -z) | "x" |
| case_id | str | 荷载工况ID | "LC_E" |
| case_name | str | 荷载工况名称 | "地震工况" |
| description | str | 荷载工况描述 | "地震荷载" |
| weight_calculation_method | str | 重量计算方法 | "auto" |
| force_distribute_method | str | 地震力分配方法 | "auto" |
| live_load_factor | float | 活载组合值系数 | 0.5 |

## 返回值 / Return Value

```python
{
    "status": "success",
    "load_cases": {...},
    "load_actions": [...],
    "summary": {
        "case_count": 1,
        "action_count": 16,
        "case_id": "LC_E",
        "intensity": 7.0,
        "site_category": "II",
        "design_group": "第二组",
        "seismic_direction": "x",
        "weight_calculation_method": "from_elements",
        "force_distribute_method": "by_stiffness",
        "live_load_factor": 0.5
    },
    "calculation_details": {
        "base_shear": 640.0,
        "total_weight": 8000.0,
        "alpha_max": 0.08,
        "story_forces": [100.0, 200.0, 340.0]
    }
}
```

## 技术细节 / Technical Details

### 底部剪力计算流程 / Base Shear Calculation Flow

```
1. 计算结构总重量
   ├─ 方法选择 (auto/from_model_direct/from_elements/from_floors/default_value)
   ├─ 如果 from_elements:
   │   ├─ 遍历所有构件
   │   ├─ 计算构件体积 (长度 × 截面面积)
   │   ├─ 计算构件重量 (体积 × 密度 × g)
   │   └─ 累加所有构件重量
   └─ 如果 from_floors:
       ├─ 遍历所有楼层
       ├─ 楼面荷载 = (恒载 + 0.5×活载) × 面积
       ├─ 竖向构件重量
       └─ 累加楼层重量

2. 获取地震影响系数最大值
   └─ 根据设防烈度查询 α_max 表

3. 计算底部剪力
   └─ F_ek = α_max × G_eq

4. 阻尼调整
   └─ 如果阻尼比 ≠ 0.05，应用调整系数 η_1
```

### 地震力分配流程 / Force Distribution Flow

```
1. 楼层力分配 (倒三角形)
   └─ F_i = (H_i / ΣH_j) × F_ek

2. 构件力分配
   ├─ 方法选择 (auto/by_stiffness/by_distance/evenly)
   ├─ 如果 by_stiffness:
   │   ├─ 计算每个构件的抗侧刚度
   │   └─ 按刚度比例分配
   ├─ 如果 by_distance:
   │   ├─ 计算刚度中心
   │   ├─ 计算每个构件到刚度中心的距离
   │   └─ 按刚度×距离比例分配
   └─ 如果 evenly:
       └─ 平均分配给所有构件

3. 创建荷载动作
   └─ 为每个构件生成 LoadAction
```

## 计算示例 / Calculation Example

### 示例1: 框架结构 / Frame Structure

```python
# 3层框架结构，设防烈度7度
result = generate_seismic_loads(model, {
    "intensity": 7.0,
    "site_category": "II",
    "design_group": "第二组",
    "weight_calculation_method": "from_elements",
    "force_distribute_method": "by_stiffness"
})

# 输出:
# 底部剪力: 640.0 kN
# 结构总重量: 8000.0 kN
# 楼层地震力:
#   楼层1: 80.0 kN (12.5%)
#   楼层2: 160.0 kN (25.0%)
#   楼层3: 240.0 kN (37.5%)
#   楼层4: 160.0 kN (25.0%)
```

### 示例2: 剪力墙结构 / Shear Wall Structure

```python
# 剪力墙结构，考虑扭转效应
result = generate_seismic_loads(model, {
    "intensity": 8.0,
    "site_category": "II",
    "design_group": "第二组",
    "force_distribute_method": "by_distance"
})

# 输出:
# 底部剪力: 1280.0 kN
# 结构总重量: 8000.0 kN
# 按距离刚度中心分配，考虑扭转效应
```

## 规范参考 / Code References

- GB 50011-2010《建筑抗震设计规范》
  - 第 5.1.3 条: 重力荷载代表值
  - 第 5.1.4 条: 地震影响系数曲线
  - 第 5.1.5 条: 阻尼调整系数
  - 第 5.2.1 条: 底部剪力法

## 注意事项 / Notes

1. **重量计算**: 建议使用 "from_elements" 方法，最准确
2. **力分配**: 框架结构推荐 "by_stiffness"，剪力墙结构推荐 "by_distance"
3. **阻尼比**: 钢结构通常 0.02-0.04，混凝土结构通常 0.05
4. **活载系数**: 一般取 0.5，根据建筑类型可调整

## 故障排除 / Troubleshooting

### 问题: 计算出的重量为 0

**原因**: 模型缺少材料或截面信息

**解决**:
- 检查模型是否包含 materials 和 sections
- 确保每个构件都有有效的 material 和 section 引用
- 使用 "default_value" 方法作为临时方案

### 问题: 地震力分配不均

**原因**: 使用了 "evenly" 分配方法

**解决**:
- 改用 "by_stiffness" 或 "by_distance" 方法
- 确保截面包含惯性矩数据

### 问题: 底部剪力过小

**原因**: 结构重量计算不足

**解决**:
- 检查材料密度是否正确
- 确认楼面荷载已包含
- 使用 "from_floors" 方法增加楼面荷载

## 扩展开发 / Extension Development

### 添加新的重量计算方法

1. 在 `base_shear_calculator.py` 中添加新方法
2. 更新 `WeightCalculationMethod` 枚举
3. 在 `_calculate_total_weight` 中添加处理逻辑

### 添加新的力分配方法

1. 在 `force_distributor.py` 中添加新方法
2. 更新 `ForceDistributeMethod` 枚举
3. 在 `distribute_force_to_floor` 中添加处理逻辑

## 更新日志 / Changelog

### v2.1.0 (2026-04-01) - 质量优化版 / Quality Optimization

#### 修复 / Fixes
- 🐛 修复阻尼调整系数公式错误 (GB 50011-2010 公式 5.1.5-3)
  - 修正前: η_1 = 0.02 + (0.05 - ζ) / 8
  - 修正后: η_1 = 0.02 + (0.05 - ζ) / (1 + 3ζ)
- 🐛 移除代码重复: 删除 runtime.py 中的重复常量定义
- 🐛 修复楼层力分布: 改为使用实际楼层重量而非仅按层数分配
  - 修正前: weight = i (仅按层数)
  - 修正后: weight = actual_floor_weight (实际楼层重量)
- 🐛 完善错误处理: 将日志级别从 warning 提升为 error

#### 新增 / New Features
- ✨ 添加输入参数验证: 使用 `validate_seismic_parameters()` 检查所有输入
- ✨ 添加楼层重量计算: `_calculate_story_weight()` 方法
- ✨ 添加单元测试套件: test_seismic_load.py 包含 40+ 测试用例

#### 改进 / Improvements
- ♻️ 代码去重: runtime.py 重复代码已清理
- 📝 完善文档: 更新所有示例和说明
- 🧪 测试覆盖: 新增完整单元测试

### v2.0.0 (2026-04-01)

- ✨ 重构为模块化架构
- ✨ 新增多种重量计算方法
- ✨ 新增多种地震力分配策略
- ✨ 新增规范符合性验证
- 🐛 修复硬编码重量问题
- 🐛 修复简化力分配问题
- 📝 完善文档和注释

### v1.0.0 (Initial)

- 基础地震荷载生成功能
- 底部剪力法实现
- 简化力分配

## 贡献 / Contributing

欢迎提交 Issue 和 Pull Request！

Welcome to submit Issues and Pull Requests!
