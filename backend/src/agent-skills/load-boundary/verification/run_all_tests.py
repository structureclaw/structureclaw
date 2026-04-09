"""
Load-Boundary 测试套件运行器 / Load-Boundary Test Suite Runner

运行所有 load-boundary 子技能的测试，包括：
- boundary-condition
- dead-load
- live-load
- wind-load
- seismic-load
- load-combination
"""

import sys
import os
import importlib.util
import traceback
from pathlib import Path


def run_test_suite(test_name: str, test_module_path: str) -> bool:
    """
    运行单个测试套件

    Args:
        test_name: 测试套件名称
        test_module_path: 测试模块路径

    Returns:
        是否成功
    """
    print(f"\n{'='*60}")
    print(f"运行测试套件: {test_name}")
    print(f"{'='*60}\n")

    try:
        # 导入测试模块
        spec = importlib.util.spec_from_file_location(test_name, test_module_path)
        test_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(test_module)

        # 运行测试
        if hasattr(test_module, 'run_tests'):
            success = test_module.run_tests()
            return success
        else:
            print(f"错误: 测试模块 {test_name} 缺少 run_tests() 函数")
            return False

    except (ImportError, ModuleNotFoundError) as e:
        print(f"错误: 无法导入测试模块 {test_name}: {e}")
        return False
    except (AttributeError, SyntaxError) as e:
        print(f"错误: 测试模块 {test_name} 存在语法或属性错误: {e}")
        traceback.print_exc()
        return False
    except RuntimeError as e:
        print(f"错误: 运行测试套件 {test_name} 时发生运行时错误: {e}")
        traceback.print_exc()
        return False
    except Exception as e:
        print(f"错误: 运行测试套件 {test_name} 失败: {e}")
        traceback.print_exc()
        return False


def main():
    """主函数"""
    # 获取当前目录
    current_dir = Path(__file__).parent

    # 测试套件列表
    test_suites = [
        {
            "name": "boundary-condition",
            "path": current_dir / "test_boundary_condition.py"
        },
        {
            "name": "dead-load",
            "path": current_dir / "test_dead_load.py"
        },
        {
            "name": "live-load",
            "path": current_dir / "test_live_load.py"
        },
        {
            "name": "seismic-load",
            "path": current_dir.parent / "seismic-load" / "test_seismic_load.py"
        },
        {
            "name": "load-combination",
            "path": current_dir / "test_load_combination.py"
        },
    ]

    # 运行所有测试套件
    results = []
    for suite in test_suites:
        success = run_test_suite(suite["name"], str(suite["path"]))
        results.append({
            "name": suite["name"],
            "success": success
        })

    # 打印汇总
    print(f"\n{'='*60}")
    print("测试汇总 / Test Summary")
    print(f"{'='*60}\n")

    total = len(results)
    passed = sum(1 for r in results if r["success"])
    failed = total - passed

    print(f"总计 / Total: {total}")
    print(f"通过 / Passed: {passed}")
    print(f"失败 / Failed: {failed}")
    print(f"通过率 / Pass Rate: {passed/total*100:.1f}%")

    # 详细结果
    print(f"\n详细结果 / Detailed Results:")
    print(f"{'-'*60}")
    for result in results:
        status = "[PASS]" if result["success"] else "[FAIL]"
        print(f"{status:10} {result['name']}")

    # 返回退出码
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
