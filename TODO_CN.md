## TODO

1. 重新整理代码架构

   - core文件夹下内容主要是OpenSeesPy引擎，应转为skill放入backend/src/agent-skills文件夹下。

2. SKILL 拆分

   - 基本流程：设计-计算-规范校验-报告导出-出图
   - 数据读取SKILL（CAD转化，Revit转化，BIM模型导入，纯图片转化，PDF不同形式等）
   - 结构类型SKILL（住宅-剪力墙结构设计，框架结构设计，框架-剪力墙结构设计，特殊结构设计，输电塔结构设计等）
   - 设计SKILL（AI-structure SKILL等）
   - 材料SKILL（混凝土材料、钢材、高强材料、砌体等）
   - 截面SKILL（普通截面，异形截面，桥截面）
   - 荷载及边界SKILL（恒载、活载、风载、地震载荷，边界条件等）
   - 验证SKILL（验证不同结构类型JSON生成是否满足schema）
   - 计算SKILL（OpenSees计算、PKPM计算、YJK计算，将通用格式转化为引擎所需格式，并启动计算）
   - 计算后处理SKILL（将引擎计算结果转为通用格式，并进行后处理，OpenSees，PKPM等）
   - 规范校验SKILL（GB50017等或按规范条文划分SKILL）
   - 报告导出SKILL（计算书等）
   - 出图SKILL（YJK出图API，PKPM出图API等）
   - 前端可视化SKILL（Plotly.js, pyvista等）
   - 通用SKILL（记忆、计划、读文件、写文件、替换、基本cmd/bash命令）
   - 技能分为builtin和skillhub(external)两种，builtin是内置技能，skillhub是外部技能，需要从skillhub中加载。

3. 结构计算JSON文件格式

   - 结构计算JSON应初步兼容YJK、PKPM等主流计算软件所需的参数，并支持后续扩展。

4. 统一多端入口

   - 将make.ps1/make.sh/make.cmd合并为sclaw，统一多端入口。sclaw应能直接在windows/Linux/MacOS下运行。
   - 补充sclaw_cn，sclaw_cn是sclaw的简体中文版本，并将对应安装源改为CN镜像源，加速国内用户部署。
   - 精简scripts文件夹中内容，将scripts文件夹中的内容合并到sclaw中，方便多端使用。
   - 保留docker部署方法，并将docker部署方法（包括windows上的start.ps1, stop.ps1, install.ps1）也写入到sclaw和sclaw_cn中，sclaw_cn中docker(Dockerfile & docker-compose.yml)均需要更改为国内镜像源

5. 增加测试代码覆盖率

   - 单元测试、集成测试、runner
   - windows、Linux环境的install测试（包括原生+docker）

6. 文档更新

   - 根据上述代码修改，更新文档（README.md, README_CN.md, docs/handbook.md, docs/handbook_CN.md, docs/reference.md, docs/reference_CN.md）
   - 同步更新github wiki
   - 删除过时的文档（docs/windows-wsl2-setup.md）

7. triage

   - ISSUE, PR, discussion 管理
