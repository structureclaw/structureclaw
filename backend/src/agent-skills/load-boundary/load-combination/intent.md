# 荷载组合技能意图定义

## 技能名称

**中文名**: 荷载组合
**英文名**: Load Combination

## 技能描述

根据荷载工况自动生成规范符合的荷载组合，支持承载能力极限状态（ULS）、正常使用极限状态（SLS）、地震作用组合等，并支持自定义组合和工况展开。

## 输入参数

### 核心参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `load_cases` | Object | 是 | 荷载工况对象，包含恒载、活载、风载、地震等工况 |
| `combination_type` | String | 否 | 组合类型：`uls`(默认)、`sls`、`seismic`、`all` |
| `combination_factors` | Object | 否 | 自定义组合系数，默认使用规范值 |
| `expand_cases` | Boolean | 否 | 是否展开工况（活1~活4、吊1~吊8等），默认 false |
| `include_favorable` | Boolean | 否 | 是否包含恒载有利情况组合，默认 true |

### load_cases 结构

```typescript
{
  "dead_load": ["LC_DE", "LC_DE2"],      // 恒载工况ID列表
  "live_load": ["LC_LL", "LC_LL2"],      // 活载工况ID列表
  "wind_load": ["LC_WX", "LC_WY"],       // 风载工况ID列表
  "seismic_load": ["LC_EX", "LC_EY"],    // 地震工况ID列表
  "crane_load": ["LC_C1", "LC_C2"],      // 吊车荷载工况ID列表
  "temperature_load": ["LC_T1"],         // 温度荷载工况ID列表
  "custom_load": ["LC_CUSTOM"]           // 自定义荷载工况ID列表
}
```

### combination_factors 结构

```typescript
{
  "gamma_g": 1.3,              // 恒载分项系数（不利）
  "gamma_g_favorable": 1.0,    // 恒载分项系数（有利）
  "gamma_q": 1.5,              // 活载分项系数
  "gamma_w": 1.5,              // 风载分项系数
  "gamma_eh": 1.3,             // 水平地震作用分项系数
  "gamma_ev": 0.5,             // 竖向地震作用分项系数
  "psi_live": 0.7,            // 活载组合值系数
  "psi_wind": 0.6,            // 风载组合值系数
  "psi_crane": 0.7,           // 吊车组合值系数
  "psi_temp": 0.6,            // 温度荷载组合值系数
  "psi_seismic": 0.5          // 地震组合时活载代表值系数
}
```

## 输出格式

### 成功响应

```typescript
{
  "status": "success",
  "combinations": [
    {
      "id": "COMB_1",
      "type": "uls",
      "description": "活载控制: LC_LL",
      "factors": {
        "LC_DE": 1.2,
        "LC_LL": 1.5
      },
      "code_reference": "GB50009-2012 3.2.4",
      "extra": {}
    },
    {
      "id": "COMB_2",
      "type": "uls",
      "description": "风载控制: LC_WX",
      "factors": {
        "LC_DE": 1.3,
        "LC_WX": 1.5
      },
      "code_reference": "GB50009-2012 3.2.4",
      "extra": {}
    }
    // ... 更多组合
  ],
  "expanded_cases": {  // 如果 expand_cases=true
    "LC_LL_1": {
      "id": "LC_LL_1",
      "type": "live_load",
      "description": "楼面活载 (活1)",
      "parent_case": "LC_LL",
      "extra": {"sub_case_index": 1}
    }
    // ... 更多展开工况
  },
  "summary": {
    "total": 25,
    "uls": 15,
    "sls": 6,
    "seismic": 4
  }
}
```

### 错误响应

```typescript
{
  "status": "error",
  "error": "无有效的荷载工况",
  "message": "至少需要提供一个荷载工况才能生成组合"
}
```

## 组合规则

### 承载能力极限状态组合 (ULS)

基于 GB50009-2012 3.2.4

1. **活载控制组合**
   - 1.3*恒 + 1.5*活
   - 1.0*恒 + 1.5*活（当恒载有利时）

2. **风载控制组合**
   - 1.3*恒 + 1.5*风
   - 1.0*恒 + 1.5*风（当恒载有利时）

3. **活+风组合**
   - 1.3*恒 + 1.5*活 + 0.6*1.5*风
   - 1.3*恒 + 1.5*风 + 0.7*1.5*活

4. **有吊车时的补充组合**
   - 1.3*恒 + 1.5*吊
   - 1.3*恒 + 0.7*1.5*活 + 1.5*吊
   - 1.3*恒 + 1.5*活 + 0.7*1.5*吊

5. **特殊构件组合**
   - 抗风柱：考虑风压力/风吸力 + 活载

### 正常使用极限状态组合 (SLS)

基于 GB50009-2012 3.2.3

所有分项系数取1.0，组合值系数同基本组合

- 1.0*恒 + 1.0*活
- 1.0*恒 + 1.0*风
- 1.0*恒 + 1.0*活 + 0.6*1.0*风
- 1.0*恒 + 1.0*风 + 0.7*1.0*活

### 地震作用组合

基于 GB50011-2010 5.4.1

- 1.2*(恒 + 0.5*活) + 1.3*地
- 1.0*(恒 + 0.5*活) + 1.3*地（当恒载有利时）

## 工况展开规则

当 `expand_cases=true` 时，自动对可变荷载进行展开：

| 荷载类型 | 展开规则 | 说明 |
|---------|---------|------|
| 活荷载 | 活1~活4 | 用于梁的不同活载分布 |
| 风荷载 | 左风、右风 | 考虑风的不同作用方向 |
| 地震作用 | 左震、右震 | 考虑地震的不同作用方向 |
| 吊车荷载 | 吊1~吊8 | 考虑吊车的不同最不利位置 |

## 使用示例

### 示例 1：基础 ULS 组合

```python
result = generate_load_combinations(
    load_cases={
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "wind_load": ["LC_WX"]
    },
    combination_type="uls"
)
```

### 示例 2：包含地震组合

```python
result = generate_load_combinations(
    load_cases={
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "seismic_load": ["LC_EX"]
    },
    combination_type="all"
)
```

### 示例 3：展开工况并组合

```python
result = generate_load_combinations(
    load_cases={
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"],
        "wind_load": ["LC_WX"]
    },
    combination_type="uls",
    expand_cases=True
)
```

### 示例 4：自定义组合系数

```python
result = generate_load_combinations(
    load_cases={
        "dead_load": ["LC_DE"],
        "live_load": ["LC_LL"]
    },
    combination_factors={
        "gamma_g": 1.35,
        "gamma_q": 1.4
    }
)
```

## 注意事项

1. **规范适用性**：默认系数基于中国规范 GB50009-2012 和 GB50011-2010
2. **工况展开**：展开工况后组合数量会大幅增加，注意性能
3. **有利恒载**：抗倾覆等验算时恒载分项系数取1.0
4. **互斥活载**：多组互斥活载不会同时组合
5. **吊车折减**：多台吊车参与组合时需乘以折减系数
6. **特殊构件**：抗风柱、温度作用等需特殊处理

## 参考规范

- GB50009-2012 建筑结构荷载规范
- GB50011-2010 建筑抗震设计规范
- GB50017-2003 钢结构设计规范
- GB50010-2010 混凝土结构设计规范
