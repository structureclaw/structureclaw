const path = require("node:path");

const { createRequire } = require("node:module");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const { COMMAND_NAMES } = require("../../scripts/cli/command-manifest");
const runtime = require("../../scripts/cli/runtime");
const { runBackendBuildOnce } = require("./shared");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function backendRequire(rootDir) {
  return createRequire(path.join(rootDir, "backend", "package.json"));
}

function clearProviderEnv() {
  process.env.LLM_API_KEY = "";
}

/** Load LangGraphAgentService from dist. */
async function importBackendAgentService(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "agent-langgraph", "agent-service.js");
  const mod = await import(pathToFileURL(filePath).href);
  return mod.LangGraphAgentService;
}

/** Bust ESM cache after tsc rewrote dist; do not use when patching LangGraphAgentService.prototype before registering routes. */
async function importBackendAgentServiceFresh(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "agent-langgraph", "agent-service.js");
  const url = `${pathToFileURL(filePath).href}?regression=${Date.now()}`;
  const mod = await import(url);
  return mod.LangGraphAgentService;
}

/** Load AgentSkillRuntime for constructing LangGraphAgentService instances. */
async function importAgentSkillRuntime(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "agent-runtime", "index.js");
  const mod = await import(pathToFileURL(filePath).href);
  return mod.AgentSkillRuntime;
}

async function validateAgentOrchestration(context) {
  await runBackendBuildOnce(context);
  clearProviderEnv();

  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const AgentSkillRuntime = await importAgentSkillRuntime(context.rootDir);

  // --- Protocol metadata (simplified: tools only, no version/schemas) ---
  {
    const protocol = LangGraphAgentService.getProtocol();
    assert(Array.isArray(protocol.tools) && protocol.tools.length >= 3, "protocol tools should be present");
    assert(protocol.tools.some((tool) => tool.name === "run_analysis"), "run_analysis tool spec should exist");
    assert(protocol.tools.some((tool) => tool.name === "validate_model"), "validate_model tool spec should exist");
    assert(protocol.tools.every((tool) => typeof tool.name === "string" && typeof tool.description === "string"), "tool specs should have name and description");
    console.log("[ok] agent protocol metadata");
  }

  // --- Skill listing ---
  {
    const skillRuntime = new AgentSkillRuntime();
    const svc = new LangGraphAgentService(skillRuntime);
    const { skills } = await svc.listSkills();
    assert(Array.isArray(skills) && skills.length > 0, "listSkills should return non-empty skill array");
    assert(skills.some((s) => s.id === "beam"), "skills should include beam");
    console.log("[ok] agent skill listing");
  }

  // --- Source code structural checks ---
  {
    const chatPath = path.join(context.rootDir, 'backend', 'src', 'api', 'chat.ts');
    const chatSource = fs.readFileSync(chatPath, 'utf8');

    const conversationPath = path.join(context.rootDir, 'backend', 'src', 'services', 'conversation.ts');
    const conversationSource = fs.readFileSync(conversationPath, 'utf8');

    assert(
      chatSource.includes('projectId'),
      '/api/v1/chat must accept projectId to align with /api/v1/agent/run',
    );
    assert(
      conversationSource.includes('PROJECTION CACHE') || conversationSource.includes('projection cache'),
      'conversation.ts must document that snapshots are projection caches, not pipeline truth',
    );
    console.log("[ok] chat projectId passthrough and snapshot boundary");
  }

  // --- Domain-to-role mapping for runtimeContract ---
  {
    const { skillManifestFileSchema } = await import(
      pathToFileURL(path.join(context.rootDir, 'backend', 'dist', 'agent-runtime', 'manifest-schema.js')).href
    );
    const { parse: parseYaml } = backendRequire(context.rootDir)('yaml');
    const { existsSync, readdirSync, readFileSync } = require('node:fs');

    function collectDirectories(root) {
      const result = [];
      const queue = [root];
      while (queue.length > 0) {
        const dir = queue.shift();
        result.push(dir);
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) queue.push(path.join(dir, entry.name));
          }
        } catch { /* ignore */ }
      }
      return result;
    }

    const DOMAIN_ROLE_MAP = {
      'structure-type': 'entry',
      'data-input': 'entry',
      'section': 'enricher',
      'material': 'enricher',
      'load-boundary': 'enricher',
      'design': 'designer',
      'validation': 'validator',
      'analysis': 'provider',
      'result-postprocess': 'transformer',
      'code-check': 'provider',
      'drawing': 'consumer',
      'report-export': 'consumer',
      'visualization': 'consumer',
      'general': 'assistant',
    };

    const skillManifestRoot = path.join(context.rootDir, 'backend', 'src', 'agent-skills');
    const dirs = collectDirectories(skillManifestRoot);
    let checkedCount = 0;
    for (const dir of dirs) {
      const manifestPath = path.join(dir, 'skill.yaml');
      if (!existsSync(manifestPath)) continue;
      const parsed = skillManifestFileSchema.safeParse(parseYaml(readFileSync(manifestPath, 'utf8')));
      if (!parsed.success) continue;
      if (!parsed.data.runtimeContract) continue;
      const expectedRole = DOMAIN_ROLE_MAP[parsed.data.domain];
      assert(
        parsed.data.runtimeContract.role === expectedRole,
        `Skill ${parsed.data.id} in domain ${parsed.data.domain} must declare role ${expectedRole}, got ${parsed.data.runtimeContract.role}`,
      );
      checkedCount++;
    }
    assert(
      checkedCount >= 1,
      `At least 1 builtin skill must declare runtimeContract for domain-to-role validation (found ${checkedCount})`,
    );
    console.log(`[ok] domain-to-role mapping validation (${checkedCount} skills checked)`);
  }
}

async function validateAgentBaseChatFallback(context) {
  await runBackendBuildOnce(context);

  process.env.LLM_API_KEY = process.env.LLM_API_KEY || "";

  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const AgentSkillRuntime = await importAgentSkillRuntime(context.rootDir);
  const skillRuntime = new AgentSkillRuntime();
  const svc = new LangGraphAgentService(skillRuntime);

  // With empty skillIds, run should still work and return a deterministic shape.
  const chatResult = await svc.run({
    conversationId: "conv-empty-skill-chat",
    message: "先聊需求，我要算一个门式刚架",
    context: {
      skillIds: [],
      locale: "zh",
    },
  });
  assert(typeof chatResult.success === "boolean", "run should return boolean success");
  assert(typeof chatResult.response === "string", "run should return string response");
  assert(Array.isArray(chatResult.toolCalls), "run should return toolCalls array");
  assert(typeof chatResult.conversationId === "string", "run should return conversationId");
  assert(typeof chatResult.traceId === "string", "run should return traceId");
  assert(chatResult.mode === "conversation", "empty-skill chat should use conversation mode");
  assert(Array.isArray(chatResult.toolCalls) && chatResult.toolCalls.length === 0, "empty-skill chat should not invoke tools");

  console.log("[ok] base-chat fallback contract");
}

async function validateAgentCapabilityModes(context) {
  await runBackendBuildOnce(context);
  clearProviderEnv();

  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const AgentSkillRuntime = await importAgentSkillRuntime(context.rootDir);
  const skillRuntime = new AgentSkillRuntime();
  const svc = new LangGraphAgentService(skillRuntime);

  // Verify listSkills works and returns skills with expected domains.
  const { skills } = await svc.listSkills();
  const defaultSkillIds = skills.map((skill) => skill.id);
  assert(Array.isArray(defaultSkillIds) && defaultSkillIds.length > 0, "should have default skills");
  assert(skills.some((s) => s.domain === "structure-type"), "should include structure-type skills");
  assert(skills.some((s) => s.domain === "analysis"), "should include analysis skills");

  // Verify run returns the expected shape.
  const result = await svc.run({
    conversationId: "conv-capability-test",
    message: "先聊一下需求",
    context: {
      locale: "zh",
      skillIds: [],
    },
  });
  assert(typeof result.success === "boolean", "run should return boolean success");
  assert(typeof result.response === "string", "run should return response string");
  assert(Array.isArray(result.toolCalls), "run should return toolCalls array");
  assert(typeof result.conversationId === "string", "run should return conversationId");
  assert(typeof result.traceId === "string", "run should return traceId");
  assert(typeof result.mode === "string", "run should return mode string");

  console.log("[ok] capability-mode contract");
}

async function validateAgentManifestBinding(context) {
  await runBackendBuildOnce(context);
  const { listAgentToolDefinitions } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-langgraph", "tool-registry.js")).href
  );
  const tools = listAgentToolDefinitions();
  const toolIds = tools.map((tool) => tool.id).sort();
  for (const requiredToolId of ["ask_user_clarification", "build_model", "detect_structure_type", "extract_draft_params", "generate_report", "run_analysis", "run_code_check", "set_session_config", "validate_model"]) {
    assert(toolIds.includes(requiredToolId), "code-owned registry should include " + requiredToolId);
  }
  assert(tools.every((tool) => tool.displayName?.zh && tool.displayName?.en && tool.description?.zh && tool.description?.en), "code-owned registry tools should keep bilingual metadata");
  assert(tools.every((tool) => typeof tool.create === "function"), "code-owned registry tools should expose executable factories");
  console.log("[ok] agent code-owned registry contract");
}

async function validateAgentManifestLoader(context) {
  await runBackendBuildOnce(context);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sclaw-manifest-loader-"));
  const validSkillRoot = path.join(tempRoot, "skills-valid");
  const invalidSkillRoot = path.join(tempRoot, "skills-invalid");
  const write = async (filePath, content) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
  };
  const assertDeclaredStagesCoverMarkdownAssets = async (skills, domainRoot, messagePrefix) => {
    for (const skill of skills) {
      const skillDir = path.dirname(skill.manifestPath);
      const relativeSkillDir = path.relative(domainRoot, skillDir) || skill.id;
      const entries = await fsp.readdir(skillDir);
      const stageAssets = ["intent.md", "draft.md", "analysis.md", "design.md"]
        .filter((fileName) => entries.includes(fileName))
        .map((fileName) => fileName.replace(/\.md$/, ""))
        .sort();
      const declaredStages = Array.isArray(skill.stages) ? [...skill.stages].sort() : [];
      for (const stage of stageAssets) {
        assert(declaredStages.includes(stage), messagePrefix + " " + relativeSkillDir + " should declare stage '" + stage + "' in skill.yaml when " + stage + ".md exists");
      }
    }
  };
  const assertBuiltinCompatibilityMatchesRuntimeDefaults = (skills, messagePrefix) => {
    for (const skill of skills) {
      assert(skill.compatibility?.minRuntimeVersion === "0.1.0", messagePrefix + " " + skill.id + " should target builtin runtime minRuntimeVersion 0.1.0");
      assert(skill.compatibility?.skillApiVersion === "v1", messagePrefix + " " + skill.id + " should target builtin skillApiVersion v1");
    }
  };
  try {
    await write(path.join(validSkillRoot, "analysis", "analysis-static", "skill.yaml"), [
      "id: analysis-static", "domain: analysis", "source: builtin", "name:", "  zh: 静力分析技能", "  en: Static Analysis Skill",
      "description:", "  zh: 负责静力分析。", "  en: Handles static analysis.", "triggers:", "  - static", "stages:", "  - analysis",
      "structureType: unknown", "structuralTypeKeys: []", "capabilities:", "  - analysis-execution", "requires: []", "conflicts: []",
      "autoLoadByDefault: false", "priority: 10", "compatibility:", "  minRuntimeVersion: 0.1.0", "  skillApiVersion: v1",
      "software: simplified", "analysisType: static", "engineId: builtin-simplified", "adapterKey: builtin-simplified", "runtimeRelativePath: runtime.py",
      "supportedAnalysisTypes:", "  - static", "supportedModelFamilies:", "  - generic", "materialFamilies: []", "",
    ].join("\n"));
    await write(path.join(validSkillRoot, "analysis", "analysis-static", "intent.md"), "# Static analysis prompt");
    await write(path.join(validSkillRoot, "analysis", "legacy-only", "intent.md"), "# legacy skill without manifest should be ignored");
    await write(path.join(invalidSkillRoot, "analysis", "invalid-analysis", "skill.yaml"), [
      "id: invalid-analysis", "domain: analysis", "source: builtin", "name:", "  zh: 缺失英文名称", "description:", "  zh: 描述存在", "  en: Description exists",
      "triggers: []", "stages:", "  - analysis", "structureType: unknown", "structuralTypeKeys: []", "capabilities: []", "obsoleteToolKey: []",
      "requires: []", "conflicts: []", "autoLoadByDefault: false", "priority: 0", "compatibility:", "  minRuntimeVersion: 0.1.0", "  skillApiVersion: v1",
      "supportedAnalysisTypes: []", "supportedModelFamilies:", "  - generic", "materialFamilies: []", "",
    ].join("\n"));
    const { loadSkillManifestsFromDirectory } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "skill-manifest-loader.js")).href);
    const skills = await loadSkillManifestsFromDirectory(validSkillRoot);
    assert(Array.isArray(skills), "skill manifest loader should return an array");
    assert(skills.length === 1, "skill manifest loader should only load directories with skill.yaml");
    assert(skills[0].id === "analysis-static", "skill manifest loader should preserve manifest id");
    assert(skills[0].name?.zh === "静力分析技能" && skills[0].name?.en === "Static Analysis Skill", "skill manifest loader should preserve bilingual localized text");
    assert(skills[0].software === "simplified", "skill manifest loader should preserve optional analysis software metadata");
    assert(skills[0].analysisType === "static", "skill manifest loader should preserve optional analysisType metadata");
    assert(skills[0].engineId === "builtin-simplified", "skill manifest loader should preserve optional engineId metadata");
    assert(skills[0].adapterKey === "builtin-simplified", "skill manifest loader should preserve optional adapterKey metadata");
    assert(skills[0].runtimeRelativePath === "runtime.py", "skill manifest loader should preserve optional runtimeRelativePath metadata");
    let rejectedInvalidSkill = false;
    try { await loadSkillManifestsFromDirectory(invalidSkillRoot); } catch (_error) { rejectedInvalidSkill = true; }
    assert(rejectedInvalidSkill, "skill manifest loader should reject malformed or unknown skill.yaml fields");
    const builtinStructureTypeRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "structure-type");
    const builtinStructureTypeSkills = await loadSkillManifestsFromDirectory(builtinStructureTypeRoot);
    assert(JSON.stringify(builtinStructureTypeSkills.map((skill) => skill.id).sort()) === JSON.stringify(["beam", "double-span-beam", "frame", "generic", "portal-frame", "truss"]), "skill manifest loader should discover builtin structure-type skills from real skill.yaml files");
    await assertDeclaredStagesCoverMarkdownAssets(builtinStructureTypeSkills, builtinStructureTypeRoot, "builtin structure-type skill manifest");
    assertBuiltinCompatibilityMatchesRuntimeDefaults(builtinStructureTypeSkills, "builtin structure-type skill manifest");
    const builtinAnalysisRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "analysis");
    const builtinAnalysisSkills = await loadSkillManifestsFromDirectory(builtinAnalysisRoot);
    assert(builtinAnalysisSkills.every((skill) => skill.software && skill.analysisType && skill.engineId && skill.adapterKey), "builtin analysis skill manifests should declare explicit execution metadata");
    await assertDeclaredStagesCoverMarkdownAssets(builtinAnalysisSkills, builtinAnalysisRoot, "builtin analysis skill manifest");
    assertBuiltinCompatibilityMatchesRuntimeDefaults(builtinAnalysisSkills, "builtin analysis skill manifest");
    const builtinCodeCheckRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "code-check");
    const builtinCodeCheckSkills = await loadSkillManifestsFromDirectory(builtinCodeCheckRoot);
    assert(builtinCodeCheckSkills.every((skill) => typeof skill.designCode === "string" && skill.designCode.length > 0), "builtin code-check skill manifests should declare explicit designCode metadata");
    await assertDeclaredStagesCoverMarkdownAssets(builtinCodeCheckSkills, builtinCodeCheckRoot, "builtin code-check skill manifest");
    assertBuiltinCompatibilityMatchesRuntimeDefaults(builtinCodeCheckSkills, "builtin code-check skill manifest");
    for (const domain of ["load-boundary", "section", "validation", "report-export", "visualization"]) {
      const builtinDomainRoot = path.join(context.rootDir, "backend", "src", "agent-skills", domain);
      const builtinDomainSkills = await loadSkillManifestsFromDirectory(builtinDomainRoot);
      await assertDeclaredStagesCoverMarkdownAssets(builtinDomainSkills, builtinDomainRoot, "builtin " + domain + " skill manifest");
      assertBuiltinCompatibilityMatchesRuntimeDefaults(builtinDomainSkills, "builtin " + domain + " skill manifest");
    }
    console.log("[ok] agent manifest loader contract");
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function validateAgentToolCatalog(context) {
  await runBackendBuildOnce(context);
  const { listAgentToolDefinitions } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-langgraph", "tool-registry.js")).href);
  const tools = listAgentToolDefinitions();
  assert(Array.isArray(tools), "code-owned tool registry should return an array");
  const toolIds = tools.map((tool) => tool.id).sort();
  assert(toolIds.includes("run_analysis"), "code-owned tool registry should expose run_analysis");
  assert(toolIds.includes("validate_model"), "code-owned tool registry should expose validate_model");
  assert(toolIds.includes("generate_report"), "code-owned tool registry should expose generate_report");
  assert(toolIds.includes("run_code_check"), "code-owned tool registry should expose run_code_check");
  assert(toolIds.includes("set_session_config"), "code-owned tool registry should expose set_session_config");
  assert(!toolIds.includes("update_session_config"), "code-owned tool registry should not expose legacy update_session_config");
  assert(tools.every((tool) => tool.source === undefined), "code-owned registry should not depend on file-declared source metadata");
  console.log("[ok] agent code-owned tool catalog contract");
}

async function validateAgentSkillCatalogManifests(context) {
  await runBackendBuildOnce(context);
  const { AgentSkillCatalogService } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-skill-catalog.js")).href);
  const service = new AgentSkillCatalogService();
  const skills = await service.listBuiltinSkills();
  const byId = new Map(skills.map((skill) => [skill.canonicalId, skill]));
  for (const skillId of ["generic", "beam", "truss", "frame", "portal-frame", "double-span-beam"]) {
    assert(byId.has(skillId), "skill catalog should include structure-type skill " + skillId);
    const skill = byId.get(skillId);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), skillId + " should retain its skill.yaml path");
  }
  assert(byId.get("generic")?.triggers.includes("load"), "generic structure-type skill should preserve the manifest-level load trigger");
  const validationSkill = skills.find((skill) => skill.canonicalId === "validation-structure-model");
  assert(validationSkill, "skill catalog should include validation-structure-model");
  assert(validationSkill.aliases.includes("structure-json-validation"), "validation-structure-model should preserve legacy alias");
  for (const skillId of ["opensees-dynamic", "opensees-nonlinear", "opensees-seismic", "opensees-static", "simplified-dynamic", "simplified-seismic", "simplified-static", "code-check-gb50010", "code-check-gb50011", "code-check-gb50017", "code-check-jgj3", "dead-load", "section-common", "visualization-frame-summary"]) {
    const skill = skills.find((entry) => entry.canonicalId === skillId);
    assert(skill, "skill catalog should include skill " + skillId);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), skillId + " should retain its skill.yaml path");
  }
  console.log("[ok] agent skill catalog manifest contract");
}

async function validateAgentRuntimeLoader(context) {
  await runBackendBuildOnce(context);
  const { AgentSkillRuntime } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "index.js")).href);
  const analysisEntry = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "analysis", "entry.js")).href);
  const analysisRegistry = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "analysis", "registry.js")).href);
  const pythonAnalysisRegistrySource = await fsp.readFile(path.join(context.rootDir, "backend", "src", "agent-skills", "analysis", "runtime", "registry.py"), "utf8");
  const sourceSkillRoot = path.join(context.rootDir, "backend", "src", "agent-skills");
  const collectStageMarkdownFiles = async (rootDir) => {
    const collected = [];
    const visit = async (currentDir) => {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) { await visit(entryPath); continue; }
        if (entry.isFile() && ["intent.md", "draft.md", "analysis.md", "design.md"].includes(entry.name)) collected.push(entryPath);
      }
    };
    await visit(rootDir);
    return collected.sort();
  };
  const runtime = new AgentSkillRuntime();
  const skills = runtime.listSkills();
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const runtimeManifests = await runtime.listSkillManifests();
  const runtimeManifestById = new Map(runtimeManifests.map((manifest) => [manifest.id, manifest]));
  for (const [skillId, domain] of [["beam", "structure-type"], ["opensees-static", "analysis"], ["code-check-gb50010", "code-check"], ["dead-load", "load-boundary"], ["visualization-frame-summary", "visualization"], ["section-common", "section"], ["validation-structure-model", "validation"]]) {
    assert(byId.has(skillId), "runtime loader should include manifest-backed " + skillId + " skill");
    assert(byId.get(skillId)?.domain === domain, skillId + " should take domain from skill.yaml");
  }
  assert(!byId.has("structure-json-validation"), "runtime loader should not keep legacy validation frontmatter id once manifest-first loader is active");
  assert(Array.isArray(runtimeManifestById.get("beam")?.supportedModelFamilies), "structure-type runtime manifests should come from skill.yaml rather than plugin-only manifests");
  assert(Array.isArray(runtimeManifestById.get("beam")?.materialFamilies), "runtime manifests should preserve manifest schema defaults for structure-type skills");
  const stageMarkdownFiles = await collectStageMarkdownFiles(sourceSkillRoot);
  assert(stageMarkdownFiles.length > 0, "runtime loader validation should inspect builtin stage markdown files");
  for (const markdownPath of stageMarkdownFiles) {
    const source = await fsp.readFile(markdownPath, "utf8");
    assert(!source.trimStart().startsWith("---\n"), path.relative(context.rootDir, markdownPath) + " should not keep legacy YAML frontmatter");
  }
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "structureclaw-runtime-selection-"));
  try {
    const manifestOnlySkillRoot = path.join(tempRoot, "agent-skills");
    await fsp.mkdir(path.join(manifestOnlySkillRoot, "analysis", "custom-static"), { recursive: true });
    await fsp.mkdir(path.join(manifestOnlySkillRoot, "code-check", "custom-gb50018"), { recursive: true });
    await fsp.writeFile(path.join(manifestOnlySkillRoot, "analysis", "custom-static", "skill.yaml"), [
      "id: custom-static", "domain: analysis", "source: builtin", "name:", "  zh: 自定义静力分析", "  en: Custom Static Analysis",
      "description:", "  zh: 仅通过 skill.yaml 声明的静力分析技能。", "  en: Static analysis skill declared only via skill.yaml.", "triggers: []", "stages:", "  - analysis",
      "structureType: frame", "structuralTypeKeys: []", "capabilities:", "  - analysis-policy", "  - analysis-execution", "requires: []", "conflicts: []",
      "autoLoadByDefault: false", "priority: 999", "compatibility:", "  minRuntimeVersion: 0.1.0", "  skillApiVersion: v1", "software: simplified", "analysisType: static",
      "engineId: builtin-custom", "adapterKey: builtin-custom", "runtimeRelativePath: runtime.py", "supportedAnalysisTypes:", "  - static", "supportedModelFamilies:", "  - frame", "  - generic", "materialFamilies: []", "",
    ].join("\n"));
    await fsp.writeFile(path.join(manifestOnlySkillRoot, "code-check", "custom-gb50018", "skill.yaml"), [
      "id: code-check-gb50018", "domain: code-check", "source: builtin", "name:", "  zh: GB50018 规范校核", "  en: GB50018 Code Check",
      "description:", "  zh: 仅通过 skill.yaml 声明的规范校核技能。", "  en: Code-check skill declared only via skill.yaml.", "triggers:", "  - GB50018", "stages:", "  - design",
      "structureType: unknown", "structuralTypeKeys: []", "capabilities:", "  - code-check-policy", "  - code-check-execution", "requires: []", "conflicts: []", "autoLoadByDefault: false", "priority: 999",
      "compatibility:", "  minRuntimeVersion: 0.1.0", "  skillApiVersion: v1", "designCode: GB50018", "supportedAnalysisTypes: []", "supportedModelFamilies:", "  - generic", "materialFamilies: []", "",
    ].join("\n"));
    const manifestOnlyRuntime = new AgentSkillRuntime({ builtinSkillManifestRoot: manifestOnlySkillRoot });
    assert(manifestOnlyRuntime.listAnalysisSkillIds().includes("custom-static"), "analysis skill ids should be resolved from skill.yaml without registry/frontmatter metadata");
    assert(manifestOnlyRuntime.isAnalysisSkillId("custom-static"), "isAnalysisSkillId should recognize manifest-only analysis skills");
    assert(manifestOnlyRuntime.resolvePreferredAnalysisSkill({ analysisType: "static", engineId: "builtin-custom", supportedModelFamilies: ["frame"] })?.id === "custom-static", "preferred analysis skill resolution should use manifest-only analysis metadata");
    assert(manifestOnlyRuntime.resolveCodeCheckDesignCodeFromSkillIds(["code-check-gb50018"]) === "GB50018", "code-check design-code resolution should use manifest-only skill metadata");
    assert(manifestOnlyRuntime.resolveCodeCheckSkillId("GB50018") === "code-check-gb50018", "code-check skill lookup should use manifest-only skill metadata");
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
  assert(typeof analysisEntry.listBuiltinAnalysisSkills === "undefined", "analysis entry should not re-export static metadata helpers once manifest-first runtime is active");
  assert(typeof analysisEntry.getBuiltinAnalysisSkill === "undefined", "analysis entry should not expose builtin analysis metadata lookup");
  assert(typeof analysisEntry.resolvePreferredBuiltinAnalysisSkill === "undefined", "analysis entry should not expose manifest selection logic directly");
  assert(typeof analysisRegistry.listBuiltinAnalysisSkills === "undefined", "analysis registry should not export static metadata helpers once manifest-first runtime is active");
  assert(typeof analysisRegistry.getBuiltinAnalysisSkill === "undefined", "analysis registry should not expose builtin analysis metadata lookup");
  assert(typeof analysisRegistry.resolvePreferredBuiltinAnalysisSkill === "undefined", "analysis registry should not expose manifest selection logic directly");
  assert(pythonAnalysisRegistrySource.includes("skill.yaml"), "python analysis runtime registry should discover builtin skills from skill.yaml");
  assert(!pythonAnalysisRegistrySource.includes("intent.md"), "python analysis runtime registry should not depend on intent.md frontmatter metadata");
  console.log("[ok] agent runtime loader contract");
}

async function validateAgentRuntimeBinder(context) {
  await runBackendBuildOnce(context);

  // AgentRuntimeBinder has been deleted; the LangGraph agent handles skill/tool
  // binding internally via the ReAct loop.  Verify that the new agent-service
  // module exists and exposes the expected constructor signature.
  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const AgentSkillRuntime = await importAgentSkillRuntime(context.rootDir);

  const skillRuntime = new AgentSkillRuntime();
  const svc = new LangGraphAgentService(skillRuntime);
  assert(typeof svc.run === "function", "LangGraphAgentService should expose run method");
  assert(typeof svc.runStream === "function", "LangGraphAgentService should expose runStream method");
  assert(typeof svc.listSkills === "function", "LangGraphAgentService should expose listSkills method");
  assert(typeof LangGraphAgentService.getProtocol === "function", "LangGraphAgentService should expose static getProtocol method");

  console.log("[ok] agent runtime binder contract (replaced by LangGraph agent)");
}

async function validateAgentToolsContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/api/v1/agent" });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/agent/tools",
  });
  assert(response.statusCode === 200, "agent/tools should return 200");

  const payload = response.json();
  assert(Array.isArray(payload.tools), "tools should be array");
  assert(payload.tools.every((tool) => typeof tool.name === "string" && typeof tool.description === "string"), "tool specs should have name and description");

  const toolNames = payload.tools.map((tool) => tool.name);
  assert(toolNames.includes("run_analysis"), "missing required tool: run_analysis");
  assert(toolNames.includes("validate_model"), "missing required tool: validate_model");
  assert(toolNames.includes("generate_report"), "missing required tool: generate_report");
  assert(toolNames.includes("run_code_check"), "missing required tool: run_code_check");

  await app.close();
  console.log("[ok] agent tools protocol contract");
}

async function validateAgentApiContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const captured = [];
  const originalRun = LangGraphAgentService.prototype.run;
  const mockRun = async function mockRun(params) {
    captured.push(params);
    return {
      conversationId: "conv-api-contract",
      traceId: "trace-api-contract",
      startedAt: "2026-03-09T00:00:00.000Z",
      completedAt: "2026-03-09T00:00:00.012Z",
      success: true,
      response: "ok",
      mode: "execution",
      toolCalls: [
        { tool: "validate_model", input: {}, status: "success", startedAt: new Date().toISOString() },
        { tool: "run_analysis", input: {}, status: "success", startedAt: new Date().toISOString() },
        { tool: "generate_report", input: {}, status: "success", startedAt: new Date().toISOString() },
      ],
    };
  };
  LangGraphAgentService.prototype.run = mockRun;

  let app;
  try {
    const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
    const { chatRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href);

    app = Fastify();
    await app.register(agentRoutes, { prefix: "/api/v1/agent" });
    await app.register(chatRoutes, { prefix: "/api/v1/chat" });

    const requestBody = {
      message: "请分析并导出报告",
      conversationId: "conv-api-1",
      traceId: "trace-request-001",
      context: {
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
        reportFormat: "both",
        reportOutput: "file",
      },
    };

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agent/run",
      payload: requestBody,
    });
    assert(runResponse.statusCode === 200, "agent/run should return 200");
    const runPayload = runResponse.json();
    assert(runPayload.traceId === "trace-api-contract", "agent/run should return traceId");
    assert(typeof runPayload.startedAt === "string", "agent/run should return startedAt");
    assert(typeof runPayload.completedAt === "string", "agent/run should return completedAt");
    assert(Array.isArray(runPayload.toolCalls), "agent/run should include toolCalls");

    const chatMessageResponse = await app.inject({
      method: "POST",
      url: "/api/v1/chat/message",
      payload: requestBody,
    });
    assert(chatMessageResponse.statusCode === 200, "chat/message should return 200");
    const chatMessagePayload = chatMessageResponse.json();
    assert(chatMessagePayload.result?.traceId === "trace-api-contract", "chat/message should proxy agent result");

    const legacyToolCallResponse = await app.inject({
      method: "POST",
      url: "/api/v1/chat/tool-call",
      payload: requestBody,
    });
    assert(legacyToolCallResponse.statusCode === 404, "chat/tool-call should no longer be exposed");

    assert(captured.length >= 2, "agent run should be called for both endpoints");
    assert(captured[0]?.traceId === "trace-request-001", "agent/run should pass traceId");
    assert(captured[1]?.traceId === "trace-request-001", "chat/message should pass traceId");
    assert(captured[0]?.context?.reportOutput === "file", "agent/run should pass reportOutput context");
    assert(captured[1]?.context?.reportFormat === "both", "chat/message should pass reportFormat context");

    console.log("[ok] agent api contract regression");
  } finally {
    LangGraphAgentService.prototype.run = originalRun;
    if (app) {
      await app.close();
    }
  }
}

async function validateAgentCapabilityMatrix(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const { AnalysisEngineCatalogService } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "analysis-engine.js")).href);
  const originalListEngines = AnalysisEngineCatalogService.prototype.listEngines;
  AnalysisEngineCatalogService.prototype.listEngines = async function mockListEngines() {
    return { engines: [{ id: "engine-frame-a", name: "Frame Engine A", enabled: true, available: true, status: "available", supportedModelFamilies: ["frame", "generic"], supportedAnalysisTypes: ["static", "dynamic"] }, { id: "engine-disabled", name: "Disabled Engine", enabled: false, available: true, status: "disabled", supportedModelFamilies: ["frame", "generic"], supportedAnalysisTypes: ["static"] }] };
  };
  let app;
  try {
    const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
    app = Fastify();
    await app.register(agentRoutes, { prefix: "/api/v1/agent" });
    const response = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix" });
    assert(response.statusCode === 200, "capability matrix route should return 200");
    const payload = response.json();
    assert(typeof payload.generatedAt === "string", "payload.generatedAt should be present");
    assert(Array.isArray(payload.skills), "payload.skills should be an array");
    assert(Array.isArray(payload.tools), "payload.tools should be an array");
    assert(Array.isArray(payload.engines), "payload.engines should be an array");
    assert(Array.isArray(payload.domainSummaries), "payload.domainSummaries should be an array");
    assert(payload.validEngineIdsBySkill && typeof payload.validEngineIdsBySkill === "object", "validEngineIdsBySkill should be an object");
    assert(payload.filteredEngineReasonsBySkill && typeof payload.filteredEngineReasonsBySkill === "object", "filteredEngineReasonsBySkill should be an object");
    assert(payload.skillDomainById && typeof payload.skillDomainById === "object", "skillDomainById should be an object");
    const toolIds = new Set(payload.tools.map((tool) => tool.id));
    assert(toolIds.has("run_analysis"), "capability matrix should expose run_analysis from the code-owned registry");
    assert(toolIds.has("validate_model"), "capability matrix should expose validate_model from the code-owned registry");
    assert(toolIds.has("generate_report"), "capability matrix should expose generate_report from the code-owned registry");
    assert(toolIds.has("run_code_check"), "capability matrix should expose run_code_check from the code-owned registry");
    assert(payload.tools.every((tool) => tool.source === "builtin"), "capability matrix tools should be marked as builtin code-owned tools");
    const frontendCategories = new Set(["modeling", "analysis", "code-check", "report", "utility"]);
    assert(payload.tools.every((tool) => frontendCategories.has(tool.category)), "capability matrix tools should use frontend-compatible categories");
    assert(payload.tools.find((tool) => tool.id === "run_analysis")?.category === "analysis", "run_analysis should be categorized for analysis UI");
    assert(payload.tools.find((tool) => tool.id === "run_code_check")?.category === "code-check", "run_code_check should be categorized for code-check UI");
    assert(payload.tools.find((tool) => tool.id === "generate_report")?.category === "report", "generate_report should be categorized for report UI");
    assert(payload.enabledToolIdsBySkill?.beam?.includes("run_analysis"), "beam should expose analysis tools through code-owned policy mapping");
    assert(payload.enabledToolIdsBySkill?.beam?.includes("generate_report"), "beam should expose report tools through code-owned policy mapping");
    assert(Array.isArray(payload.skillIdsByToolId?.run_analysis) && payload.skillIdsByToolId.run_analysis.includes("beam"), "skillIdsByToolId should invert enabled tool mappings");
    assert(payload.tools.every((tool) => Array.isArray(tool.requiresTools)), "capability matrix tools should expose requiresTools arrays");
    assert(payload.skillDomainById.beam === "structure-type", "beam should have structure-type domain mapping");
    assert(payload.skillDomainById["dead-load"] === "load-boundary", "discoverable load-boundary skills should be exposed in skillDomainById");
    assert(payload.skills.find((skill) => skill.id === "beam")?.runtimeStatus === "active", "beam should be marked active");
    assert(payload.skills.find((skill) => skill.id === "dead-load")?.runtimeStatus === "discoverable", "dead-load should be marked discoverable");
    assert(payload.validEngineIdsBySkill.beam.includes("engine-frame-a"), "beam should include frame-compatible engine");
    assert(!payload.validEngineIdsBySkill.beam.includes("engine-disabled"), "beam should not include disabled engine");
    assert(payload.filteredEngineReasonsBySkill.beam["engine-disabled"].includes("engine_disabled"), "beam should mark disabled engine reason");
    assert(Array.isArray(payload.analysisCompatibility.static.skillIds), "static analysis skill IDs should be an array");
    assert(payload.analysisCompatibility.static.baselinePolicyAvailable === true, "baseline policy should be available for static");
    const responseDynamic = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix?analysisType=dynamic" });
    assert(responseDynamic.statusCode === 200, "analysisType-specific capability matrix route should return 200");
    assert(responseDynamic.json().appliedAnalysisType === "dynamic", "payload should echo applied analysis type");
    AnalysisEngineCatalogService.prototype.listEngines = async function mockListEnginesFailure() { throw new Error("simulated engine catalog failure"); };
    const degradedResponse = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix" });
    assert(degradedResponse.statusCode === 200, "capability matrix route should degrade instead of failing when engine discovery errors");
    assert(Array.isArray(degradedResponse.json().engines) && degradedResponse.json().engines.length === 0, "degraded capability matrix should surface an empty engine list");
    console.log("[ok] agent capability matrix contract");
  } finally {
    AnalysisEngineCatalogService.prototype.listEngines = originalListEngines;
    if (app) await app.close();
  }
}

async function validateAgentSkillhubContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const stateDir = path.join(context.rootDir, ".runtime", "skillhub");
  const cacheFile = path.join(stateDir, "cache.json");

  await fsp.rm(stateDir, { recursive: true, force: true });

  const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/api/v1/agent" });

  const searchResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/search?q=seismic" });
  assert(searchResp.statusCode === 200, "search should return 200");
  const searchPayload = searchResp.json();
  assert(Array.isArray(searchPayload.items), "search should return items array");
  assert(searchPayload.items.length >= 1, "search should return matching items");
  const targetSkillId = searchPayload.items[0].id;
  assert(typeof targetSkillId === "string" && targetSkillId.length > 0, "search item should include id");

  const installResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: targetSkillId },
  });
  assert(installResp.statusCode === 200, "install should return 200");
  assert(installResp.json().installed === true, "install response should indicate installed");

  const listResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/installed" });
  assert(listResp.statusCode === 200, "installed list should return 200");
  const listPayload = listResp.json();
  assert(Array.isArray(listPayload.items), "installed list should include items array");
  assert(listPayload.items.some((item) => item.id === targetSkillId), "installed list should include installed skill");

  const disableResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/disable",
    payload: { skillId: targetSkillId },
  });
  assert(disableResp.statusCode === 200, "disable should return 200");
  assert(disableResp.json().enabled === false, "disable should set enabled=false");

  const enableResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/enable",
    payload: { skillId: targetSkillId },
  });
  assert(enableResp.statusCode === 200, "enable should return 200");
  assert(enableResp.json().enabled === true, "enable should set enabled=true");

  const uninstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/uninstall",
    payload: { skillId: targetSkillId },
  });
  assert(uninstallResp.statusCode === 200, "uninstall should return 200");
  assert(uninstallResp.json().uninstalled === true, "uninstall should remove installed skill");

  const listAfterResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/installed" });
  const listAfter = listAfterResp.json();
  assert(!listAfter.items.some((item) => item.id === targetSkillId), "uninstalled skill should not appear in installed list");

  const incompatibleSearchResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/search?q=future-runtime-only" });
  assert(incompatibleSearchResp.statusCode === 200, "incompatible search should return 200");
  const incompatibleSearchPayload = incompatibleSearchResp.json();
  const incompatibleSkill = incompatibleSearchPayload.items.find((item) => item.id === "skillhub.future-runtime-only");
  assert(Boolean(incompatibleSkill), "future-runtime-only skill should exist in catalog");
  assert(incompatibleSkill.compatibility.compatible === false, "future-runtime-only should be incompatible");
  assert(incompatibleSkill.compatibility.reasonCodes.includes("runtime_version_incompatible"), "future-runtime-only should report runtime version incompatibility");
  assert(incompatibleSkill.compatibility.reasonCodes.includes("skill_api_version_incompatible"), "future-runtime-only should report skill api incompatibility");

  const incompatibleInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.future-runtime-only" },
  });
  assert(incompatibleInstallResp.statusCode === 200, "incompatible install should return 200");
  const incompatibleInstallPayload = incompatibleInstallResp.json();
  assert(incompatibleInstallPayload.installed === true, "incompatible skill should still install");
  assert(incompatibleInstallPayload.enabled === false, "incompatible skill should auto-disable after install");
  assert(incompatibleInstallPayload.fallbackBehavior === "baseline_only", "incompatible skill should declare baseline fallback");
  assert(incompatibleInstallPayload.compatibilityStatus === "incompatible", "incompatible install should return incompatible status");

  const incompatibleEnableResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/enable",
    payload: { skillId: "skillhub.future-runtime-only" },
  });
  assert(incompatibleEnableResp.statusCode === 200, "incompatible enable should return 200");
  const incompatibleEnablePayload = incompatibleEnableResp.json();
  assert(incompatibleEnablePayload.enabled === false, "incompatible enable should remain disabled");
  assert(incompatibleEnablePayload.fallbackBehavior === "baseline_only", "incompatible enable should keep baseline fallback");

  const badSignatureInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.bad-signature-pack" },
  });
  assert(badSignatureInstallResp.statusCode === 200, "bad signature install should return 200");
  const badSignaturePayload = badSignatureInstallResp.json();
  assert(badSignaturePayload.installed === false, "bad signature skill should not install");
  assert(badSignaturePayload.integrityStatus === "rejected", "bad signature should be rejected");
  assert(badSignaturePayload.integrityReasonCodes.includes("signature_invalid"), "bad signature should report signature_invalid");

  const badChecksumInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.bad-checksum-pack" },
  });
  assert(badChecksumInstallResp.statusCode === 200, "bad checksum install should return 200");
  const badChecksumPayload = badChecksumInstallResp.json();
  assert(badChecksumPayload.installed === false, "bad checksum skill should not install");
  assert(badChecksumPayload.integrityStatus === "rejected", "bad checksum should be rejected");
  assert(badChecksumPayload.integrityReasonCodes.includes("checksum_mismatch"), "bad checksum should report checksum_mismatch");

  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.writeFile(
    cacheFile,
    JSON.stringify(
      {
        skills: {
          "skillhub.cached-only-pack": {
            id: "skillhub.cached-only-pack",
            version: "1.0.0",
            domain: "report-export",
            compatibility: {
              minRuntimeVersion: "0.1.0",
              skillApiVersion: "v1",
            },
            integrity: {
              checksum: "4f9beaa82c00cb7d4c679020ac6f5021536b9b5b13b7be2ad55e872fe414d2f4",
              signature: "sig:skillhub.cached-only-pack:1.0.0",
            },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  process.env.SCLAW_SKILLHUB_OFFLINE = "true";
  const offlineInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.cached-only-pack" },
  });
  assert(offlineInstallResp.statusCode === 200, "offline cache install should return 200");
  const offlineInstallPayload = offlineInstallResp.json();
  assert(offlineInstallPayload.installed === true, "offline cache install should succeed");
  assert(offlineInstallPayload.reusedFromCache === true, "offline cache install should indicate cache reuse");
  process.env.SCLAW_SKILLHUB_OFFLINE = "false";

  await app.close();
  await fsp.rm(stateDir, { recursive: true, force: true });
  console.log("[ok] agent skillhub contract");
}

async function validateAgentSkillhubCli(context) {
  await runBackendBuildOnce(context);

  const runCli = (args, envExtra = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(context.rootDir, "sclaw"), "skill", ...args],
        {
          cwd: context.rootDir,
          encoding: "utf8",
          env: {
            ...process.env,
            ...envExtra,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`CLI failed for ${args.join(" ")}: ${stderr || error.message}`));
            return;
          }
          resolve((stdout || "").trim());
        },
      );
    });

  const parseCliJson = (raw, label) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      throw new Error(`CLI output is empty for ${label}`);
    }
    const firstJsonCharIndex = text.search(/[\[{]/u);
    if (firstJsonCharIndex === -1) {
      throw new Error(`CLI output is not JSON for ${label}: ${text}`);
    }
    return JSON.parse(text.slice(firstJsonCharIndex));
  };

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sclaw-skillhub-cli-"));
  const state = { installed: false, enabled: false };
  const server = require("node:http").createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (!request.url) {
      response.end("{}");
      return;
    }

    if (request.url.startsWith("/api/v1/agent/skillhub/search")) {
      const items = state.installed
        ? [{ id: "skillhub.seismic-simplified-policy", installed: true, enabled: state.enabled }]
        : [{ id: "skillhub.seismic-simplified-policy", installed: false, enabled: false }];
      response.end(JSON.stringify({ items, total: 1 }));
      return;
    }
    if (request.url.startsWith("/api/v1/agent/skillhub/installed")) {
      response.end(JSON.stringify({ items: state.installed ? [{ id: "skillhub.seismic-simplified-policy", enabled: state.enabled }] : [] }));
      return;
    }

    if (request.method === "POST") {
      if (request.url.includes("/install")) {
        state.installed = true;
        state.enabled = true;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", installed: true, enabled: true }));
        return;
      }
      if (request.url.includes("/disable")) {
        state.enabled = false;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", enabled: false }));
        return;
      }
      if (request.url.includes("/enable")) {
        state.enabled = true;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", enabled: true }));
        return;
      }
      if (request.url.includes("/uninstall")) {
        state.installed = false;
        state.enabled = false;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", uninstalled: true }));
        return;
      }
    }

    response.end("{}");
  });

  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address.port);
    });
  });

  const env = {
    SCLAW_API_BASE: `http://127.0.0.1:${port}`,
  };

  const search = parseCliJson(await runCli(["search", "seismic"], env), "skill search");
  assert(Array.isArray(search.items) && search.items.length > 0, "search should return at least one item");
  const skillId = search.items[0].id;
  assert(typeof skillId === "string" && skillId.length > 0, "search result should provide skill id");

  const install = parseCliJson(await runCli(["install", skillId], env), "skill install");
  assert(install.installed === true, "install should mark installed true");
  const listAfterInstall = parseCliJson(await runCli(["list"], env), "skill list after install");
  assert(Array.isArray(listAfterInstall.items), "list should return items array");
  assert(listAfterInstall.items.some((item) => item.id === skillId), "list should include installed skill");

  const disable = parseCliJson(await runCli(["disable", skillId], env), "skill disable");
  assert(disable.enabled === false, "disable should set enabled=false");
  const enable = parseCliJson(await runCli(["enable", skillId], env), "skill enable");
  assert(enable.enabled === true, "enable should set enabled=true");
  const uninstall = parseCliJson(await runCli(["uninstall", skillId], env), "skill uninstall");
  assert(uninstall.uninstalled === true, "uninstall should remove skill");
  const listAfterUninstall = parseCliJson(await runCli(["list"], env), "skill list after uninstall");
  assert(!listAfterUninstall.items.some((item) => item.id === skillId), "uninstalled skill should not remain in list");

  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(tempRoot, { recursive: true, force: true });
  console.log("[ok] agent skillhub cli contract");
}

async function validateAgentSkillhubRepositoryDown(context) {
  await runBackendBuildOnce(context);
  process.env.SCLAW_SKILLHUB_FORCE_DOWN = "true";
  const Fastify = backendRequire(context.rootDir)("fastify");
  const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);

  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/api/v1/agent" });
  const searchResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/search?q=beam" });
  assert(searchResp.statusCode >= 500, "skillhub search should fail when repository is forced down");

  // Verify the agent service can be instantiated and used even when repository is down.
  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const AgentSkillRuntime = await importAgentSkillRuntime(context.rootDir);
  const skillRuntime = new AgentSkillRuntime();
  const svc = new LangGraphAgentService(skillRuntime);
  const { skills } = await svc.listSkills();
  assert(Array.isArray(skills) && skills.length > 0, "built-in skills should still be available when repository is down");

  await app.close();
  process.env.SCLAW_SKILLHUB_FORCE_DOWN = "false";
  console.log("[ok] skillhub repository-down fallback contract");
}

async function validateChatStreamContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const LangGraphAgentService = await importBackendAgentService(context.rootDir);
  const { prisma } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "utils", "database.js")).href);

  let capturedTraceId;
  let persistedAssistantMetadata;
  const originalRunStream = LangGraphAgentService.prototype.runStream;
  const originalConversationFindFirst = prisma.conversation.findFirst;
  const originalConversationUpdate = prisma.conversation.update;
  const originalMessageFindMany = prisma.message.findMany;
  const originalMessageCreateMany = prisma.message.createMany;
  const mockRunStream = async function* mockRunStream(params) {
    const request = params;
    capturedTraceId = request.traceId;
    const traceId = "stream-trace-001";
    yield { type: "start", content: { traceId, conversationId: "conv-stream-001", startedAt: "2026-03-09T00:00:00.000Z" } };
    yield {
      type: "presentation_init",
      presentation: {
        version: 3,
        mode: "execution",
        status: "streaming",
        summaryText: "",
        phases: [],
        artifacts: [],
        traceId,
        startedAt: "2026-03-09T00:00:00.000Z",
      },
    };
    yield {
      type: "phase_upsert",
      phase: {
        phaseId: "phase:modeling",
        phase: "modeling",
        title: "建模阶段",
        status: "running",
        steps: [],
      },
    };
    yield {
      type: "step_upsert",
      step: {
        id: "step:build_model:2026-03-09T00:00:00.002Z",
        phase: "modeling",
        status: "done",
        tool: "build_model",
        title: "已选择建模技能",
        reason: "routing",
        startedAt: "2026-03-09T00:00:00.002Z",
      },
      phaseId: "phase:modeling",
    };
    yield {
      type: "step_upsert",
      phaseId: "phase:modeling",
      step: {
        id: "step:build_model:2026-03-09T00:00:00.003Z",
        phase: "modeling",
        tool: "build_model",
        status: "running",
        title: "开始生成结构模型",
        reason: "draft model",
        startedAt: "2026-03-09T00:00:00.003Z",
      },
    };
    yield {
      type: "step_upsert",
      phaseId: "phase:understanding",
      step: {
        id: "step:clarify:2026-03-09T00:00:00.004Z",
        phase: "understanding",
        status: "done",
        title: "Need more modeling details",
        errorMessage: "Please provide the span and support conditions.",
        startedAt: "2026-03-09T00:00:00.004Z",
      },
    };
    yield {
      type: "artifact_upsert",
      artifact: {
        artifact: "model",
        status: "available",
        title: "结构模型",
        previewable: true,
        snapshotKey: "modelSnapshot",
      },
    };
    yield {
      type: "artifact_payload_sync",
      artifact: "model",
      model: { schema_version: "1.0.0" },
    };
    yield {
      type: "step_upsert",
      phaseId: "phase:modeling",
      step: {
        id: "step:build_model:2026-03-09T00:00:00.015Z",
        phase: "modeling",
        tool: "build_model",
        status: "done",
        title: "结构模型已生成",
        output: { model: { schema_version: "1.0.0" } },
        startedAt: "2026-03-09T00:00:00.015Z",
        completedAt: "2026-03-09T00:00:00.030Z",
        durationMs: 15,
      },
    };
    yield { type: "summary_replace", summaryText: "ok" };
    yield {
      type: "result",
      content: {
        traceId,
        conversationId: "conv-stream-001",
        startedAt: "2026-03-09T00:00:00.000Z",
        completedAt: "2026-03-09T00:00:00.008Z",
        success: true,
        response: "ok",
        mode: "execution",
        toolCalls: [],
      },
    };
    yield { type: "done" };
  };
  LangGraphAgentService.prototype.runStream = mockRunStream;
  prisma.conversation.findFirst = async () => ({ id: "conv-stream-001" });
  prisma.conversation.update = async () => ({ id: "conv-stream-001" });
  prisma.message.findMany = async () => [];
  prisma.message.createMany = async ({ data }) => {
    persistedAssistantMetadata = data.find((entry) => entry.role === "assistant")?.metadata;
    return { count: Array.isArray(data) ? data.length : 0 };
  };

  const parseSseEvents = (raw) =>
    raw
      .split("\n\n")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => chunk.slice("data: ".length));

  let app;
  try {
    const { chatRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href);
    app = Fastify();
    await app.register(chatRoutes, { prefix: "/api/v1/chat" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/chat/stream",
      headers: { origin: "http://localhost:30000" },
      payload: {
        message: "analyze this model",
        traceId: "trace-stream-request-1",
        context: { model: { schema_version: "1.0.0" } },
      },
    });

    assert(response.statusCode === 200, "chat/stream should return 200");
    assert(response.headers["access-control-allow-origin"] === "http://localhost:30000", "chat/stream should include access-control-allow-origin for allowed origin");
    assert(response.headers["access-control-allow-credentials"] === "true", "chat/stream should include access-control-allow-credentials for allowed origin");
    assert(String(response.headers.vary || "").includes("Origin"), "chat/stream should include Vary: Origin for allowed origin");
    const events = parseSseEvents(response.body);
    assert(events.length >= 4, "stream should include events and done marker");
    assert(events[events.length - 1] === "[DONE]", "stream should end with [DONE]");

    const chunks = events
      .filter((item) => item !== "[DONE]")
      .map((item) => JSON.parse(item));
    assert(chunks[0].type === "start", "first chunk should be start");
    assert(chunks.some((chunk) => chunk.type === "presentation_init"), "stream should contain presentation_init chunk");
    assert(chunks.some((chunk) => chunk.type === "phase_upsert"), "stream should contain phase_upsert chunk");
    assert(chunks.some((chunk) => chunk.type === "artifact_upsert"), "stream should contain artifact_upsert chunk");
    assert(chunks.some((chunk) => chunk.type === "artifact_payload_sync"), "stream should contain artifact_payload_sync chunk");
    assert(chunks.some((chunk) => chunk.type === "step_upsert" && chunk.phaseId === "phase:modeling"), "stream should contain phase-scoped step chunk");
    assert(chunks.some((chunk) => chunk.type === "result"), "stream should contain result chunk");
    assert(chunks[chunks.length - 1].type === "done", "last chunk before [DONE] should be done");
    assert(capturedTraceId === "trace-stream-request-1", "chat/stream should pass traceId to agent stream");
    assert(persistedAssistantMetadata?.presentation?.version === 3, "chat/stream should persist assistant presentation metadata");
    assert(
      persistedAssistantMetadata?.presentation?.summaryText === "ok",
      "chat/stream should persist the latest summaryText inside assistant presentation metadata",
    );
    assert(
      Array.isArray(persistedAssistantMetadata?.presentation?.phases)
        && persistedAssistantMetadata.presentation.phases.some((phase) => phase.phase === "modeling" && phase.steps.some((step) => step.tool === "build_model")),
      "chat/stream should persist modeling steps inside assistant presentation metadata",
    );

    const startTrace = chunks.find((chunk) => chunk.type === "start")?.content?.traceId;
    const resultTrace = chunks.find((chunk) => chunk.type === "result")?.content?.traceId;
    assert(startTrace && resultTrace && startTrace === resultTrace, "traceId should match between start and result");
    assert(typeof chunks.find((chunk) => chunk.type === "start")?.content?.startedAt === "string", "start event should include startedAt");

    const disallowedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/chat/stream",
      headers: { origin: "http://evil.example.com" },
      payload: {
        message: "analyze this model",
        traceId: "trace-stream-request-2",
        context: { model: { schema_version: "1.0.0" } },
      },
    });
    assert(disallowedResponse.headers["access-control-allow-origin"] === undefined, "chat/stream should omit access-control-allow-origin for disallowed origin");

    console.log("[ok] chat stream contract regression");
  } finally {
    LangGraphAgentService.prototype.runStream = originalRunStream;
    prisma.conversation.findFirst = originalConversationFindFirst;
    prisma.conversation.update = originalConversationUpdate;
    prisma.message.findMany = originalMessageFindMany;
    prisma.message.createMany = originalMessageCreateMany;
    if (app) {
      await app.close();
    }
  }
}

async function validateChatMessageRouting(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const LangGraphAgentService = await importBackendAgentService(context.rootDir);

  let agentRunCount = 0;
  const capturedRunTraceIds = [];
  const capturedRunMessages = [];
  const originalRun = LangGraphAgentService.prototype.run;

  const mockAgentRun = async function mockAgentRun(params) {
    const request = params;
    agentRunCount += 1;
    capturedRunTraceIds.push(request.traceId);
    capturedRunMessages.push(request.message);
    return {
      conversationId: "conv-route-001",
      traceId: "trace-route-001",
      startedAt: "2026-03-09T00:00:00.000Z",
      completedAt: "2026-03-09T00:00:00.006Z",
      success: true,
      response: "tool-ok",
      mode: "conversation",
      toolCalls: [],
    };
  };
  LangGraphAgentService.prototype.run = mockAgentRun;

  let app;
  try {
    const { chatRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href);
    app = Fastify();
    await app.register(chatRoutes, { prefix: "/api/v1/chat" });

    const autoChatResp = await app.inject({
      method: "POST",
      url: "/api/v1/chat/message",
      payload: {
        message: "auto without model",
        context: {
          skillIds: ["beam"],
        },
      },
    });
    assert(autoChatResp.statusCode === 200, "auto conversation response should be 200");
    const autoChatPayload = autoChatResp.json();
    assert(autoChatPayload.result?.response === "tool-ok", "agent-first conversation result should be returned");
    assert(autoChatPayload.result?.conversationId === "conv-route-001", "message response should include created conversationId");

  const autoConversationWithModelResp = await app.inject({
    method: "POST",
    url: "/api/v1/chat/message",
    payload: {
      message: "auto with model but no execution intent",
      traceId: "trace-route-auto-1",
      context: { model: { schema_version: "1.0.0" } },
    },
  });
  assert(autoConversationWithModelResp.statusCode === 200, "auto conversation-with-model response should be 200");
  const autoConversationWithModelPayload = autoConversationWithModelResp.json();
  assert(autoConversationWithModelPayload.result?.response === "tool-ok", "conversation with model should still route through agent");

  const autoToolResp = await app.inject({
    method: "POST",
    url: "/api/v1/chat/message",
    payload: {
      message: "analyze this model",
      traceId: "trace-route-auto-tool-1",
      context: { model: { schema_version: "1.0.0" } },
    },
  });
  assert(autoToolResp.statusCode === 200, "auto tool response should be 200");
  const autoToolPayload = autoToolResp.json();
  assert(autoToolPayload.result?.traceId === "trace-route-001", "tool result should be returned");

  const autoIntentExecResp = await app.inject({
    method: "POST",
    url: "/api/v1/chat/message",
    payload: {
      message: "请帮我做结构设计验算",
      traceId: "trace-route-auto-intent-1",
    },
  });
  assert(autoIntentExecResp.statusCode === 200, "auto intent tool response should be 200");
  assert(agentRunCount === 4, "agent run should be called for auto /chat/message requests");
  assert(capturedRunTraceIds.includes("trace-route-auto-1"), "agent-first message route should pass traceId for non-execution message");
  assert(capturedRunTraceIds.includes("trace-route-auto-tool-1"), "auto tool invocation should pass traceId");
  assert(capturedRunTraceIds.includes("trace-route-auto-intent-1"), "auto intent invocation should pass traceId");
  assert(capturedRunMessages.includes("auto without model"), "plain chat-like requests should now route through agent");

    const legacyToolCallResp = await app.inject({
      method: "POST",
      url: "/api/v1/chat/tool-call",
      payload: {
        message: "legacy force tool",
        traceId: "trace-route-tool-legacy-1",
      },
    });
    assert(legacyToolCallResp.statusCode === 404, "legacy /chat/tool-call endpoint should not be available");

    console.log("[ok] chat message routing contract");
  } finally {
    LangGraphAgentService.prototype.run = originalRun;
    if (app) {
      await app.close();
    }
  }
}

async function validateReportNarrativeContract(context) {
  context.backendBuildReady = false;
  await runBackendBuildOnce(context);
  clearProviderEnv();
  const LangGraphAgentService = await importBackendAgentServiceFresh(context.rootDir);
  const AgentSkillRuntime = await importAgentSkillRuntime(context.rootDir);

  const skillRuntime = new AgentSkillRuntime();
  const svc = new LangGraphAgentService(skillRuntime);

  // Verify the service can be instantiated and run returns the expected shape.
  // The LangGraph agent uses globalThis clients internally, so we just test
  // that the service interface is correct.
  const result = await svc.run({
    message: "请分析并按规范校核后出报告",
    context: {
      skillIds: ["beam", "opensees-static", "validation-structure-model", "report-export-builtin", "code-check-gb50017", "postprocess-builtin"],
      locale: "zh",
    },
  });

  assert(typeof result.success === "boolean", "run should return boolean success");
  assert(typeof result.response === "string", "run should return response string");
  assert(typeof result.conversationId === "string", "run should return conversationId");
  assert(typeof result.traceId === "string", "run should return traceId");
  assert(typeof result.startedAt === "string", "run should return startedAt");
  assert(typeof result.completedAt === "string", "run should return completedAt");
  assert(typeof result.mode === "string", "run should return mode string");
  assert(Array.isArray(result.toolCalls), "run should return toolCalls array");

  console.log("[ok] report narrative contract (LangGraph agent service shape)");
}

async function validateDevStartupGuards(context) {
  const cliMainPath = path.join(context.rootDir, "scripts", "cli", "main.js");
  const cliMainContent = await fsp.readFile(cliMainPath, "utf8");
  const cliRuntimePath = path.join(context.rootDir, "scripts", "cli", "runtime.js");
  const linuxNodeInstallerPath = path.join(context.rootDir, "scripts", "install-node-linux.sh");
  const windowsNodeInstallerPath = path.join(context.rootDir, "scripts", "install-node-windows.ps1");
  const readmePath = path.join(context.rootDir, "README.md");
  const readmeCnPath = path.join(context.rootDir, "README_CN.md");
  const [
    cliRuntimeContent,
    linuxNodeInstallerContent,
    windowsNodeInstallerContent,
    readmeContent,
    readmeCnContent,
  ] = await Promise.all([
    fsp.readFile(cliRuntimePath, "utf8"),
    fsp.readFile(linuxNodeInstallerPath, "utf8"),
    fsp.readFile(windowsNodeInstallerPath, "utf8"),
    fsp.readFile(readmePath, "utf8"),
    fsp.readFile(readmeCnPath, "utf8"),
  ]);
  const runtimePaths = runtime.resolvePaths(context.rootDir);

  console.log("Validating unified startup and docker command guards...");
  assert(COMMAND_NAMES.has("doctor"), "missing doctor command");
  assert(COMMAND_NAMES.has("start"), "missing start command");
  assert(COMMAND_NAMES.has("docker-install"), "missing docker-install command");
  assert(COMMAND_NAMES.has("docker-start"), "missing docker-start command");
  assert(COMMAND_NAMES.has("docker-stop"), "missing docker-stop command");
  assert(COMMAND_NAMES.has("docker-status"), "missing docker-status command");
  assert(COMMAND_NAMES.has("docker-logs"), "missing docker-logs command");
  assert(
    cliMainContent.includes("installedPackagesMatchLock"),
    "missing npm dependency drift detection in unified CLI",
  );
  assert(
    cliMainContent.includes("ensureAnalysisPython"),
    "missing analysis Python guard in unified CLI",
  );
  assert(
    !cliMainContent.includes("runtime.requireCommand(\"python\""),
    "doctor path should not hard-require system python before uv provisioning",
  );
  assert(
    cliMainContent.includes("appendSessionHeader"),
    "missing log session isolation hook in unified CLI",
  );
  assert(
    cliMainContent.includes("getPortCleanupOptions"),
    "missing scoped port cleanup options in unified CLI",
  );
  assert(
    cliMainContent.includes("SCLAW_FORCE_PORT_CLEANUP"),
    "missing opt-in untracked port cleanup guard in unified CLI",
  );
  assert(
    cliRuntimeContent.includes("normalizePortNumber"),
    "missing port sanitization in CLI runtime cleanup",
  );
  assert(
    cliRuntimeContent.includes("isProjectOwnedPortProcess"),
    "missing project ownership guard in CLI runtime cleanup",
  );
  assert(
    cliMainContent.includes("persistDockerEnv"),
    "missing docker env persistence in unified CLI",
  );
  assert(
    cliMainContent.includes("waitForDockerServices"),
    "missing docker readiness check in unified CLI",
  );
  assert(
    runtimePaths.analysisRequirementsFile.endsWith(
      path.join("backend", "src", "agent-skills", "analysis", "runtime", "requirements.txt"),
    ),
    "analysis requirements path is not aligned with the current runtime layout",
  );
  assert(
    linuxNodeInstallerContent.includes("nvm install"),
    "missing nvm-based Node auto installer for Linux",
  );
  assert(
    windowsNodeInstallerContent.includes("CoreyButler.NVMforWindows"),
    "missing nvm-windows installer hook for Windows",
  );
  assert(
    readmeContent.includes("./scripts/install-node-linux.sh")
      && readmeContent.includes("./scripts/install-node-windows.ps1"),
    "README should document Linux and Windows Node installer scripts",
  );
  assert(
    readmeCnContent.includes("./scripts/install-node-linux.sh")
      && readmeCnContent.includes("./scripts/install-node-windows.ps1"),
    "README_CN should document Linux and Windows Node installer scripts",
  );
  console.log("[ok] unified startup and docker command guards are present");
}

async function validateDockerBackendRuntimeAssets(context) {
  const dockerfilePath = path.join(context.rootDir, "backend", "Dockerfile");
  const dockerfileContent = await fsp.readFile(dockerfilePath, "utf8");

  assert(
    dockerfileContent.includes("COPY --from=builder /app/src/agent-skills ./src/agent-skills"),
    "backend Dockerfile should copy src/agent-skills into the runner image",
  );
  assert(
    !dockerfileContent.includes("COPY --from=builder /app/src/" + "agent-tools ./src/" + "agent-tools"),
    "backend Dockerfile should not copy the removed legacy tool asset directory",
  );

  console.log("[ok] docker backend runtime assets are present");
}

async function validateStructureJsonSkill(context) {
  await runBackendBuildOnce(context);

  // Test 1: Verify validation skill metadata comes from skill.yaml, not registry exports
  const { AgentSkillCatalogService } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-skill-catalog.js")).href
  );
  const entryModule = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "validation", "entry.js")).href
  );
  const registryModule = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "validation", "registry.js")).href
  );

  const skillCatalog = new AgentSkillCatalogService();
  const skill = await skillCatalog.getBuiltinSkillById("validation-structure-model");
  assert(skill !== undefined, "validation-structure-model should be discoverable from the manifest-backed skill catalog");
  assert(skill.canonicalId === "validation-structure-model", "validation skill should use the canonical manifest id");
  assert(skill.aliases.includes("structure-json-validation"), "validation skill should preserve the legacy alias from skill.yaml");
  assert(skill.domain === "validation", "validation skill should keep validation domain");
  assert(skill.triggers.includes("validate"), "validation skill should keep validate trigger");
  assert(skill.triggers.includes("验证"), "validation skill should keep Chinese validate trigger");
  assert(skill.autoLoadByDefault === true, "validation skill should auto-load by default");
  assert(skill.priority === 100, "validation skill priority should stay 100");
  assert(typeof entryModule.listBuiltinValidationSkills === "undefined", "validation entry should not re-export static registry metadata helpers");
  assert(typeof entryModule.getBuiltinValidationSkill === "undefined", "validation entry should not expose builtin metadata lookup");
  assert(typeof registryModule.listBuiltinValidationSkills === "undefined", "validation registry should not export static metadata helpers once manifest-first runtime is active");
  assert(typeof registryModule.getBuiltinValidationSkill === "undefined", "validation registry should not expose builtin metadata lookup");
  assert(typeof registryModule.findValidationSkillsByTrigger === "undefined", "validation registry should not expose trigger-based metadata lookup");
  assert(typeof registryModule.getValidationSkillCapabilities === "undefined", "validation registry should not expose capability lookup from frontmatter metadata");
  console.log("[ok] manifest-backed validation skill metadata");

  // Test 2: Test Python runtime directly via CLI
  const runtimePath = path.join(
    context.rootDir,
    "backend",
    "src",
    "agent-skills",
    "validation",
    "structure-json",
    "runtime.py"
  );

  // Helper to run Python validation
  const runPythonValidation = (jsonData, args = []) =>
    new Promise((resolve, reject) => {
      const proc = execFile(
        "python",
        [runtimePath, "--schema-version", "2.0.0", ...args, "-"],
        { encoding: "utf8" },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(new Error(`Python execution failed: ${stderr || error.message}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${stdout}`));
          }
        }
      );
      proc.stdin.write(typeof jsonData === "string" ? jsonData : JSON.stringify(jsonData));
      proc.stdin.end();
    });

  // Check if Python and schema validation are available
  let pythonAvailable = false;
  let schemaValidationAvailable = false;
  try {
    const checkResult = await runPythonValidation('{"test": true}', ["--no-semantic"]);
    pythonAvailable = true;
    schemaValidationAvailable = !checkResult.issues.some(i => i.code === "SCHEMA_VALIDATION_ERROR" && i.message.includes("not available"));
  } catch (e) {
    console.log(`[warn] Python runtime not available: ${e.message}`);
  }

  if (!pythonAvailable) {
    console.log("[skip] Python runtime tests (python not available)");
  } else if (!schemaValidationAvailable) {
    console.log("[skip] Schema validation tests (StructureModelV2 not available, install structure_protocol)");
  }

  if (!pythonAvailable || !schemaValidationAvailable) {
    console.log("[ok] validation skill tests completed with limitations");
    return;
  }

  // Test 2a: Valid minimal structure JSON
  const validModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
      { id: "2", x: 3, y: 0, z: 0 },
    ],
    elements: [{ id: "E1", type: "beam", nodes: ["1", "2"], material: "M1", section: "S1" }],
    materials: [{ id: "M1", name: "Steel", type: "steel", E: 205000, nu: 0.3, rho: 7850 }],
    sections: [{ id: "S1", name: "Rectangular 0.3x0.6", type: "rectangular", width: 0.3, height: 0.6 }],
    load_cases: [],
    load_combinations: [],
  };

  const validResult = await runPythonValidation(validModel);
  assert(validResult.valid === true, "valid model should pass validation");
  assert(validResult.summary.error_count === 0, "valid model should have no errors");
  assert(validResult.validated_model !== undefined, "valid model should return validated_model");
  console.log("[ok] python runtime validates correct model");

  // Test 2b: Invalid JSON syntax
  const invalidJsonResult = await runPythonValidation('{"invalid json');
  assert(invalidJsonResult.valid === false, "invalid JSON should fail");
  assert(invalidJsonResult.summary.error_count > 0, "invalid JSON should have errors");
  assert(invalidJsonResult.issues.some((i) => i.code === "JSON_SYNTAX_ERROR"), "should report JSON_SYNTAX_ERROR");
  console.log("[ok] python runtime detects syntax errors");

  // Test 2c: Schema validation errors (missing required fields)
  const incompleteModel = {
    schema_version: "2.0.0",
    nodes: [{ id: "1", x: 0, y: 0 }], // Missing z coordinate
  };
  const incompleteResult = await runPythonValidation(incompleteModel);
  assert(incompleteResult.valid === false, "incomplete model should fail validation");
  assert(incompleteResult.issues.length > 0, "incomplete model should have issues");
  console.log("[ok] python runtime detects schema errors");

  // Test 2d: Semantic validation errors (invalid references)
  const badRefModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0 },
      { id: "2", x: 3, y: 0, z: 0 },
    ],
    elements: [{ id: "E1", type: "beam", nodes: ["1", "999"], material: "M1", section: "S1" }], // Node 999 doesn't exist
    materials: [{ id: "M1", name: "Steel", type: "steel", E: 205000, nu: 0.3, rho: 7850 }],
    sections: [{ id: "S1", name: "Rectangular 0.3x0.6", type: "rectangular", width: 0.3, height: 0.6 }],
    load_cases: [],
    load_combinations: [],
  };
  const badRefResult = await runPythonValidation(badRefModel);
  assert(badRefResult.valid === false, "model with bad references should fail");
  assert(
    badRefResult.issues.some((i) => i.code === "SEMANTIC_INVALID_REFERENCE"),
    "should report SEMANTIC_INVALID_REFERENCE"
  );
  console.log("[ok] python runtime detects semantic errors");

  // Test 2e: Duplicate ID detection
  const dupIdModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0 },
      { id: "1", x: 3, y: 0, z: 0 }, // Duplicate ID
    ],
  };
  const dupIdResult = await runPythonValidation(dupIdModel);
  assert(dupIdResult.issues.some((i) => i.code === "SEMANTIC_DUPLICATE_ID"), "should report SEMANTIC_DUPLICATE_ID");
  console.log("[ok] python runtime detects duplicate IDs");

  // Test 2f: Material property validation
  const badMaterialModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0 },
      { id: "2", x: 3, y: 0, z: 0 },
    ],
    elements: [{ id: "E1", type: "beam", nodes: ["1", "2"], material: "M1", section: "S1" }],
    materials: [{ id: "M1", type: "steel", E: -1000, nu: 0.3, rho: 7850 }], // Negative E
    sections: [{ id: "S1", type: "rectangular", width: 0.3, height: 0.6 }],
    load_cases: [],
    load_combinations: [],
  };
  const badMatResult = await runPythonValidation(badMaterialModel);
  assert(
    badMatResult.issues.some((i) => i.code === "SEMANTIC_INVALID_VALUE" && i.path.includes("materials")),
    "should report invalid material value"
  );
  console.log("[ok] python runtime validates material properties");

  // Test 2g: Options - skip semantic validation
  const skipSemanticResult = await runPythonValidation(dupIdModel, ["--no-semantic"]);
  assert(skipSemanticResult.valid === true, "model with semantic-only issues should pass when semantic is skipped");
  console.log("[ok] python runtime respects --no-semantic flag");

  // Test 2h: Options - stop on first error
  const stopOnFirstResult = await runPythonValidation(incompleteModel, ["--stop-on-first-error"]);
  assert(stopOnFirstResult.issues.length <= 2, "should stop after first error");
  console.log("[ok] python runtime respects --stop-on-first-error flag");

  // Test 3: Verify runtime-facing validation exports still exist
  assert(typeof entryModule.VALIDATION_GET_ACTION_BY_PATH === "object", "validation entry should keep runtime action mapping exports");
  assert(typeof entryModule.VALIDATION_POST_ACTION_BY_PATH === "object", "validation entry should keep runtime action mapping exports");
  console.log("[ok] validation module runtime exports");
}

const BACKEND_VALIDATIONS = {
  "validate-agent-orchestration": validateAgentOrchestration,
  "validate-agent-base-chat-fallback": validateAgentBaseChatFallback,
  "validate-agent-capability-modes": validateAgentCapabilityModes,
  "validate-agent-manifest-binding": validateAgentManifestBinding,
  "validate-agent-manifest-loader": validateAgentManifestLoader,
  "validate-agent-runtime-loader": validateAgentRuntimeLoader,
  "validate-agent-runtime-binder": validateAgentRuntimeBinder,
  "validate-agent-tool-catalog": validateAgentToolCatalog,
  "validate-agent-skill-catalog-manifests": validateAgentSkillCatalogManifests,
  "validate-agent-tools-contract": validateAgentToolsContract,
  "validate-agent-api-contract": validateAgentApiContract,
  "validate-agent-capability-matrix": validateAgentCapabilityMatrix,
  "validate-agent-skillhub-contract": validateAgentSkillhubContract,
  "validate-agent-skillhub-cli": validateAgentSkillhubCli,
  "validate-agent-skillhub-repository-down": validateAgentSkillhubRepositoryDown,
  "validate-chat-stream-contract": validateChatStreamContract,
  "validate-chat-message-routing": validateChatMessageRouting,
  "validate-report-narrative-contract": validateReportNarrativeContract,
  "validate-dev-startup-guards": validateDevStartupGuards,
  "validate-docker-backend-runtime-assets": validateDockerBackendRuntimeAssets,
  "validate-structure-json-skill": validateStructureJsonSkill,
};

async function runBackendValidation(name, context) {
  const task = BACKEND_VALIDATIONS[name];
  if (!task) {
    throw new Error(`Unknown backend validation: ${name}`);
  }
  await task(context);
}

module.exports = {
  BACKEND_VALIDATIONS,
  runBackendValidation,
};
