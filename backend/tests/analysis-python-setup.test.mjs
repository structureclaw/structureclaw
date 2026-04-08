import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const require = createRequire(import.meta.url);
const runtime = require(path.join(repoRoot, 'scripts', 'cli', 'runtime.js'));
const cliMain = require(path.join(repoRoot, 'scripts', 'cli', 'main.js'));

describe('analysis python setup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reinstalls analysis requirements when backend/.venv is missing yaml', async () => {
    const paths = runtime.resolvePaths(repoRoot);
    const env = {
      ...process.env,
      SCLAW_PROFILE: 'test',
      SCLAW_PROGRAM_NAME: 'sclaw',
    };
    let yamlInstalled = false;
    const runCommand = jest.spyOn(runtime, 'runCommand').mockImplementation(async (command, args) => {
      if (command === 'uv' && Array.isArray(args) && args.includes('pip') && args.includes('install')) {
        yamlInstalled = true;
      }
    });

    jest.spyOn(runtime, 'loadProjectEnvironment').mockReturnValue({
      paths,
      env,
      dotEnv: {},
    });
    jest.spyOn(runtime, 'resolveAnalysisPython').mockReturnValue('/virtual/backend/.venv/bin/python');
    jest.spyOn(runtime, 'hasCommand').mockReturnValue(true);
    jest.spyOn(runtime, 'pythonModuleExists').mockImplementation(async (_pythonPath, moduleName) => {
      if (moduleName === 'uvicorn') {
        return true;
      }
      if (moduleName === 'yaml') {
        return yamlInstalled;
      }
      return false;
    });

    await cliMain.main(['setup-analysis-python'], { rootDir: repoRoot });

    expect(runCommand).not.toHaveBeenCalledWith(
      'uv',
      expect.arrayContaining(['venv']),
    );
    expect(runCommand).toHaveBeenCalledWith(
      'uv',
      expect.arrayContaining([
        'pip',
        'install',
        '--python',
        '/virtual/backend/.venv/bin/python',
        '-r',
        paths.analysisRequirementsFile,
      ]),
      expect.objectContaining({ env }),
    );
  });
});
