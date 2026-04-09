"""
快速验证脚本 - 检查所有 Python 文件的语法和基本结构
Quick verification script - Check all Python files for syntax and basic structure
"""

import ast
import os
import sys
from pathlib import Path


def check_python_syntax(file_path):
    """
    检查 Python 文件语法

    Args:
        file_path: Python 文件路径

    Returns:
        (is_valid, error_message)
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            source = f.read()
        ast.parse(source)
        return True, None
    except SyntaxError as e:
        return False, f"Syntax error at line {e.lineno}: {e.msg}"
    except (OSError, IOError, UnicodeDecodeError) as e:
        return False, f"文件读取错误: {str(e)}"
    except MemoryError as e:
        return False, f"解析错误: {str(e)}"


def check_imports(file_path):
    """
    检查 Python 文件的导入语句

    Args:
        file_path: Python 文件路径

    Returns:
        imports - 导入语句列表
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            source = f.read()
        tree = ast.parse(source)

        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module if node.module else ''
                for alias in node.names:
                    imports.append(f"{module}.{alias.name}")

        return imports
    except Exception as e:
        return [f"Error: {str(e)}"]


def main():
    """主函数"""
    print("=" * 70)
    print("Load and Boundary Skills - Quick Verification")
    print("=" * 70)

    # 获取所有 Python 文件
    base_dir = Path(__file__).parent.parent
    python_files = []

    # 核心模块
    core_dir = base_dir / "core"
    for py_file in core_dir.glob("*.py"):
        python_files.append(py_file)

    # 子技能
    sub_skills = ["dead-load", "live-load", "wind-load", "seismic-load", "boundary-condition"]
    for skill in sub_skills:
        skill_dir = base_dir / skill
        for py_file in skill_dir.glob("*.py"):
            python_files.append(py_file)

    # 测试文件
    verification_dir = base_dir / "verification"
    for py_file in verification_dir.glob("*.py"):
        python_files.append(py_file)

    # 排序
    python_files.sort()

    print(f"\nFound {len(python_files)} Python files to check\n")

    # 检查每个文件
    all_passed = True
    results = []

    for py_file in python_files:
        rel_path = py_file.relative_to(base_dir)

        # 检查语法
        is_valid, error = check_python_syntax(py_file)
        if not is_valid:
            print(f"[FAIL] {rel_path}")
            print(f"  Error: {error}")
            all_passed = False
            results.append((rel_path, False, error))
            continue

        # 检查导入
        imports = check_imports(py_file)

        # 获取文件大小
        file_size = py_file.stat().st_size

        print(f"[PASS] {rel_path} ({file_size} bytes)")
        print(f"  Imports: {len(imports)}")

        results.append((rel_path, True, None))

    # 总结
    print("\n" + "=" * 70)
    if all_passed:
        print("[PASS] All files passed syntax check!")
    else:
        print("[FAIL] Some files have errors")
    print("=" * 70)

    # 详细报告
    if not all_passed:
        print("\nFailed files:")
        for rel_path, passed, error in results:
            if not passed:
                print(f"  - {rel_path}: {error}")

    return 0 if all_passed else 1


if __name__ == "__main__":
    # 设置标准输出编码
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.exit(main())
